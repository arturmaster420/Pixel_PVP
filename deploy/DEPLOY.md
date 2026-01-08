# Deploy Pack (Docker + WSS Reverse Proxy)

This folder lets you bring the game online **fast** on a VPS:
- HTTPS for the website
- WSS for the game server (`/ws`)
- 1 command to start / restart

It uses **Caddy** as reverse proxy (auto TLS via Let's Encrypt).

---

## What you need
- A VPS (Ubuntu 22.04+ recommended)
- A domain (or subdomain) pointing to the VPS IP (A/AAAA record)
- Ports **80** and **443** open to the VPS

---

## Quick start (VPS)

### 1) Install Docker
On Ubuntu (official convenience script):
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### 2) Upload the project to the VPS
Copy the project folder to the VPS (scp / sftp / git), then:
```bash
cd <project-root>
cd deploy
cp .env.example .env
nano .env
```

Set:
- `DOMAIN=your.real.domain`
- optionally `ACME_EMAIL=you@domain.com`

### 3) Start
```bash
docker compose up -d --build
```

### 4) Check logs
```bash
docker compose logs -f caddy
docker compose logs -f server
```

Your site should be available at:
- `https://your.real.domain/`
- WebSocket endpoint: `wss://your.real.domain/ws`

---

## Local test (Docker, no TLS)
Set `DOMAIN=:80` in `.env` and run:
```bash
docker compose up -d --build
```
Open:
- `http://localhost/`

(WS will be `ws://localhost/ws` through the proxy.)

---

## Updating
1) Replace the project folder with a new ZIP (keep your `.env`)
2) Rebuild + restart:
```bash
docker compose up -d --build
```

---

## Notes
- Caddy stores certificates in docker volumes: `caddy_data`, `caddy_config`.
- The client is served from `../apps/client/dist`.
  If you update client code, rebuild it before deploying:
  ```bash
  cd ..
  npm --prefix apps/client install
  npm --prefix apps/client run build
  ```

Note:
- The compose file maps the server to `127.0.0.1:8080` (loopback only) so the client can also connect directly in dev-mode.
- In production you should keep it loopback-only (as configured) and use `/ws` through Caddy for public traffic.
