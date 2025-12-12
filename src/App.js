import React, { useState, useRef, useEffect, useMemo } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

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
function FitBounds({ locations, allViewRef }) {
  const map = useMap();
  // Zoom por defecto cuando solo hay 1 marcador
  const DEFAULT_SINGLE_ZOOM = 15;
  // Padding para asegurar que los íconos no queden pegados al borde
  const FIT_PADDING = [40, 40];

  useEffect(() => {
    if (!locations || locations.length === 0) return;

    try {
      if (locations.length === 1) {
        // Centrar en la única ubicación con zoom estándar
        map.setView([locations[0].lat, locations[0].lng], DEFAULT_SINGLE_ZOOM);
        // Guardar vista que muestra la ubicación única (después de corto delay para asegurar cálculo)
        setTimeout(() => {
          try {
            const c = map.getCenter();
            allViewRef && (allViewRef.current = { center: [c.lat, c.lng], zoom: map.getZoom() });
          } catch (e) {
            console.warn('No se pudo guardar allViewRef para single marker (delayed):', e);
          }
        }, 300);
      } else {
        // Calcular bounds y ajustar zoom para que entren todos los íconos
        const bounds = L.latLngBounds(locations.map(loc => [loc.lat, loc.lng]));
        // fitBounds con padding y límite máximo de zoom para evitar un zoom excesivo
        map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: 16 });
        // Guardar la vista que muestra todos los íconos después de permitir que Leaflet calcule zoom
        setTimeout(() => {
          try {
            const c = map.getCenter();
            allViewRef && (allViewRef.current = { center: [c.lat, c.lng], zoom: map.getZoom() });
          } catch (e) {
            console.warn('No se pudo guardar allViewRef después de fitBounds (delayed):', e);
          }
        }, 300);
      }
    } catch (e) {
      console.warn('FitBounds error:', e);
    }
  }, [map, locations]);

  return null;
}

