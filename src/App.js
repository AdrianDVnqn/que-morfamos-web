import React, { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import { lanzarLluviaTono } from './utils/emojiRain.js';

// Avatar de participante del chat: una silueta en el color de quien habla. Es lo que ata el
// avatar con el nombre sin inventar caras ni cargar imagenes.
function AvatarChat({ color, emoji, inicial }) {
  // El Sommelier lleva cara propia y no inicial: ademas de darle identidad, marca que no es uno
  // mas del grupo. Va emoji y no una foto: una foto de stock implicaria una persona real que no
  // existe, y ademas habria que licenciarla.
  if (emoji) {
    return <span className="chat-avatar chat-avatar--bot" aria-hidden="true">{emoji}</span>;
  }
  // Para las personas, la inicial sobre el color de su nombre: se reconoce quien habla de un
  // vistazo mejor que con una silueta, que es igual para todos.
  return (
    <span className="chat-avatar" style={{ background: color }} aria-hidden="true">
      {inicial}
    </span>
  );
}

// Mini mapa estatico para la cabecera del detalle.
//
// Se arma con <img> de tiles y aritmetica de coordenadas en vez de montar un Leaflet: una
// instancia de Leaflet dentro de un modal hereda el problema de tamano cero que ya nos costo caro
// (el contenedor no tiene medidas hasta que el modal esta pintado), mas su propio ciclo de vida
// para algo que ni siquiera es interactivo. Asi es un puñado de imagenes y cero JS por cuadro.
//
// La cuenta es la proyeccion Web Mercator estandar: se pasa lat/lon a pixeles del mundo en el
// zoom dado, y se dibuja la ventana centrada en ese punto.
// zoom 14 y no 16: a 16 entran cuatro cuadras y el mapa no te ubica en ningun lado. A 14 se
// ve el barrio y la referencia sirve de verdad.
function MiniMapa({ lat, lng, urlTemplate, alto = 132, ancho = 640, zoom = 14 }) {
  if (!lat || !lng || Number.isNaN(lat) || Number.isNaN(lng)) return null;

  const TILE = 256;
  const n = Math.pow(2, zoom);
  const mundoX = ((lng + 180) / 360) * n * TILE;
  const la = (lat * Math.PI) / 180;
  const mundoY = ((1 - Math.asinh(Math.tan(la)) / Math.PI) / 2) * n * TILE;

  // Ventana visible, centrada en el lugar.
  const x0 = mundoX - ancho / 2;
  const y0 = mundoY - alto / 2;

  const tiles = [];
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + ancho) / TILE); tx++) {
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + alto) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const src = urlTemplate
        .replace('{z}', zoom)
        .replace('{x}', ((tx % n) + n) % n)
        .replace('{y}', ty)
        .replace('{r}', '');
      tiles.push(
        <img
          key={`${tx}-${ty}`}
          src={src}
          alt=""
          aria-hidden="true"
          draggable="false"
          style={{ position: 'absolute', left: tx * TILE - x0, top: ty * TILE - y0, width: TILE, height: TILE }}
        />
      );
    }
  }

  return (
    <div className="mini-mapa" style={{ height: alto, width: ancho }} aria-hidden="true">
      {tiles}
      <span className="mini-mapa__pin">📍</span>
    </div>
  );
}

// Componente para cambiar el TileLayer dinámicamente
function ChangeMapStyle({ url, attribution, detectRetina = true, maxNativeZoom }) {
  const map = useMap();
  useEffect(() => {
    // Forzar re-render del mapa cuando cambia el estilo
    map.invalidateSize();
  }, [map, url]);
  // Opciones recomendadas para mejorar la experiencia de carga de tiles
  const tileOpts = {
    attribution,
    detectRetina,
    maxNativeZoom,
    // keepBuffer 2 -> 6: cuantos anillos de tiles fuera del viewport se conservan. Con 2, al
    // panear apenas un poco las tiles salientes se descartaban y habia que volver a pedirlas.
    keepBuffer: 6,
    // updateWhenIdle true -> false: con true, Leaflet NO pide tiles mientras el mapa se mueve,
    // solo cuando se detiene. Eso es lo que se ve como "se borra y se regenera" al arrastrar.
    // En false las va cargando durante el movimiento.
    updateWhenIdle: false,
    // No re-renderiza tiles en cada frame de la animacion de zoom: mantiene las del zoom previo
    // hasta que la animacion termina, en vez de parpadear durante la transicion.
    updateWhenZooming: false,
  };

  return <TileLayer url={url} {...tileOpts} />;
}

// Precarga de tiles en el cache HTTP del navegador.
// ACOTADA A PROPOSITO POR CUOTA: el plan gratuito de Stadia son 200.000 creditos/mes y cada tile
// raster cuesta 1. Una version anterior de esto precargaba tambien z15..z19 alrededor de cada
// marcador para adelantarse al hover: eran ~140 tiles por busqueda de las cuales solo ~9 se
// veian, o sea ~1.400 busquedas/mes de techo. Se dejo solo la vista general (z12..z14 sobre el
// area de resultados, ~16 tiles), que es lo que el usuario ve SI o SI. El acercamiento del hover
// se carga bajo demanda: se paga solo por lo que realmente se mira, y queda cacheado despues.
// Lo que arreglo el parpadeo al panear no fue esto sino updateWhenIdle:false + keepBuffer:6.
function tileXY(lat, lon, z) {
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const la = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(la)) / Math.PI) / 2) * n);
  return { x, y };
}

function PrecargarTiles({ locations, urlTemplate }) {
  useEffect(() => {
    if (!locations || locations.length === 0 || !urlTemplate) return;
    const vistos = new Set();
    const urls = [];
    const agregar = (z, x, y) => {
      const clave = `${z}/${x}/${y}`;
      if (vistos.has(clave)) return;
      vistos.add(clave);
      urls.push(
        urlTemplate
          .replace('{z}', z).replace('{x}', x).replace('{y}', y)
          .replace('{r}', '').replace('{s}', 'a')
      );
    };

    // Vista general: area que cubre todos los resultados
    const lats = locations.map(l => l.lat), lons = locations.map(l => l.lng);
    const bbox = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
    for (let z = 12; z <= 14; z++) {
      const a = tileXY(bbox[1], bbox[2], z), b = tileXY(bbox[0], bbox[3], z);
      for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++)
        for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) agregar(z, x, y);
    }
    // De a poco y sin bloquear: el navegador limita las conexiones por host igual.
    let i = 0;
    const id = setInterval(() => {
      for (let k = 0; k < 6 && i < urls.length; k++, i++) { const im = new Image(); im.src = urls[i]; }
      if (i >= urls.length) clearInterval(id);
    }, 120);
    return () => clearInterval(id);
  }, [locations, urlTemplate]);
  return null;
}

// Componente para forzar que el mapa cargue correctamente
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    // Forzar recalcular tamaño después de varios delays para cubrir el caso
    // donde el contenedor padre cambia de tamaño cuando carga el contenido
    // Antes eran cuatro invalidateSize (100/300/500/1000ms). Cada uno fuerza un redibujado
    // completo de tiles y marcadores; con el ResizeObserver de abajo observando el contenedor,
    // los tres ultimos eran redundantes.
    const timers = [setTimeout(() => map.invalidateSize(), 150)];

    // También invalidar cuando la ventana cambia de tamaño
    const handleResize = () => map.invalidateSize();
    window.addEventListener('resize', handleResize);

    // Observar cambios en el contenedor del mapa.
    // invalidateSize() puede cambiar el layout y volver a disparar al observer, asi que se
    // coalescen las notificaciones en un solo frame y se omite si el tamano no cambio de verdad.
    const container = map.getContainer().parentElement;
    let rafId = null;
    let ultimo = { w: 0, h: 0 };
    const resizeObserver = new ResizeObserver((entries) => {
      const r = entries[0] && entries[0].contentRect;
      if (r && Math.abs(r.width - ultimo.w) < 1 && Math.abs(r.height - ultimo.h) < 1) return;
      if (r) ultimo = { w: r.width, h: r.height };
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => { rafId = null; map.invalidateSize(); });
    });
    if (container) {
      resizeObserver.observe(container);
    }

    return () => {
      timers.forEach(t => clearTimeout(t));
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, [map]);
  return null;
}

// Corre `fn` cuando el mapa tenga tamano real, y no antes.
//
// Por que existe: en mobile el mapa vive detras de la pestana "Mapa", asi que cuando llegan los
// resultados esta oculto y mide 0x0. Medido instrumentando las llamadas de camara:
//     fitBounds  size: { x: 0, y: 0 }
//     setView    size: { x: 0, y: 0 }
// Leaflet divide por el tamano del contenedor para armar la animacion: con 0 la cuenta da NaN, y
// cuando el panel se vuelve visible proyecta desde ahi y tira "Invalid LatLng object: (NaN, NaN)"
// en loop. El try/catch que habia alrededor no servia porque el throw ocurre despues, dentro de
// un requestAnimationFrame. Validar las coordenadas tampoco: las coordenadas estaban bien.
function cuandoTengaTamano(map, fn) {
  const cont = map.getContainer();
  const listo = () => cont.clientWidth > 0 && cont.clientHeight > 0;

  const ejecutar = () => {
    // getSize() esta cacheado: si el contenedor cambio de tamano mientras estaba oculto, Leaflet
    // sigue creyendo que mide lo de antes hasta que se lo invalida. Preguntarle a el en vez de al
    // DOM fue justamente el error de la primera version de este helper: el observer disparaba,
    // getSize() seguia devolviendo 0x0 y el encuadre no se hacia nunca.
    const s = map.getSize();
    if (s.x !== cont.clientWidth || s.y !== cont.clientHeight) map.invalidateSize();
    fn();
  };

  if (listo()) {
    ejecutar();
    return () => { };
  }
  const obs = new ResizeObserver(() => {
    if (!listo()) return;
    obs.disconnect();
    ejecutar();
  });
  obs.observe(cont);
  return () => obs.disconnect();
}

// Quien pidio menos movimiento en el sistema no quiere que el mapa le vuele en la cara.
function movimientoReducido() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Componente para ajustar el zoom para mostrar todos los marcadores
// Ahora recibe 'trigger' para saber cuándo recalcular (ej: al cambiar de tab)
function FitBounds({ locations, trigger }) {
  const map = useMap();
  // Stadia tiene datos hasta z20 en Neuquen, asi que se puede acercar de verdad. (Con el
  // basemap anterior habia que topar en 16 porque de z17 en adelante devolvia placeholders.)
  const DEFAULT_SINGLE_ZOOM = 18;
  const FIT_PADDING = [40, 40];

  useEffect(() => {
    if (!locations || locations.length === 0) return;

    // Antes esto era invalidateSize() + setTimeout(150) y a encomendarse: adivinar cuanto tarda
    // el layout. En mobile el mapa esta oculto detras de la pestana, asi que a los 150ms seguia
    // midiendo 0x0 y encuadraba contra la nada. Ahora se espera al tamano real, sea cuando sea.
    const cancelar = cuandoTengaTamano(map, () => {
      try {
        if (locations.length === 1) {
          const loc = locations[0];
          if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number' && !isNaN(loc.lat) && !isNaN(loc.lng)) {
            // Animación suave al centro
            map.flyTo([loc.lat, loc.lng], DEFAULT_SINGLE_ZOOM, { duration: 0.8 });
          }
        } else {
          const validLocs = locations.filter(l => typeof l.lat === 'number' && typeof l.lng === 'number' && !isNaN(l.lat) && !isNaN(l.lng));
          if (validLocs.length > 0) {
            const bounds = L.latLngBounds(validLocs.map(loc => [loc.lat, loc.lng]));
            if (bounds.isValid()) {
              // Usamos flyToBounds para una transición suave o fitBounds para instantánea
              map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: 16, animate: true, duration: 0.8 });
            }
          }
        }
      } catch (e) { console.warn('FitBounds error:', e); }
    });

    return cancelar;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, locations, trigger]);

  return null;
}

