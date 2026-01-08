# GitHub Pages + Pixel PVP (WS override)

When hosting the client on GitHub Pages (or any static host), you can point it at a WebSocket server without rebuilding.

## One-time setup via URL

Open your hosted game URL with `?ws=`:

- `https://<user>.github.io/<repo>/?ws=wss%3A%2F%2FYOUR_SERVER_DOMAIN%2Fws`

The value is stored in `localStorage` under `pixel_pvp_ws_url`.

## Clear the stored URL

- `https://<user>.github.io/<repo>/?ws=clear`

## Priority order (highest → lowest)

1. `?ws=...` (and stored override)
2. `window.__BE_TRY_WS_URL__`
3. `import.meta.env.VITE_WS_URL`
4. Smart default (`ws://<host>:8080` in dev, `wss://<host>/ws` in prod)
