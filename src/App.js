import React, { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import { lanzarLluviaTono } from './utils/emojiRain.js';

// Componente para cambiar el TileLayer dinámicamente
function ChangeMapStyle({ url, attribution }) {
  const map = useMap();
  useEffect(() => {
    // Forzar re-render del mapa cuando cambia el estilo
    map.invalidateSize();
  }, [map, url]);
  // Opciones recomendadas para mejorar la experiencia de carga de tiles
  const tileOpts = {
    attribution,
    detectRetina: true,
    keepBuffer: 2, // mantener algunos tiles fuera de la vista para zoom/pan suave
    updateWhenIdle: true, // renderizar tiles cuando el mapa quede idle
  };

  return <TileLayer url={url} {...tileOpts} />;
}

// Componente para forzar que el mapa cargue correctamente
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    // Forzar recalcular tamaño después de varios delays para cubrir el caso
    // donde el contenedor padre cambia de tamaño cuando carga el contenido
    const timers = [
      setTimeout(() => map.invalidateSize(), 100),
      setTimeout(() => map.invalidateSize(), 300),
      setTimeout(() => map.invalidateSize(), 500),
      setTimeout(() => map.invalidateSize(), 1000),
    ];

    // También invalidar cuando la ventana cambia de tamaño
    const handleResize = () => map.invalidateSize();
    window.addEventListener('resize', handleResize);

    // Observar cambios en el contenedor del mapa
    const container = map.getContainer().parentElement;
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    if (container) {
      resizeObserver.observe(container);
    }

    return () => {
      timers.forEach(t => clearTimeout(t));
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, [map]);
  return null;
}

// Componente para ajustar el zoom para mostrar todos los marcadores
// Ahora recibe 'trigger' para saber cuándo recalcular (ej: al cambiar de tab)
function FitBounds({ locations, allViewRef, trigger }) {
  const map = useMap();
  const DEFAULT_SINGLE_ZOOM = 18;
  const FIT_PADDING = [40, 40];

  useEffect(() => {
    if (!locations || locations.length === 0) return;

    // Función segura para guardar la vista
    const saveSafeView = () => {
      try {
        const c = map.getCenter();
        const z = map.getZoom();
        if (!isNaN(c.lat) && !isNaN(c.lng) && !isNaN(z)) {
          allViewRef && (allViewRef.current = { center: [c.lat, c.lng], zoom: z });
        }
      } catch (e) { /* ignore */ }
    };

    // Forzar recalculo de tamaño antes de ajustar bounds
    map.invalidateSize();

    // Damos un pequeño respiro para que el invalidateSize surta efecto
    const timer = setTimeout(() => {
      try {
        if (locations.length === 1) {
          const loc = locations[0];
          if (loc && !isNaN(loc.lat) && !isNaN(loc.lng)) {
            // Animación suave al centro
            map.flyTo([loc.lat, loc.lng], DEFAULT_SINGLE_ZOOM, { duration: 0.8 });
            saveSafeView();
          }
        } else {
          const validLocs = locations.filter(l => !isNaN(l.lat) && !isNaN(l.lng));
          if (validLocs.length > 0) {
            const bounds = L.latLngBounds(validLocs.map(loc => [loc.lat, loc.lng]));
            if (bounds.isValid()) {
              // Usamos flyToBounds para una transición suave o fitBounds para instantánea
              map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: 16, animate: true, duration: 0.8 });
              saveSafeView();
            }
          }
        }
      } catch (e) { console.warn('FitBounds error:', e); }
    }, 150); // Delay aumentado ligeramente para asegurar que el mapa ya es visible

    return () => clearTimeout(timer);

    // AQUÍ ESTÁ LA CLAVE: Agregamos 'trigger' a las dependencias
  }, [map, locations, allViewRef, trigger]);

  return null;
}

