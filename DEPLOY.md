# Be_Try Arena BR — Deploy (Web)

This project is split into:
- **Client**: Vite static build (`apps/client/dist`)
- **Server**: Node.js WebSocket authoritative server (`apps/server/src/index.js`)

## 1) Client WS URL configuration

The client resolves WebSocket URL in this order:
1. `window.__BE_TRY_WS_URL__` (runtime override)
2. `import.meta.env.VITE_WS_URL` (build-time override via Vite)
3. Smart defaults:
   - **Dev** (localhost or non-standard port): `ws://<host>:8080`
   - **Prod** (same host via reverse proxy): `wss://<host>/ws` (or `ws://` on http)

### Runtime override (recommended for mirrors)

Add this to `index.html` **before** the module script:

```html
<script>
  // Example:
  // window.__BE_TRY_WS_URL__ = 'wss://yourdomain.com/ws';
</script>
```

### Build-time override

Create `apps/client/.env.production`:

```env
VITE_WS_URL=wss://yourdomain.com/ws
```

## 2) Build the client

From repo root:

```bash
npm install
npm run build
```

Output: `apps/client/dist`.

### Portals / sub-path hosting

Many portals host your game under a sub-path (not at `/`).
To avoid broken asset paths, this repo sets **Vite `base: './'`** (see `apps/client/vite.config.js`).
The committed `apps/client/dist/index.html` also uses **relative** `./assets/...` paths.

## 3) Run the server

From repo root:

```bash
npm --prefix apps/server install
PORT=8080 node apps/server/src/index.js
```

Optional ops:

- `ADMIN_KEY=...` enables a tiny WS-only admin command surface (`t:'admin'`) for ops/debug (e.g. room reset, metrics dump).

## 4) HTTPS + WSS (reverse proxy)

If your site uses `https://`, browsers require `wss://`.
The common setup is:
- Static client hosted at `https://yourdomain.com/`
- Reverse proxy forwards `https://yourdomain.com/ws` -> `http://127.0.0.1:8080`

### Option A: Caddy (simple)

`Caddyfile`:

```caddy
yourdomain.com {
  root * /var/www/arena-client
  file_server

  @ws path /ws
  reverse_proxy @ws 127.0.0.1:8080
}
```

### Option B: Nginx

```nginx
server {
  server_name yourdomain.com;

  location / {
    root /var/www/arena-client;
    try_files $uri /index.html;
  }

  location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 60s;
  }
}
```

## 5) Quick local prod-like test

You can test the **/ws** proxy pattern locally:

- Serve `apps/client/dist` with any static server.
- Put a local reverse proxy mapping `/ws` to `localhost:8080`.

Or easiest: set `VITE_WS_URL=ws://localhost:8080` and use any static file server.


---

## Docker deploy-pack

A ready-to-run Docker + Caddy (WSS) deploy-pack is included in `deploy/`.

- Read: `deploy/DEPLOY.md`
- Start: `cd deploy && cp .env.example .env && docker compose up -d --build`
