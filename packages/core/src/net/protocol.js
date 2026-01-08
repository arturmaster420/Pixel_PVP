// Shared protocol constants between client and server.
//
// Why:
// - When the client is cached (old JS) but the server has been updated,
//   subtle breakages happen. A small protocol gate lets the server
//   tell the client to refresh instead of behaving randomly.

// Increment this when you deploy a server that may be incompatible with older clients.
// NOTE: keep it an integer.
export const PROTOCOL_VERSION = 2;

// Human-readable build tag shown in UI/logs.
// This is not used for compatibility checks (use PROTOCOL_VERSION for that).
// v0.2.15: Fix client interpolation so discrete world items (buff pickups, orbs) update correctly.
// v0.2.18: Bot anti-corner-stuck steering + final-minute shrink to 0.
// v0.2.19: Regen buff + 2x buff spawn rate + storm stage UI fix.
// v0.2.20: Achievements -> cosmetics (auras/trails) + aura/trail sync.
// v0.2.21: Include auraId/trailId in snapshots so cosmetics render correctly.
// v0.2.21: Include auraId/trailId in snapshots so cosmetics render correctly.
// v0.2.25: Achievements tab + ScoreWin vs LastWin split + per-match buff-collector tracking.
// v0.2.26: Achievements Claim UX + Pixel PVP rename.
// v0.2.27: Achievements list: show only current level + move completed to bottom.
// v0.2.31: Mobile smoothness (less GC + softer interpolation fallback) + Achievements UI polish.
// v0.2.32: Perf/Net overlay toggle + interpDelay auto-tune from snapshot buffer headroom.
// v0.2.33: Default snapshot rate lowered to 15Hz (override via SNAP_HZ env var).
// v0.2.34: Server backpressure protection (drop snapshots for slow clients instead of queueing).
// v0.2.36: WAN smoothing: higher interp headroom + clamp render time behind newest snapshot.
export const BUILD_TAG = '0.2.37';