// Componente para centrar el mapa en el restaurante hovereado (solo desde tarjetas)
function CenterOnHover({ centerOn, locations, allViewRef }) {
  const map = useMap();
  const HOVER_ZOOM_DELTA = 2;
  const DEFAULT_HOVER_ZOOM = 16;

  useEffect(() => {
    // Caso 1: Centrar en un restaurante específico
    if (centerOn && locations.length > 0) {
      const loc = locations.find(l => l.nombre === centerOn);
      // Validar coordenadas antes de volar
      if (loc && !isNaN(loc.lat) && !isNaN(loc.lng)) {
        let hoverZoom = DEFAULT_HOVER_ZOOM;
        if (allViewRef && allViewRef.current && !isNaN(allViewRef.current.zoom)) {
          hoverZoom = Math.max(allViewRef.current.zoom + HOVER_ZOOM_DELTA, 3);
        }
        try {
          map.flyTo([loc.lat, loc.lng], hoverZoom, { duration: 0.5 });
        } catch (e) { console.warn("Error en flyTo", e); }
      }
    }
    // Caso 2: Restaurar vista general
    else {
      if (allViewRef && allViewRef.current && allViewRef.current.center) {
        const [lat, lng] = allViewRef.current.center;
        const zoom = allViewRef.current.zoom || 13;

        // VALIDACIÓN CRÍTICA PARA EVITAR ERROR (NaN, NaN)
        if (!isNaN(lat) && !isNaN(lng) && !isNaN(zoom)) {
          try {
            map.flyTo([lat, lng], zoom, { duration: 0.5 });
          } catch (e) {
            console.warn('FlyTo preventivo evitado:', e);
          }
        }
      }
    }
  }, [centerOn, locations, map, allViewRef]);

  return null;
}

