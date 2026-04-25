# Teliman Tracking Fleeti

A fleet operations dashboard for Teliman built on top of Fleeti.

## What it does
- live fleet dashboard
- trackers map with route playback
- alerts and basic analytics
- driver and tracker detail views
- delivery order / mission tracking tied to vehicles

## Architecture
- **Frontend**: React + Vite
- **Backend**: Express proxy to Fleeti API
- **Map**: Leaflet live tracker view
- **Data source**: Fleeti API
- **Local business storage**: `delivery-orders.json`

The backend exists to keep Fleeti credentials server-side and expose a smaller app-specific API to the frontend.

## Setup
```bash
cp .env.example .env
```

Fill the required environment variables in `.env`.

⚠️ Vous pouvez démarrer avec **l’API privée** (FLEETI_API_BASE + login/password/dealer) *ou* avec **l’API publique** (`FLEETI_PUBLIC_API_KEY`).
Le backend bascule automatiquement vers l’API publique si l’API privée est indisponible.

## Security notes
- Never commit `.env`
- Never hardcode Fleeti credentials in source files
- Restrict `ALLOWED_ORIGINS` in production
- Enable `REQUIRE_API_TOKEN=true` if the backend should not be public
- Rotate secrets if this repository previously contained real credentials

## Run backend
```bash
npm run dev:server
```

Available backend endpoints include:
- `/api/health`
- `/api/dashboard`
- `/api/trackers`
- `/api/drivers`
- `/api/alerts`
- `/api/reports`
- `/api/tracks`
- `/api/delivery-orders`

## Run frontend
```bash
npm run dev
```

## Build frontend
```bash
npm run build
```

## Environment
- `FLEETI_API_BASE` (optionnel si API publique utilisée)
- `FLEETI_LOGIN` (optionnel si API publique utilisée)
- `FLEETI_PASSWORD` (optionnel si API publique utilisée)
- `FLEETI_DEALER_ID` (optionnel si API publique utilisée)
- `FLEETI_PUBLIC_API_BASE` (optionnel, défaut: `https://api.fleeti.co/v1`)
- `FLEETI_PUBLIC_API_KEY` (requis si API privée non configurée)
- `FLEETI_LOCALE`
- `PORT`
- `VITE_BACKEND_URL`
- `ALLOWED_ORIGINS`
- `FLEETI_TRACKER_IDS` (optional)
- `REQUIRE_API_TOKEN` (optional)
- `INTERNAL_API_TOKEN` (optional)
- `CACHE_TTL_MS` (optional)
