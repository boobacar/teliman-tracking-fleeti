# Teliman Tracking Fleeti

V3 introduces a safer architecture:

- **Frontend**: React + Vite dashboard
- **Backend**: Express proxy to Fleeti API
- **Map**: Leaflet live tracker view
- **Features**: search, filters, alerts, risk ranking, events, tracker detail cards

## Setup

```bash
cp .env.example .env
```

Fill the Fleeti credentials in `.env`.

## Run backend

```bash
npm run dev:server
```

Available backend endpoints:

- `/api/health`
- `/api/dashboard`
- `/api/trackers`
- `/api/drivers`
- `/api/alerts`

## Run frontend

```bash
npm run dev
```

## Build frontend

```bash
npm run build
```

## Environment

- `FLEETI_API_BASE`
- `FLEETI_LOGIN`
- `FLEETI_PASSWORD`
- `FLEETI_DEALER_ID`
- `FLEETI_LOCALE`
- `PORT`
- `VITE_BACKEND_URL`
