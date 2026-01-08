import { defineConfig } from 'vite';

export default defineConfig({
  // Portal-friendly builds: make asset URLs relative.
  base: './',

  server: {
    port: 5173,

    // Allow Cloudflare Quick Tunnels like https://xxxx.trycloudflare.com
    // (fixes "Blocked request. This host ... is not allowed")
    allowedHosts: ['.trycloudflare.com'],

    // Helpful for LAN / tunnels (bind 0.0.0.0)
    host: true,
  },
});