// Small helper component: when `visible` becomes true, call invalidateSize on the map ref a couple of times
function MapKick({ visible, mapRef }) {
  useEffect(() => {
    if (!visible || !mapRef?.current) return;
    console.log('[MapKick] kicking map invalidates');
    // multiple calls over short time help Leaflet recalc when container was hidden
    const timers = [60, 180, 420, 900].map((ms) => setTimeout(() => {
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
const createFoodIcon = (emoji) => L.divIcon({
  html: `<div class="marker-emoji">${emoji}</div>`,
  className: 'food-marker',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -20]
});

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

// Fondo slideshow (imágenes difuminadas y mezcladas con el tema)
const BACKGROUND_IMAGES = [
  'https://images.unsplash.com/photo-1762047314688-b59b04b5f5de?q=80&w=928&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  'https://images.unsplash.com/photo-1528605248644-14dd04022da1?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
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

// Estilo de mapa oscuro
const MAP_STYLE = {
  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  attribution: '&copy; CARTO'
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
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `¿Indeciso? Te ahorro la búsqueda y te tiro la data justa 🍷

Tengo leídas todas las reseñas de Neuquén para recomendarte lo mejor. Preguntame:

🍕 Recomendaciones: "¿Dónde explota la pizza?"

🧐 La verdad de la milanesa: "¿Qué onda este bar que me dijo mi amigo? ¿Está bueno?"

🎯 A medida: "Lugares veganos", "Restaurantes aptos celíacos", "Lugares románticos" o "Lugares para ir en familia."

🤓 Dato nerd: "¿Cuántos lugares de sushi hay?"

¡Dale! Decime qué querés y arrancamos.
`,
      mode: 'system'
    }
  ]);
  const SAMPLE_CHIPS = [
    { label: '🍕 Mejores Pizzas', query: 'Mejores pizzas' },
    { label: '🥗 Opciones Veganas', query: 'Opciones veganas' },
    { label: '🍺 Mejores cervecerías', query: 'Mejores cervecerías' }
  ];
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState('checking');
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
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [tonesExpanded, setTonesExpanded] = useState(false);

  // === NUEVO ESTADO PARA PESTAÑAS MÓVILES ===
  const [mobileTab, setMobileTab] = useState('chat'); // 'chat' | 'results' | 'map'

  const isMobile = window.innerWidth <= 768;

  const toneToggleRef = useRef(null);


  const hasResults =
    restaurantCards.length > 0 || mapLocations.length > 0;

  // Cuando el usuario selecciona la pestaña Chat en mobile, asegurar scroll al final
  useEffect(() => {
    if (mobileTab === 'chat' && messagesContainerRef.current) {
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
  }, [mobileTab]);

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
  const [detailsCache, setDetailsCache] = useState({});
  const getDetailsCacheKey = (nombre, topicParam = null) => {
    const t = topicParam || conversationContext?.topic || 'default';
    return `${nombre}__${t}__${tone || 'cordial'}`;
  };
  const [inlineDetail, setInlineDetail] = useState(null); // Para modo resumen
  const [loadingInlineDetail, setLoadingInlineDetail] = useState(false);
  // Modal backend inactivo
  const [showBackendInactiveModal, setShowBackendInactiveModal] = useState(false);
  const [backendCountdown, setBackendCountdown] = useState(60);
  // Mostrar modal solo si apiStatus === 'error' y es la página inicial (solo mensaje de bienvenida)
  useEffect(() => {
    let countdownInterval;
    const isInitialPage = messages.length === 1 && messages[0]?.role === 'assistant';
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

  // === NUEVO REF PARA CONTENEDOR DE MENSAJES ===
  const messagesContainerRef = useRef(null);
  const markerRefs = useRef({});
  const cardRefs = useRef({}); // Refs para scroll a tarjetas
  const cardsContainerRef = useRef(null); // Ref del contenedor de tarjetas
  const scrollingFromMap = useRef(false); // Flag para evitar centrar mapa cuando scroll es desde marcador
  const allViewRef = useRef({ center: null, zoom: null }); // Guarda la vista que muestra todos los iconos
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

  // Memoizar el icono para que no se recree en cada render
  const currentIcon = useMemo(() => {
    return createFoodIcon(detectFoodType(lastQuery));
  }, [lastQuery]);

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
        const style = window.getComputedStyle(node);
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
        console.log('[HIGHLIGHT] Agregando clase a:', hoveredRestaurant, marker._icon);
      } else {
        console.log('[HIGHLIGHT] Marker sin _icon:', hoveredRestaurant, marker);
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
    }, 2000); // Debe coincidir con la transición CSS de 1.8s + margen
    return () => clearTimeout(t);
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
          setApiStatus('connected');
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
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, loading]);

  const checkBackendHealth = async () => {
    try {
      const response = await axios.get(`${API_URL}/health`, { timeout: 5000, ...axiosConfig });
      if (response.data.status === 'healthy') {
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

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let firstTokenReceived = false;

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        // Split by newlines to get NDJSON lines
        let lines = buffer.split("\n");
        // Keep the last part in buffer if it's incomplete (doesn't end with newline)
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

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

              if (event.locs) {
                setMapLocations(event.locs);
                if (event.locs.length > 0 && initialUserMessage) setLastQuery(initialUserMessage);
              }

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

    // Limpiar resultados anteriores y volver al chat grande
    setSidebarMode(false);
    setMapLocations([]);
    setRestaurantCards([]);

    setCurrentTopic(um);
    setInput('');
    setMobileTab('chat');

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
      default: return '🤖';
    }
  };

  const getModeLabel = (mode) => {
    switch (mode) {
      case 'estadisticas': return 'Estadísticas';
      case 'rag': return 'Recomendaciones';
      case 'resumen': return 'Resumen';
      default: return 'Sistema';
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

    // Si no está en cache, cargar normalmente
    setLoadingDetail(true);
    try {
      // Si hay topic en el contexto, pasarlo como query param para obtener reseñas filtradas
      const url = topic
        ? `${API_URL}/restaurant/${encodeURIComponent(nombreRestaurante)}?topic=${encodeURIComponent(topic)}&tone=${encodeURIComponent(tone)}`
        : `${API_URL}/restaurant/${encodeURIComponent(nombreRestaurante)}?tone=${encodeURIComponent(tone)}`;
      const response = await axios.get(url, axiosConfig);
      setSelectedRestaurant(response.data);
      // Guardar en cache con key que incluye topic si aplica
      setDetailsCache(prev => ({
        ...prev,
        [cacheKey]: response.data
      }));
    } catch (error) {
      console.error('Error al obtener detalles:', error);
      setSelectedRestaurant(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeModal = () => {
    setSelectedRestaurant(null);
  };

  const renderStars = (rating) => {
    const fullStars = Math.floor(rating);
    const hasHalf = rating % 1 >= 0.5;
    return (
      <span className="stars-display">
        {'★'.repeat(fullStars)}
        {hasHalf && '½'}
        {'☆'.repeat(5 - fullStars - (hasHalf ? 1 : 0))}
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
              key={`base-${i}`}
              className={`bg-slide bg-slide-${i}`}
              style={{ backgroundImage: `url(${src})` }}
            />
          ))}
        </div>
        {prevBgImages && (
          <div className="bg-layer prev">
            {prevBgImages.map((src, i) => (
              <div
                key={`prev-${i}`}
                className={`bg-slide bg-slide-${i}`}
                style={{ backgroundImage: `url(${src})` }}
              />
            ))}
          </div>
        )}
      </div>
      <header className="app-header">
        <div className="header-top-row">
          <div className="header-title-group">
            <h1
              style={{ cursor: 'pointer' }}
              onClick={() => window.location.reload()}
            >🍽️ ¿Qué Morfamos?</h1>
            <span className="header-subtitle">Tu IA gastronómica de Neuquén y alrededores</span>
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

      <div className="main-content">
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
                {message.role === 'assistant' && message.mode && (
                  <div className="message-mode">
                    {getModeIcon(message.mode)} {getModeLabel(message.mode)}
                  </div>
                )}
                <div className="message-content">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              </div>
            ))}
            {loading && (
              <div className="message message-assistant">
                <div className="message-content loading">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  Pensando...
                </div>
              </div>
            )}
          </div>

          {/* Mostrar opciones pendientes si el backend las devolvió (labels opcionales) */}
          {conversationContext && conversationContext.pending_options && (
            <div className="pending-options">
              <div className="pending-note">Elegí la opción que corresponda:</div>
              <div className="pending-list">
                {Array.isArray(conversationContext.pending_options)
                  ? conversationContext.pending_options.map((opt, i) => (
                    <button key={i} className="pending-btn" onClick={() => selectPendingOption(i)}>
                      {i + 1}. {opt}
                    </button>
                  ))
                  : (conversationContext.pending_options.labels || []).map((lbl, i) => (
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
          {messages.length <= 1 && !sidebarMode && (
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
            />
            <button
              type="submit"
              disabled={loading || !input.trim() || apiStatus !== 'connected'}
              className="send-button"
            >
              {loading ? '⏳' : '📤'}
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
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <p>Cargando información del restaurante...</p>
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
                      style={{ cursor: 'pointer' }}
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
                    key={mapLocations.map(l => l.nombre).join('-')}
                    whenCreated={(m) => { mapRef.current = m; console.log('[MAP] created', m); }}
                    center={[mapLocations[0].lat, mapLocations[0].lng]}
                    zoom={13}
                    preferCanvas={true}
                    zoomAnimation={true}
                    fadeAnimation={true}
                    style={{ height: '100%', width: '100%', borderRadius: '12px' }}
                  >
                    <MapResizer />
                    <FitBounds locations={mapLocations} allViewRef={allViewRef} trigger={mobileTab} />
                    <ChangeMapStyle
                      url={MAP_STYLE.url}
                      attribution={MAP_STYLE.attribution}
                    />
                    <CenterOnHover
                      centerOn={centerMapOn}
                      locations={mapLocations}
                      allViewRef={allViewRef}
                    />
                    {/** small hack: kick-map-invalidates after mount */}
                    <MapKick visible={mobileTab === 'map'} mapRef={mapRef} />
                    {/* Force a couple invalidateSize calls after mount to avoid blank map when container was hidden */}
                    {mapLocations.map((loc, idx) => (
                      <Marker
                        key={`${loc.nombre}-${idx}`}
                        position={[loc.lat, loc.lng]}
                        icon={currentIcon}
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
      </div>{/* Fin main-content */}

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

      {/* Modal backend inactivo por inactividad */}
      {showBackendInactiveModal && (
        <div className="modal-overlay" style={{
          zIndex: 9999,
          background: 'rgba(10, 20, 40, 0.55)', // azul oscuro, menos opaco
          backdropFilter: 'blur(2px)'
        }}>
          <div className="modal-content" style={{
            maxWidth: 400,
            textAlign: 'center',
            background: 'rgba(20, 30, 60, 0.98)',
            borderRadius: 14,
            color: '#fff',
            boxShadow: '0 4px 32px 0 rgba(0,0,0,0.25)',
            border: '1.5px solid #2a4a7a',
            padding: 24
          }}>
            <img src="https://bvtelevision.wordpress.com/wp-content/uploads/2015/04/technical.jpg?w=300" alt="Backend inactivo" style={{ width: '100%', maxWidth: 250, borderRadius: 8, marginBottom: 18, border: '2px solid #2a4a7a' }} />
            <h2
              className="modal-title-gradient"
              style={{
                marginBottom: 16,
                fontWeight: 700,
                letterSpacing: 0.5,
                fontSize: '2rem',
                background: 'var(--accent-gradient)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                WebkitTextFillColor: 'transparent',
                textShadow: '0 2px 8px rgba(0,0,0,0.18), 0 1px 0 #fff2',
                backgroundSize: '200% 200%',
                animation: 'gradient-move 6s ease-in-out infinite',
              }}
            >Backend inactivo... Reconectando</h2>
            <p style={{ marginBottom: 14, fontSize: 17, color: '#fff', lineHeight: 1.5 }}>
              El backend fue desactivado por inactividad prolongada.<br />
              <span style={{ color: '#6ec1ff' }}>Intentando reactivar en <b>{backendCountdown}</b> segundos.</span>
            </p>
            <div style={{ fontSize: 32, margin: '12px 0' }}>
              <span role="img" aria-label="reloj">⏳</span>
            </div>
            <p style={{ fontSize: 14, color: '#b3d8ff', marginTop: 10 }}>La página intentará reconectar automáticamente.</p>
          </div>
        </div>
      )}

      {/* Modal de detalle del restaurante */}
      {(selectedRestaurant || loadingDetail) && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>✕</button>
            {loadingDetail ? (
              <div className="modal-loading">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <p>Cargando información...</p>
              </div>
            ) : selectedRestaurant && (
              <>
                <div className="modal-header">
                  <h2>{selectedRestaurant.nombre}</h2>
                  <div className="modal-rating">
                    {renderStars(selectedRestaurant.rating)}
                    <span className="rating-number">{selectedRestaurant.rating?.toFixed(1)}</span>
                    <span className="rating-count">({selectedRestaurant.total_reviews} reseñas)</span>
                  </div>
                </div>

                <div className="modal-location">
                  <p>📍 {selectedRestaurant.direccion || 'Dirección no disponible'}</p>
                  {(selectedRestaurant.barrio || selectedRestaurant.zona) && (
                    <p className="location-zone">
                      {selectedRestaurant.barrio}{selectedRestaurant.barrio && selectedRestaurant.zona ? ' • ' : ''}{selectedRestaurant.zona}
                    </p>
                  )}
                </div>

                {selectedRestaurant.resumen_general && (
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
    </div>
  );
}

export default App;