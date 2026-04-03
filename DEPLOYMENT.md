# Teliman Tracking Fleeti — Deployment & Operations

## Stack
- Frontend: Vite + React, deployed on Vercel
- Backend: Express API on VPS
- Reverse proxy: Nginx + HTTPS
- Data source: Fleeti API

## Production endpoints
- Frontend: Vercel project linked to this repo
- Backend API: https://api.telimanlogistique.com
- Healthcheck: https://api.telimanlogistique.com/api/health

## Backend runtime
- Default port: `8787`
- Process manager: recommended `pm2` or `systemd`
- Reverse proxy target: `http://127.0.0.1:8787`

## Required environment variables
```env
FLEETI_API_BASE=https://tracking.ci.fleeti.co/api-v2
FLEETI_LOGIN=boubsfal@gmail.com
FLEETI_PASSWORD="Azerty123456#"
FLEETI_DEALER_ID=23241
FLEETI_LOCALE=fr
PORT=8787
```

## Important note
`FLEETI_PASSWORD` must stay quoted because of `#` in dotenv parsing.

## Suggested backend restart flow
```bash
cd /home/lamine/.openclaw/workspace/teliman-tracking-fleeti
npm install
npm run build
pm2 restart teliman-tracking-fleeti || pm2 start server.js --name teliman-tracking-fleeti
```

## Nginx reminder
Proxy backend domain `api.telimanlogistique.com` to local port `8787`.
Ensure HTTPS is enabled with Let's Encrypt.

## Validation checklist
- `https://api.telimanlogistique.com/api/health` responds OK
- frontend loads without mixed content
- `/map`, `/trackers`, `/alerts`, `/analytics` routes work
- Vercel SPA rewrites active
- Fleeti credentials loaded server-side only

## Operational recommendations
- keep backend logs enabled
- monitor API health regularly
- restart backend after env changes
- keep frontend and backend deploys in sync when API shape changes