// Componente para centrar el mapa en el restaurante hovereado (solo desde tarjetas)
function CenterOnHover({ centerOn, locations, allViewRef }) {
  const map = useMap();
  // Zoom del hover: valor positivo -> más cercano (más zoom in)
  const HOVER_ZOOM_DELTA = 2; // aumentar en 2 niveles respecto a la vista de todos los iconos
  const DEFAULT_HOVER_ZOOM = 16;

  useEffect(() => {
    if (centerOn && locations.length > 0) {
      const loc = locations.find(l => l.nombre === centerOn);
      if (loc) {
        // Determinar zoom objetivo: basado en allViewRef si existe
        let hoverZoom = DEFAULT_HOVER_ZOOM;
        if (allViewRef && allViewRef.current && allViewRef.current.zoom) {
          hoverZoom = Math.max((allViewRef.current.zoom || DEFAULT_HOVER_ZOOM) + HOVER_ZOOM_DELTA, 3);
        }

        map.flyTo([loc.lat, loc.lng], hoverZoom, { duration: 0.5 });
      }
    } else {
      // Restaurar la vista que muestra todos los íconos
      if (allViewRef && allViewRef.current && allViewRef.current.center) {
        try {
          map.flyTo(allViewRef.current.center, allViewRef.current.zoom || 13, { duration: 0.5 });
        } catch (e) {
          console.warn('No se pudo restaurar la vista allViewRef del mapa:', e);
        }
      }
    }
  }, [centerOn, locations, map, allViewRef]);

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
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '¿No sabés cuáles son los mejores lugares en Neuquén? Dejá que yo te diga la posta 🍽️\n\nPuedo:\n- Decirte dónde hay buena pizza.\n- Contarte qué opinan de un lugar en particular (ese al que van tus amigos).\n- Buscar cuántos locales ofrecen opciones para tu restricción alimentaria.\n\nEjemplos: "¿Dónde hay buena pizza?", "Qué opinan de Growler Bar?", "Cuántos restaurantes de sushi hay?", "Dónde hay opciones veganas?"',
      mode: 'system'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState('checking');
  const [conversationContext, setConversationContext] = useState({});
  const [mapLocations, setMapLocations] = useState([]);
  const [lastQuery, setLastQuery] = useState('');
  const [restaurantCards, setRestaurantCards] = useState([]);
  const [cardsMode, setCardsMode] = useState('rag'); // 'rag' = completas, 'estadisticas' = minimalistas
  const [sortBy, setSortBy] = useState('rating'); // 'rating', 'reviews', 'name'
  const [sidebarMode, setSidebarMode] = useState(false); // Chat en sidebar después del primer mensaje
  const [hoveredRestaurant, setHoveredRestaurant] = useState(null);
  const [centerMapOn, setCenterMapOn] = useState(null); // Solo se activa desde tarjetas
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailsCache, setDetailsCache] = useState({});
  const [inlineDetail, setInlineDetail] = useState(null); // Para modo resumen
  const [loadingInlineDetail, setLoadingInlineDetail] = useState(false);
  const messagesEndRef = useRef(null);
  const markerRefs = useRef({});
  const cardRefs = useRef({}); // Refs para scroll a tarjetas
  const cardsContainerRef = useRef(null); // Ref del contenedor de tarjetas
  const scrollingFromMap = useRef(false); // Flag para evitar centrar mapa cuando scroll es desde marcador
  const allViewRef = useRef({ center: null, zoom: null }); // Guarda la vista que muestra todos los iconos

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

  // Pre-cargar detalles de restaurantes cuando llegan las tarjetas
  useEffect(() => {
    if (restaurantCards.length > 0) {
      // Si es modo resumen con un solo restaurante, cargar detalles inline
      if (cardsMode === 'resumen' && restaurantCards.length === 1) {
        const nombre = restaurantCards[0].nombre;
        setLoadingInlineDetail(true);
        
        // Usar cache si existe
        if (detailsCache[nombre]) {
          setInlineDetail(detailsCache[nombre]);
          setLoadingInlineDetail(false);
        } else {
          // Cargar desde API
          axios.get(`${API_URL}/restaurant/${encodeURIComponent(nombre)}`, axiosConfig)
            .then(response => {
              setInlineDetail(response.data);
              setDetailsCache(prev => ({ ...prev, [nombre]: response.data }));
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
          if (!detailsCache[card.nombre]) {
          try {
            const response = await axios.get(`${API_URL}/restaurant/${encodeURIComponent(card.nombre)}`, axiosConfig);
            setDetailsCache(prev => ({
              ...prev,
              [card.nombre]: response.data
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
      
      if (detailsCache[nombre]) {
        setInlineDetail(detailsCache[nombre]);
        setLoadingInlineDetail(false);
      } else {
        axios.get(`${API_URL}/restaurant/${encodeURIComponent(nombre)}`, axiosConfig)
          .then(response => {
            setInlineDetail(response.data);
            setDetailsCache(prev => ({ ...prev, [nombre]: response.data }));
          })
          .catch(error => console.error('Error cargando detalles:', error))
          .finally(() => setLoadingInlineDetail(false));
      }
    } else {
      setInlineDetail(null);
    }
  }, [restaurantCards, cardsMode, mapLocations]);

  // Verificar estado del backend al cargar y periódicamente
  useEffect(() => {
    checkBackendHealth();
    const interval = setInterval(checkBackendHealth, 10000); // Cada 10 segundos
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const checkBackendHealth = async () => {
    try {
      const response = await axios.get(`${API_URL}/health`, { timeout: 3000, ...axiosConfig });
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

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');

    // Agregar mensaje del usuario
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    console.log('[FRONTEND DEBUG] Enviando query:', userMessage);
    console.log('[FRONTEND DEBUG] Contexto actual:', conversationContext);

    try {
      const response = await axios.post(`${API_URL}/chat`, {
        query: userMessage,
        conversation_context: conversationContext
      }, { timeout: 60000, ...axiosConfig }); // 60 segundos para respuestas del LLM

      console.log('[FRONTEND DEBUG] Respuesta recibida:', response.data);
      console.log('[FRONTEND DEBUG] Nuevo contexto:', response.data.conversation_context);

      // Actualizar contexto de conversación
      setConversationContext(response.data.conversation_context || {});

      // Actualizar ubicaciones del mapa si hay
      if (response.data.locations && response.data.locations.length > 0) {
        console.log('[FRONTEND DEBUG] Locations recibidas:', response.data.locations);
        setMapLocations(response.data.locations);
        setLastQuery(userMessage); // Guardar query solo cuando hay ubicaciones
      } else {
        setMapLocations([]);
      }

      // Siempre actualizar el modo de visualización
      if (response.data.mode) {
        console.log('[FRONTEND DEBUG] Modo:', response.data.mode);
        setCardsMode(response.data.mode);
      }

      // Actualizar tarjetas de restaurantes si hay
      if (response.data.restaurant_cards && response.data.restaurant_cards.length > 0) {
        console.log('[FRONTEND DEBUG] Cards recibidas:', response.data.restaurant_cards);
        setRestaurantCards(response.data.restaurant_cards);
        // Activar modo sidebar cuando hay resultados
        setSidebarMode(true);
      } else {
        console.log('[FRONTEND DEBUG] No hay cards, pero modo es:', response.data.mode);
        setRestaurantCards([]);
        // Si es modo resumen y hay locations, activar sidebar igual
        if (response.data.mode === 'resumen' && response.data.locations?.length > 0) {
          setSidebarMode(true);
        }
      }

      // Si hay detail_content (modo resumen), mostrarlo en el panel
      if (response.data.detail_content && response.data.mode === 'resumen') {
        console.log('[FRONTEND DEBUG] Detail content recibido');
        // Crear un objeto de detalle con el contenido
        const card = response.data.restaurant_cards?.[0];
        if (card) {
          setInlineDetail({
            nombre: card.nombre,
            rating: card.rating,
            total_reviews: card.total_reviews,
            direccion: card.direccion,
            barrio: card.barrio,
            zona: card.zona,
            resumen_general: response.data.detail_content
          });
        }
      } else {
        setInlineDetail(null);
      }

      // Agregar respuesta del asistente
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.data.response,
        mode: response.data.mode
      }]);
      
      // Actualizar estado de conexión exitosa
      setApiStatus('connected');
    } catch (error) {
      console.error('Error:', error);
      
      // Actualizar estado de conexión
      setApiStatus('error');
      
      let errorMessage = '❌ Error al conectar con el servidor.';
      if (error.code === 'ECONNREFUSED' || error.message.includes('Network Error')) {
        errorMessage = '❌ No puedo conectar con el backend. Asegurate de que esté corriendo en puerto 8000.';
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = '⏱️ La consulta tardó demasiado. El backend puede estar ocupado.';
      }
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: errorMessage,
        mode: 'error'
      }]);
    } finally {
      setLoading(false);
    }
  };

  // Seleccionar una opción pendiente (click en etiqueta)
  const selectPendingOption = async (index) => {
    if (loading) return;

    const selectionStr = String(index + 1); // enviamos el número al backend
    // Mostrar el mensaje del usuario en la UI
    setMessages(prev => [...prev, { role: 'user', content: selectionStr }] );
    setLoading(true);

    try {
      const response = await axios.post(`${API_URL}/chat`, {
        query: selectionStr,
        conversation_context: conversationContext
      }, { timeout: 60000, ...axiosConfig });

      // Actualizar contexto y UI igual que en sendMessage
      setConversationContext(response.data.conversation_context || {});
      setMessages(prev => [...prev, { role: 'assistant', content: response.data.response, mode: response.data.mode }]);

      if (response.data.locations && response.data.locations.length > 0) {
        setMapLocations(response.data.locations);
        setLastQuery(selectionStr);
      } else {
        setMapLocations([]);
      }

      if (response.data.restaurant_cards && response.data.restaurant_cards.length > 0) {
        setRestaurantCards(response.data.restaurant_cards);
        setSidebarMode(true);
      } else {
        setRestaurantCards([]);
      }

      if (response.data.detail_content && response.data.mode === 'resumen') {
        const card = response.data.restaurant_cards?.[0];
        if (card) {
          setInlineDetail({
            nombre: card.nombre,
            rating: card.rating,
            total_reviews: card.total_reviews,
            direccion: card.direccion,
            barrio: card.barrio,
            zona: card.zona,
            resumen_general: response.data.detail_content
          });
        }
      } else {
        setInlineDetail(null);
      }

      setApiStatus('connected');
    } catch (error) {
      console.error('Error al seleccionar opción:', error);
      setApiStatus('error');
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ Error al procesar la selección', mode: 'error' }]);
    } finally {
      setLoading(false);
    }
  };

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
    const topic = conversationContext?.topic;
    const cacheKey = topic ? `${nombreRestaurante}__${topic}` : nombreRestaurante;
    if (detailsCache[cacheKey]) {
      setSelectedRestaurant(detailsCache[cacheKey]);
      return;
    }
    
    // Si no está en cache, cargar normalmente
    setLoadingDetail(true);
    try {
      // Si hay topic en el contexto, pasarlo como query param para obtener reseñas filtradas
      const url = topic
        ? `${API_URL}/restaurant/${encodeURIComponent(nombreRestaurante)}?topic=${encodeURIComponent(topic)}`
        : `${API_URL}/restaurant/${encodeURIComponent(nombreRestaurante)}`;
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
      <div className="bg-slideshow" aria-hidden>
        {BACKGROUND_IMAGES.map((src, i) => (
          <div
            key={i}
            className={`bg-slide bg-slide-${i}`}
            style={{ backgroundImage: `url(${src})` }}
          />
        ))}
      </div>
      <header className="app-header">
        <h1 
          style={{ cursor: 'pointer' }}
          onClick={() => window.location.reload()}
        >🍽️ ¿Qué Morfamos?</h1>
        <span className="header-subtitle">Tu IA gastronómica de Neuquén y alrededores</span>
        <div className={`status-indicator status-${apiStatus}`}>
          <span className="status-dot"></span>
          {apiStatus === 'connected' ? 'Conectado' : apiStatus === 'checking' ? 'Conectando...' : 'Sin conexión'}
        </div>
      </header>

      <div className="main-content">
      <div className={`chat-container ${sidebarMode ? 'chat-sidebar' : ''}`}>
        {sidebarMode && (
          <div className="chat-header">
            <h4>💬 Chat</h4>
            <span className="chat-badge">En vivo</span>
          </div>
        )}
        <div className="messages-container">
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
          <div ref={messagesEndRef} />
        </div>

        {/* Mostrar opciones pendientes si el backend las devolvió (labels opcionales) */}
        {conversationContext && conversationContext.pending_options && (
          <div className="pending-options">
            <div className="pending-note">Elegí la opción que corresponda:</div>
            <div className="pending-list">
              {Array.isArray(conversationContext.pending_options)
                ? conversationContext.pending_options.map((opt, i) => (
                    <button key={i} className="pending-btn" onClick={() => selectPendingOption(i)}>
                      {i+1}. {opt}
                    </button>
                  ))
                : (conversationContext.pending_options.labels || []).map((lbl, i) => (
                    <button key={i} className="pending-btn" onClick={() => selectPendingOption(i)}>
                      {i+1}. {lbl}
                    </button>
                  ))
              }
            </div>
          </div>
        )}

        <form className="input-container" onSubmit={sendMessage}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Preguntame sobre restaurantes, bares, heladerías, etc. en Neuquén y alrededores"
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

      {/* Área de resultados (cards + mapa) */}
      <div className={sidebarMode ? 'results-area' : 'results-area-hidden'}>
        
        {/* Panel de detalle inline para modo resumen */}
        {cardsMode === 'resumen' && (loadingInlineDetail || inlineDetail) && (
          <div className="detail-panel">
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
          <div className={`cards-container ${cardsMode === 'estadisticas' ? 'cards-compact' : ''}`}>
            <h3>{cardsMode === 'estadisticas' ? `📍 ${restaurantCards.length} lugares encontrados` : '🍽️ Lugares recomendados'}</h3>
          
            {cardsMode === 'estadisticas' ? (
              // Tarjetas minimalistas para estadísticas
              <>
                <div className="sort-buttons">
                  <button 
                    className={`sort-btn ${sortBy === 'rating' ? 'active' : ''}`}
                    onClick={() => setSortBy('rating')}
                    title="Ordenar por puntaje"
                  >
                    ⭐ Puntaje
                  </button>
                  <button 
                    className={`sort-btn ${sortBy === 'reviews' ? 'active' : ''}`}
                    onClick={() => setSortBy('reviews')}
                    title="Ordenar por cantidad de reseñas"
                  >
                    💬 Reseñas
                  </button>
                  <button 
                    className={`sort-btn ${sortBy === 'name' ? 'active' : ''}`}
                    onClick={() => setSortBy('name')}
                    title="Ordenar alfabéticamente"
                  >
                    🔤 A-Z
                  </button>
                </div>
                <div className="cards-list" ref={cardsContainerRef}>
                  {sortedCards.map((card, idx) => (
                    <div 
                      key={idx} 
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
                {restaurantCards.map((card, idx) => (
                  <div 
                    key={idx} 
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
                        <p>"{card.frase_destacada}"</p>
                        {card.autor_reseña && <span className="quote-author">— {card.autor_reseña}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mapa de ubicaciones */}
        {mapLocations.length > 0 && (
          <div className="map-container">
            <div className="map-header">
              <h3>📍 {mapLocations.length === 1 ? 'Ubicación' : 'Ubicaciones'}</h3>
            </div>
            <MapContainer
              key={mapLocations.map(l => l.nombre).join('-')}
              center={[mapLocations[0].lat, mapLocations[0].lng]}
              zoom={13}
              preferCanvas={true}
              zoomAnimation={true}
              fadeAnimation={true}
              style={{ height: '300px', width: '100%', borderRadius: '12px' }}
            >
              <MapResizer />
              <FitBounds locations={mapLocations} allViewRef={allViewRef} />
              <ChangeMapStyle 
                url={MAP_STYLE.url} 
                attribution={MAP_STYLE.attribution} 
              />
              <CenterOnHover 
                centerOn={centerMapOn} 
                locations={mapLocations} 
                allViewRef={allViewRef}
              />
              {mapLocations.map((loc, idx) => (
                <Marker 
                  key={loc.nombre} 
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
                        // Buscar card con matching case-insensitive
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
                        // Fallback: mostrar rating de loc si existe
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
        )}
      </div>
      </div>{/* Fin main-content */}

      

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
