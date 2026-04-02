# Visualizador de Correlativas

Web app que importa un PDF de régimen de correlatividades, detecta materias y dependencias automáticamente, y muestra un mapa interactivo donde marcar materias aprobadas para desbloquear las siguientes.

La app funciona 100% del lado cliente para despliegue estático (GitHub Pages): parseo PDF en navegador y progreso en `localStorage`.

## Estructura de carpetas

- `src/client/`: código fuente frontend (`index.html`, `app.js`, `client-core.js`, `styles.css`).
- `src/`: backend legacy (Express + parser en Node), mantenido por compatibilidad local.
- `scripts/build.mjs`: genera el sitio estático en `dist/`.
- `pdf/`: plantillas PDF incluidas en el build.
- `dist/`: salida de build lista para publicar.
- `data/`: datos locales usados por el backend legacy.

## Ejecutar (modo estático recomendado)

```bash
npm install
npm run build
```

Publicá el contenido de `dist/` en cualquier hosting estático.

## Ejecutar (modo legacy con Node)

```bash
npm install
npm start
```

Abrir `http://localhost:3000`.

## Flujo de uso

1. Subí un PDF desde la interfaz.
2. El parser detecta el bloque de `ANEXO I` y arma materias + correlativas sin hardcodear nombres de materias.
3. Se genera el grafo y podés marcar materias como aprobadas.
4. El progreso se guarda localmente en el navegador.

## Notas

- Abrir `index.html` con `file://` puede fallar por restricciones del navegador.
- Para pruebas locales, usá un servidor HTTP o el despliegue en GitHub Pages.