// Cuando el usuario hoverea una tarjeta, el marcador correspondiente se destaca (ver
// .marker-highlighted en App.css) y el mapa NO se mueve. Este componente solo se ocupa del caso
// borde: que el marcador destacado haya quedado fuera de la vista.
//
// Por que el mapa no se mueve, si antes volaba hasta el lugar:
//   - Hover es la senal mas debil que existe en una interfaz: el mouse pasa por encima de las
//     cosas sin que el usuario lo decida. Mover la camara es la accion mas fuerte que se le puede
//     hacer al mapa, porque le saca el encuadre que eligio. Gastar la accion mas fuerte en la
//     senal mas debil es lo que hacia que se sintiera fuera de control.
//   - Peor: acercarse a un lugar borra del mapa a los otros cuatro. Al hoverear una tarjeta la
//     pregunta es "donde queda este respecto de los demas", y el zoom destruia justamente la
//     informacion por la que el mapa esta ahi.
// Es lo que hacen Airbnb, Booking, Zillow e Idealista: hover destaca el pin, el movimiento queda
// reservado para el click.
function AsegurarHoverVisible({ centerOn, locations }) {
  const map = useMap();

  // Misma espera que antes: descarta las tarjetas que el mouse solo roza de paso.
  const RETARDO_MS = 130;
  // Margen en pixeles, no en porcentaje. Con porcentaje, el mismo numero significaba cosas muy
  // distintas segun la forma del panel: en el mapa de escritorio (angosto y alto) un 12% eran
  // ~120px arriba y abajo, mientras FitBounds deja los marcadores a 40px del borde — asi que
  // marcadores perfectamente visibles contaban como "afuera" y el mapa paneaba de gusto.
  // 32px queda comodamente por dentro de ese padding: un marcador recien encuadrado no dispara
  // nada, y solo se panea si de verdad quedo fuera de la pantalla.
  const MARGEN_PX = 32;

  const temporizador = useRef(null);
  const cancelarEspera = useRef(null);

  useEffect(() => {
    clearTimeout(temporizador.current);
    if (!centerOn || !locations || locations.length === 0) return;

    const loc = locations.find(l => l.nombre === centerOn);
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number'
      || isNaN(loc.lat) || isNaN(loc.lng)) return;

    temporizador.current = setTimeout(() => {
      cancelarEspera.current && cancelarEspera.current();
      cancelarEspera.current = cuandoTengaTamano(map, () => {
        try {
          const punto = L.latLng(loc.lat, loc.lng);
          const p = map.latLngToContainerPoint(punto);
          const tam = map.getSize();
          const seVe = p.x >= MARGEN_PX && p.y >= MARGEN_PX
            && p.x <= tam.x - MARGEN_PX && p.y <= tam.y - MARGEN_PX;
          // Si ya se ve, no se toca nada. Quedarse quieto es la respuesta correcta casi siempre.
          if (seVe) return;
          // Y si hay que traerlo, se desplaza sin tocar el zoom: el usuario conserva su escala.
          // Ojo con NO pasar animate:true aca: eso anula la guarda de Leaflet que evita animar
          // distancias enormes. Si el usuario arrastro el mapa a la otra punta, animar el paneo
          // significa barrer media provincia pixel a pixel; sin el flag, Leaflet reposiciona de
          // una cuando el destino no entra en pantalla, y anima solo los tramos cortos.
          map.panTo(punto, movimientoReducido() ? { animate: false } : { duration: 0.4 });
        } catch (e) { console.warn('AsegurarHoverVisible:', e); }
      });
    }, RETARDO_MS);

    return () => {
      clearTimeout(temporizador.current);
      cancelarEspera.current && cancelarEspera.current();
    };
  }, [centerOn, locations, map]);

  return null;
}

function MapKick({ visible, mapRef }) {
  useEffect(() => {
    if (!visible || !mapRef?.current) return;
    // Antes eran cuatro invalidateSize (60/180/420/900ms) cada vez que se mostraba la pestana del
    // mapa. Alcanza con uno: el ResizeObserver de MapResizer ya reacciona cuando el contenedor
    // pasa de oculto a visible y toma tamano real.
    const timers = [120].map((ms) => setTimeout(() => {
      try { mapRef.current.invalidateSize(); } catch (e) { console.warn('[MapKick] invalidate failed', e); }
    }, ms));
    return () => timers.forEach(t => clearTimeout(t));
  }, [visible, mapRef]);
  return null;
}

// Fix para iconos de Leaflet en React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Función para crear icono con emoji dinámico
// El marcador es una pildora con el emoji y el rating. El emoji lo elige la CONSULTA, no el
// lugar, asi que los cinco marcadores de una busqueda son identicos entre si: sin el numero, el
// mapa no dice cual es cual y hay que ir y volver a la lista para averiguarlo.
// El contenedor va con ancho fijo (Leaflet lo posiciona por iconSize/iconAnchor) y la pildora se
// centra adentro, asi el anclaje no depende de cuanto mida el texto.
// Los marcadores caen en cascada, en el orden en que el bot los recomendo: el escalonado no es
// adorno, es lo que hace visible que hay un ranking. Se topea a los 10 primeros para que una
// lista larga no tarde una eternidad en terminar de aparecer.
const RETARDO_CASCADA_MS = 60;

const createFoodIcon = (emoji, rating, indice = 0) => L.divIcon({
  html: `<div class="marker-pill" style="animation-delay:${Math.min(indice, 9) * RETARDO_CASCADA_MS}ms">`
    + `<span class="marker-pill__emoji">${emoji}</span>`
    + (rating ? `<span class="marker-pill__rating">${rating}</span>` : '')
    + `</div>`,
  className: 'food-marker',
  iconSize: [64, 30],
  iconAnchor: [32, 15],
  popupAnchor: [0, -18]
});

// El rating llega en la tarjeta o en la ubicacion segun por donde haya venido el dato; misma
// precedencia que ya usaba el popup del marcador.
const ratingDe = (loc, cards) => {
  const card = (cards || []).find(c => c.nombre.toLowerCase() === loc.nombre.toLowerCase());
  const r = (card && card.rating > 0) ? card.rating : loc.rating;
  return (typeof r === 'number' && r > 0) ? r.toFixed(1) : null;
};

// Detectar tipo de comida y devolver emoji correspondiente
const detectFoodType = (query) => {
  const q = query.toLowerCase();

  // Pizza
  if (q.includes('pizza') || q.includes('pizzer')) return '🍕';

  // Hamburguesas
  if (q.includes('hamburguesa') || q.includes('burger') || q.includes('hamburgueseria')) return '🍔';

  // Pasta
  if (q.includes('pasta') || q.includes('fideos') || q.includes('ravioles') || q.includes('ñoquis')) return '🍝';

  // Sushi / Japonés
  if (q.includes('sushi') || q.includes('japon') || q.includes('rolls')) return '🍣';

  // Tacos / Mexicano
  if (q.includes('taco') || q.includes('mexican') || q.includes('burrito')) return '🌮';

  // Parrilla / Carne / Asado
  if (q.includes('parrilla') || q.includes('asado') || q.includes('carne') || q.includes('bife')) return '🥩';

  // Facturas / Medialunas / Panadería
  if (q.includes('factura') || q.includes('medialuna') || q.includes('croissant') || q.includes('panader')) return '🥐';

  // Café / Desayuno
  if (q.includes('cafe') || q.includes('café') || q.includes('desayuno') || q.includes('brunch')) return '☕';

  // Helado
  if (q.includes('helado') || q.includes('heladeria')) return '🍦';

  // Cervecería / Cerveza / Birra
  if (q.includes('cerveza') || q.includes('cerveceria') || q.includes('cervecería') || q.includes('birra') || q.includes('growler')) return '🍺';

  // Bar / Cocktails
  if (q.includes('bar') || q.includes('cocktail') || q.includes('trago') || q.includes('drink')) return '🍸';

  // Vegano / Vegetariano
  if (q.includes('vegano') || q.includes('vegetariano') || q.includes('ensalada')) return '🥗';

  // Empanadas
  if (q.includes('empanada')) return '🥟';

  // Postres / Dulce
  if (q.includes('postre') || q.includes('torta') || q.includes('dulce')) return '🍰';

  // Por defecto: plato genérico
  return '🍽️';
};

// Función para obtener la URL del backend
const getBackendURL = () => {
  // Aceptar ambas formas de variable de entorno usadas en distintos despliegues
  const envUrl = process.env.REACT_APP_API_URL || process.env.REACT_APP_BACKEND_URL;
  if (envUrl) return envUrl;

  // En desarrollo, usar localhost
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:8000';
  }

  // En producción, usar la misma IP que el frontend pero puerto 8000
  return `http://${window.location.hostname}:8000`;
};

// URL del API - se adapta automáticamente o usa túnel
const API_URL = getBackendURL();

const formatStatusDate = (value) => {
  if (!value) return 'No disponible';
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = dateOnly
    ? (() => {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year, month - 1, day);
    })()
    : new Date(value);
  if (Number.isNaN(date.getTime())) return 'No disponible';
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getNextWeeklyRun = () => {
  const next = new Date();
  next.setHours(22, 0, 0, 0);
  const daysUntilSunday = (7 - next.getDay()) % 7;
  next.setDate(next.getDate() + daysUntilSunday);
  if (next <= new Date()) next.setDate(next.getDate() + 7);
  return next;
};

const getNextMonthlyRun = () => {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  if (next <= now) next.setMonth(next.getMonth() + 1);
  return next;
};

const formatNextRun = (date) => date.toLocaleString('es-AR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

// Formato compacto para el pie: 23/08/26 - 5:21 am. En una linea con cuatro fechas, el formato
// largo ("23 de ago de 2026, 05:21 a. m.") satura; este dice lo mismo en la mitad de caracteres.
// Se omite la zona horaria: todo el proyecto es de Neuquen y aclarar ART en cada item era ruido.
const _aHoraCompacta = (date) =>
  date
    .toLocaleTimeString('es-AR', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s*a\.\s*m\.?/i, ' am')
    .replace(/\s*p\.\s*m\.?/i, ' pm')
    .replace(/\s+/g, ' ')
    .trim();

const formatCompacta = (value) => {
  if (!value) return null;
  const soloFecha = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = soloFecha
    ? (() => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); })()
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const dia = date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return `${dia} - ${_aHoraCompacta(date)}`;
};

// Fondo slideshow (imágenes difuminadas y mezcladas con el tema)
const BACKGROUND_IMAGES = [
  'https://images.unsplash.com/photo-1762047314688-b59b04b5f5de?q=80&w=928&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  'https://plus.unsplash.com/premium_photo-1675252369719-dd52bc69c3df?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?q=80&w=820&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  'https://images.unsplash.com/photo-1592861956120-e524fc739696?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'
];

// Imágenes específicas por categoría
const BG_PIZZERIA = 'https://images.unsplash.com/photo-1593504049359-74330189a345?q=80&w=627&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';
const BG_BAKERY = 'https://images.unsplash.com/photo-1568254183919-78a4f43a2877?q=80&w=1738&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';
const BG_BARS = 'https://images.unsplash.com/photo-1569924995012-c4c706bfcd51?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';
const BG_PARRILLA = 'https://images.unsplash.com/photo-1529694157872-4e0c0f3b238b?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';
const BG_VEGANO = 'https://images.unsplash.com/photo-1511690078903-71dc5a49f5e3?q=80&w=928&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';
const BG_HELADOS = 'https://images.unsplash.com/photo-1567206563064-6f60f40a2b57?q=80&w=1548&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';
const BG_HAMBURGUESA = 'https://images.unsplash.com/photo-1695606392809-0da228da6b83?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';
const BG_SUSHI = 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';
// Empanadas
const BG_EMPANADAS = 'https://images.unsplash.com/photo-1619926096619-5956ab4dfb1b?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';

// Configurar axios: solo añadir header para localtunnel cuando se use
const axiosConfig = {};
if (process.env.REACT_APP_BACKEND_URL && process.env.REACT_APP_BACKEND_URL.includes('loca.lt')) {
  axiosConfig.headers = { 'bypass-tunnel-reminder': 'true' };
}

// Estilo de mapa oscuro: Stadia Maps "Alidade Smooth Dark".
// Historial de esta decision:
//  - CARTO dark_all (tier anonimo): dejo de servirse sin key; su plan gratis es trial de 14 dias.
//  - OpenStreetMap + filtro CSS invert/hue-rotate: mapa de proposito general, demasiado detalle,
//    y habia que filtrar tile por tile. Ruidoso y lento.
//  - Esri Dark Gray Canvas: rapido y sin key, pero en Neuquen solo tiene datos hasta z16
//    (verificado pidiendo z11..z19: de z17 en adelante devuelve siempre el mismo placeholder
//    "Map data not yet available"), asi que se rompia al acercarse.
//  - Stadia: datos reales hasta z20 (verificado igual), oscuro nativo y plan gratuito permanente.
// La key va por env. En una SPA queda embebida en el bundle y es publica: Stadia lo contempla y
// se protege restringiendo por dominio desde su panel, no ocultandola.
const MAP_STYLE = {
  url: `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key=${process.env.REACT_APP_STADIA_KEY || ''}`,
  attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  detectRetina: true
};

