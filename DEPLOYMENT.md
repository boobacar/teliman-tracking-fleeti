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
FLEETI_LOGIN=your-login@example.com
FLEETI_PASSWORD='replace-with-secure-password'
FLEETI_DEALER_ID=23241
FLEETI_LOCALE=fr
PORT=8787
ALLOWED_ORIGINS=https://your-frontend-domain.example
```

## Optional hardening
```env
FLEETI_TRACKER_IDS=3487533,3487539,3488325
REQUIRE_API_TOKEN=true
INTERNAL_API_TOKEN=replace-with-long-random-token
CACHE_TTL_MS=60000
```

## Important note
If the Fleeti password contains `#`, spaces, or shell-sensitive characters, keep it quoted in `.env`.

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
- `.env` is not committed
- CORS only allows trusted frontend origins

## Operational recommendations
- keep backend logs enabled
- monitor API health regularly
- restart backend after env changes
- keep frontend and backend deploys in sync when API shape changes
- rotate secrets if they were ever committed before
