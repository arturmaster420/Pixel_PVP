# Be_Try Arena BR (Respawn)

Web PvP (authoritative server) with lobby, room codes + invite links, bots, map vote.

## Quick start

```bash
npm install
npm run dev
```

- Server: ws://localhost:8080
- Client: http://localhost:5173

## Commands

- `npm run dev` — run server + client
- `npm run dev:server` — run server only
- `npm run dev:client` — run client only
- `npm run build` — build client
- `npm run start` — start server (production)

## Portal upload (static)

Upload **`apps/client/dist/`** contents as your static web build.
Assets are relative (`./assets/...`), so hosting under a sub-path is ok.

For WSS reverse proxy and WS URL overrides, see `DEPLOY.md`.

## Protocol (minimal, outdated)

Client → Server
- `join`: `{t:'join', name?, color?}`
- `input`: `{t:'in', seq, mv:[x,y], aim:[x,y], fire:boolean}`

Server → Client
- `welcome`: `{t:'welcome', id, serverTime, config}`
- `snapshot`: `{t:'ss', serverTime, match, circle, players, bullets, orbs, events}`

This is an MVP scaffold; expect to iterate.