function App() {
  // Preload background slideshow images early so they display quickly
  useEffect(() => {
    const imagesToPreload = [
      ...BACKGROUND_IMAGES,
      BG_PIZZERIA,
      BG_BAKERY,
      BG_BARS,
      BG_PARRILLA,
      BG_EMPANADAS,
      BG_VEGANO,
      BG_HELADOS,
      BG_HAMBURGUESA,
      BG_SUSHI
    ];
    imagesToPreload.forEach(src => {
      const img = new Image();
      img.src = src;
    });
  }, []);
  // La bienvenida se representa como una CONVERSACION que se va escribiendo sola, no como un
  // cartel. Dos personas intentando decidir donde comer —que es la escena que todo el mundo
  // vivio— y el bot cortandola. Dramatiza el problema en vez de describirlo, y de paso muestra
  // como se ve el chat antes de que escribas nada.
  // Arranca vacia: la llena BIENVENIDA con temporizadores (ver el efecto mas abajo).
  const [messages, setMessages] = useState([]);
  // La bienvenida terminada cuenta como "pagina inicial" aunque tenga 4 mensajes: varios lugares
  // preguntaban messages.length <= 1 para saberlo, y eso se rompia al partirla en varios.
  const [bienvenidaEnCurso, setBienvenidaEnCurso] = useState(true);
  // Sonidito de mensaje.
  //
  // Se SINTETIZA con Web Audio en vez de reproducir un archivo: el tono de WhatsApp es marca
  // registrada, y ademas asi no hay assets que cargar ni licencias que revisar.
  //
  // Ojo con las expectativas: los navegadores bloquean el audio hasta que hubo una interaccion
  // del usuario, asi que en la PRIMERA carga la escena de bienvenida va a ser muda. No es un bug
  // ni algo que se pueda esquivar. De ahi en adelante suena normal, porque cualquier mensaje
  // posterior viene despues de que el usuario escribio o toco algo.
  const audioRef = useRef(null);
  const [sonidoActivo, setSonidoActivo] = useState(() => {
    try { return localStorage.getItem('qm_sonido') !== 'off'; } catch { return true; }
  });

  // Un tono de notificacion no es UN pitido: son dos notas cortas, la segunda mas alta, con
  // ataque casi instantaneo y caida rapida. Eso es lo que el oido reconoce como "mensaje" y no
  // como alarma. Se le suma una octava por debajo a volumen bajo para darle cuerpo, si no suena
  // a beep de microondas.
  const reproducirBlip = (saliente = false) => {
    if (!sonidoActivo) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioRef.current) audioRef.current = new Ctx();
      const ctx = audioRef.current;
      if (ctx.state === 'suspended') return;  // bloqueado por el navegador: no insistimos

      // Saliente (lo que "manda" el usuario) va mas agudo y mas corto; entrante mas redondo.
      const notas = saliente ? [1046, 1568] : [784, 1175];
      const salida = ctx.createGain();
      salida.gain.value = 0.16;
      // Un pasabajos suave le saca el filo metalico de la onda cruda.
      const filtro = ctx.createBiquadFilter();
      filtro.type = 'lowpass';
      filtro.frequency.value = 2600;
      salida.connect(filtro).connect(ctx.destination);

      notas.forEach((hz, i) => {
        const t0 = ctx.currentTime + i * 0.075;
        [[hz, 1], [hz / 2, 0.35]].forEach(([f, peso]) => {
          const osc = ctx.createOscillator();
          const vol = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f, t0);
          vol.gain.setValueAtTime(0.0001, t0);
          vol.gain.exponentialRampToValueAtTime(0.9 * peso, t0 + 0.008);  // ataque casi seco
          vol.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);       // y se apaga rapido
          osc.connect(vol).connect(salida);
          osc.start(t0);
          osc.stop(t0 + 0.18);
        });
      });
    } catch { /* si el navegador no deja, no pasa nada */ }
  };

  // Cualquier interaccion del usuario habilita el audio: el navegador mantiene el contexto
  // suspendido hasta que hay un gesto.
  useEffect(() => {
    const despertarAudio = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!audioRef.current && Ctx) audioRef.current = new Ctx();
        if (audioRef.current?.state === 'suspended') audioRef.current.resume();
      } catch { /* ignorado */ }
    };
    window.addEventListener('pointerdown', despertarAudio, { once: true });
    window.addEventListener('keydown', despertarAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', despertarAudio);
      window.removeEventListener('keydown', despertarAudio);
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem('qm_sonido', sonidoActivo ? 'on' : 'off'); } catch { /* ignorado */ }
  }, [sonidoActivo]);

  // Guion de la escena. `pausa` es lo que se espera ANTES de mostrar el mensaje, y sale del
  // largo del texto: un mensaje corto se escribe rapido y uno largo tarda, que es lo que hace
  // que se sienta gente tipeando y no un temporizador.
  // Chat de grupo. Cada uno pide algo distinto —burger, vegano, empanadas— asi que la escena
  // muestra el RANGO del bot sin tener que explicarlo, ademas de dramatizar el problema.
  // Los nombres van en colores distintos como en WhatsApp: es lo que hace que se lea como un
  // grupo y no como una persona hablando sola.
  const EMOJI_BOT = '🧐';  // el monoculo ES el personaje, y ya aparece en su mensaje
  const COLOR_BOT = '#ff8fa3';  // el rosa de marca, aclarado para que se lea sobre el ciruela

  // La escena se arma sola en cada carga: cambian quienes aparecen y que pide cada uno, asi el
  // que vuelve a entrar no ve siempre lo mismo. Se calcula una sola vez por montaje (useMemo con
  // deps vacias); si se recalculara en cada render, los nombres bailarian mientras se actua.
  const BIENVENIDA = useMemo(() => {
    const POOL = ['Vic', 'Sabro', 'Lauti', 'Colo', 'Edu', 'Santi', 'Fabio', 'Juli',
      'Juan', 'Fer', 'Stefa', 'Vicky', 'Lau', 'Lia', 'Dani'];
    const COLORES = ['#7fd1ff', '#ffb27f', '#8ee6a8', '#c9a7ff', '#ffd479', '#8fd4c8'];
    // Pedidos variados para el resto. Edu y Sabro tienen el suyo fijo (ver mas abajo).
    // Mezcla a proposito pedidos POR COMIDA y pedidos POR OCASION (pet friendly, mesas afuera,
    // abierto tarde, barato). Los segundos insinuan que al bot se le puede pedir bastante mas que
    // una categoria, que es justo lo que lo distingue de un buscador por palabra clave.
    const PEDIDOS = [
      'Yo quiero una buena burger',
      'Empanadas fritas papáaa',
      'Yo voto pizza, como siempre',
      'Hace mil que no como un asado',
      'Yo me tiro por unas milanesas',
      'Sushi, invito yo',
      'Quiero unos tacos bien picantes',
      'Pastas caseras y no se discute',
      'Yo quiero helado, no me importa la hora',
      'Un buen sánguche de milanesa y listo',
      'Choripán, no me compliquen',
      'Papas con cheddar y soy feliz',
      'Pollo al spiedo con papas, básico',
      'Un ramen, hace un frío bárbaro',
      'Algo que esté abierto hasta tarde',
      'Un lugar con mesas afuera que está lindo',
      'Llevo al perro, que sea pet friendly',
      'Algo tranqui donde se pueda charlar',
      'Cualquier cosa, pero que no salga un ojo de la cara',
      'Algo rápido que ando corriendo',
      'Yo arranco por el postre y después vemos',
      // Esta apunta a otra cosa que el bot sabe hacer: preguntar por UN lugar puntual.
      'Che, me contaron de un lugar nuevo pero no sé qué onda',
    ];

    const mezclar = (arr) => {
      const c = [...arr];
      for (let i = c.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [c[i], c[j]] = [c[j], c[i]];
      }
      return c;
    };

    const elegidos = mezclar(POOL).slice(0, 4);
    // Edu y Sabro tienen pedido propio, asi que no pueden ser quien abre la charla: ahi se
    // perderia su linea. Si les toca esa posicion, se los cambia por otro del grupo.
    // Estos cuatro piden siempre lo mismo porque es parte de quienes son, no del humor del dia.
    const FIJOS = {
      Edu: 'Yo voy a pedir algo vegan',
      Sabro: 'Yo quiero algo vegetariano',
      Lau: 'Yo algo sin TACC, acuérdense',
      Dani: 'Yo quiero unas buenas birras artesanales en un bar copado',
    };
    // Ninguno de ellos puede ser quien abre la charla: esa posicion lleva la pregunta y su
    // pedido se perderia. Primero se intenta cambiarlo por otro del grupo.
    if (FIJOS[elegidos[0]]) {
      const otro = elegidos.findIndex((n, i) => i > 0 && !FIJOS[n]);
      if (otro > 0) {
        [elegidos[0], elegidos[otro]] = [elegidos[otro], elegidos[0]];
      } else {
        // Y si los cuatro elegidos tienen pedido fijo —posible desde que son cuatro— no hay con
        // quien cambiar, asi que se trae a alguien libre de afuera.
        const libre = mezclar(POOL).find(n => !FIJOS[n] && !elegidos.includes(n));
        if (libre) elegidos[0] = libre;
      }
    }

    const sueltos = mezclar(PEDIDOS);
    const colores = mezclar(COLORES);
    const [quienAbre, ...piden] = elegidos;

    return [
      { role: 'otro', autor: quienAbre, color: colores[0], content: 'Che, ¿qué morfamos esta noche?' },
      ...piden.map((nombre, i) => ({
        role: 'otro',
        autor: nombre,
        color: colores[i + 1],
        content: FIJOS[nombre] || sueltos.pop(),
      })),
      // Guiño a Los Simuladores: la frase que antecede a la entrada del especialista.
      { role: 'user', autor: 'Vos', content: 'Banquen que conozco a alguien que nos puede ayudar... 🕵️' },
      // Aviso de sistema: nadie lo "escribe", asi que no lleva indicador de tipeo.
      { role: 'sistema', content: 'El Sommelier del Comahue se unió al grupo' },
      { role: 'assistant', autor: 'El Sommelier del Comahue', mode: 'system', content: 'A sus órdenes. Yo les tiro la posta. 🧐' },
    ];
  }, []);

  // Cuanto tarda alguien en escribir un mensaje. Antes esto era un numero a mano por mensaje —
  // el comentario decia que salia del largo del texto, pero no era cierto. Ahora si: 32ms por
  // caracter, con un piso para que los mensajes cortos no aparezcan de golpe y un techo para que
  // los largos no eternicen la escena.
  const tiempoDeTipeo = (texto) => Math.min(1800, Math.max(550, texto.length * 26));

  const [escribiendo, setEscribiendo] = useState(null);

  useEffect(() => {
    let cancelado = false;
    const esperar = (ms) => new Promise(r => setTimeout(r, ms));

    const sinMovimiento = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (sinMovimiento) {
      // Quien pidio menos movimiento no quiere ver una escena actuandose: va entera y listo.
      setMessages(BIENVENIDA.map(({ autor, ...m }) => m));
      setBienvenidaEnCurso(false);
      return;
    }

    (async () => {
      await esperar(600);
      for (const m of BIENVENIDA) {
        if (cancelado) return;
        if (m.role !== 'sistema') {
          setEscribiendo({ role: m.role, autor: m.autor, color: m.color });
          await esperar(tiempoDeTipeo(m.content));
          if (cancelado) return;
          setEscribiendo(null);
        }
        setMessages(prev => [...prev, m]);
        reproducirBlip(m.role === 'user');
        // Un respiro antes de que el siguiente empiece a tipear, como cuando alguien lee lo que
        // le acaban de mandar.
        await esperar(m.role === 'sistema' ? 600 : 340);
      }
      if (!cancelado) setBienvenidaEnCurso(false);
    })();

    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Los chips son el mejor cartel de lo que el bot sabe hacer, así que conviene que muestren
  // RANGO y no tres veces la misma clase de consulta. Antes eran tres categorías sueltas y dos
  // arrancaban con "Mejores". Ahora: una categoría común, una restricción de dieta, una consulta
  // multi-concepto (lo más difícil que resuelve) y una por ocasión, que deja claro que no es un
  // buscador por palabra clave.
  const SAMPLE_CHIPS = [
    { label: '🍕 Mejores pizzas', query: 'Mejores pizzas' },
    { label: '🌱 Opciones veganas', query: 'Opciones veganas' },
    { label: '👦 Parrilla con juegos para chicos', query: 'Parrilla con juegos para chicos' },
    { label: '💛 Lugar para una cita', query: 'Lugar para una cita' }
  ];
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Y cuando termina de responder de verdad. Este es el sonido que SI se va a escuchar siempre,
  // porque para llegar aca el usuario tuvo que escribir o tocar un chip.
  const estabaCargando = useRef(false);
  useEffect(() => {
    if (estabaCargando.current && !loading) reproducirBlip(false);
    estabaCargando.current = loading;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const [apiStatus, setApiStatus] = useState('checking');
  const [backendHealth, setBackendHealth] = useState(null);
  const [conversationContext, setConversationContext] = useState({});
  const [tone, setTone] = useState('cordial'); // 'cordial' (default), 'soberbio', 'sassy'
  const [mapLocations, setMapLocations] = useState([]);
  const [lastQuery, setLastQuery] = useState('');
  const [currentTopic, setCurrentTopic] = useState(''); // Última búsqueda o tópico que escribió el usuario
  const [restaurantCards, setRestaurantCards] = useState([]);
  const [bgImages, setBgImages] = useState(BACKGROUND_IMAGES);
  const [prevBgImages, setPrevBgImages] = useState(null);
  const [isBgTransitioning, setIsBgTransitioning] = useState(false);
  const [cardsMode, setCardsMode] = useState('rag'); // 'rag' = completas, 'estadisticas' = minimalistas
  const [sortBy, setSortBy] = useState('rating'); // 'rating', 'reviews', 'name'
  const [sidebarMode, setSidebarMode] = useState(false); // Chat en sidebar después del primer mensaje
  const [hoveredRestaurant, setHoveredRestaurant] = useState(null);
  // Arrancan ABIERTOS: en el estado inicial los ejemplos son la mejor forma de comunicar que se
  // le puede pedir al bot. Escondidos detras del boton 💡, practicamente nadie los descubria — y
  // encima la pantalla inicial quedaba medio vacia. Se colapsan al primer envio (ver handleSend).
  const [chipsExpanded, setChipsExpanded] = useState(true);
  const [tonesExpanded, setTonesExpanded] = useState(false);

  // === NUEVO ESTADO PARA PESTAÑAS MÓVILES ===
  const [mobileTab, setMobileTab] = useState('chat'); // 'chat' | 'results' | 'map'

  // Estado para detectar si el usuario hizo scroll hacia arriba
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const toneToggleRef = useRef(null);

  // Cuando el usuario selecciona la pestaña Chat en mobile, asegurar scroll al final
  useEffect(() => {
    if (mobileTab === 'chat' && messagesContainerRef.current && !userScrolledUp) {
      // Defer para permitir layout si el contenedor venía oculto
      setTimeout(() => {
        try {
          const container = messagesContainerRef.current;
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        } catch (e) {
          // ignore
        }
      }, 120);
    }
  }, [mobileTab, userScrolledUp]);

  // Detectar cuando el usuario hace scroll hacia arriba en el chat
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      setUserScrolledUp(!isAtBottom);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleDocumentClick = (e) => {
      try {
        if (!toneToggleRef.current) return;
        if (tonesExpanded && !toneToggleRef.current.contains(e.target)) {
          setTonesExpanded(false);
        }
      } catch (err) {
        // ignore
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [tonesExpanded]);
  const cardsPositionsRef = useRef(null);

  // Capture current cards positions (before changing the DOM order)
  const captureCardPositions = () => {
    const container = cardsContainerRef.current;
    if (!container) return;
    const nodes = Array.from(container.children);
    const rects = {};
    nodes.forEach(node => {
      const name = node.dataset.cardName;
      if (name) rects[name] = node.getBoundingClientRect();
    });
    cardsPositionsRef.current = rects;
    console.debug('[FLIP DEBUG] captureCardPositions, stored rects:', Object.keys(rects).length);
  };

  const handleSetSortBy = (newSort) => {
    if (cardsMode === 'estadisticas') captureCardPositions();
    setSortBy(newSort);
  };
  const [centerMapOn, setCenterMapOn] = useState(null); // Solo se activa desde tarjetas
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // Distinto de loadingDetail: la tarjeta ya se está mostrando (con sus reseñas) pero el bloque
  // del resumen todavía espera al LLM.
  const [loadingAnalisis, setLoadingAnalisis] = useState(false);
  const [detailsCache, setDetailsCache] = useState({});
  const getDetailsCacheKey = (nombre, topicParam = null) => {
    const t = topicParam || conversationContext?.topic || 'default';
    return `${nombre}__${t}__${tone || 'cordial'}`;
  };
  const [inlineDetail, setInlineDetail] = useState(null); // Para modo resumen
  const [loadingInlineDetail, setLoadingInlineDetail] = useState(false);
  // Modal backend inactivo
  const [showBackendInactiveModal, setShowBackendInactiveModal] = useState(false);
  const [showBackendConnectingModal, setShowBackendConnectingModal] = useState(false);
  const [backendConnectingSeconds, setBackendConnectingSeconds] = useState(0);
  // Duracion tipica del arranque en frio de la maquina de Fly. Solo se usa para dibujar la
  // barra de progreso: si tarda mas, la barra queda topeada y el contador sigue subiendo.
  const ESPERA_ARRANQUE_SEGUNDOS = 30;
  const [backendCountdown, setBackendCountdown] = useState(60);
  const [showConnectionToast, setShowConnectionToast] = useState(false);
  const prevApiStatus = useRef(apiStatus);

  // Mostrar toast cuando el backend se conecta después de estar en error
  useEffect(() => {
    if (prevApiStatus.current === 'error' && apiStatus === 'connected') {
      setShowConnectionToast(true);
      setTimeout(() => setShowConnectionToast(false), 3000);
    }
    prevApiStatus.current = apiStatus;
  }, [apiStatus]);

  // Mostrar modal solo si apiStatus === 'error' y es la página inicial (solo mensaje de bienvenida)
  useEffect(() => {
    let countdownInterval;
    const isInitialPage = !sidebarMode && messages.every(m => m.role !== 'user' || m.content.length < 40);
    if (apiStatus === 'error' && isInitialPage) {
      setShowBackendInactiveModal(true);
      setBackendCountdown(60);
      countdownInterval = setInterval(() => {
        setBackendCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setShowBackendInactiveModal(false);
    }
    return () => {
      if (countdownInterval) clearInterval(countdownInterval);
    };
  }, [apiStatus, messages]);

  // Mostrar popup de arranque en frío mientras el backend está respondiendo
  useEffect(() => {
    const isInitialPage = !sidebarMode && messages.every(m => m.role !== 'user' || m.content.length < 40);
    let timer;
    let interval;

    if (apiStatus === 'checking' && isInitialPage) {
      setBackendConnectingSeconds(0);
      timer = setTimeout(() => {
        setShowBackendConnectingModal(true);
      }, 250);

      interval = setInterval(() => {
        setBackendConnectingSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setShowBackendConnectingModal(false);
      setBackendConnectingSeconds(0);
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [apiStatus, messages]);

  // === NUEVO REF PARA CONTENEDOR DE MENSAJES ===
  const messagesContainerRef = useRef(null);
  const markerRefs = useRef({});
  const cardRefs = useRef({}); // Refs para scroll a tarjetas
  const cardsContainerRef = useRef(null); // Ref del contenedor de tarjetas
  const scrollingFromMap = useRef(false); // Flag para evitar centrar mapa cuando scroll es desde marcador
  const mapRef = useRef(null); // Ref al objeto Leaflet map (usado para invalidateSize)

  // Ensure map invalidation when mobile tab is shown
  useEffect(() => {
    if (mobileTab === 'map' && mapRef.current) {
      console.log('[MAP] mobile tab shown - invalidating size');
      [100, 300, 600].forEach(ms => setTimeout(() => {
        try { mapRef.current.invalidateSize(); } catch (e) { console.warn('invalidateSize failed', e); }
      }, ms));
    }
  }, [mobileTab]);

  // Función para scroll a una tarjeta específica (solo dentro del contenedor)
  const scrollToCard = (nombre, fromMap = false) => {
    const card = cardRefs.current[nombre];
    const container = cardsContainerRef.current;
    if (card && container) {
      if (fromMap) {
        scrollingFromMap.current = true;
        setTimeout(() => { scrollingFromMap.current = false; }, 600);
      }
      const containerRect = container.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const scrollTop = card.offsetTop - container.offsetTop - (containerRect.height / 2) + (cardRect.height / 2);
      container.scrollTo({ top: scrollTop, behavior: 'smooth' });
    }
  };

  // Un icono por lugar, porque ahora cada uno lleva su rating. Se memoiza el mapa completo: si
  // los iconos se recrearan en cada render, Leaflet reemplazaria el nodo del marcador y se
  // perderia la clase .marker-highlighted que el hover le agrega por fuera de React.
  const iconosPorLugar = useMemo(() => {
    const emoji = detectFoodType(lastQuery);
    const m = {};
    (mapLocations || []).forEach((loc, idx) => {
      m[loc.nombre] = createFoodIcon(emoji, ratingDe(loc, restaurantCards), idx);
    });
    return m;
  }, [lastQuery, mapLocations, restaurantCards]);

  // Ordenar tarjetas según criterio seleccionado
  const sortedCards = useMemo(() => {
    if (cardsMode !== 'estadisticas') return restaurantCards;

    return [...restaurantCards].sort((a, b) => {
      switch (sortBy) {
        case 'rating':
          return (b.rating || 0) - (a.rating || 0);
        case 'reviews':
          return (b.total_reviews || 0) - (a.total_reviews || 0);
        case 'name':
          return a.nombre.localeCompare(b.nombre);
        default:
          return 0;
      }
    });
  }, [restaurantCards, sortBy, cardsMode]);

  // FLIP animation: animate reordering of items in `cardsContainerRef` when `sortedCards` changes
  useLayoutEffect(() => {
    if (cardsMode !== 'estadisticas') {
      // Reset stored positions when not in list mode
      cardsPositionsRef.current = null;
      return;
    }

    const container = cardsContainerRef.current;
    if (!container) return;

    // Build map of current rects
    const nodes = Array.from(container.children);
    const newRects = {};
    nodes.forEach(node => {
      const name = node.dataset.cardName;
      if (name) newRects[name] = node.getBoundingClientRect();
    });

    const prevRects = cardsPositionsRef.current;
    // If prevRects isn't available, maybe we didn't capture before sort - fallback to storing current
    if (!prevRects) {
      // store positions for future comparisons
      cardsPositionsRef.current = newRects;
      return;
    }
    console.debug('[FLIP DEBUG] FLIP animate, prevRects:', Object.keys(prevRects).length, 'newRects:', Object.keys(newRects).length,
      'prevOrder:', Object.keys(prevRects).join(','), 'newOrder:', nodes.map(n => n.dataset.cardName).join(','));

    // For each node, compute delta and apply inverse transform (FLIP)
    nodes.forEach(node => {
      const name = node.dataset.cardName;
      if (!name || !prevRects[name] || !newRects[name]) return;
      const deltaY = prevRects[name].top - newRects[name].top;
      if (deltaY) {
        // Temporarily disable transition so the transform is applied instantly
        node.style.transition = 'none';
        node.style.transform = `translateY(${deltaY}px)`;
        node.style.willChange = 'transform';
        console.debug('[FLIP DEBUG] apply inverse transform for', name, 'deltaY', deltaY);
      }
    });

    // Force reflow to ensure the browser sees the starting transform
    // eslint-disable-next-line no-unused-expressions
    container && container.offsetHeight;

    // Trigger animation to zero transform on next frame
    requestAnimationFrame(() => {
      nodes.forEach(node => {
        // Get delta from applied transform if present
        // Use Web Animations API for more reliable animations
        try {
          const delta = node.style.transform || 'translateY(0px)';
          const duration = 320;
          const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
          // Animate from current translated position back to 0
          const anim = node.animate([
            { transform: delta },
            { transform: 'translateY(0px)' }
          ], { duration, easing });
          anim.onfinish = () => {
            node.style.transform = '';
            node.style.willChange = '';
            node.style.transition = '';
          };
        } catch (e) {
          // Fallback to CSS transition if WA API not supported
          node.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';
          node.style.transform = '';
          setTimeout(() => {
            node.style.transition = '';
            node.style.willChange = '';
          }, 360);
        }
      });
    });

    const clearStyles = () => {
      nodes.forEach(node => {
        node.style.transition = '';
        node.style.willChange = '';
      });
    };
    // Clear after animation finishes
    const t = setTimeout(clearStyles, 400);
    // Store current for next comparison
    cardsPositionsRef.current = newRects;
    return () => clearTimeout(t);
  }, [sortedCards, cardsMode]);

  // Efecto para sincronizar highlight del marcador cuando cambia hoveredRestaurant
  useEffect(() => {
    // Quitar highlight de todos los marcadores
    Object.keys(markerRefs.current).forEach(nombre => {
      const marker = markerRefs.current[nombre];
      if (marker && marker._icon) {
        marker._icon.classList.remove('marker-highlighted');
      }
    });

    // Agregar highlight al marcador hovered
    if (hoveredRestaurant && markerRefs.current[hoveredRestaurant]) {
      const marker = markerRefs.current[hoveredRestaurant];
      if (marker && marker._icon) {
        marker._icon.classList.add('marker-highlighted');
      }
    }
  }, [hoveredRestaurant]);

  // Determinar imágenes de fondo basadas en el tópico de búsqueda
  const getBackgroundImagesForTopic = (topic) => {
    if (!topic || typeof topic !== 'string') return BACKGROUND_IMAGES;
    const t = topic.toLowerCase();
    if (/^\d+$/.test(t.trim())) return BACKGROUND_IMAGES; // si es solo un número, fallback
    if (t.includes('pizza') || t.includes('pizzer')) return [BG_PIZZERIA];
    if (t.includes('pan') || t.includes('factur') || t.includes('medialun') || t.includes('panader')) return [BG_BAKERY];
    if (t.includes('bar') || t.includes('cocktail') || t.includes('trago') || t.includes('cerveza') || t.includes('birra') || t.includes('pub')) return [BG_BARS];
    if (t.includes('parrill') || t.includes('asado') || t.includes('carne') || t.includes('bife')) return [BG_PARRILLA];
    if (t.includes('vegano') || t.includes('vegetar') || t.includes('vegan')) return [BG_VEGANO];
    // Helados / Heladerías / Gelato
    if (t.includes('helado') || t.includes('helader')) return [BG_HELADOS];
    // Hamburguesas / burger
    if (t.includes('hamburg') || t.includes('burger')) return [BG_HAMBURGUESA];
    // Sushi / Japan / Asiática
    if (t.includes('sushi') || t.includes('japon') || t.includes('asiat')) return [BG_SUSHI];
    // Empanadas / facturas saladas
    if (t.includes('empanad')) return [BG_EMPANADAS];
    return BACKGROUND_IMAGES;
  };

  // Emoji de carga basado en el tópico de búsqueda
  const getLoadingEmoji = (topic) => {
    if (!topic || typeof topic !== 'string') return '🍽️';
    const t = topic.toLowerCase();
    if (/^\d+$/.test(t.trim())) return '🍽️'; // si es solo un número, fallback
    if (t.includes('pizza') || t.includes('pizzer')) return '🍕';
    if (t.includes('pan') || t.includes('factur') || t.includes('medialun') || t.includes('panader')) return '🥐';
    if (t.includes('bar') || t.includes('cocktail') || t.includes('trago') || t.includes('pub')) return '🍸';
    if (t.includes('cerveza') || t.includes('birra') || t.includes('cervecer')) return '🍺';
    if (t.includes('parrill') || t.includes('asado') || t.includes('carne') || t.includes('bife')) return '🥩';
    if (t.includes('vegano') || t.includes('vegetar') || t.includes('vegan') || t.includes('ensalad')) return '🥗';
    if (t.includes('helado') || t.includes('helader')) return '🍦';
    if (t.includes('hamburg') || t.includes('burger')) return '🍔';
    if (t.includes('sushi') || t.includes('japon') || t.includes('asiat')) return '🍣';
    if (t.includes('empanad')) return '🥟';
    if (t.includes('cafe') || t.includes('café') || t.includes('cafeter')) return '☕';
    if (t.includes('pasta') || t.includes('italian') || t.includes('tuco')) return '🍝';
    if (t.includes('taco') || t.includes('mexican') || t.includes('burrito')) return '🌮';
    if (t.includes('pollo') || t.includes('chicken')) return '🍗';
    if (t.includes('postre') || t.includes('dulce') || t.includes('torta') || t.includes('pastel')) return '🍰';
    if (t.includes('desayun') || t.includes('brunch')) return '🥞';
    if (t.includes('milanesa') || t.includes('napolitana')) return '🍖';
    return '🍽️';
  };

  useEffect(() => {
    const newImages = getBackgroundImagesForTopic(currentTopic || conversationContext?.topic || '');
    // simple compare: if first image is same and lengths same, ignore
    const equal = (a, b) => {
      if (!a || !b) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }
    if (equal(newImages, bgImages)) return;
    // Start transition
    setPrevBgImages(bgImages);
    setBgImages(newImages);
    setIsBgTransitioning(true);
    const t = setTimeout(() => {
      setPrevBgImages(null);
      setIsBgTransitioning(false);
      // 3.4s: la capa nueva entra con el mismo cruce de 3s del slideshow (7.5% de 40s), asi
      // que la vieja tiene que quedarse abajo hasta que este completamente tapada.
    }, 3400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTopic, conversationContext]);

  // Pre-cargar detalles de restaurantes cuando llegan las tarjetas
  useEffect(() => {
    if (restaurantCards.length > 0) {
      // Si es modo resumen con un solo restaurante, cargar detalles inline
      if (cardsMode === 'resumen' && restaurantCards.length === 1) {
        const nombre = restaurantCards[0].nombre;
        setLoadingInlineDetail(true);

        // Usar cache si existe
        const inlineCacheKey = getDetailsCacheKey(nombre);
        if (detailsCache[inlineCacheKey]) {
          setInlineDetail(detailsCache[inlineCacheKey]);
          setLoadingInlineDetail(false);
        } else {
          // Cargar desde API
          axios.get(`${API_URL}/restaurant/${encodeURIComponent(nombre)}?tone=${encodeURIComponent(tone)}`, axiosConfig)
            .then(response => {
              setInlineDetail(response.data);
              setDetailsCache(prev => ({ ...prev, [inlineCacheKey]: response.data }));
            })
            .catch(error => console.error('Error cargando detalles:', error))
            .finally(() => setLoadingInlineDetail(false));
        }
      } else {
        // Limpiar detalles inline si no es modo resumen
        setInlineDetail(null);

        // Cargar en background los detalles de cada restaurante
        restaurantCards.forEach(async (card) => {
          // Solo cargar si no está en cache
          const bgKey = getDetailsCacheKey(card.nombre);
          if (!detailsCache[bgKey]) {
            try {
              const response = await axios.get(`${API_URL}/restaurant/${encodeURIComponent(card.nombre)}?tone=${encodeURIComponent(tone)}`, axiosConfig);
              setDetailsCache(prev => ({
                ...prev,
                [bgKey]: response.data
              }));
            } catch (error) {
              console.error(`Error pre-cargando ${card.nombre}:`, error);
            }
          }
        });
      }
    } else if (cardsMode === 'resumen' && mapLocations.length === 1) {
      // Fallback: si no hay cards pero hay una location en modo resumen, cargar detalles
      const nombre = mapLocations[0].nombre;
      console.log('[FRONTEND DEBUG] Cargando detalles desde location:', nombre);
      setLoadingInlineDetail(true);

      const inlineCacheKey2 = getDetailsCacheKey(nombre);
      if (detailsCache[inlineCacheKey2]) {
        setInlineDetail(detailsCache[inlineCacheKey2]);
        setLoadingInlineDetail(false);
      } else {
        axios.get(`${API_URL}/restaurant/${encodeURIComponent(nombre)}?tone=${encodeURIComponent(tone)}`, axiosConfig)
          .then(response => {
            setInlineDetail(response.data);
            setDetailsCache(prev => ({ ...prev, [inlineCacheKey2]: response.data }));
          })
          .catch(error => console.error('Error cargando detalles:', error))
          .finally(() => setLoadingInlineDetail(false));
      }
    } else {
      setInlineDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantCards, cardsMode, mapLocations]);

  // Verificar estado del backend al cargar y periódicamente
  // Polling agresivo inicial (cold start puede tardar hasta 60s), luego más espaciado
  useEffect(() => {
    let interval;
    let attempts = 0;
    const maxRetries = 12; // 12 intentos x 5s = 60s de tolerancia para cold start

    const warmupBackend = async () => {
      attempts++;
      console.log(`[Warmup] Intento ${attempts}/${maxRetries}...`);

      try {
        // Timeout largo para tolerar cold start de Fly.io
        const response = await axios.get(`${API_URL}/health`, {
          timeout: attempts <= 2 ? 15000 : 5000, // Primeros intentos con más paciencia
          ...axiosConfig
        });

        if (response.data.status === 'healthy') {
          console.log('[Warmup] ✅ Backend caliente!');
          setBackendHealth(response.data);
          setApiStatus('connected');
          // Los datos del pie (fecha del ultimo scraping) requieren consultar la base, asi que
          // el backend los deja detras de ?full=1 y /health a secas es un chequeo barato. Se pide
          // la version completa UNA sola vez al conectar; el polling de abajo sigue siendo barato
          // porque corre cada 30s en cada pestaña abierta.
          axios.get(`${API_URL}/health?full=1`, { timeout: 15000, ...axiosConfig })
            .then(full => setBackendHealth(prev => ({ ...prev, ...full.data })))
            .catch(() => { /* el pie muestra solo lo que tenga; no vale romper por esto */ });
          // Una vez conectado, polling menos frecuente
          clearInterval(interval);
          interval = setInterval(checkBackendHealth, 30000); // Cada 30s cuando ya está activo
        } else {
          setApiStatus('error');
        }
      } catch (error) {
        console.log(`[Warmup] Backend arrancando... (${error.message})`);
        if (attempts >= maxRetries) {
          setApiStatus('error');
        } else {
          setApiStatus('checking');
        }
      }
    };

    // Primer intento inmediato
    warmupBackend();
    // Polling cada 5 segundos hasta conectar
    interval = setInterval(warmupBackend, 5000);

    return () => clearInterval(interval);
  }, []);

  // === SCROLL MEJORADO: Usar el contenedor del chat en lugar de scrollIntoView ===
  useLayoutEffect(() => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      // Solo hacer scroll automático si el usuario NO ha subido manualmente
      if (!userScrolledUp) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }
    }
  }, [messages, loading, userScrolledUp]);

  const checkBackendHealth = async () => {
    try {
      const response = await axios.get(`${API_URL}/health`, { timeout: 5000, ...axiosConfig });
      if (response.data.status === 'healthy') {
        setBackendHealth(response.data);
        setApiStatus('connected');
      } else {
        setApiStatus('error');
      }
    } catch (error) {
      console.log('Backend no disponible:', error.message);
      setApiStatus('error');
    }
  };

  // Shared function to handle streaming response
  const streamChatResponse = async (payload, initialUserMessage = null, startTime = null) => {
    // 1. Setup UI for streaming
    setLoading(true);
    setMobileTab('chat');

    // If not triggered by a pending option click, user message is already added
    // If we want to be safe, we can enforce adding it here, but `sendQuery` does it before.

    // Add placeholder for assistant message
    setMessages(prev => [...prev, { role: 'assistant', content: '', mode: 'general' }]);

    // We need an index to update the LAST message
    // Since state updates are async, we can't rely on messages.length immediately after setMessages
    // So we will use a functional update pattern for every token append.

    try {
      const response = await fetch(`${API_URL}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.REACT_APP_BACKEND_URL && process.env.REACT_APP_BACKEND_URL.includes('loca.lt')
            ? { 'bypass-tunnel-reminder': 'true' } : {})
        },
        body: JSON.stringify(payload)
      });

      console.log(`[PERF] HTTP Response (TTFB proxy): ${Date.now() - startTime}ms`);

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let firstTokenReceived = false;
      let firstByteReceived = false;

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          if (!firstByteReceived) {
            firstByteReceived = true;
            console.log(`[PERF] Time to First Byte (TTFB): ${Date.now() - startTime}ms (${value.byteLength} bytes)`);
          }
          buffer += decoder.decode(value, { stream: true });
        }

        // Split by newlines to get NDJSON lines
        let lines = buffer.split("\n");
        // Keep the last part in buffer if it's incomplete (doesn't end with newline)
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          // Skip SSE comments (e.g. proxy flush padding)
          if (line.trim().startsWith(':')) continue;
          try {
            // Strip SSE "data: " prefix if present
            const jsonStr = line.startsWith('data: ') ? line.slice(6) : line;
            const event = JSON.parse(jsonStr);

            if (event.type === 'token') {
              if (!firstTokenReceived && startTime) {
                firstTokenReceived = true;
                console.log(`[PERF] Time to First Token (TTFT): ${Date.now() - startTime}ms`);
              }

              setMessages(prev => {
                const newMsgs = [...prev];
                const lastIndex = newMsgs.length - 1;
                // Critical: Copy the object to avoid mutation in Strict Mode (which runs reducers twice)
                const lastMsg = { ...newMsgs[lastIndex] };

                if (lastMsg.role === 'assistant') {
                  lastMsg.content += event.content;
                  newMsgs[lastIndex] = lastMsg;
                }
                return newMsgs;
              });
            } else if (event.type === 'meta') {
              // Update Metadata
              if (event.mode) {
                setCardsMode(event.mode);
                // Update message mode tag
                setMessages(prev => {
                  const newMsgs = [...prev];
                  const lastIndex = newMsgs.length - 1;
                  const lastMsg = { ...newMsgs[lastIndex] };

                  if (lastMsg.role === 'assistant') {
                    lastMsg.mode = event.mode;
                    newMsgs[lastIndex] = lastMsg;
                  }
                  return newMsgs;
                });
              }

              if (event.cards) {
                console.log('[STREAM] Cards received:', event.cards.length);
                setRestaurantCards(event.cards);
                if (event.cards.length > 0) setSidebarMode(true);
              }

              // Siempre se setea, incluso si el meta no trae `locs`: varios modos del backend
              // (general, blocked y algunos rag) no incluyen el campo, y como ya no se limpia al
              // arrancar la consulta, sin este `|| []` quedarian los marcadores de la busqueda
              // anterior sobre una respuesta que no tiene ubicaciones.
              const locsNuevas = event.locs || [];
              setMapLocations(locsNuevas);
              if (locsNuevas.length > 0 && initialUserMessage) setLastQuery(initialUserMessage);

              // If pending options received in meta (e.g. numeric menu)
              if (event.pending) {
                setConversationContext(prev => ({ ...prev, pending_options: event.pending }));
              }

              // Handle detail_content update logic (for RESUMEN mode)
              // If mode is 'resumen', we might want to populate inlineDetail from the text generated so far?
              // Actually, the backend sends 'detail_content' in the legacy structure.
              // In streaming, 'detail_content' is just the full text accumulated. 
              // We don't get a separate 'detail_content' field in meta usually unless we change backend.
              // But wait, the backend generator does logic to populate inline detail?
              // Current backend gen logic:
              // yield {"type": "meta", "mode": "resumen", "cards": cards, "locs": locs}
              // It does NOT yield `detail_content`. The text IS the content.
              // So checking for `detail_content` here is different.
              // Strategy: if mode is resumen and we have 1 card, populate inlineDetail with the accumulating text?
              // Maybe wait until stream ends or use effect.
            } else if (event.type === 'context_update') {
              if (event.context) setConversationContext(event.context);
            } else if (event.type === 'error') {
              console.error('Stream error event:', event.message);
              // We could show error in UI but usually we just log
            }

          } catch (e) {
            console.error('Error parsing NDJSON line:', e, line);
          }
        }

        if (done) break;
      }

      // Post-stream logic check
      setApiStatus('connected');

      // Trigger side-effects that depend on final state if needed
      // (Most are handled reactively by useEffects on restaurantCards/mapLocations)

    } catch (error) {
      console.error('Stream fetch error:', error);
      setApiStatus('error');
      setMessages(prev => {
        // If we started an assistant message, append error there or add new one?
        const newMsgs = [...prev];
        const lastMsg = newMsgs[newMsgs.length - 1];
        // Only append if it looks like an error occurred before any content
        if (lastMsg.role === 'assistant' && lastMsg.content === '') {
          lastMsg.content = "❌ Error de conexión al stream.";
          lastMsg.mode = 'error';
        } else {
          // Append as separate or just log? Let's just append warning
          lastMsg.content += "\n\n(❌ Error de conexión)";
        }
        return newMsgs;
      });
    } finally {
      setLoading(false);
    }
  };

  const sendQuery = async (userMessage) => {
    const um = userMessage?.trim();
    if (!um || loading) return;

    // Capture start time
    const tStart = Date.now();

    // Limpiar resultados anteriores y volver al chat grande.
    // OJO: no se limpia mapLocations aca. El mapa se renderiza condicionalmente con
    // {mapLocations.length > 0 && ...}, asi que vaciarlo desmontaba TODO el subarbol —
    // incluida la instancia de Leaflet— durante toda la consulta, y al llegar la respuesta se
    // reconstruia de cero re-descargando las tiles. Ahora el mapa anterior queda visible
    // mientras carga y se reemplaza al llegar el meta (que siempre setea locs, ver abajo).
    setSidebarMode(false);
    setRestaurantCards([]);

    setCurrentTopic(um);
    setInput('');
    setChipsExpanded(false); // ya no hacen falta una vez que el usuario sabe que pedir
    setMobileTab('chat');
    setUserScrolledUp(false); // Resetear flag de scroll para bajar al enviar nuevo mensaje

    // Add User Message
    setMessages(prev => [...prev, { role: 'user', content: um }]);

    const payload = {
      query: um,
      conversation_context: { ...conversationContext, tone },
      tone
    };

    await streamChatResponse(payload, um, tStart);
  };

  // Seleccionar una opción pendiente (click en etiqueta)
  const selectPendingOption = async (index) => {
    if (loading) return;

    const tStart = Date.now();
    const selectionStr = String(index + 1);
    setCurrentTopic(selectionStr);
    setMobileTab('chat');
    setUserScrolledUp(false);

    // Add User Message
    setMessages(prev => [...prev, { role: 'user', content: selectionStr }]);

    // Note: Pending options logic might clear pending_options in backend, 
    // but we send current context.
    const payload = {
      query: selectionStr,
      conversation_context: { ...conversationContext, tone },
      tone
    };

    await streamChatResponse(payload, selectionStr, tStart);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    await sendQuery(input);
  }

  const handleChipClick = async (q) => {
    if (loading) return;
    await sendQuery(q);
  }

  const getModeIcon = (mode) => {
    switch (mode) {
      case 'estadisticas': return '📊';
      case 'rag': return '🧠';
      case 'resumen': return '📝';
      // Sin emoji: el 🤖 gritaba "chatbot generico" y cualquier reemplazo (🎯, 🍽️) sigue
      // oliendo a asistente de IA. La etiqueta sola, en versalitas y con el color de marca, es
      // mas fuerte desnuda.
      default: return '';
    }
  };

  const getModeLabel = (mode) => {
    switch (mode) {
      case 'estadisticas': return 'Estadísticas';
      case 'rag': return 'Recomendaciones';
      case 'resumen': return 'Resumen';
      // "Morfi-Bot" describia la tecnologia, que es lo menos interesante que tiene.
      // El chiste esta en el choque: un titulo frances de alta gastronomia pegado a la meseta
      // patagonica. Nadie se lo toma en serio, que es el tono correcto para una app que se llama
      // "¿Que morfamos?" — y convive bien con los tonos soberbio e ironico que ya existen.
      // "del Comahue" y no "de la Barda": la barda es un accidente neuquino, pero la base incluye
      // lugares de Cipolletti, que es Rio Negro. El Comahue abarca las dos provincias.
      default: return 'El Sommelier del Comahue';
    }
  };

  const openRestaurantDetail = async (nombreRestaurante) => {
    // Usar cache si está disponible
    // Priorizar currentTopic (última búsqueda del usuario), si existe
    const topic = currentTopic && currentTopic.length > 0 ? currentTopic : conversationContext?.topic;
    const cacheKey = `${nombreRestaurante}__${topic || 'default'}__${tone || 'cordial'}`;
    if (detailsCache[cacheKey]) {
      setSelectedRestaurant(detailsCache[cacheKey]);
      return;
    }

    // Carga en dos tiempos. Medido en el endpoint: metadata 0.31s, reseñas 1.13s, análisis del
    // LLM 4.49s — o sea que el 72% de la espera es UNA parte y el resto está listo a 1.4s.
    // Antes se esperaba todo junto y el usuario miraba 6 segundos de esqueleto. Ahora se piden
    // las dos cosas EN PARALELO (no en cadena: encadenarlas sumaría los tiempos en vez de
    // solaparlos): apenas llega la base se pinta la tarjeta con sus reseñas, y el esqueleto queda
    // sólo en el bloque del resumen, que es lo único que falta.
    const base = `${API_URL}/restaurant/${encodeURIComponent(nombreRestaurante)}`;
    const params = (extra) =>
      `?tone=${encodeURIComponent(tone)}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}${extra}`;

    setLoadingDetail(true);
    setLoadingAnalisis(true);

    const pedidoCompleto = axios.get(base + params(''), axiosConfig);

    // La base sólo se pinta si el análisis todavía no llegó: si el completo vino de caché y ganó
    // la carrera, pisarlo con la base dejaría la tarjeta sin resumen.
    axios.get(base + params('&solo_base=1'), axiosConfig)
      .then(({ data }) => {
        setSelectedRestaurant(prev => (prev && prev.resumen_general) ? prev : data);
        setLoadingDetail(false);
      })
      .catch(() => { /* si falla, el pedido completo sigue en vuelo y resuelve igual */ });

    try {
      const response = await pedidoCompleto;
      setSelectedRestaurant(response.data);
      setDetailsCache(prev => ({
        ...prev,
        [cacheKey]: response.data
      }));
    } catch (error) {
      console.error('Error al obtener detalles:', error);
      setSelectedRestaurant(prev => prev || null);
    } finally {
      setLoadingDetail(false);
      setLoadingAnalisis(false);
    }
  };

  const closeModal = () => {
    setSelectedRestaurant(null);
  };

  // El numero acompaña al relleno de las estrellas: misma duracion (0.9s) y misma sensacion de
  // curva, asi los dos terminan juntos. easeOutQuint es la version en JS del
  // cubic-bezier(0.22, 1, 0.36, 1) que usa la animacion CSS.
  // `clave` reinicia el conteo al abrir otro lugar: sin eso, dos lugares con el mismo rating no
  // volverian a animar porque el valor no cambio.
  const useConteo = (valor, clave, duracion = 2200) => {
    const [n, setN] = useState(0);
    useEffect(() => {
      const destino = Number(valor) || 0;
      const sinMovimiento = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!destino || sinMovimiento) { setN(destino); return; }
      let raf, inicio;
      const paso = (t) => {
        if (inicio === undefined) inicio = t;
        const avance = Math.min(1, (t - inicio) / duracion);
        setN(destino * (1 - Math.pow(1 - avance, 5)));
        if (avance < 1) raf = requestAnimationFrame(paso);
        else setN(destino);
      };
      raf = requestAnimationFrame(paso);
      return () => cancelAnimationFrame(raf);
    }, [valor, clave, duracion]);
    return n;
  };

  const ratingAnimado = useConteo(selectedRestaurant?.rating, selectedRestaurant?.nombre);
  // Las reseñas tardan un toque mas: son un numero mucho mas grande y frenar despues hace que
  // se lea el conteo en vez de ver un borron.
  const reviewsAnimadas = useConteo(selectedRestaurant?.total_reviews, selectedRestaurant?.nombre, 2400);

  // Dos capas de 5 estrellas superpuestas: la de abajo apagada, la de arriba dorada y recortada
  // al porcentaje del rating. Animar ESE ancho es lo que da el efecto de que se van llenando —
  // y de paso se ven medias estrellas de verdad (un 4.2 recorta a 84%), cosa que la version
  // anterior no podia: redondeaba a "media" o nada con un caracter '½'.
  const renderStars = (rating) => {
    const valor = Number(rating) || 0;
    const relleno = Math.max(0, Math.min(100, (valor / 5) * 100));
    return (
      <span
        // El estallido se reserva para 3.5+: si aparece en cualquier lugar deja de decir algo.
        className={`stars-display${valor >= 3.5 ? ' tiene-remate' : ''}`}
        style={{ '--relleno': `${relleno}%` }}
        role="img"
        aria-label={`${valor.toFixed(1)} de 5 estrellas`}
      >
        <span className="stars-display__base" aria-hidden="true">★★★★★</span>
        <span className="stars-display__fill" aria-hidden="true">★★★★★</span>
      </span>
    );
  };

  return (
    <div className={`App ${sidebarMode ? 'sidebar-layout' : ''}`}>
      {/* Fondo slideshow detrás del contenido */}
      <div className={`bg-slideshow ${bgImages.length === 1 ? 'single' : ''} ${isBgTransitioning ? 'is-transitioning' : ''}`} aria-hidden>
        <div className="bg-layer base">
          {bgImages.map((src, i) => (
            <div
              // La key lleva la URL a proposito: con `base-${i}` React reusaba el mismo div y
              // solo le cambiaba background-image, o sea un CORTE SECO en medio de la animacion.
              // Incluyendo el src, la slide se remonta y su cruce arranca de cero.
              key={`base-${i}-${src}`}
              className={`bg-slide bg-slide-${i}`}
              style={{ backgroundImage: `url(${src})` }}
            />
          ))}
        </div>
        {prevBgImages && (
          <div className="bg-layer prev">
            {prevBgImages.map((src, i) => (
              <div
                key={`prev-${i}-${src}`}
                className={`bg-slide bg-slide-${i}`}
                style={{ backgroundImage: `url(${src})` }}
              />
            ))}
          </div>
        )}
      </div>
      {/* Primer elemento enfocable de la pagina: permite saltar la cabecera e ir al contenido. */}
      <a href="#contenido" className="skip-link">Saltar al contenido</a>

      <header className="app-header">
        {/* La pagina no tenia H1: el titulo existia solo como video, invisible para un lector de
            pantalla y para los buscadores. Va oculto visualmente porque el logo ya cumple ese rol
            a nivel visual. */}
        <h1 className="sr-only">¿Qué morfamos? — Recomendaciones de restaurantes en Neuquén</h1>
        <div className="header-top-row">
          <div className="header-title-group">
            <div
              className="header-video-wrapper"
              onClick={() => window.location.reload()}
              /* Era un div clickeable: invisible para teclado y para lectores de pantalla.
                 Con role/tabIndex/onKeyDown se comporta como un boton de verdad. */
              role="button"
              tabIndex={0}
              aria-label="Volver al inicio"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.reload(); }
              }}
              style={{ cursor: 'pointer' }}
            >
              <video
                autoPlay
                loop
                muted
                playsInline
                className="header-video"
                aria-hidden="true"
              >
                <source src={process.env.PUBLIC_URL + '/banner.mp4'} type="video/mp4" />
              </video>
            </div>
          </div>
          <div className="header-controls">
            <div
              ref={toneToggleRef}
              className={`tone-toggle ${tonesExpanded ? 'expanded' : ''}`}
              role="tablist"
              aria-label="Tono de la IA"
              onClick={() => setTonesExpanded(!tonesExpanded)}
            >
              {/* Render all 3 tone buttons always, but hide non-active ones in mobile unless expanded */}
              {['cordial', 'soberbio', 'sassy'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`tone-btn${tone === t ? ' active' : ''}${!tonesExpanded && tone !== t ? ' hidden' : ''}`}
                  title={t === 'cordial' ? 'Cordial' : t === 'soberbio' ? 'Soberbio' : 'Irónico'}
                  aria-pressed={tone === t}
                  data-tooltip={t === 'cordial' ? 'Amable y servicial' : t === 'soberbio' ? 'Soberbio y seguro' : 'Irónico y mordaz'}
                  aria-label={t === 'cordial' ? 'Cordial' : t === 'soberbio' ? 'Soberbio' : 'Irónico'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tone !== t) {
                      setTone(t);
                      setConversationContext(prev => ({ ...prev, tone: t }));
                      // Map internal tone keys to emojirain keys
                      const mapToneForRain = (tt) => {
                        if (tt === 'cordial') return 'amable';
                        if (tt === 'sassy') return 'ironico';
                        return tt; // 'soberbio' stays the same
                      };
                      try {
                        lanzarLluviaTono(mapToneForRain(t));
                      } catch (err) {
                        console.warn('Error lanzando lluvia de emojis:', err);
                      }
                    }
                    setTonesExpanded(false);
                  }}
                >
                  <span className="tone-icon">{t === 'cordial' ? '😊' : t === 'soberbio' ? '😏' : '😎'}</span>
                </button>
              ))}
              {/* Only show the + indicator in mobile when not expanded */}
              {!tonesExpanded && <span className="tone-expand-indicator">+</span>}
            </div>
            {/* El sonido se puede apagar y la eleccion queda guardada: un sitio que hace ruido
                sin forma visible de callarlo es de las cosas que mas molestan. */}
            <button
              type="button"
              className="sonido-toggle"
              onClick={() => setSonidoActivo(v => !v)}
              aria-pressed={sonidoActivo}
              aria-label={sonidoActivo ? 'Silenciar los sonidos' : 'Activar los sonidos'}
              title={sonidoActivo ? 'Silenciar' : 'Activar sonido'}
            >
              {sonidoActivo ? '🔊' : '🔇'}
            </button>
            <div
              className={`status-indicator status-${apiStatus}`}
              data-tooltip={apiStatus === 'connected' ? 'Backend conectado' : apiStatus === 'checking' ? 'Conectando al backend...' : 'Sin conexión al backend'}
            >
              <span className="status-dot"></span>
              <span className="status-text">
                {apiStatus === 'connected' ? 'Conectado' : apiStatus === 'checking' ? 'Conectando...' : 'Sin conexión'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* <main> en vez de <div>: sin landmarks, un lector de pantalla no puede saltar entre
          regiones de la pagina. La auditoria daba main/nav/footer/section = 0. */}
      <main className="main-content" id="contenido">
        {/* CONTENEDOR DEL CHAT: oculto en mobile si mobileTab no es 'chat' */}
        <div className={`chat-container ${sidebarMode ? 'chat-sidebar' : ''} ${mobileTab !== 'chat' ? 'mobile-hidden' : ''}`}>
          {sidebarMode && (
            <div className="chat-header">
              <h4>💬 Chat</h4>
              <span className="chat-badge">En vivo</span>
            </div>
          )}
          <div className="messages-container" ref={messagesContainerRef}>
            {messages.map((message, index) => (
              <div key={index} className={`message message-${message.role}`}>
                {(message.role === 'otro' || message.role === 'assistant') && (
                  <AvatarChat
                    color={message.color}
                    inicial={message.autor?.[0]}
                    emoji={message.role === 'assistant' ? EMOJI_BOT : null}
                  />
                )}
                <div className="message-content">
                  {message.role === 'otro' && message.autor && (
                    <span className="autor-nombre" style={{ color: message.color }}>{message.autor}</span>
                  )}
                  {message.role === 'assistant' && message.mode && (
                    <span className="autor-nombre" style={{ color: COLOR_BOT }}>
                      {getModeIcon(message.mode)} {getModeLabel(message.mode)}
                    </span>
                  )}
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              </div>
            ))}
            {escribiendo && (
              <div className={`message message-${escribiendo.role} message-tipeando`}>
                {escribiendo.role !== 'user' && (
                  <AvatarChat
                    color={escribiendo.color}
                    inicial={escribiendo.autor?.[0]}
                    emoji={escribiendo.role === 'assistant' ? EMOJI_BOT : null}
                  />
                )}
                <div className="message-content">
                  {escribiendo.role !== 'user' && escribiendo.autor && (
                    <span className="autor-nombre" style={{ color: escribiendo.color || COLOR_BOT }}>
                      {escribiendo.autor} está escribiendo…
                    </span>
                  )}
                  <span className="puntos-tipeo"><span /><span /><span /></span>
                </div>
              </div>
            )}
            {loading && (
              <div className="message message-assistant">
                <div className="message-content loading">
                  <div className="typing-indicator">
                    <span>{getLoadingEmoji(currentTopic)}</span>
                    <span>{getLoadingEmoji(currentTopic)}</span>
                    <span>{getLoadingEmoji(currentTopic)}</span>
                  </div>
                  Pensando...
                </div>
              </div>
            )}
          </div>

          {/* Botón flotante para volver abajo cuando el usuario hace scroll */}
          {userScrolledUp && (
            <button
              className="scroll-to-bottom-btn"
              onClick={() => {
                const container = messagesContainerRef.current;
                if (container) {
                  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                  setUserScrolledUp(false);
                }
              }}
            >
              ↓ Nuevo mensaje
            </button>
          )}
          {/* Mostrar opciones pendientes si el backend las devolvió (labels opcionales) */}
          {conversationContext && conversationContext.pending_options && (
            <div className="pending-options">
              {/* <div className="pending-note">Elegí la opción que corresponda:</div> */}
              <div className="pending-list">
                {Array.isArray(conversationContext.pending_options)
                  ? conversationContext.pending_options.map((opt, i) => (
                    <button key={i} className="pending-btn" onClick={() => selectPendingOption(i)}>
                      {i + 1}. {opt}
                    </button>
                  ))
                  : (conversationContext.pending_options.options || conversationContext.pending_options.labels || []).map((lbl, i) => (
                    <button key={i} className="pending-btn" onClick={() => selectPendingOption(i)}>
                      {i + 1}. {lbl}
                    </button>
                  ))
                }
              </div>
            </div>
          )}

          {/* Expandable chips bar with bubble trigger */}
          { /* Mostrar chips solo en la página inicial (sin interacciones y sin sidebar) */}
          {!sidebarMode && (
            <div
              className="chip-bar-mobile"
              onMouseEnter={() => setChipsExpanded(true)}
              onMouseLeave={() => setChipsExpanded(false)}
            >
              <button
                className={`chip-bubble-btn ${chipsExpanded ? 'expanded' : ''}`}
                type="button"
                onClick={() => setChipsExpanded(!chipsExpanded)}
                aria-label="Mostrar ejemplos de búsqueda"
              >
                <span className="bubble-icon">💡</span>
                <span className="bubble-text">Ejemplos</span>
              </button>
              <div className={`chips-expandable ${chipsExpanded ? 'expanded' : ''}`}>
                {SAMPLE_CHIPS.map((c, i) => (
                  <button key={i} className="chip-btn" type="button" onClick={() => handleChipClick(c.query)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form className="input-container" onSubmit={sendMessage}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setMobileTab('chat')}
              placeholder="¿Qué tenés ganas de comer hoy?"
              disabled={loading || apiStatus !== 'connected'}
              className="message-input"
              /* El placeholder no sirve como etiqueta: desaparece al escribir y varios lectores
                 de pantalla no lo anuncian. */
              aria-label="Buscar restaurantes en Neuquén"
            />
            <button
              type="submit"
              disabled={loading || !input.trim() || apiStatus !== 'connected'}
              className="send-button"
              /* Un emoji no es un nombre accesible: un lector de pantalla anunciaba "boton" a
                 secas. aria-hidden en el emoji evita que ademas lo lea como "bandeja de salida". */
              aria-label={loading ? 'Enviando consulta' : 'Enviar consulta'}
            >
              <span aria-hidden="true">{loading ? '⏳' : '📤'}</span>
            </button>
          </form>
        </div>

        {/* Se muestra si es 'results' O 'map'. Si no, se oculta el padre entero */}
        <div className={`${sidebarMode ? 'results-area' : 'results-area-hidden'} ${mobileTab !== 'results' && mobileTab !== 'map' ? 'mobile-hidden' : ''}`}>

          {/* Panel de detalle inline para modo resumen */}
          {cardsMode === 'resumen' && (loadingInlineDetail || inlineDetail) && (
            <div className={`detail-panel ${mobileTab !== 'results' ? 'mobile-hidden' : ''}`}>
              {loadingInlineDetail ? (
                <div className="detail-loading">
  <div className="detalle-esqueleto" role="status" aria-live="polite" aria-busy="true">
                    <span className="sr-only">Cargando la informacion del lugar</span>
                    <div className="esq esq--titulo" />
                    <div className="esq esq--rating" />
                    <div className="esq esq--direccion" />

                    <div className="esq-bloque">
                      <div className="esq esq--subtitulo" />
                      <div className="esq esq--linea" />
                      <div className="esq esq--linea" />
                      <div className="esq esq--linea es-ultima" />
                    </div>

                    <div className="esq-columnas">
                      <div className="esq-bloque">
                        <div className="esq esq--subtitulo" />
                        <div className="esq esq--linea" />
                        <div className="esq esq--linea es-ultima" />
                      </div>
                      <div className="esq-bloque">
                        <div className="esq esq--subtitulo" />
                        <div className="esq esq--linea" />
                        <div className="esq esq--linea es-ultima" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : inlineDetail && (
                <>
                  <div className="detail-header">
                    <h2>{inlineDetail.nombre}</h2>
                    <div className="detail-rating">
                      {renderStars(inlineDetail.rating)}
                      <span className="rating-number">{inlineDetail.rating?.toFixed(1)}</span>
                      <span className="rating-count">({inlineDetail.total_reviews} reseñas)</span>
                    </div>
                  </div>

                  <div className="detail-location">
                    <p>📍 {inlineDetail.direccion || 'Dirección no disponible'}</p>
                    {(inlineDetail.barrio || inlineDetail.zona) && (
                      <p className="location-zone">
                        {inlineDetail.barrio}{inlineDetail.barrio && inlineDetail.zona ? ' • ' : ''}{inlineDetail.zona}
                      </p>
                    )}
                  </div>

                  {inlineDetail.resumen_general && (
                    <div className="detail-summary">
                      <ReactMarkdown>{inlineDetail.resumen_general}</ReactMarkdown>
                    </div>
                  )}

                  <div className="detail-aspects">
                    {inlineDetail.aspectos_positivos?.length > 0 && (
                      <div className="aspects-positive">
                        <h4>👍 Lo mejor</h4>
                        <ul>
                          {inlineDetail.aspectos_positivos.map((asp, i) => (
                            <li key={i}>{asp}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {inlineDetail.aspectos_negativos?.length > 0 && (
                      <div className="aspects-negative">
                        <h4>👎 A mejorar</h4>
                        <ul>
                          {inlineDetail.aspectos_negativos.map((asp, i) => (
                            <li key={i}>{asp}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {inlineDetail.reviews?.length > 0 && (
                    <div className="detail-reviews">
                      <h3>💬 Reseñas de clientes</h3>
                      <div className="reviews-list">
                        {inlineDetail.reviews.map((review, idx) => (
                          <div key={idx} className="review-item">
                            <div className="review-header">
                              <span className="review-author">{review.autor}</span>
                              <span className="review-rating">
                                {'⭐'.repeat(review.rating)}
                              </span>
                              {review.fecha && <span className="review-date">{review.fecha}</span>}
                            </div>
                            <p className="review-text">{review.texto}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Tarjetas de restaurantes (solo si NO es modo resumen) */}
          {restaurantCards.length > 0 && cardsMode !== 'resumen' && (
            <div className={`cards-container ${cardsMode === 'estadisticas' ? 'cards-compact' : ''} ${mobileTab !== 'results' ? 'mobile-hidden' : ''}`}>
              <h3>{cardsMode === 'estadisticas' ? `📍 ${restaurantCards.length} lugares encontrados` : '🍽️ Lugares recomendados'}</h3>

              {cardsMode === 'estadisticas' ? (
                // Tarjetas minimalistas para estadísticas
                <>
                  <div className="sort-buttons">
                    <button
                      className={`sort-btn ${sortBy === 'rating' ? 'active' : ''}`}
                      onClick={() => handleSetSortBy('rating')}
                      title="Ordenar por puntaje"
                    >
                      ⭐ Puntaje
                    </button>
                    <button
                      className={`sort-btn ${sortBy === 'reviews' ? 'active' : ''}`}
                      onClick={() => handleSetSortBy('reviews')}
                      title="Ordenar por cantidad de reseñas"
                    >
                      💬 Reseñas
                    </button>
                    <button
                      className={`sort-btn ${sortBy === 'name' ? 'active' : ''}`}
                      onClick={() => handleSetSortBy('name')}
                      title="Ordenar alfabéticamente"
                    >
                      🔤 A-Z
                    </button>
                  </div>
                  <div className="cards-list" ref={cardsContainerRef}>
                    {sortedCards.map((card, idx) => (
                      <div
                        key={`${card.nombre}-${idx}`}
                        data-card-name={card.nombre}
                        ref={(el) => { if (el) cardRefs.current[card.nombre] = el; }}
                        className={`card-mini ${hoveredRestaurant === card.nombre ? 'card-highlighted' : ''}`}
                        onMouseEnter={() => { setHoveredRestaurant(card.nombre); if (!scrollingFromMap.current) setCenterMapOn(card.nombre); }}
                        onMouseLeave={() => { setHoveredRestaurant(null); setCenterMapOn(null); }}
                        onClick={() => openRestaurantDetail(card.nombre)}
                      >
                        <span className="card-mini-name">{card.nombre}</span>
                        <div className="card-mini-stats">
                          <span className="card-mini-rating">⭐ {card.rating?.toFixed(1) || 'N/A'}</span>
                          {card.total_reviews > 0 && (
                            <span className="card-mini-reviews">({card.total_reviews})</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                // Tarjetas completas para recomendaciones
                <div className="cards-grid" ref={cardsContainerRef}>
                  {sortedCards.map((card, idx) => (
                    <div
                      key={`${card.nombre}-${idx}`}
                      data-card-name={card.nombre}
                      ref={(el) => { if (el) cardRefs.current[card.nombre] = el; }}
                      className={`restaurant-card ${hoveredRestaurant === card.nombre ? 'card-highlighted' : ''}`}
                      onMouseEnter={() => { setHoveredRestaurant(card.nombre); if (!scrollingFromMap.current) setCenterMapOn(card.nombre); }}
                      onMouseLeave={() => { setHoveredRestaurant(null); setCenterMapOn(null); }}
                      onClick={() => openRestaurantDetail(card.nombre)}
                      // Mismo retardo que el marcador de este lugar: la tarjeta y su pin
                      // aparecen juntos, asi lista y mapa se leen como un solo objeto.
                      // Va como variable CSS y no como animationDelay directo: un estilo inline
                      // le ganaria por especificidad a TODA animacion de la tarjeta, incluido el
                      // pulseHighlight del hover en mobile, que quedaria retrasado hasta medio
                      // segundo. Asi el retardo se aplica solo donde corresponde (ver App.css).
                      style={{ cursor: 'pointer', '--retardo-entrada': `${Math.min(idx, 9) * RETARDO_CASCADA_MS}ms` }}
                    >
                      <div className="card-header">
                        <h4>{card.nombre}</h4>
                        <div className="card-rating">
                          <span className="stars">⭐ {card.rating?.toFixed(1) || 'N/A'}</span>
                          <span className="reviews">({card.total_reviews} reseñas)</span>
                        </div>
                      </div>
                      <div className="card-location">
                        {card.direccion && <p className="address">📍 {card.direccion}</p>}
                        {(card.barrio || card.zona) && (
                          <p className="zone">
                            {card.barrio}{card.barrio && card.zona ? ' • ' : ''}{card.zona}
                          </p>
                        )}
                      </div>
                      {card.descripcion && (
                        <div className="card-description">
                          <p>{card.descripcion}</p>
                        </div>
                      )}
                      {card.frase_destacada && (
                        <div className="card-quote">
                          <p>{card.frase_destacada}</p>
                          {card.autor_reseña && <span className="quote-author">— {card.autor_reseña}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}


          {/* Mapa de ubicaciones (pestaña mobile 'map') */}
          <div className={`map-container ${mobileTab !== 'map' ? 'mobile-hidden' : ''}`}>
            {mapLocations.length > 0 && (
              <div className="map-wrapper">
                <div className="map-inner">
                  <div className="map-header">
                    <h3>📍 {mapLocations.length === 1 ? 'Ubicación' : 'Ubicaciones'}</h3>
                  </div>
                  <MapContainer
                    /* Antes habia key={mapLocations...join('-')}: cambiar el key en cada consulta
                       desmontaba el MapContainer y creaba una instancia nueva de Leaflet desde
                       cero, re-descargando todas las tiles. Los marcadores ya se reconcilian solos
                       (se renderizan con .map sobre mapLocations) y FitBounds reencuadra al
                       cambiar `locations`, asi que el remonte no aportaba nada y costaba caro. */
                    whenCreated={(m) => { mapRef.current = m; }}
                    center={[mapLocations[0].lat, mapLocations[0].lng]}
                    zoom={13}
                    preferCanvas={true}
                    zoomAnimation={true}
                    fadeAnimation={true}
                    style={{ height: '100%', width: '100%', borderRadius: '12px' }}
                  >
                    <MapResizer />
                    <FitBounds locations={mapLocations} trigger={mobileTab} />
                    <PrecargarTiles locations={mapLocations} urlTemplate={MAP_STYLE.url} />
                    <ChangeMapStyle
                      url={MAP_STYLE.url}
                      attribution={MAP_STYLE.attribution}
                      detectRetina={MAP_STYLE.detectRetina}
                      maxNativeZoom={MAP_STYLE.maxNativeZoom}
                    />
                    <AsegurarHoverVisible
                      centerOn={centerMapOn}
                      locations={mapLocations}
                    />
                    {/** small hack: kick-map-invalidates after mount */}
                    <MapKick visible={mobileTab === 'map'} mapRef={mapRef} />
                    {/* Force a couple invalidateSize calls after mount to avoid blank map when container was hidden */}
                    {mapLocations.map((loc, idx) => (
                      <Marker
                        key={`${loc.nombre}-${idx}`}
                        position={[loc.lat, loc.lng]}
                        icon={iconosPorLugar[loc.nombre]}
                        ref={(ref) => { if (ref) markerRefs.current[loc.nombre] = ref; }}
                        eventHandlers={{
                          mouseover: () => {
                            setHoveredRestaurant(loc.nombre);
                            scrollToCard(loc.nombre, true);
                          },
                          mouseout: () => setHoveredRestaurant(null),
                          click: () => scrollToCard(loc.nombre, true)
                        }}
                      >
                        <Popup>
                          <div className="map-popup">
                            <strong>{loc.nombre}</strong>
                            {(() => {
                              const card = restaurantCards.find(c =>
                                c.nombre.toLowerCase() === loc.nombre.toLowerCase()
                              );
                              if (card && (card.rating > 0 || card.total_reviews > 0)) {
                                return (
                                  <div className="popup-stats">
                                    {card.rating > 0 && (
                                      <span className="popup-rating">⭐ {card.rating.toFixed(1)}</span>
                                    )}
                                    {card.total_reviews > 0 && (
                                      <span className="popup-reviews">({card.total_reviews} reseñas)</span>
                                    )}
                                  </div>
                                );
                              }
                              if (loc.rating > 0) {
                                return (
                                  <div className="popup-stats">
                                    <span className="popup-rating">⭐ {loc.rating.toFixed(1)}</span>
                                    {loc.total_reviews > 0 && (
                                      <span className="popup-reviews">({loc.total_reviews} reseñas)</span>
                                    )}
                                  </div>
                                );
                              }
                              return null;
                            })()}
                            {loc.direccion && <p className="popup-address">{loc.direccion}</p>}
                            <button
                              className="popup-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                openRestaurantDetail(loc.nombre);
                              }}
                            >
                              + Info
                            </button>
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                  </MapContainer>
                </div>
              </div>
            )}
          </div>

        </div>{/* Fin results-area */}
      </main>{/* Fin main-content */}

      {/* BARRA DE NAVEGACIÓN MÓVIL (Solo visible si sidebarMode es true) */}
      {sidebarMode && (
        <div className="mobile-tab-bar" role="tablist">
          <button
            className={`mobile-tab-btn ${mobileTab === 'chat' ? 'active' : ''}`}
            onClick={() => setMobileTab('chat')}
            role="tab"
            aria-selected={mobileTab === 'chat'}
          >
            💬 Chat
          </button>
          <button
            className={`mobile-tab-btn ${mobileTab === 'results' ? 'active' : ''}`}
            onClick={() => setMobileTab('results')}
            role="tab"
            aria-selected={mobileTab === 'results'}
          >
            🍽️ Lugares {restaurantCards.length > 0 && `(${restaurantCards.length})`}
          </button>
          <button
            className={`mobile-tab-btn ${mobileTab === 'map' ? 'active' : ''} ${mapLocations.length === 0 ? 'disabled' : ''}`}
            onClick={() => { if (mapLocations.length > 0) setMobileTab('map'); }}
            role="tab"
            aria-selected={mobileTab === 'map'}
            disabled={mapLocations.length === 0}
            title={mapLocations.length === 0 ? 'Sin ubicaciones disponibles' : 'Ver mapa'}
          >
            🗺️ Mapa {mapLocations.length > 0 ? `(${mapLocations.length})` : ''}
          </button>
        </div>
      )}

      {/* Modal de conexión inicial / arranque en frío */}
      {showBackendConnectingModal && (
        <div className="modal-overlay" style={{ zIndex: 9998 }} role="status" aria-live="polite">
          <div className="conn-modal">
            {/* Despertador y no otro reloj de arena: el ⏳ del contador ya dice "pasa el
                tiempo", asi que repetirlo arriba no agregaba nada. Este tiene que decir POR QUE
                estas esperando — el servidor esta dormido — y engancha con "despertando". */}
            <div className="conn-modal__icon" aria-hidden="true">⏰</div>

            <p className="conn-modal__text">
              Estamos despertando el servidor. Suele tardar unos 30 segundos.
            </p>

            {/* Se topea en 97% para no mostrar la barra llena mientras todavia se espera. */}
            <div
              className="conn-modal__progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={ESPERA_ARRANQUE_SEGUNDOS}
              aria-valuenow={backendConnectingSeconds}
              aria-label="Progreso del arranque del servidor"
            >
              <div
                className="conn-modal__progress-bar"
                style={{ width: `${Math.min(97, (backendConnectingSeconds / ESPERA_ARRANQUE_SEGUNDOS) * 100)}%` }}
              />
            </div>

            <div className="conn-modal__timer">
              <span className="hourglass-anim" aria-hidden="true">⏳</span>
              <span className="conn-modal__seconds">{backendConnectingSeconds}s</span>
            </div>

            <p className="conn-modal__hint" style={{ marginTop: 18 }}>
              No cierres la pestaña: en cuanto termine de conectar, la página se habilita sola.
            </p>
          </div>
        </div>
      )}

      {/* Modal backend inactivo por inactividad */}
      {showBackendInactiveModal && (
        <div className="modal-overlay" style={{ zIndex: 9999 }} role="status" aria-live="polite">
          <div className="conn-modal">
            <img
              src={`${process.env.PUBLIC_URL}/backend-inactivo.jpg`}
              alt=""
              className="conn-modal__img"
            />
            <h2 className="conn-modal__title">Backend inactivo... Reconectando</h2>
            <p className="conn-modal__text">
              El backend fue desactivado por inactividad prolongada.<br />
              Intentando reactivar en <b className="conn-modal__countdown">{backendCountdown}</b> segundos.
            </p>
            <div className="conn-modal__icon" aria-hidden="true">⏳</div>
            <p className="conn-modal__hint">La página intentará reconectar automáticamente.</p>
          </div>
        </div>
      )}

      {/* Toast de conexión exitosa */}
      {showConnectionToast && (
        <div className="conn-toast" role="status" aria-live="polite">
          <span aria-hidden="true">✅</span>
          <span>¡Conexión establecida!</span>
        </div>
      )}

      {/* Modal de detalle del restaurante */}
      {(selectedRestaurant || loadingDetail) && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>✕</button>
            {loadingDetail ? (
              <div className="modal-loading">
<div className="detalle-esqueleto" role="status" aria-live="polite" aria-busy="true">
                  <span className="sr-only">Cargando la informacion del lugar</span>
                  <div className="esq esq--titulo" />
                  <div className="esq esq--rating" />
                  <div className="esq esq--direccion" />

                  <div className="esq-bloque">
                    <div className="esq esq--subtitulo" />
                    <div className="esq esq--linea" />
                    <div className="esq esq--linea" />
                    <div className="esq esq--linea es-ultima" />
                  </div>

                  <div className="esq-columnas">
                    <div className="esq-bloque">
                      <div className="esq esq--subtitulo" />
                      <div className="esq esq--linea" />
                      <div className="esq esq--linea es-ultima" />
                    </div>
                    <div className="esq-bloque">
                      <div className="esq esq--subtitulo" />
                      <div className="esq esq--linea" />
                      <div className="esq esq--linea es-ultima" />
                    </div>
                  </div>
                </div>
              </div>
            ) : selectedRestaurant && (
              <>
                {/* El minimapa va AL COSTADO del nombre, no cruzando todo el ancho: a la
                    derecha del titulo quedaba una franja muerta, y una banda de mapa a lo ancho
                    empujaba todo el contenido hacia abajo por algo que es de apoyo. */}
                <div className="modal-header modal-header--con-mapa">
                  <div className="modal-header__texto">
                  <h2>{selectedRestaurant.nombre}</h2>
                  <div className="modal-rating">
                    {renderStars(selectedRestaurant.rating)}
                    <span className="rating-number">{ratingAnimado.toFixed(1)}</span>
                    <span className="rating-count">({Math.round(reviewsAnimadas).toLocaleString('es-AR')} reseñas)</span>
                  </div>
                  </div>
                  <MiniMapa
                    lat={selectedRestaurant.lat}
                    lng={selectedRestaurant.lng}
                    urlTemplate={MAP_STYLE.url}
                    alto={140}
                    ancho={300}
                    zoom={14}
                  />
                </div>

                <div className="modal-location">
                  <p>📍 {selectedRestaurant.direccion || 'Dirección no disponible'}</p>
                  {/* Horarios, teléfono y cómo llegar no los tenemos ni queremos tenerlos:
                      para eso está la ficha de Google, y linkear devuelve tráfico a la fuente. */}
                  {selectedRestaurant.url && (
                    <a
                      className="modal-maps-link"
                      href={selectedRestaurant.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11z"
                          stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
                        />
                        <circle cx="12" cy="10" r="2.5" fill="currentColor" />
                      </svg>
                      Ver en Google Maps ↗
                    </a>
                  )}
                  {(selectedRestaurant.barrio || selectedRestaurant.zona) && (
                    <p className="location-zone">
                      {selectedRestaurant.barrio}{selectedRestaurant.barrio && selectedRestaurant.zona ? ' • ' : ''}{selectedRestaurant.zona}
                    </p>
                  )}
                </div>

                {/* El esqueleto queda SOLO donde falta el dato. El resto de la tarjeta —nombre,
                    rating, dirección, reseñas— ya está pintado desde el pedido base, que llega a
                    ~1.6s contra los ~6s del completo. */}
                {loadingAnalisis && !selectedRestaurant.resumen_general ? (
                  <div className="modal-summary" role="status" aria-live="polite" aria-busy="true">
                    <h3>📋 Resumen</h3>
                    <span className="sr-only">Preparando el resumen del lugar</span>
                    <div className="detalle-esqueleto">
                      <div className="esq esq--linea" />
                      <div className="esq esq--linea" />
                      <div className="esq esq--linea es-ultima" />
                    </div>
                  </div>
                ) : selectedRestaurant.resumen_general && (
                  <div className="modal-summary">
                    <h3>📋 Resumen</h3>
                    <p>{selectedRestaurant.resumen_general}</p>
                  </div>
                )}

                <div className="modal-aspects">
                  {selectedRestaurant.aspectos_positivos?.length > 0 && (
                    <div className="aspects-positive">
                      <h4>👍 Lo mejor</h4>
                      <ul>
                        {selectedRestaurant.aspectos_positivos.map((asp, i) => (
                          <li key={i}>{asp}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selectedRestaurant.aspectos_negativos?.length > 0 && (
                    <div className="aspects-negative">
                      <h4>👎 A mejorar</h4>
                      <ul>
                        {selectedRestaurant.aspectos_negativos.map((asp, i) => (
                          <li key={i}>{asp}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {selectedRestaurant.reviews?.length > 0 && (
                  <div className="modal-reviews">
                    <h3>💬 Reseñas de clientes</h3>
                    <div className="reviews-list">
                      {selectedRestaurant.reviews.map((review, idx) => (
                        <div key={idx} className="review-item">
                          <div className="review-header">
                            <span className="review-author">{review.autor}</span>
                            <span className="review-rating">
                              {'⭐'.repeat(review.rating)}
                            </span>
                            {review.fecha && <span className="review-date">{review.fecha}</span>}
                          </div>
                          <p className="review-text">{review.texto}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Footer adriandv */}
      <footer className="app-footer-status">
        {/* Etiquetas y fechas abreviadas: cuatro items con año y hora completa saturaban la
            linea. El dato preciso sigue disponible en el title de cada uno. */}
        <div className="dataset-status" aria-label="Estado de actualización de datos">
          {formatCompacta(backendHealth?.last_scraping || backendHealth?.dataset_updated_at) && (
            <span title={`Últimos datos scrapeados: ${formatStatusDate(backendHealth?.last_scraping || backendHealth?.dataset_updated_at)}`}>
              <strong>Datos</strong> {formatCompacta(backendHealth?.last_scraping || backendHealth?.dataset_updated_at)}
            </span>
          )}
          <span title={`Próxima actualización de reseñas: ${formatNextRun(getNextWeeklyRun())} ART`}>
            <strong>Próx. reseñas</strong> {formatCompacta(getNextWeeklyRun())}
          </span>
          <span title={`Próxima búsqueda de lugares nuevos: ${formatNextRun(getNextMonthlyRun())} ART`}>
            <strong>Próx. lugares</strong> {formatCompacta(getNextMonthlyRun())}
          </span>
          {(backendHealth?.backend_updated_at || backendHealth?.updated_at) && (
            <span title={`Backend desplegado: ${formatStatusDate(backendHealth.backend_updated_at || backendHealth.updated_at)}`}>
              <strong>Deploy</strong> {formatCompacta(backendHealth.backend_updated_at || backendHealth.updated_at)}
            </span>
          )}
        </div>
        <div className="app-footer-credit">
          Creado con ❤️ por <a href="https://adriandv.dev" target="_blank" rel="noopener noreferrer">adriandv.dev</a>
        </div>
      </footer>
    </div>
  );
}

export default App;
