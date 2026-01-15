# Qué Morfamos - Frontend

Este repositorio contiene el frontend del buscador gastronómico [quemorfamos.adriandv.dev](https://quemorfamos.adriandv.dev), una interfaz conversacional para descubrir restaurantes en Neuquén, Argentina.

## Demo en Vivo

El sistema está deployado y disponible en: [quemorfamos.adriandv.dev](https://quemorfamos.adriandv.dev)

Link alternativo: [que-morfamos-web.vercel.app](https://que-morfamos-web.vercel.app)

## Descripción

La aplicación permite a los usuarios buscar recomendaciones de restaurantes mediante lenguaje natural. El sistema interpreta consultas como "quiero comer sushi cerca del río" o "lugares con opciones veganas en el centro" y devuelve recomendaciones basadas en el análisis semántico de más de 170,000 reseñas reales de Google Maps.

## Características

- Interfaz conversacional con respuestas en lenguaje natural
- Mapa interactivo de ubicaciones (Leaflet)
- Tarjetas de restaurantes con rating, categoría y datos de contacto
- Diseño responsive para dispositivos móviles
- Respuestas generadas por IA basadas en reseñas reales

## Contexto del Proyecto

Este desarrollo forma parte de mi portfolio personal, construido para profundizar mis habilidades en desarrollo frontend y sistemas de IA conversacional. El proyecto integra conceptos de:

- Desarrollo de interfaces en React
- Consumo de APIs RESTful
- Visualización de datos geoespaciales con Leaflet
- UX/UI para sistemas conversacionales
- Integración con backends de IA (LLMs + RAG)

## Stack Tecnológico

| Componente | Tecnología |
|------------|------------|
| Framework | React 18 |
| Mapas | Leaflet + React-Leaflet |
| HTTP Client | Axios |
| Markdown Rendering | react-markdown |
| Build Tool | Create React App |
| Deploy | Render (Static Site) |

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                     │
│  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ Chat Interface  │  │ Mapa Interactivo (Leaflet)  │  │
│  └────────┬────────┘  └─────────────────────────────┘  │
│           │                                             │
│           ▼                                             │
│  ┌──────────────────────────────────────────────────┐  │
│  │              API Backend (FastAPI)                │  │
│  │   - Búsqueda semántica con embeddings            │  │
│  │   - Generación de respuestas con LLM             │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Instalación Local

```bash
# Clonar el repositorio
git clone https://github.com/AdrianDVnqn/que-morfamos-web.git
cd que-morfamos-web

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.production .env.local
# Editar .env.local con la URL del backend

# Iniciar servidor de desarrollo
npm start
```

## Repositorios Relacionados

Este frontend forma parte de un ecosistema más amplio:

- **que-morfamos-web** (este repo): Frontend React
- **que-morfamos** (backend): API FastAPI + lógica de recomendación
- **que-morfamos-scraper**: Pipeline de datos y embeddings
- **que-morfamos-dashboard**: Panel de monitoreo Next.js

## Disclaimer

Este proyecto fue desarrollado exclusivamente con fines educativos y de aprendizaje personal. No tiene propósitos comerciales ni se obtiene rédito económico de él. El código se comparte públicamente como parte de mi portfolio profesional.
