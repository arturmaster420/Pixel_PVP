# Be_Try Arena BR — Release v0.2.0

This repository is a portal-ready, authoritative-server WebSocket PvP arena game.

## Quick start (local)

```bash
npm install
npm run dev
```

- Client: http://localhost:5173
- Server (WS): ws://localhost:8080

## Production (VPS)

Use the provided deploy pack (Docker + Caddy + WSS). See `DEPLOY.md`.

## Environment variables

Server (`apps/server`):
- `PORT` (default `8080`)
- `METRICS=0` to disable periodic metrics
- `METRICS_LOG_EVERY_SEC` (default `30`)
- `ADMIN_KEY` (optional; enables WS-only admin ops)

Client:
- Served as static `apps/client/dist` (relative paths; works in subfolders / iframe).

## Portal notes

- First user interaction is handled by the Portal wrapper overlay ("Start") to satisfy browser policies.
- Optional ads integration is supported via `window.__BT_ADS__` (if the portal injects it).
