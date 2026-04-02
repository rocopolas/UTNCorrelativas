# Visualizador de Correlativas

Web app que importa un PDF de régimen de correlatividades, detecta materias y dependencias automáticamente, y muestra un mapa interactivo donde marcar materias aprobadas para desbloquear las siguientes.

## Ejecutar

```bash
npm install
npm start
```

Abrir `http://localhost:3000`.

## Flujo

1. Subí un PDF desde la interfaz.
2. El backend parsea el bloque de `ANEXO I` y arma materias + correlativas sin hardcodear nombres de materias.
3. Se genera el grafo y podés marcar materias como aprobadas.
4. El progreso se guarda en `data/store.json`.

## API

- `POST /api/import` (multipart con campo `pdf`)
- `GET /api/graph`
- `POST /api/progress/toggle` body JSON `{ "subjectId": number }`
