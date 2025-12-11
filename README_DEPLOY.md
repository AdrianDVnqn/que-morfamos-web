Que Morfamos - Frontend

Instrucciones rápidas para subir a GitHub y desplegar en Vercel.

1) Verificar que `package.json` contiene los scripts:

```json
"scripts": {
  "start": "react-scripts start",
  "build": "react-scripts build",
  "test": "react-scripts test",
  "eject": "react-scripts eject"
}
```

2) Inicializar git y hacer commit (desde `frontend/`):

```powershell
cd frontend
git init
git add .
git commit -m "feat: initial frontend for que-morfamos"
```

3) Añadir remoto y push (elige HTTPS o SSH):

HTTPS:
```powershell
git remote add origin https://github.com/AdrianDVnqn/que-morfamos-web.git
git branch -M main
git push -u origin main
```

SSH:
```powershell
git remote add origin git@github.com:AdrianDVnqn/que-morfamos-web.git
git branch -M main
git push -u origin main
```

4) Desplegar en Vercel:
- Opción GUI: En vercel.com -> New Project -> Import Git Repository -> seleccionar `AdrianDVnqn/que-morfamos-web` -> Deploy.
- Opción CLI:
```powershell
npm i -g vercel
cd frontend
vercel login
vercel --prod
```

Build settings for Vercel:
- Build command: `npm run build`
- Output directory: `build`

5) Variables de entorno
Si usas un túnel o URL externa para backend, añade `REACT_APP_BACKEND_URL` o `REACT_APP_API_URL` en Vercel (Project Settings -> Environment Variables).

Conectar al backend desplegado en Render

Si tu backend está desplegado en Render y expone la API en `https://<tu-app>.onrender.com` (por ejemplo, si `main.py` es el entrypoint), configura en Vercel la variable:

```
REACT_APP_BACKEND_URL=https://<tu-app>.onrender.com
-- o --
REACT_APP_API_URL=https://<tu-app>.onrender.com
```

Notas:
- Asegurate de que el endpoint `/health` y los endpoints de la API estén accesibles públicamente en Render.
- Si Render sirve con HTTPS (normalmente sí), el frontend en Vercel podrá comunicarse sin problemas.
- Si habilitás CORS en el backend, añade el origen de Vercel o usa `*` durante pruebas.

Si querés, puedo intentar ejecutar los pasos de git aquí (necesitarás autenticación para push), o te doy los comandos para que los ejecutes en tu máquina.