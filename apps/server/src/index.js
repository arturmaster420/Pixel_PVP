import { WebSocketServer } from 'ws';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  CONFIG,
  PROTOCOL_VERSION,
  BUILD_TAG,
  createSim,
  addPlayer,
  removePlayer,
  applyInput,
  step,
  makeSnapshot,
  computeStorm,
  resetMatch,
  enterLobby
} from 'be-try-core';
import { safeJsonParse, send } from './protocol.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

const wss = new WebSocketServer({ port: PORT });
console.log(`[server] ws://localhost:${PORT}`);

// ---------------------------------------------------------------------
// Metrics (P0)
// ---------------------------------------------------------------------
// Emits periodic JSON lines to stdout and writes a small metrics.json file.
// Disable with METRICS=0. Control interval via METRICS_LOG_EVERY_SEC (default 30).
const METRICS_ENABLED = process.env.METRICS !== '0';
const METRICS_LOG_EVERY_SEC = process.env.METRICS_LOG_EVERY_SEC ? Number(process.env.METRICS_LOG_EVERY_SEC) : 30;
// Optional admin key (enables a tiny WS-only ops surface).
// If ADMIN_KEY is unset/empty, admin commands are disabled.
const ADMIN_KEY = (process.env.ADMIN_KEY || '').trim();

const metrics = {
  startedAtMs: Date.now(),
  connectionsTotal: 0,
  disconnectsTotal: 0,
  disconnectsInMatch: 0,
  joinsTotal: 0,
  joinsPublic: 0,
  joinsCode: 0,
  rejoinsTotal: 0,
  joinFails: Object.create(null),
  authFails: Object.create(null),
  matchesStarted: 0,
  matchesEnded: 0,
  lobbyTimeToStartSum: 0,
  lobbyTimeToStartCount: 0,
  matchDurationSum: 0,
  matchDurationCount: 0,

  // Optional client crash reports (ops/debug)
  clientErrorsTotal: 0,
  clientErrorsByKind: Object.create(null),
  wsCloseCodes: Object.create(null),

  // Rolling loop stats (reset on each metrics snapshot).
  _loopTickCount: 0,
  _loopDtSum: 0,
  _loopDtMax: 0,
  _loopWorkMsSum: 0,
  _loopWorkMsMax: 0
};

function incCounter(obj, key, by = 1) {
  obj[key] = (obj[key] || 0) + by;
}

function countConnectedPeers() {
  let c = 0;
  for (const p of peers.values()) {
    if (p && p.ws && p.ws.readyState === 1) c += 1;
  }
  return c;
}

function countJoinedConnectedPeers() {
  let c = 0;
  for (const p of peers.values()) {
    if (p && p.joined && p.ws && p.ws.readyState === 1) c += 1;
  }
  return c;
}

function snapshotMetrics(reason = 'interval') {
  let roomsTotal = 0, roomsLobby = 0, roomsMatch = 0, roomsResults = 0;
  for (const r of rooms.values()) {
    roomsTotal += 1;
    const st = r.sim.matchState;
    if (st === 'lobby') roomsLobby += 1;
    else if (st === 'match') roomsMatch += 1;
    else if (st === 'results') roomsResults += 1;
  }

  const nowMs = Date.now();
  const uptimeSec = Math.max(0, (nowMs - metrics.startedAtMs) / 1000);

  const avgLobbyTimeToStart = metrics.lobbyTimeToStartCount > 0
    ? metrics.lobbyTimeToStartSum / metrics.lobbyTimeToStartCount
    : null;

  const avgMatchDuration = metrics.matchDurationCount > 0
    ? metrics.matchDurationSum / metrics.matchDurationCount
    : null;

  // Per-room snapshot/loop metrics (top rooms by population).
  const roomDetails = [];
  for (const r of rooms.values()) {
    const sim = r.sim;
    let connected = 0;
    let joinedConnected = 0;
    for (const cid of r.peers) {
      const p = peers.get(cid);
      if (!p || !p.ws || p.ws.readyState !== 1) continue;
      connected += 1;
      if (p.joined) joinedConnected += 1;
    }

    const nowS = nowMs / 1000;
    const dtS = Math.max(0.001, nowS - (r._mLastMetricsAtSec || nowS));
    const dSnapCount = (r._mSnapCount - (r._mLastSnapCount || 0));
    const dSnapBytes = (r._mSnapBytes - (r._mLastSnapBytes || 0));
    r._mLastMetricsAtSec = nowS;
    r._mLastSnapCount = r._mSnapCount;
    r._mLastSnapBytes = r._mSnapBytes;

    const elapsed = sim.matchState === 'lobby' ? 0 : Math.max(0, (sim.time - sim.matchStart));

    roomDetails.push({
      id: r.id,
      public: !r.code,
      code: r.code || null,
      state: sim.matchState,
      peers: r.peers.size,
      connected,
      joinedConnected,
      botsEnabled: !!r.botsEnabled,
      countdownSec: r.countdownEndAt ? Math.max(0, r.countdownEndAt - sim.time) : null,
      elapsedSec: Number(elapsed.toFixed(2)),
      mapVariant: sim.matchMapVariant || null,

      snapHz: Number((dSnapCount / dtS).toFixed(1)),
      snapBytesPerSec: Math.round(dSnapBytes / dtS),
      snapBytesTotal: r._mSnapBytes,
      simStepsTotal: r._mSimSteps,
      simCapDropsTotal: r._mSimCapDrops
    });
  }

  roomDetails.sort((a, b) => (b.peers - a.peers) || (b.connected - a.connected));
  const roomsTop = roomDetails.slice(0, 12);

  const loopAvgDtMs = metrics._loopTickCount > 0 ? (metrics._loopDtSum / metrics._loopTickCount) * 1000 : null;
  const loopAvgWorkMs = metrics._loopTickCount > 0 ? (metrics._loopWorkMsSum / metrics._loopTickCount) : null;

  return {
    t: 'metrics',
    reason,
    time: new Date(nowMs).toISOString(),
    uptimeSec: Math.round(uptimeSec),
    proto: PROTOCOL_VERSION,
    build: BUILD_TAG,

    ccu: countJoinedConnectedPeers(),
    connected: countConnectedPeers(),
    peerSessions: peers.size,

    roomsTotal,
    roomsLobby,
    roomsMatch,
    roomsResults,

    connectionsTotal: metrics.connectionsTotal,
    disconnectsTotal: metrics.disconnectsTotal,
    disconnectsInMatch: metrics.disconnectsInMatch,

    joinsTotal: metrics.joinsTotal,
    joinsPublic: metrics.joinsPublic,
    joinsCode: metrics.joinsCode,
    rejoinsTotal: metrics.rejoinsTotal,

    joinFails: metrics.joinFails,
    authFails: metrics.authFails,

    clientErrorsTotal: metrics.clientErrorsTotal,
    clientErrorsByKind: metrics.clientErrorsByKind,
    wsCloseCodes: metrics.wsCloseCodes,

    matchesStarted: metrics.matchesStarted,
    matchesEnded: metrics.matchesEnded,
    avgLobbyTimeToStartSec: avgLobbyTimeToStart != null ? Number(avgLobbyTimeToStart.toFixed(2)) : null,
    avgMatchDurationSec: avgMatchDuration != null ? Number(avgMatchDuration.toFixed(2)) : null,

    loopAvgDtMs: loopAvgDtMs != null ? Number(loopAvgDtMs.toFixed(2)) : null,
    loopMaxDtMs: Number((metrics._loopDtMax * 1000).toFixed(2)),
    loopAvgWorkMs: loopAvgWorkMs != null ? Number(loopAvgWorkMs.toFixed(2)) : null,
    loopMaxWorkMs: Number(metrics._loopWorkMsMax.toFixed(2)),

    roomsTop
  };
}

let _lastMetricsLogAt = 0;

function logMetrics(reason = 'interval') {
  if (!METRICS_ENABLED) return;
  const now = nowSec();
  if (reason === 'interval' && METRICS_LOG_EVERY_SEC > 0) {
    if (_lastMetricsLogAt && now - _lastMetricsLogAt < METRICS_LOG_EVERY_SEC - 0.001) return;
  }
  _lastMetricsLogAt = now;
  const snap = snapshotMetrics(reason);
  try { console.log(`[metrics] ${JSON.stringify(snap)}`); } catch {}
  try { fs.writeFileSync('metrics.json', JSON.stringify(snap)); } catch {}

  // Reset rolling loop counters after emit.
  metrics._loopTickCount = 0;
  metrics._loopDtSum = 0;
  metrics._loopDtMax = 0;
  metrics._loopWorkMsSum = 0;
  metrics._loopWorkMsMax = 0;
}

function sendWithMetrics(ws, obj) {
  // Record a few high-value failure reasons without changing packet semantics.
  try {
    if (obj && obj.t === 'joinFail') incCounter(metrics.joinFails, obj.reason || 'unknown');
    if (obj && obj.t === 'authFail') incCounter(metrics.authFails, obj.reason || 'unknown');
  } catch {}
  send(ws, obj);
}

// ---------------------------------------------------------------------
// Multi-room server
// - Each room has its own authoritative sim, lobby/match/results.
// - New joins are routed ONLY into an OPEN LOBBY room.
// - Once a room starts a match, that room is CLOSED for new joins.
// - Reconnect/rejoin (same cid/tok) can reattach to their previous room.
// ---------------------------------------------------------------------

// Prevent mapId collisions across rooms (client caches obstacles by mapId)
const ROOM_MAPID_OFFSET = 1_000_000;
const ROOM_MAX_PLAYERS = 8;

// Lobby / ready-up rules (per room)
const MIN_READY_TO_START = 2;
const START_COUNTDOWN_SEC = 10;
const RESULTS_HOLD_SEC = 10;

// Bots (per room)
// Bots: allow 2/4/6 (client can choose in lobby)
const DEFAULT_BOT_COUNT = 2;
function sanitizeBotsCount(v) {
  const n = (typeof v === 'number') ? (v | 0) : ((String(v ?? '').trim() | 0) || 0);
  if (n === 4) return 4;
  if (n === 6) return 6;
  return 2;
}
const BOT_COLORS = ['#ff6a00', '#7b61ff'];

// Player colors are now server-assigned (no client color picker).
const AUTO_PLAYER_COLORS = ['#55aaff','#ff5a7a','#7dff9b','#ffe15a','#c87cff','#ff9f4a','#66ffd6','#ffffff'];
function autoColorFromAvatar(avatarId, pid) {
  const n = AUTO_PLAYER_COLORS.length;
  let h = 0;
  if (typeof pid === 'string') {
    const m = pid.match(/[0-9a-fA-F]{2}$/);
    if (m) h = parseInt(m[0], 16) | 0;
    else {
      for (let i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) | 0;
      h = Math.abs(h);
    }
  }
  const a = (avatarId | 0);
  const idx = (h + a * 7) % n;
  return AUTO_PLAYER_COLORS[(idx + n) % n];
}

// Reconnect / Rejoin token
const REJOIN_GRACE_SEC = 25;

// Basic hardening (v0.1.9.45)
// - Drop overly large messages
// - Per-peer rate limiting (prevents spam / runaway clients)
// - Gentle GC for empty rooms and inactive peer sessions
const MAX_MSG_BYTES = 8 * 1024;
// Per-connection byte budgets (keeps JSON.parse + handler work bounded).
// This is separate from MAX_MSG_BYTES (single frame cap).
const RL_MAX_BYTES_PER_SEC_AUTH = 48 * 1024;
const RL_MAX_BYTES_PER_SEC_PREAUTH = 24 * 1024;

// Hard caps for malformed / abusive traffic.
const BAD_MSG_MAX_PER_SEC_AUTH = 25;
const BAD_MSG_MAX_PER_SEC_PREAUTH = 20;
// Keep empty rooms around briefly (allows quick reconnects / code re-join)
const ROOM_EMPTY_TTL_SEC = 45;
// Remove inactive peer sessions to avoid unbounded memory growth
const PEER_INACTIVE_TTL_SEC = 60 * 60; // 1 hour

// AFK / Idle handling (release hardening)
// - prevents "ghost ready" in lobby
// - frees room slots when someone stays connected but idle
// - keeps sim rates/architecture unchanged
const LOBBY_AFK_UNREADY_SEC = 90;  // if ready but idle -> auto-unready
const LOBBY_AFK_KICK_SEC = 180;    // idle in lobby -> kick
const MATCH_AFK_WARN_SEC = 120;    // in match/results -> warn
const MATCH_AFK_KICK_SEC = 150;    // in match/results -> kick

// Rate limits (per peer, per 1-second window)
const RL_MAX_TOTAL_PER_SEC = 80;
const RL_MAX_INPUT_PER_SEC = 140; // client can send ~60Hz inputs; keep headroom
const RL_MAX_JOIN_PER_SEC = 4;
const RL_MAX_VOTE_PER_SEC = 12;
const RL_MAX_MISC_PER_SEC = 30;

// Pre-auth rate limits (per websocket, per 1-second window)
// Prevents unauthenticated clients from spamming hello/ping and consuming CPU.
const PREAUTH_RL_MAX_TOTAL_PER_SEC = 40;
const PREAUTH_RL_MAX_HELLO_PER_SEC = 10;
const PREAUTH_RL_MAX_PING_PER_SEC = 20;

// Additional join/apply hardening (prevents room/code spam)
const JOIN_MIN_INTERVAL_SEC = 0.25;
const CODE_ROOM_CREATE_MAX_PER_MIN = 3;

const ALLOWED_MSG_TYPES = new Set([
  'ping',
  'hello',
  'join',
  'mapReq',
  'ready',
  'bots',
  'voteWeapon',
  'voteMap',
  'in',
  'again',
  'nextMatch',
  'clientErr',
  'admin'
]);

// cid -> peer
const peers = new Map();
// ws -> cid
const cidByWs = new Map();

// roomId -> room
const rooms = new Map();
let nextRoomSeq = 1;

function minReadyForRoom(room) {
  // Bots fallback: allow solo start ONLY when bots are enabled AND there is only one human.
  // Otherwise keep the normal ready-up rule so one player can't force-start a match for others.
  if (!room || !room.botsEnabled) return MIN_READY_TO_START;
  let humans = 0;
  for (const cid of room.peers) {
    const p = peers.get(cid);
    if (!p || !p.joined) continue;
    if (!p.ws || p.ws.readyState !== 1) continue;
    humans += 1;
  }
  return humans <= 1 ? 1 : MIN_READY_TO_START;
}

function clampStr(s, n) {
  return String(s ?? '').trim().slice(0, n);
}

function safeCid(s) {
  const t = clampStr(s, 64);
  if (!t) return null;
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(t)) return null;
  return t;
}

function safeTok(s) {
  const t = clampStr(s, 96);
  if (!t) return null;
  if (!/^[a-zA-Z0-9_-]{8,96}$/.test(t)) return null;
  return t;
}

function safeName(s, fallback) {
  const t = clampStr(s, 16);
  return t || fallback;
}

function safeColor(s) {
  const t = clampStr(s, 16);
  if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return t;
  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(t)) return t;
  if (/^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|0?\.\d+|1(\.0+)?)\s*\)$/.test(t)) return t;
  return '#55aaff';
}

function safeAvatarId(v) {
  const n = Array.isArray(CONFIG.AVATARS) ? CONFIG.AVATARS.length : 0;
  if (!n) return 0;
  const id = (typeof v === 'number') ? (v | 0) : ((String(v ?? '').trim() | 0) || 0);
  if (id < 0) return 0;
  if (id >= n) return n - 1;
  return id;
}

function safeAuraId(v) {
  const n = Array.isArray(CONFIG.AURAS) ? CONFIG.AURAS.length : 0;
  if (!n) return 0;
  const id = (typeof v === 'number') ? (v | 0) : ((String(v ?? '').trim() | 0) || 0);
  if (id < 0) return 0;
  if (id >= n) return n - 1;
  return id;
}

function safeTrailId(v) {
  const n = Array.isArray(CONFIG.TRAILS) ? CONFIG.TRAILS.length : 0;
  if (!n) return 0;
  const id = (typeof v === 'number') ? (v | 0) : ((String(v ?? '').trim() | 0) || 0);
  if (id < 0) return 0;
  if (id >= n) return n - 1;
  return id;
}


function parseRoomCode(input) {
  const raw = clampStr(input, 32);
  if (!raw) return { code: null, err: null };
  // Uppercase + strip spaces (server-side sanitization)
  const t = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!t) return { code: null, err: null };
  if (t.length < 3 || t.length > 8) return { code: null, err: 'bad_code' };
  if (!/^[A-Z0-9]+$/.test(t)) return { code: null, err: 'bad_code' };
  return { code: t, err: null };
}


function hashTok(tok) {
  return createHash('sha256').update(String(tok || '')).digest('hex');
}

function nowSec() {
  return Date.now() / 1000;
}

function pidFromCid(cid) {
  const h = createHash('sha1').update(String(cid)).digest('hex').slice(0, 8);
  return `p_${h}`;
}

function getPeer(ws) {
  const cid = cidByWs.get(ws);
  if (!cid) return null;
  return peers.get(cid) || null;
}

function getRoom(roomId) {
  if (!roomId) return null;
  return rooms.get(roomId) || null;
}

function createRoom(opts = {}) {
  const seq = nextRoomSeq++;
  const id = `r${seq}`;
  const sim = createSim({ seed: seq });
  const room = {
    id,
    seq,
    code: opts?.code || null,
    mapOffset: seq * ROOM_MAPID_OFFSET,
    sim,
    peers: new Set(),
    emptyAtSec: nowSec(),
    botsEnabled: true,
    botsCount: DEFAULT_BOT_COUNT,
    // Small per-bot memory (AI state, targets, navigation).
    botMem: new Map(),
    // Coarse nav grid built once per match (used by bot AI).
    botNav: null,
    countdownEndAt: null,
    lastSnap: 0,
    acc: 0,

    // Metrics (room-local counters)
    _mSnapCount: 0,
    _mSnapBytes: 0,
    _mSimSteps: 0,
    _mSimCapDrops: 0,
    _mLastMetricsAtSec: nowSec(),
    _mLastSnapCount: 0,
    _mLastSnapBytes: 0
  };
  rooms.set(id, room);
  return room;
}

function markRoomEmptyIfNeeded(room) {
  if (!room) return;
  if (room.peers.size > 0) {
    room.emptyAtSec = null;
    return;
  }
  if (room.emptyAtSec == null) room.emptyAtSec = nowSec();
}

function rateLimitAllow(peer, type) {
  // For unauthenticated connections peer is null; caller should decide.
  const s = Math.floor(nowSec());
  if (!peer._rl || peer._rl.sec !== s) {
    peer._rl = { sec: s, total: 0, input: 0, join: 0, vote: 0, misc: 0 };
  }
  const rl = peer._rl;
  rl.total += 1;
  if (rl.total > RL_MAX_TOTAL_PER_SEC) return false;

  if (type === 'in') {
    rl.input += 1;
    return rl.input <= RL_MAX_INPUT_PER_SEC;
  }
  if (type === 'join') {
    rl.join += 1;
    return rl.join <= RL_MAX_JOIN_PER_SEC;
  }
  if (type === 'voteWeapon' || type === 'voteMap') {
    rl.vote += 1;
    return rl.vote <= RL_MAX_VOTE_PER_SEC;
  }
  // ping/mapReq/ready/bots/again/hello etc.
  rl.misc += 1;
  return rl.misc <= RL_MAX_MISC_PER_SEC;
}

function preAuthAllow(ws, type) {
  const s = Math.floor(nowSec());
  const prev = ws._preRl;
  const rl = (!prev || prev.sec !== s)
    ? (ws._preRl = { sec: s, total: 0, hello: 0, ping: 0 })
    : prev;

  rl.total += 1;
  if (rl.total > PREAUTH_RL_MAX_TOTAL_PER_SEC) return false;

  if (type === 'hello') {
    rl.hello += 1;
    return rl.hello <= PREAUTH_RL_MAX_HELLO_PER_SEC;
  }
  if (type === 'ping') {
    rl.ping += 1;
    return rl.ping <= PREAUTH_RL_MAX_PING_PER_SEC;
  }
  return true;
}

function bytesAllow(peer, bytes) {
  const s = Math.floor(nowSec());
  const prev = peer._rlBytes;
  const rl = (!prev || prev.sec !== s)
    ? (peer._rlBytes = { sec: s, bytes: 0 })
    : prev;
  rl.bytes += (bytes | 0);
  return rl.bytes <= RL_MAX_BYTES_PER_SEC_AUTH;
}

function preAuthBytesAllow(ws, bytes) {
  const s = Math.floor(nowSec());
  const prev = ws._preBytes;
  const rl = (!prev || prev.sec !== s)
    ? (ws._preBytes = { sec: s, bytes: 0 })
    : prev;
  rl.bytes += (bytes | 0);
  return rl.bytes <= RL_MAX_BYTES_PER_SEC_PREAUTH;
}

function markBadMsg(target, kind = 'bad') {
  const s = Math.floor(nowSec());
  const prev = target._badMsg;
  const st = (!prev || prev.sec !== s)
    ? (target._badMsg = { sec: s, count: 0, kind })
    : prev;
  st.count += 1;
  st.kind = kind;
  return st.count;
}

function sanitizeInputMsg(msg) {
  const finite = (v) => (Number.isFinite(v) ? v : 0);
  const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

  let mvx = 0, mvy = 0;
  if (Array.isArray(msg.mv) && msg.mv.length >= 2) {
    mvx = clamp(finite(+msg.mv[0]), -1, 1);
    mvy = clamp(finite(+msg.mv[1]), -1, 1);
  }

  let aimx = 0, aimy = 0;
  if (Array.isArray(msg.aim) && msg.aim.length >= 2) {
    aimx = clamp(finite(+msg.aim[0]), -1_000_000, 1_000_000);
    aimy = clamp(finite(+msg.aim[1]), -1_000_000, 1_000_000);
  }

  return {
    mv: [mvx, mvy],
    aim: [aimx, aimy],
    fire: !!msg.fire
  };
}

function getOrCreateOpenLobbyRoom() {
  // Pick a lobby room that has capacity. Prefer the most-filled lobby to reduce fragmentation.
  let best = null;
  for (const r of rooms.values()) {
    if (r.sim.matchState !== 'lobby') continue;
    if (r.code) continue;
    const n = r.peers.size;
    if (n >= ROOM_MAX_PLAYERS) continue;
    if (!best || n > best.peers.size) best = r;
  }
  return best || createRoom();
}

function findRoomByCode(code) {
  if (!code) return null;
  for (const r of rooms.values()) {
    if (r.code === code) return r;
  }
  return null;
}


function isBotId(id) {
  return typeof id === 'string' && id.startsWith('b_');
}

function isRoomBotId(room, id) {
  return !!room && typeof id === 'string' && id.startsWith(`b_${room.id}_`);
}

function botIdsForRoom(room) {
  const count = sanitizeBotsCount(room?.botsCount ?? DEFAULT_BOT_COUNT);
  return Array.from({ length: count }, (_, i) => `b_${room.id}_${i + 1}`);
}

function norm2(x, y) {
  const d = Math.hypot(x, y) || 1;
  return [x / d, y / d];
}

function eachConnectedPeerInRoom(room, fn) {
  for (const cid of room.peers) {
    const peer = peers.get(cid);
    if (!peer || !peer.ws || peer.ws.readyState !== 1) continue;
    fn(peer);
  }
}

function markActive(peer) {
  if (!peer) return;
  peer.lastActiveAtSec = nowSec();
  // Reset AFK warn throttle when the user becomes active again.
  peer._afkWarnedAtSec = 0;
}

function kickPeerFromRoom(peer, room, reason) {
  if (!peer) return;
  const ws = peer.ws;
  try {
    if (ws && ws.readyState === 1) {
      send(ws, { t: 'kicked', reason: String(reason || 'kick') });
    }
  } catch {}

  // Remove membership immediately (even in match) to free room slots.
  try {
    if (room) {
      room.peers.delete(peer.cid);
      markRoomEmptyIfNeeded(room);
      if (peer.inSim && room.sim && room.sim.players && room.sim.players.has(peer.pid)) {
        removePlayer(room.sim, peer.pid);
      }
    }
  } catch {}

  peer.inSim = false;
  peer.joined = false;
  peer.ready = false;
  peer.weaponVote = null;
  peer.mapVote = null;
  peer.roomId = null;
  peer.disconnectedAt = (room && room.sim) ? room.sim.time : 0;

  try { if (ws) ws.close(4001, String(reason || 'kick')); } catch {}
}

function afkTickRoom(room) {
  if (!room) return;
  const sim = room.sim;
  if (!sim) return;

  const wall = nowSec();
  const state = sim.matchState;

  eachConnectedPeerInRoom(room, (peer) => {
    if (!peer.joined) return;
    // Treat only meaningful interaction as activity (not ping).
    const last = (typeof peer.lastActiveAtSec === 'number' && peer.lastActiveAtSec > 0)
      ? peer.lastActiveAtSec
      : (peer.lastSeenAtSec || wall);

    const idleSec = Math.max(0, wall - last);

    if (state === 'lobby') {
      if (peer.ready && idleSec >= LOBBY_AFK_UNREADY_SEC) {
        peer.ready = false;
      }
      if (idleSec >= LOBBY_AFK_KICK_SEC) {
        kickPeerFromRoom(peer, room, 'afk');
      }
      return;
    }

    // match/results
    if (idleSec >= MATCH_AFK_WARN_SEC && idleSec < MATCH_AFK_KICK_SEC) {
      const left = Math.max(0, Math.ceil(MATCH_AFK_KICK_SEC - idleSec));
      const lastWarn = peer._afkWarnedAtSec || 0;
      // Throttle warnings (max ~1 per 5 seconds)
      if (!lastWarn || (wall - lastWarn) >= 5) {
        peer._afkWarnedAtSec = wall;
        try {
          if (peer.ws && peer.ws.readyState === 1) {
            send(peer.ws, { t: 'afkWarn', left });
          }
        } catch {}
      }
    }

    if (idleSec >= MATCH_AFK_KICK_SEC) {
      kickPeerFromRoom(peer, room, 'afk');
    }
  });
}

function mapIdOut(room, mapIdIn) {
  const m = (mapIdIn | 0) || 0;
  if (m <= 0) return 0;
  // Ensure unique across rooms.
  return (room.mapOffset + m) | 0;
}

function sendMap(room, ws, peer) {
  if (!ws || ws.readyState !== 1) return;
  const sim = room.sim;
  if (sim.matchState !== 'match' && sim.matchState !== 'results') return;

  const outId = mapIdOut(room, sim.mapId);
  if (outId <= 0) return;

  send(ws, {
    t: 'map',
    mapId: outId,
    obstacles: sim.obstacles
  });

  if (peer) peer.lastMapIdSent = outId;
}

function ensureJoinedPlayersInSim(room) {
  const sim = room.sim;
  if (sim.matchState !== 'lobby') return;

  for (const cid of room.peers) {
    const peer = peers.get(cid);
    if (!peer || !peer.joined) continue;
    if (!peer.ws || peer.ws.readyState !== 1) continue;

    if (sim.players.has(peer.pid)) {
      peer.inSim = true;
      continue;
    }

    const p = addPlayer(sim, { id: peer.pid, name: peer.name, color: peer.color, avatarId: peer.avatarId });
    peer.inSim = true;
    peer.name = p.name;
    peer.color = p.color;
  }
}

function removeBots(room) {
  const sim = room.sim;
  if (!sim || !sim.players) return;
  for (const id of Array.from(sim.players.keys())) {
    if (!isRoomBotId(room, id)) continue;
    if (sim.players.has(id)) removePlayer(sim, id);
    room.botMem?.delete(id);
  }
}

function ensureBotsInMatch(room) {
  const sim = room.sim;
  if (sim.matchState !== 'match') return;

  if (!room.botsEnabled) {
    removeBots(room);
    return;
  }

  const ids = botIdsForRoom(room);
  const want = new Set(ids);

  // Remove extra bots if the configured count decreased.
  for (const id of Array.from(sim.players.keys())) {
    if (!isRoomBotId(room, id)) continue;
    if (want.has(id)) continue;
    removePlayer(sim, id);
    room.botMem?.delete(id);
  }

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (sim.players.has(id)) continue;
    const nAv = Array.isArray(CONFIG.AVATARS) ? CONFIG.AVATARS.length : 0;
    // Deterministic variety so bots don't all look identical.
    const av = nAv > 0 ? (((i + 1) * 97) % nAv) : 0;
    addPlayer(sim, {
      id,
      name: `BOT ${i + 1}`,
      color: autoColorFromAvatar(av, id),
      avatarId: av
    });
  }
}

// ---------------------------------------------------------------------
// Bot AI (server-authoritative)
// Goals (per latest request):
// - Farm orbs when idle.
// - Stay inside the safe zone (storm circle).
// - If an enemy appears on "radar" (distance-based), engage and shoot when LOS exists.
// - Bots can fight both humans and other bots.
// Implementation:
// - Simple FSM + coarse A* nav grid built once per match.
// - Replaces the previous steering/unstuck-heavy logic (cleaner + more predictable).
// ---------------------------------------------------------------------

const BOT_RADAR_DIST = 2600;          // engage enemies within this distance (radar-style)
const BOT_ORB_SEEK_DIST = 5200;       // farm orbs within this distance
const BOT_ZONE_FRAC_SOFT = 0.92;      // clamp goals inside circle * frac
const BOT_ZONE_FRAC_HARD = 0.97;      // force "return to zone" if outside circle * frac
const BOT_REPATH_SEC = 0.55;          // how often a bot can recompute A* (per bot)
const BOT_WP_REACH = 95;              // waypoint reached distance
const BOT_WANDER_HOLD_SEC = 3.2;      // keep wander target for a bit
const BOT_STUCK_SEC = 0.65;           // if not moving for this long, force repath
const BOT_NAV_CELL = 200;             // nav grid cell size (world units)
const BOT_OBS_PAD = 22;               // obstacle padding for nav (player radius + comfort)

function segmentAabbTOI(x0, y0, x1, y1, rx, ry, rw, rh, pad = 0) {
  const minX = rx - rw * 0.5 - pad;
  const maxX = rx + rw * 0.5 + pad;
  const minY = ry - rh * 0.5 - pad;
  const maxY = ry + rh * 0.5 + pad;

  const dx = x1 - x0;
  const dy = y1 - y0;

  let tmin = 0;
  let tmax = 1;

  if (Math.abs(dx) < 1e-12) {
    if (x0 < minX || x0 > maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - x0) * inv;
    let t2 = (maxX - x0) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return null;
  }

  if (Math.abs(dy) < 1e-12) {
    if (y0 < minY || y0 > maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - y0) * inv;
    let t2 = (maxY - y0) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return null;
  }

  if (tmin < 0) tmin = 0;
  if (tmin > 1) return null;
  return tmin;
}

function hasLineOfSight(sim, x0, y0, x1, y1) {
  const obs = sim.obstacles || [];
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    const t = segmentAabbTOI(x0, y0, x1, y1, o.x, o.y, o.w || 0, o.h || 0, 8);
    if (t != null) return false;
  }
  return true;
}

// ---------------------------------------------------------------------
// Bot local wall-avoidance (anti-corner-stuck)
// ---------------------------------------------------------------------

function circleAabbOverlap(cx, cy, cr, rx, ry, rw, rh) {
  const hw = rw * 0.5;
  const hh = rh * 0.5;
  const px = Math.max(rx - hw, Math.min(cx, rx + hw));
  const py = Math.max(ry - hh, Math.min(cy, ry + hh));
  const dx = cx - px;
  const dy = cy - py;
  return (dx * dx + dy * dy) <= cr * cr;
}

function queryObstacleGridLocal(grid, minX, minY, maxX, maxY) {
  if (!grid || !grid.map) return [];
  const cs = grid.cellSize || 1;
  const cx0 = Math.floor(minX / cs);
  const cx1 = Math.floor(maxX / cs);
  const cy0 = Math.floor(minY / cs);
  const cy1 = Math.floor(maxY / cs);
  const out = [];
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const arr = grid.map.get(`${cx},${cy}`);
      if (arr) out.push(...arr);
    }
  }
  return out;
}

function probeBlocked(sim, x, y, r) {
  const obs = sim.obstacleGrid
    ? queryObstacleGridLocal(sim.obstacleGrid, x - r, y - r, x + r, y + r)
    : (sim.obstacles || []);
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    if (circleAabbOverlap(x, y, r, o.x, o.y, o.w || 0, o.h || 0)) return true;
  }
  return false;
}

function botAvoidWalls(sim, b, mvx, mvy, wpX, wpY) {
  const len = Math.hypot(mvx, mvy);
  if (len < 1e-4) return [mvx, mvy];

  // Probe slightly ahead of the bot. If the probe would overlap a wall,
  // steer tangentially (slide) instead of ramming the corner.
  const probeDist = (CONFIG.PLAYER_RADIUS || 14) + 22;
  const probeR = (CONFIG.PLAYER_RADIUS || 14) + 8;

  const fx = b.x + mvx * probeDist;
  const fy = b.y + mvy * probeDist;
  if (!probeBlocked(sim, fx, fy, probeR)) return [mvx, mvy];

  // Candidate directions: left/right tangents + reverse as last resort.
  const tx = wpX - b.x;
  const ty = wpY - b.y;
  const tlen = Math.hypot(tx, ty) || 1;
  const ntx = tx / tlen;
  const nty = ty / tlen;

  const cands = [
    [-mvy, mvx],
    [mvy, -mvx],
    [-mvx, -mvy]
  ];

  let best = [mvx, mvy];
  let bestScore = Infinity;

  for (const c of cands) {
    const cx = c[0];
    const cy = c[1];
    const px = b.x + cx * probeDist;
    const py = b.y + cy * probeDist;
    const blocked = probeBlocked(sim, px, py, probeR);
    const dot = cx * ntx + cy * nty; // higher is better
    const score = (blocked ? 10 : 0) + (1 - dot);
    if (score < bestScore) {
      bestScore = score;
      best = [cx, cy];
    }
  }
  return best;
}

function clampGoalIntoCircle(circle, x, y, frac = BOT_ZONE_FRAC_SOFT) {
  const r = circle.r * frac;
  const dx = x - circle.cx;
  const dy = y - circle.cy;
  const d = Math.hypot(dx, dy);
  if (d <= r || d < 1e-6) return { x, y };
  const s = r / d;
  return { x: circle.cx + dx * s, y: circle.cy + dy * s };
}

function pickBotCoverGoal(sim, b, target, circle) {
  // Try to pick a point near an obstacle that blocks LOS from target->cover.
  // Fallback: move away from target.
  const obs = sim.obstacles || [];
  const pad = 26;
  const maxObsDist = 1400;

  let best = null;
  let bestScore = Infinity;

  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    const dxO = o.x - b.x;
    const dyO = o.y - b.y;
    const dO = Math.hypot(dxO, dyO);
    if (dO > maxObsDist) continue;

    const hw = (o.w || 0) * 0.5;
    const hh = (o.h || 0) * 0.5;

    // Choose side opposite of the enemy ("behind cover").
    const ex = target.x;
    const ey = target.y;
    const relx = o.x - ex;
    const rely = o.y - ey;

    let cx = o.x;
    let cy = o.y;

    // Pick dominant axis in obstacle local space.
    if (Math.abs(relx) * hh >= Math.abs(rely) * hw) {
      // left/right
      const s = (relx >= 0) ? 1 : -1; // obstacle is to right of enemy => cover point on right side
      cx = o.x + s * (hw + pad);
      cy = o.y;
    } else {
      // top/bottom
      const s = (rely >= 0) ? 1 : -1;
      cx = o.x;
      cy = o.y + s * (hh + pad);
    }

    // Clamp inside zone.
    const cc = clampGoalIntoCircle(circle, cx, cy, BOT_ZONE_FRAC_SOFT);
    cx = cc.x; cy = cc.y;

    // Must actually be blocked by this obstacle.
    const tHit = segmentAabbTOI(ex, ey, cx, cy, o.x, o.y, o.w || 0, o.h || 0, 10);
    if (tHit == null) continue;

    // Prefer closer cover, but don't go too far from goal direction.
    const score = Math.hypot(cx - b.x, cy - b.y) + 0.15 * dO;
    if (score < bestScore) {
      bestScore = score;
      best = { x: cx, y: cy };
    }
  }

  if (best) return best;

  // Fallback: retreat away from target.
  const dx = target.x - b.x;
  const dy = target.y - b.y;
  const dist = Math.max(1e-6, Math.hypot(dx, dy));
  const ax = dx / dist;
  const ay = dy / dist;
  const rx = b.x - ax * 760;
  const ry = b.y - ay * 760;
  return clampGoalIntoCircle(circle, rx, ry, BOT_ZONE_FRAC_SOFT);
}

function buildBotNavGrid(sim) {
  const worldHalf = CONFIG.WORLD_HALF_SIZE || 9000;
  const cell = BOT_NAV_CELL;
  const size = worldHalf * 2;
  const w = Math.ceil(size / cell);
  const h = Math.ceil(size / cell);
  const ox = -worldHalf;
  const oy = -worldHalf;

  const blocked = new Uint8Array(w * h);
  const obs = sim.obstacles || [];

  // Mark blocked cells if the cell AABB overlaps an obstacle (expanded).
  // Using overlap (not just center-point) prevents bots from trying to path through thin maze walls.
  const cellHalf = cell * 0.5;
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const x = ox + (cx + 0.5) * cell;
      const y = oy + (cy + 0.5) * cell;

      let hit = 0;
      // Fast AABB overlap test against each obstacle (expanded by BOT_OBS_PAD).
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        const hw = (o.w || 0) * 0.5 + BOT_OBS_PAD;
        const hh = (o.h || 0) * 0.5 + BOT_OBS_PAD;
        if (Math.abs(x - o.x) <= (hw + cellHalf) && Math.abs(y - o.y) <= (hh + cellHalf)) { hit = 1; break; }
      }
      blocked[cx + cy * w] = hit;
    }
  }

  return { cell, w, h, ox, oy, blocked };
}

function navCellOf(nav, x, y) {
  const cx = Math.max(0, Math.min(nav.w - 1, Math.floor((x - nav.ox) / nav.cell)));
  const cy = Math.max(0, Math.min(nav.h - 1, Math.floor((y - nav.oy) / nav.cell)));
  return { cx, cy, idx: cx + cy * nav.w };
}

function navCenterOf(nav, cx, cy) {
  return { x: nav.ox + (cx + 0.5) * nav.cell, y: nav.oy + (cy + 0.5) * nav.cell };
}

function navNearestFree(nav, cx, cy, maxR = 8) {
  const idx0 = cx + cy * nav.w;
  if (!nav.blocked[idx0]) return { cx, cy, idx: idx0 };

  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= nav.w || ny >= nav.h) continue;
        const ni = nx + ny * nav.w;
        if (!nav.blocked[ni]) return { cx: nx, cy: ny, idx: ni };
      }
    }
  }
  return { cx, cy, idx: idx0 };
}

function navDegree(nav, idx) {
  const x = idx % nav.w;
  const y = (idx / nav.w) | 0;
  let deg = 0;
  // 4-neighborhood
  if (x + 1 < nav.w && !nav.blocked[idx + 1]) deg++;
  if (x - 1 >= 0 && !nav.blocked[idx - 1]) deg++;
  if (y + 1 < nav.h && !nav.blocked[idx + nav.w]) deg++;
  if (y - 1 >= 0 && !nav.blocked[idx - nav.w]) deg++;
  return deg;
}

function navFindNearestPassage(nav, cx, cy, { maxR = 14, minDeg = 3 } = {}) {
  // A "passage" is a free cell that is not a dead-end: degree >= minDeg.
  // We use a simple expanding-square scan (cheap; nav is coarse).
  let best = null;
  let bestD2 = Infinity;
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= nav.w || ny >= nav.h) continue;
        const ni = nx + ny * nav.w;
        if (nav.blocked[ni]) continue;
        const deg = navDegree(nav, ni);
        if (deg < minDeg) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = { cx: nx, cy: ny, idx: ni };
        }
      }
    }
    if (best) return best;
  }
  return navNearestFree(nav, cx, cy, maxR);
}

function heapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p][0] <= heap[i][0]) break;
    const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp;
    i = p;
  }
}

function heapPop(heap) {
  if (!heap.length) return null;
  const root = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let s = i;
      if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
      if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
      if (s === i) break;
      const tmp = heap[s]; heap[s] = heap[i]; heap[i] = tmp;
      i = s;
    }
  }
  return root;
}

function aStarCells(nav, startIdx, goalIdx) {
  if (startIdx === goalIdx) return [startIdx];
  const N = nav.w * nav.h;

  const g = new Float32Array(N);
  const came = new Int32Array(N);
  const closed = new Uint8Array(N);
  for (let i = 0; i < N; i++) { g[i] = Infinity; came[i] = -1; }

  const gx = goalIdx % nav.w;
  const gy = (goalIdx / nav.w) | 0;

  const heur = (idx) => {
    const x = idx % nav.w;
    const y = (idx / nav.w) | 0;
    return Math.abs(x - gx) + Math.abs(y - gy);
  };

  const open = [];
  g[startIdx] = 0;
  heapPush(open, [heur(startIdx), startIdx]);

  let iter = 0;
  const maxIter = 9000;

  while (open.length && iter++ < maxIter) {
    const popped = heapPop(open);
    if (!popped) break;
    const idx = popped[1];
    if (closed[idx]) continue;
    if (idx === goalIdx) {
      const out = [];
      let cur = idx;
      while (cur !== -1) { out.push(cur); cur = came[cur]; }
      out.reverse();
      return out;
    }
    closed[idx] = 1;

    const x = idx % nav.w;
    const y = (idx / nav.w) | 0;

    const nbs = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    ];

    for (let k = 0; k < 4; k++) {
      const nx = nbs[k][0];
      const ny = nbs[k][1];
      if (nx < 0 || ny < 0 || nx >= nav.w || ny >= nav.h) continue;
      const ni = nx + ny * nav.w;
      if (closed[ni]) continue;
      if (nav.blocked[ni]) continue;

      const ng = g[idx] + 1;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = idx;
        heapPush(open, [ng + heur(ni), ni]);
      }
    }
  }

  return null;
}

function buildPathWaypoints(nav, fromX, fromY, toX, toY) {
  const s0 = navCellOf(nav, fromX, fromY);
  const g0 = navCellOf(nav, toX, toY);
  const s = navNearestFree(nav, s0.cx, s0.cy);
  const g = navNearestFree(nav, g0.cx, g0.cy);

  if (nav.blocked[s.idx] || nav.blocked[g.idx]) return null;

  const cells = aStarCells(nav, s.idx, g.idx);
  if (!cells || cells.length < 2) return null;

  const pts = [];
  const step = 2;
  for (let i = 1; i < cells.length; i += step) {
    const idx = cells[i];
    const cx = idx % nav.w;
    const cy = (idx / nav.w) | 0;
    pts.push(navCenterOf(nav, cx, cy));
  }
  pts.push({ x: toX, y: toY });
  return pts;
}

function botInitMem(b, now) {
  return {
    mode: 'wander',
    ptrType: null,
    ptrId: null,
    ptrHoldUntil: 0,
    targetId: null,
    orbId: null,
    goalIdx: -1,
    path: [],
    repathAt: 0,
    wanderX: b.x,
    wanderY: b.y,
    wanderUntil: 0,
    lastX: b.x,
    lastY: b.y,
    lastT: now,
    stuckFor: 0,
    stuckHits: 0,
    stuckHitsUntil: 0,
    escapeUntil: 0,
    escapeX: b.x,
    escapeY: b.y,
    coverRecalcAt: 0,
    coverX: b.x,
    coverY: b.y,
    strafeSign: (Math.random() < 0.5 ? 1 : -1)
  };
}

function botPickWander(mem, circle, now) {
  const tries = 10;
  const rMax = circle.r * 0.78;
  for (let k = 0; k < tries; k++) {
    const a = Math.random() * Math.PI * 2;
    const u = Math.random();
    const rr = Math.sqrt(u) * rMax;
    const x = circle.cx + Math.cos(a) * rr;
    const y = circle.cy + Math.sin(a) * rr;
    const g = clampGoalIntoCircle(circle, x, y, BOT_ZONE_FRAC_SOFT);
    mem.wanderX = g.x;
    mem.wanderY = g.y;
    mem.wanderUntil = now + BOT_WANDER_HOLD_SEC;
    return;
  }
  mem.wanderX = circle.cx;
  mem.wanderY = circle.cy;
  mem.wanderUntil = now + 1.0;
}


const BOT_COMPASS_ENEMY_PREF_DIST = BOT_RADAR_DIST; // enemy if close, else orbs (like the top compass)

function pickBotCompassTarget(sim, bot, botId, circle, mem, playersArr) {
  const now = sim.time;

  // Keep current compass target briefly (prevents jitter).
  if (mem.ptrHoldUntil && now < mem.ptrHoldUntil && mem.ptrType && mem.ptrId) {
    if (mem.ptrType === 'enemy') {
      for (let i = 0; i < playersArr.length; i++) {
        const p = playersArr[i];
        if (!p || p.dead) continue;
        if (p.id === botId) continue;
        if (p.id !== mem.ptrId) continue;
        const dx = p.x - bot.x;
        const dy = p.y - bot.y;
        return { type: 'enemy', ent: p, d2: dx * dx + dy * dy };
      }
    } else if (mem.ptrType === 'orb' && sim.orbs && sim.orbs.length) {
      for (let i = 0; i < sim.orbs.length; i++) {
        const o = sim.orbs[i];
        if (!o || o.id !== mem.ptrId) continue;
        const dx = o.x - bot.x;
        const dy = o.y - bot.y;
        return { type: 'orb', ent: o, d2: dx * dx + dy * dy };
      }
    }
    // Target disappeared
    mem.ptrType = null;
    mem.ptrId = null;
    mem.ptrHoldUntil = 0;
  }

  // Nearest enemy (alive). Bots fight both humans and other bots.
  let bestEnemy = null;
  let bestEnemyD2 = Infinity;
  for (let i = 0; i < playersArr.length; i++) {
    const p = playersArr[i];
    if (!p || p.dead) continue;
    if (p.id === botId) continue;
    const dx = p.x - bot.x;
    const dy = p.y - bot.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestEnemyD2) { bestEnemyD2 = d2; bestEnemy = p; }
  }

  // Nearest orb (prefer inside/near safe circle).
  let bestOrb = null;
  let bestOrbD2 = Infinity;
  if (sim.orbs && sim.orbs.length) {
    const seek2 = BOT_ORB_SEEK_DIST * BOT_ORB_SEEK_DIST;
    const rSlack = (circle.r * 1.15);
    const rSlack2 = rSlack * rSlack;

    for (let i = 0; i < sim.orbs.length; i++) {
      const o = sim.orbs[i];
      const dx = o.x - bot.x;
      const dy = o.y - bot.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > seek2) continue;

      const cdx = o.x - circle.cx;
      const cdy = o.y - circle.cy;
      if ((cdx * cdx + cdy * cdy) > rSlack2) continue;

      if (d2 < bestOrbD2) { bestOrbD2 = d2; bestOrb = o; }
    }
  }

  const pref2 = BOT_COMPASS_ENEMY_PREF_DIST * BOT_COMPASS_ENEMY_PREF_DIST;
  const enemyClose = bestEnemy && bestEnemyD2 <= pref2;

  let type = null;
  let ent = null;
  let d2 = Infinity;

  if (enemyClose) {
    type = 'enemy';
    ent = bestEnemy;
    d2 = bestEnemyD2;
  } else if (bestOrb) {
    type = 'orb';
    ent = bestOrb;
    d2 = bestOrbD2;
  } else if (bestEnemy) {
    // No orbs nearby: chase the nearest enemy even if far.
    type = 'enemy';
    ent = bestEnemy;
    d2 = bestEnemyD2;
  }

  // Hold the pointer choice a little to avoid "flicker".
  if (type && ent) {
    mem.ptrType = type;
    mem.ptrId = ent.id;
    mem.ptrHoldUntil = now + (type === 'enemy' ? 0.25 : 0.45);
  } else {
    mem.ptrType = null;
    mem.ptrId = null;
    mem.ptrHoldUntil = 0;
  }

  return { type, ent, d2 };
}


function botUpdate(room, circle) {
  const sim = room.sim;
  if (sim.matchState !== 'match') return;

  // Lazy nav build per match.
  if (!room.botNav || room.botNav.mapId !== sim.mapId) {
    room.botNav = { mapId: sim.mapId, nav: buildBotNavGrid(sim) };
    // Clean per-bot state for the new map.
    if (room.botMem) room.botMem.clear();
  }

  const nav = room.botNav?.nav || null;

  const wid = sim.matchWeaponId || 'pistol';
  const weapon = (CONFIG.WEAPONS && CONFIG.WEAPONS[wid]) ? CONFIG.WEAPONS[wid] : CONFIG.PISTOL;

  const playersArr = Array.from(sim.players.values());

  for (const id of botIdsForRoom(room)) {
    const b = sim.players.get(id);
    if (!b) continue;

    let mem = room.botMem.get(id);
    if (!mem) {
      mem = botInitMem(b, sim.time);
      room.botMem.set(id, mem);
    }

    if (b.dead) {
      mem.mode = 'dead';
      mem.path.length = 0;
      applyInput(sim, id, { mv: [0, 0], aim: [1, 0], fire: false });
      continue;
    }

    // --- Decide mode ---
    const dxC = circle.cx - b.x;
    const dyC = circle.cy - b.y;
    const distC = Math.hypot(dxC, dyC);

const pick = pickBotCompassTarget(sim, b, id, circle, mem, playersArr);
const target = (pick.type === 'enemy') ? pick.ent : null;
const targetD2 = (pick.type === 'enemy') ? pick.d2 : Infinity;
const orb = (pick.type === 'orb') ? pick.ent : null;

// Zone priority: if far outside, ignore other goals.
if (distC > circle.r * BOT_ZONE_FRAC_HARD) {
  mem.mode = 'zone';
} else if (target) {
  mem.mode = 'fight';
} else if (orb) {
  mem.mode = 'farm';
} else {
  mem.mode = 'wander';
}

    const hpFrac = (b.maxHp && b.maxHp > 0) ? (b.hp / b.maxHp) : 1;
    const lowHp = (hpFrac < 0.35) && !(b.spawnProtectUntil && b.spawnProtectUntil > sim.time);

    // Low-HP behavior: prefer to play around cover instead of face-tanking.
    if (mem.mode === 'fight' && target && lowHp) {
      mem.mode = 'cover';
    }

    // If we recently triggered an "escape from dead-end" goal, keep it briefly.
    if (mem.escapeUntil && mem.escapeUntil > sim.time) {
      mem.mode = (mem.mode === 'zone') ? 'zone' : 'escape';
    }

    // --- Compute goal ---
    let goalX = b.x;
    let goalY = b.y;

    if (mem.mode === 'zone') {
      goalX = circle.cx;
      goalY = circle.cy;
    } else if (mem.mode === 'escape') {
      goalX = mem.escapeX;
      goalY = mem.escapeY;
      // Finish escape early if we reached it.
      if (Math.hypot(goalX - b.x, goalY - b.y) <= BOT_WP_REACH * 1.2) {
        mem.escapeUntil = 0;
      }
    } else if (mem.mode === 'cover' && target) {
      // Recompute cover point occasionally to reduce jitter.
      if (!mem.coverRecalcAt || sim.time >= mem.coverRecalcAt) {
        const g = pickBotCoverGoal(sim, b, target, circle);
        mem.coverX = g.x; mem.coverY = g.y;
        mem.coverRecalcAt = sim.time + 0.6 + Math.random() * 0.2;
      }
      goalX = mem.coverX;
      goalY = mem.coverY;
    } else if ((mem.mode === 'fight' || mem.mode === 'cover') && target) {
      const dx = target.x - b.x;
      const dy = target.y - b.y;
      const dist = Math.max(1e-6, Math.hypot(dx, dy));
      const ax = dx / dist;
      const ay = dy / dist;

      // Pursue what the top "compass pointer" indicates.
      // Keep a little space so ranged weapons can function, but avoid strafe-jitter.
      const desiredMin = 420;

      if (dist < desiredMin) {
        // Back off slightly if we got too close.
        goalX = b.x - ax * 520;
        goalY = b.y - ay * 520;
      } else {
        // Chase the target directly.
        goalX = target.x;
        goalY = target.y;
      }
    } else if (mem.mode === 'farm' && orb) {
      goalX = orb.x;
      goalY = orb.y;
    } else if (mem.mode === 'wander') {
      if (!mem.wanderUntil || mem.wanderUntil <= sim.time) {
        botPickWander(mem, circle, sim.time);
      }
      goalX = mem.wanderX;
      goalY = mem.wanderY;
    }

    // Always clamp goals inside the safe zone (bots should "держаться зоны").
    const clamped = clampGoalIntoCircle(circle, goalX, goalY, BOT_ZONE_FRAC_SOFT);
    goalX = clamped.x;
    goalY = clamped.y;

    // --- Navigation / pathing ---
    let wpX = goalX;
    let wpY = goalY;

    if (nav) {
      const gCell0 = navCellOf(nav, goalX, goalY);
      const gCell = navNearestFree(nav, gCell0.cx, gCell0.cy);
      const goalIdx = gCell.idx;

      const dtM = Math.max(0, sim.time - (mem.lastT ?? sim.time));
      const moved = Math.hypot(b.x - (mem.lastX ?? b.x), b.y - (mem.lastY ?? b.y));
      const wantMove = Math.hypot(goalX - b.x, goalY - b.y) > BOT_WP_REACH;

      if (wantMove && moved < 8) mem.stuckFor = (mem.stuckFor || 0) + dtM;
      else mem.stuckFor = Math.max(0, (mem.stuckFor || 0) - dtM * 0.5);

      mem.lastX = b.x;
      mem.lastY = b.y;
      mem.lastT = sim.time;

      const wasStuck = ((mem.stuckFor || 0) >= BOT_STUCK_SEC);

      const needRepath =
        (mem.goalIdx !== goalIdx) ||
        (!mem.path || mem.path.length === 0) ||
        (sim.time >= (mem.repathAt || 0)) ||
        wasStuck;

      if (needRepath) {
        mem.goalIdx = goalIdx;
        mem.repathAt = sim.time + BOT_REPATH_SEC + Math.random() * 0.12;
        mem.stuckFor = 0;

        // If we got stuck in dense maze corridors, bias the path goal sideways a bit
        // (helps bots find an alternate corridor instead of ramming the same wall).
        let toX = goalX;
        let toY = goalY;
        if (wasStuck) {
          const nowT = sim.time;
          // Track repeated dead-end bumps in a short window.
          if (!mem.stuckHitsUntil || nowT > mem.stuckHitsUntil) mem.stuckHits = 0;
          mem.stuckHits = (mem.stuckHits || 0) + 1;
          mem.stuckHitsUntil = nowT + 3.0;

          const j = nav.cell * 0.9;

          // After 2+ stuck repaths, "warm up" by aiming for the nearest passage/intersection first.
          if ((mem.stuckHits || 0) >= 2) {
            const s0 = navCellOf(nav, b.x, b.y);
            const s = navNearestFree(nav, s0.cx, s0.cy);
            // Prefer degree>=3 cells (not a dead-end). If none nearby, degree>=2.
            let pass = navFindNearestPassage(nav, s.cx, s.cy, { maxR: 16, minDeg: 3 });
            if (!pass || navDegree(nav, pass.idx) < 3) pass = navFindNearestPassage(nav, s.cx, s.cy, { maxR: 16, minDeg: 2 });

            const pc = navCenterOf(nav, pass.cx, pass.cy);
            toX = pc.x;
            toY = pc.y;

            const cc = clampGoalIntoCircle(circle, toX, toY, BOT_ZONE_FRAC_SOFT);
            toX = cc.x;
            toY = cc.y;

            mem.escapeX = toX;
            mem.escapeY = toY;
            mem.escapeUntil = nowT + 1.4; // brief escape to get out of тупик
            mem.stuckHits = 0;
          } else if ((mem.mode === 'fight' || mem.mode === 'cover') && target) {
            const dx = target.x - b.x;
            const dy = target.y - b.y;
            const dist = Math.max(1e-6, Math.hypot(dx, dy));
            const ax = dx / dist;
            const ay = dy / dist;
            const px = -ay;
            const py = ax;
            const s = (mem.strafeSign || 1);
            toX = b.x + ax * Math.min(dist, 900) + px * s * j;
            toY = b.y + ay * Math.min(dist, 900) + py * s * j;
            // Flip strafe each stuck repath so it tries both sides over time.
            mem.strafeSign = -s;
          } else {
            toX = goalX + (Math.random() * 2 - 1) * j;
            toY = goalY + (Math.random() * 2 - 1) * j;
          }

          const cc = clampGoalIntoCircle(circle, toX, toY, BOT_ZONE_FRAC_SOFT);
          toX = cc.x;
          toY = cc.y;
        }

        const pts = buildPathWaypoints(nav, b.x, b.y, toX, toY);
        mem.path = pts || [];

        // If we fail to path in a corridor while fighting, flip strafe to avoid deadlocks.
        if (!pts && (mem.mode === 'fight' || mem.mode === 'cover')) mem.strafeSign = -(mem.strafeSign || 1);
      }

      while (mem.path && mem.path.length) {
        const p0 = mem.path[0];
        const dd = Math.hypot(p0.x - b.x, p0.y - b.y);
        if (dd <= BOT_WP_REACH) mem.path.shift();
        else break;
      }

      if (mem.path && mem.path.length) {
        wpX = mem.path[0].x;
        wpY = mem.path[0].y;
      }
    }

    // Movement vector toward waypoint.
    let mvx = 0;
    let mvy = 0;
    const mv = norm2(wpX - b.x, wpY - b.y);
    mvx = mv[0];
    mvy = mv[1];

    // Local wall-avoidance: when chasing/attacking, bots can ram corners.
    // Steer tangentially when the probe ahead hits a wall.
    if ((mem.mode === 'fight' || mem.mode === 'cover' || mem.mode === 'escape') && (sim.obstacles || sim.obstacleGrid)) {
      const adj = botAvoidWalls(sim, b, mvx, mvy, wpX, wpY);
      mvx = adj[0];
      mvy = adj[1];
    }

    // Aim
    let aimx = b.aimx || 1;
    let aimy = b.aimy || 0;

    if ((mem.mode === 'fight' || mem.mode === 'cover') && target) {
      const dx = target.x - b.x;
      const dy = target.y - b.y;
      const a = norm2(dx, dy);
      aimx = a[0];
      aimy = a[1];
    } else if (Math.hypot(mvx, mvy) > 0.01) {
      aimx = mvx;
      aimy = mvy;
    }

    // Fire only when target is in range AND LOS (keeps bots from shooting walls endlessly).
    let fire = false;
    if ((mem.mode === 'fight' || mem.mode === 'cover') && target) {
      const dist = Math.sqrt(targetD2);
      const lvl = Math.max(1, Math.min(10, b.level || 1));
      const rangeMul = 1 + weapon.rangePerLevel * (lvl - 1);
      const range = weapon.baseRange * rangeMul;
      fire = hasLineOfSight(sim, b.x, b.y, target.x, target.y) && dist <= range * 1.08;
    }

    applyInput(sim, id, { mv: [mvx, mvy], aim: [aimx, aimy], fire });
  }
}
function getWeaponPool() {
  return CONFIG.MATCH_WEAPON_POOL ?? ['pistol'];
}

// Map vote (lobby)
// Map identifiers are map variants used by the obstacle generator.
// Keep this small for now (v1): Classic (default) and Labyrinth.
function getMapPool() {
  // Optional: allow overriding via config later.
  return CONFIG.MATCH_MAP_POOL ?? ['default', 'labyrinth'];
}

function computeMapVoteCounts(room) {
  const pool = getMapPool();
  const counts = {};
  for (const mid of pool) counts[mid] = 0;
  let total = 0;

  for (const cid of room.peers) {
    const peer = peers.get(cid);
    if (!peer || !peer.joined) continue;
    if (!peer.ws || peer.ws.readyState !== 1) continue;
    const v = peer.mapVote;
    if (!v) continue;
    if (counts[v] == null) continue;
    counts[v] += 1;
    total += 1;
  }
  return { pool, counts, total };
}

function pickMapForNextMatch(room, nextMapId, { fallback = false } = {}) {
  const sim = room.sim;
  const { pool, counts, total } = computeMapVoteCounts(room);
  if (!total) {
    if (!fallback) return null;
    // No votes yet: rotate deterministically across the full pool.
    // This keeps variety (pillars/cross/etc.) even when players don't vote.
    const mid = (nextMapId | 0);
    const n = Array.isArray(pool) ? pool.length : 0;
    if (!n) return 'default';
    const idx = ((mid > 0 ? (mid - 1) : 0) % n + n) % n;
    return pool[idx];
  }

  let max = 0;
  for (const mid of pool) max = Math.max(max, counts[mid] || 0);
  const tied = pool.filter(mid => (counts[mid] || 0) === max);
  if (tied.length === 1) return tied[0];

  // deterministic tie-break (seed + upcoming mapId)
  const seedU = (sim.seed >>> 0) || 1;
  const midU = (nextMapId >>> 0) || 0;
  const x = (((midU * 1103515245) >>> 0) + ((seedU * 12345) >>> 0)) >>> 0;
  tied.sort();
  return tied[x % tied.length];
}

function clearMapVotes(room) {
  for (const cid of room.peers) {
    const peer = peers.get(cid);
    if (peer) peer.mapVote = null;
  }
}

function computeWeaponVoteCounts(room) {
  const pool = getWeaponPool();
  const counts = {};
  for (const wid of pool) counts[wid] = 0;
  let total = 0;

  for (const cid of room.peers) {
    const peer = peers.get(cid);
    if (!peer || !peer.joined) continue;
    if (!peer.ws || peer.ws.readyState !== 1) continue;
    const v = peer.weaponVote;
    if (!v) continue;
    if (counts[v] == null) continue;
    counts[v] += 1;
    total += 1;
  }
  return { pool, counts, total };
}

function pickWeaponForNextMatch(room, nextMapId, { fallback = false } = {}) {
  const sim = room.sim;
  const { pool, counts, total } = computeWeaponVoteCounts(room);
  if (!total) return fallback ? sim._pickWeaponId(nextMapId) : null;

  let max = 0;
  for (const wid of pool) max = Math.max(max, counts[wid] || 0);
  const tied = pool.filter(wid => (counts[wid] || 0) === max);
  if (tied.length === 1) return tied[0];

  // deterministic tie-break (seed + upcoming mapId)
  const seedU = (sim.seed >>> 0) || 1;
  const midU = (nextMapId >>> 0) || 0;
  const x = (((midU * 1103515245) >>> 0) + ((seedU * 12345) >>> 0)) >>> 0;
  tied.sort();
  return tied[x % tied.length];
}

function clearWeaponVotes(room) {
  for (const cid of room.peers) {
    const peer = peers.get(cid);
    if (peer) peer.weaponVote = null;
  }
}

function pruneDisconnectedPeers() {
  for (const peer of peers.values()) {
    if (peer.ws) continue;
    if (peer.disconnectedAt == null) continue;

    const room = getRoom(peer.roomId);
    const roomTime = room ? room.sim.time : 0;
    if (room && (roomTime - peer.disconnectedAt) < REJOIN_GRACE_SEC) continue;

    // Expire this session: remove from sim if still present.
    if (room && peer.inSim && room.sim.players.has(peer.pid)) {
      removePlayer(room.sim, peer.pid);
    }
    if (room) room.peers.delete(peer.cid);

    peer.inSim = false;
    peer.ready = false;
    peer.joined = false;
    peer.weaponVote = null;
    peer.mapVote = null;
    peer.disconnectedAt = null;
    peer.lastMapIdSent = -1;
    peer.roomId = null;
  }
}

function pruneRooms() {
  const t = nowSec();
  for (const room of rooms.values()) {
    if (room.peers.size > 0) {
      room.emptyAtSec = null;
      continue;
    }
    if (room.emptyAtSec == null) room.emptyAtSec = t;

    // Keep at least one public lobby around to avoid churn.
    const isPublicLobby = (room.sim.matchState === 'lobby' && !room.code);
    if (isPublicLobby) continue;

    if ((t - room.emptyAtSec) >= ROOM_EMPTY_TTL_SEC) {
      rooms.delete(room.id);
    }
  }
}

function pruneInactivePeers() {
  const t = nowSec();
  for (const [cid, peer] of peers.entries()) {
    if (!peer) continue;
    if (peer.ws) continue; // active connection
    if (peer.roomId) continue; // still attached to a room (rejoin grace etc.)
    if (peer.joined || peer.inSim) continue;
    const last = peer.lastSeenAtSec ?? 0;
    if (last && (t - last) >= PEER_INACTIVE_TTL_SEC) {
      peers.delete(cid);
    }
  }
}

wss.on('connection', (ws) => {
  // Stable welcome id across reconnects: require auth first.
  send(ws, { t: 'helloReq', proto: PROTOCOL_VERSION, build: BUILD_TAG });
  if (METRICS_ENABLED) { metrics.connectionsTotal += 1; }

  ws.on('message', (buf) => {
    const bytes = (buf && typeof buf.length === 'number') ? (buf.length | 0) : 0;

    // Hard cap: drop overly large frames (do not parse).
    try {
      if (bytes > MAX_MSG_BYTES) {
        const n = markBadMsg(ws, 'oversize');
        if (n >= 3) {
          try { ws.close(4003, 'oversize'); } catch {}
        }
        return;
      }
    } catch {}

    // Byte budget: keeps handler work bounded even with many small frames.
    const p0 = getPeer(ws);
    if (!p0) {
      if (!preAuthBytesAllow(ws, bytes)) {
        const n = markBadMsg(ws, 'bytes');
        if (n >= BAD_MSG_MAX_PER_SEC_PREAUTH) {
          try { ws.close(4004, 'rate_limited'); } catch {}
        }
        return;
      }
    } else {
      if (!bytesAllow(p0, bytes)) {
        const n = markBadMsg(p0, 'bytes');
        if (n >= BAD_MSG_MAX_PER_SEC_AUTH) {
          try { ws.close(4004, 'rate_limited'); } catch {}
        }
        return;
      }
    }

    const msg = safeJsonParse(buf.toString());
    if (!msg || typeof msg.t !== 'string') {
      const tgt = p0 || ws;
      const n = markBadMsg(tgt, 'json');
      const lim = p0 ? BAD_MSG_MAX_PER_SEC_AUTH : BAD_MSG_MAX_PER_SEC_PREAUTH;
      if (n >= lim) {
        try { ws.close(4005, 'bad_msg'); } catch {}
      }
      return;
    }

    // Drop unknown message types early.
    if (!ALLOWED_MSG_TYPES.has(msg.t)) {
      const tgt = p0 || ws;
      const n = markBadMsg(tgt, 'unknown');
      const lim = p0 ? BAD_MSG_MAX_PER_SEC_AUTH : BAD_MSG_MAX_PER_SEC_PREAUTH;
      if (n >= lim) {
        try { ws.close(4005, 'bad_msg'); } catch {}
      }
      return;
    }

    // Ping works even before auth.
    if (msg.t === 'ping') {
      const peer = getPeer(ws);
      if (!peer) {
        if (!preAuthAllow(ws, 'ping')) return;
      } else {
        peer.lastSeenAtSec = nowSec();
        if (!rateLimitAllow(peer, 'ping')) return;
      }
      const room = peer ? getRoom(peer.roomId) : null;
      send(ws, { t: 'pong', c: msg.c ?? 0, s: room ? room.sim.time : 0 });
      return;
    }

    if (msg.t === 'hello') {
      if (!preAuthAllow(ws, 'hello')) return;
      // Protocol gate: prevents old cached clients from behaving unpredictably.
      // We validate before token handling to give a clear failure reason.
      const clientProto = (msg.proto | 0) || 0;
      if (clientProto !== PROTOCOL_VERSION) {
        // Reuse authFail so even older clients (without updateRequired handler)
        // show a clear "reload" message.
        sendWithMetrics(ws, { t: 'authFail',
          reason: 'update_required',
          serverProto: PROTOCOL_VERSION,
          clientProto,
          serverBuild: BUILD_TAG
        });
        try { ws.close(4002, 'update_required'); } catch {}
        return;
      }

      const cid = safeCid(msg.cid);
      const tok = safeTok(msg.tok);
      if (!cid || !tok) {
        sendWithMetrics(ws, { t: 'authFail', reason: 'bad_token' });
        try { ws.close(); } catch {}
        return;
      }

      const tokHash = hashTok(tok);
      let peer = peers.get(cid);

      if (peer) {
        if (peer.tokHash !== tokHash) {
          sendWithMetrics(ws, { t: 'authFail', reason: 'token_mismatch' });
          try { ws.close(); } catch {}
          return;
        }
        if (peer.ws && peer.ws.readyState === 1 && peer.ws !== ws) {
          try { peer.ws.close(); } catch {}
        }
        peer.ws = ws;
        peer.disconnectedAt = null;
        peer.lastSeenAtSec = nowSec();
        peer.lastActiveAtSec = nowSec();
        peer._afkWarnedAtSec = 0;
      } else {
        const pid = pidFromCid(cid);
        peer = {
          cid,
          pid,
          tokHash,
          ws,
          joined: false,
          ready: false,
          inSim: false,
          name: pid,
          color: '#55aaff',
          avatarId: 0,
          auraId: 0,
          trailId: 0,
          weaponVote: null,
          mapVote: null,
          lastMapIdSent: -1,
          disconnectedAt: null,
          roomId: null,
          lastSeenAtSec: nowSec(),
          lastActiveAtSec: nowSec(),
          _afkWarnedAtSec: 0,
          _rl: null
        };
        peers.set(cid, peer);
      }

      cidByWs.set(ws, cid);

      const room = getRoom(peer.roomId);
      send(ws, {
        t: 'welcome',
        id: peer.pid,
        proto: PROTOCOL_VERSION,
        protocol: PROTOCOL_VERSION, // alias for older clients/tests
        build: BUILD_TAG,
        serverTime: room ? room.sim.time : 0,
        config: {
          matchDurationSec: CONFIG.MATCH_DURATION_SEC,
          dropRatio: CONFIG.DROP_XP_RATIO_ON_DEATH
        },
        rejoin: {
          joined: !!peer.joined,
          inSim: !!peer.inSim,
          roomId: peer.roomId || null,
          matchState: room ? room.sim.matchState : 'none'
        }
      });
      return;
    }

    const peer = getPeer(ws);
    if (!peer) return;

    // Update activity timestamp and enforce per-peer rate limits.
    peer.lastSeenAtSec = nowSec();
    if (!rateLimitAllow(peer, msg.t)) {
      const n = markBadMsg(peer, 'rate');
      if (n >= BAD_MSG_MAX_PER_SEC_AUTH) {
        try { ws.close(4004, 'rate_limited'); } catch {}
      }
      return;
    }

    const pid = peer.pid;

    if (msg.t === 'join') {
      // Join/apply can be spammed by buggy clients; keep it bounded.
      const wall = nowSec();
      if (peer._lastJoinAtSec && (wall - peer._lastJoinAtSec) < JOIN_MIN_INTERVAL_SEC) {
        sendWithMetrics(ws, { t: 'joinFail', reason: 'rate_limited' });
        return;
      }
      peer._lastJoinAtSec = wall;
      markActive(peer);
      const name = safeName(msg.name, pid);
      const avatarId = safeAvatarId(msg.avatarId ?? msg.avatar ?? msg.av);
      const auraId = safeAuraId(msg.auraId ?? msg.aura ?? msg.au);
      const trailId = safeTrailId(msg.trailId ?? msg.trail ?? msg.tr);
      const color = autoColorFromAvatar(avatarId, pid); // ignore client-provided color
      peer.name = name;
      peer.color = color;
      peer.avatarId = avatarId;
      peer.auraId = auraId;
      peer.trailId = trailId;

      let room = getRoom(peer.roomId);
      const canRejoinSameRoom = !!(
        room &&
        peer.joined &&
        peer.inSim &&
        room.sim.players.has(pid) &&
        (room.sim.matchState === 'match' || room.sim.matchState === 'results')
      );

      const parsed = parseRoomCode(msg.roomCode ?? msg.code ?? msg.rc ?? '');
      const desiredCode = parsed.code;
      const codeErr = parsed.err;

      // Not a rejoin -> must select a lobby (public or code).
      if (!canRejoinSameRoom) {
        if (codeErr) {
          sendWithMetrics(ws, { t: 'joinFail', reason: codeErr });
          return;
        }

        let target = null;

        if (desiredCode) {
          const byCode = findRoomByCode(desiredCode);
          if (byCode) {
            if (byCode.sim.matchState !== 'lobby') {
              sendWithMetrics(ws, { t: 'joinFail', reason: 'room_in_match' });
              return;
            }
            // Allow re-apply if already in this room even when it is full.
            if (byCode.peers.size >= ROOM_MAX_PLAYERS && (!room || byCode.id !== room.id)) {
              sendWithMetrics(ws, { t: 'joinFail', reason: 'room_full', count: byCode.peers.size, max: ROOM_MAX_PLAYERS });
              return;
            }
            target = byCode;
          } else {
            // Creating many private rooms can be abused; cap per peer.
            const w = peer._codeCreate || { start: wall, count: 0 };
            if ((wall - w.start) >= 60) { w.start = wall; w.count = 0; }
            if (w.count >= CODE_ROOM_CREATE_MAX_PER_MIN) {
              peer._codeCreate = w;
              sendWithMetrics(ws, { t: 'joinFail', reason: 'rate_limited' });
              return;
            }
            w.count += 1;
            peer._codeCreate = w;
            target = createRoom({ code: desiredCode });
          }
        } else {
          // Public lobby: stay in the current public lobby if possible.
          if (room && room.sim.matchState === 'lobby' && !room.code) {
            target = room;
          } else {
            target = getOrCreateOpenLobbyRoom();
          }
        }

        // Move rooms if needed.
        if (room && target && room.id !== target.id) {
          room.peers.delete(peer.cid);
          markRoomEmptyIfNeeded(room);
          if (peer.inSim && room.sim.players.has(pid)) removePlayer(room.sim, pid);
          peer.inSim = false;
        }

        room = target;
        room.peers.add(peer.cid);
        markRoomEmptyIfNeeded(room);
        peer.roomId = room.id;
        peer.lastMapIdSent = -1;
        peer.weaponVote = null;
        peer.mapVote = null;
      } else {
        // Rejoin: keep same room.
        if (room) room.peers.add(peer.cid);
        if (room) markRoomEmptyIfNeeded(room);
      }

      peer.joined = true;
      peer.ready = false;

      if (room.sim.matchState === 'lobby') {
        if (!room.sim.players.has(pid)) {
          const p = addPlayer(room.sim, { id: pid, name, color, avatarId, auraId, trailId });
          peer.inSim = true;
          peer.name = p.name;
          peer.color = p.color;
        } else {
          const pl = room.sim.players.get(pid);
          if (pl) { pl.name = name; pl.color = color; pl.avatarId = avatarId; pl.auraId = auraId; pl.trailId = trailId; }
          peer.inSim = true;
        }
      } else {
        const pl = room.sim.players.get(pid);
        if (pl) { pl.name = name; pl.color = color; pl.avatarId = avatarId; pl.auraId = auraId; pl.trailId = trailId; }
        peer.inSim = room.sim.players.has(pid);
      }

      
      // Metrics: successful join
      if (METRICS_ENABLED) {
        metrics.joinsTotal += 1;
        if (canRejoinSameRoom) metrics.rejoinsTotal += 1;
        if (room && room.code) metrics.joinsCode += 1; else metrics.joinsPublic += 1;
        // Track when a lobby started being populated (for time-to-start stats).
        if (room && room.sim && room.sim.matchState === 'lobby' && room._mFirstJoinAtSim == null && room.peers && room.peers.size > 0) {
          room._mFirstJoinAtSim = room.sim.time;
        }
      }
send(ws, { t: 'joined', id: pid, roomId: room.id, role: 'player', rejoin: canRejoinSameRoom, roomCode: room.code || null });
      return;
    }

    const room = getRoom(peer.roomId);
    if (!room) return;

    if (msg.t === 'mapReq') {
      if (!peer.joined) return;
      const wall = nowSec();
      if (peer._lastMapReqAtSec && (wall - peer._lastMapReqAtSec) < 0.5) return;
      peer._lastMapReqAtSec = wall;
      sendMap(room, ws, peer);
      return;
    }

    if (msg.t === 'ready') {
      if (!peer.joined) return;
      if (room.sim.matchState !== 'lobby') return;
      markActive(peer);
      peer.ready = !!msg.v;
      return;
    }

    if (msg.t === 'bots') {
      if (!peer.joined) return;
      if (room.sim.matchState !== 'lobby') return;
      markActive(peer);
      // Allow client to also set bot count (2/4/6) while in lobby.
      if (msg.n != null || msg.count != null || msg.c != null) {
        const raw = (msg.n != null) ? msg.n : ((msg.count != null) ? msg.count : msg.c);
        room.botsCount = sanitizeBotsCount(raw);
      }
      room.botsEnabled = !!msg.v;
      if (!room.botsEnabled) removeBots(room);
      return;
    }

    if (msg.t === 'voteWeapon') {
      if (!peer.joined) return;
      if (room.sim.matchState !== 'lobby') return;
      markActive(peer);
      const pool = getWeaponPool();
      const widRaw = (msg.weaponId ?? msg.wid ?? '').toString().trim().toLowerCase();
      if (!widRaw) { peer.weaponVote = null; return; }
      if (!pool.includes(widRaw)) return;
      peer.weaponVote = widRaw;
      return;
    }

    if (msg.t === 'voteMap') {
      if (!peer.joined) return;
      if (room.sim.matchState !== 'lobby') return;
      markActive(peer);
      const pool = getMapPool();
      const midRaw = (msg.mapId ?? msg.mapVariant ?? msg.mid ?? '').toString().trim();
      if (!midRaw) { peer.mapVote = null; return; }
      // Map ids are case-sensitive in our snapshots; normalize to lower-case.
      const mid = midRaw.toLowerCase();
      if (!pool.includes(mid)) return;
      peer.mapVote = mid;
      return;
    }

    if (msg.t === 'in') {
      if (!peer.joined) return;
      if (room.sim.matchState !== 'match') return;
      if (!peer.inSim) return;
      markActive(peer);
      applyInput(room.sim, pid, sanitizeInputMsg(msg));
      return;
    }

    if (msg.t === 'again') {
      markActive(peer);
      if (room.sim.matchState === 'results') {
        enterLobby(room.sim, room.sim.time);
        removeBots(room);
        ensureJoinedPlayersInSim(room);
        for (const cid of room.peers) {
          const p = peers.get(cid);
          if (!p) continue;
          p.ready = false;
          p.lastMapIdSent = -1;
          p.weaponVote = null;
          p.mapVote = null;
        }
        room.countdownEndAt = null;
        room.sim.nextWeaponId = null;
        room.sim.nextMapVariant = null;
        clearWeaponVotes(room);
        clearMapVotes(room);
        eachConnectedPeerInRoom(room, (p) => send(p.ws, { t: 'toLobby' }));
      }
      return;
    }

    if (msg.t === 'nextMatch') {
      markActive(peer);
      if (room.sim.matchState === 'results') {
        // Fast rematch in the same room without going back to lobby.
        const sim = room.sim;
        const nextMapId = (sim.mapId | 0) + 1;
        sim.nextWeaponId = pickWeaponForNextMatch(room, nextMapId, { fallback: true });
        sim.nextMapVariant = pickMapForNextMatch(room, nextMapId, { fallback: true });

        // Reset match state immediately.
        resetMatch(sim, sim.time);

        // New map => rebuild bot nav/mem lazily.
        room.botNav = null;
        if (room.botMem) room.botMem.clear();

        // Re-apply bots and clear ready flags (players stay in room).
        ensureBotsInMatch(room);
        for (const cid of room.peers) {
          const p = peers.get(cid);
          if (p) p.ready = false;
        }
        room.countdownEndAt = null;

        // Send map then matchStart so clients can start instantly.
        eachConnectedPeerInRoom(room, (p) => {
          sendMap(room, p.ws, p);
          send(p.ws, { t: 'matchStart', weaponId: sim.matchWeaponId || 'pistol' });
        });
      }
      return;
    }


    // Optional client crash report (does not affect gameplay/state)
    if (msg.t === 'clientErr') {
      const kind = clampStr((msg.kind ?? msg.k ?? 'error'), 24).toLowerCase();
      const m = clampStr((msg.msg ?? msg.message ?? ''), 240);
      const stack = clampStr((msg.stack ?? ''), 1200);
      if (METRICS_ENABLED) {
        metrics.clientErrorsTotal += 1;
        incCounter(metrics.clientErrorsByKind, kind || 'error');
      }
      if (process.env.LOG_CLIENT_ERRORS === '1') {
        console.log(`[clientErr] ${kind}: ${m}${stack ? `\n${stack}` : ''}`);
      }
      return;
    }

    // Optional ops/admin commands (disabled unless ADMIN_KEY is set).
    if (msg.t === 'admin') {
      if (!ADMIN_KEY) {
        send(ws, { t: 'adminRes', ok: false, err: 'admin_disabled' });
        return;
      }
      const key = (msg.key ?? msg.k ?? '').toString();
      if (key !== ADMIN_KEY) {
        send(ws, { t: 'adminRes', ok: false, err: 'bad_key' });
        return;
      }

      const action = (msg.action ?? msg.a ?? '').toString();
      if (action === 'logMetrics') {
        logMetrics('admin');
        send(ws, { t: 'adminRes', ok: true, action });
        return;
      }

      if (action === 'listRooms') {
        const list = [];
        for (const r of rooms.values()) {
          list.push({
            id: r.id,
            code: r.code || null,
            public: !r.code,
            state: r.sim.matchState,
            peers: r.peers.size,
            botsEnabled: !!r.botsEnabled
          });
        }
        list.sort((a, b) => (b.peers - a.peers) || a.id.localeCompare(b.id));
        send(ws, { t: 'adminRes', ok: true, action, rooms: list.slice(0, 50) });
        return;
      }

      if (action === 'resetRoom') {
        const rid = (msg.roomId ?? msg.rid ?? peer.roomId ?? '').toString();
        const target = getRoom(rid);
        if (!target) {
          send(ws, { t: 'adminRes', ok: false, action, err: 'room_not_found', roomId: rid || null });
          return;
        }
        // Force transition to lobby and clear lobby state.
        enterLobby(target.sim, target.sim.time);
        removeBots(target);
        ensureJoinedPlayersInSim(target);
        for (const cid of target.peers) {
          const p = peers.get(cid);
          if (!p) continue;
          p.ready = false;
          p.lastMapIdSent = -1;
          p.weaponVote = null;
          p.mapVote = null;
        }
        target.countdownEndAt = null;
        target.sim.nextWeaponId = null;
        target.sim.nextMapVariant = null;
        clearWeaponVotes(target);
        clearMapVotes(target);
        eachConnectedPeerInRoom(target, (p) => send(p.ws, { t: 'toLobby' }));
        logMetrics('admin_room_reset');
        send(ws, { t: 'adminRes', ok: true, action, roomId: target.id });
        return;
      }

      send(ws, { t: 'adminRes', ok: false, err: 'unknown_action', action });
      return;
    }
  });

  ws.on('close', (code, reasonBuf) => {
    if (METRICS_ENABLED) {
      metrics.disconnectsTotal += 1;
      incCounter(metrics.wsCloseCodes, String((code ?? 0) | 0));
    }

    const cid = cidByWs.get(ws);
    cidByWs.delete(ws);
    if (!cid) return;

    const peer = peers.get(cid);
    if (!peer) return;

    if (peer.ws === ws) peer.ws = null;

    const room = getRoom(peer.roomId);
    if (METRICS_ENABLED && room && room.sim && room.sim.matchState !== 'lobby') { metrics.disconnectsInMatch += 1; }
    if (!room) {
      peer.disconnectedAt = 0;
      return;
    }

    // In lobby: remove immediately (no gameplay impact). Keep identity so they can rejoin.
    if (room.sim.matchState === 'lobby') {
      if (peer.inSim && room.sim.players.has(peer.pid)) removePlayer(room.sim, peer.pid);
      peer.inSim = false;
      peer.ready = false;
      peer.weaponVote = null;
      peer.mapVote = null;
      // Remove from room membership so empty lobby rooms can be GC'ed.
      room.peers.delete(peer.cid);
      markRoomEmptyIfNeeded(room);
      peer.roomId = null;
      peer.disconnectedAt = room.sim.time;
      return;
    }

    // In match/results: keep them for grace window.
    peer.disconnectedAt = room.sim.time;
  });
});

// Periodic metrics output
if (METRICS_ENABLED && METRICS_LOG_EVERY_SEC > 0) {
  setInterval(() => logMetrics('interval'), Math.max(1, METRICS_LOG_EVERY_SEC) * 1000).unref?.();
}

// ---------------------------------------------------------------------
// Simulation tick (shared clock)
// ---------------------------------------------------------------------

let last = Number(process.hrtime.bigint()) / 1e9;
let dtAccGlobal = 0;

const SIM_DT = 1 / 60;
// Snapshot cadence.
// NOTE: The sim runs in fixed 60Hz steps; using 15Hz aligns perfectly (every 4 sim steps)
// and reduces bandwidth/parse load on mobile (especially via tunnels/proxies).
// Override with SNAP_HZ env var if needed.
const SNAP_HZ = Math.max(10, Math.min(60, Number(process.env.SNAP_HZ || '') || 15));
const SNAP_DT = 1 / SNAP_HZ;
// Backpressure safety for slow links (mobile, tunnels, congested uplink).
// If a client can't keep up, ws will buffer outgoing data and latency will explode
// ("ping" climbs into seconds, then reconnects). For real-time games it's better
// to drop snapshots than to queue them.
// Override via MAX_WS_BUFFERED_BYTES env var if needed.
const MAX_WS_BUFFERED_BYTES = Math.max(64_000, Math.min(8_000_000, Number(process.env.MAX_WS_BUFFERED_BYTES || '') || 512_000));

// Snapshot payload caps (helps avoid uplink bufferbloat on LTE/tunnels).
// Collisions remain server-authoritative; these caps mainly affect visuals (bullets/orbs/pickups).
// Override via env vars if needed.
const MAX_SS_BULLETS = Math.max(0, Math.min(2000, Number(process.env.MAX_SS_BULLETS || '') || 120));
const MAX_SS_ORBS = Math.max(0, Math.min(5000, Number(process.env.MAX_SS_ORBS || '') || 350));
const MAX_SS_BUFFPICKUPS = Math.max(0, Math.min(2000, Number(process.env.MAX_SS_BUFFPICKUPS || '') || 160));

function downsampleEven(arr, cap) {
  if (!Array.isArray(arr) || cap <= 0 || arr.length <= cap) return arr;
  const out = new Array(cap);
  const step = arr.length / cap;
  for (let i = 0; i < cap; i++) out[i] = arr[Math.floor(i * step)];
  return out;
}
// Hardening: prevent spiral-of-death on long stalls.
// We keep the authoritative 60Hz sim, but cap catch-up work per interval.
const MAX_ROOM_ACC_SEC = 0.25;
const MAX_SIM_STEPS_PER_TICK = 16;

// Ensure there is always at least one lobby room.
createRoom();

setInterval(() => {
  const _workStart = Number(process.hrtime.bigint()) / 1e6;
  const now = Number(process.hrtime.bigint()) / 1e9;
  let dt = now - last;
  last = now;
  dt = Math.min(0.05, Math.max(0, dt));
  dtAccGlobal += dt;

  if (METRICS_ENABLED) {
    metrics._loopTickCount += 1;
    metrics._loopDtSum += dt;
    if (dt > metrics._loopDtMax) metrics._loopDtMax = dt;
  }

  // Housekeeping
  pruneDisconnectedPeers();
  pruneInactivePeers();
  pruneRooms();
  if (!Array.from(rooms.values()).some(r => r.sim.matchState === 'lobby' && !r.code)) {
    createRoom();
  }

  // Simulate each room using the same dt slice.
  for (const room of rooms.values()) {
    const sim = room.sim;
    const prevState = room._mPrevState || sim.matchState;

    // AFK / idle maintenance (does not affect sim rates)
    afkTickRoom(room);

    room.acc += dt;
    if (room.acc > MAX_ROOM_ACC_SEC) room.acc = MAX_ROOM_ACC_SEC;

    let circle = null;
    let steps = 0;
    let droppedBacklog = false;
    while (room.acc >= SIM_DT && steps < MAX_SIM_STEPS_PER_TICK) {
      ensureBotsInMatch(room);
      botUpdate(room, computeStorm(sim.matchState === 'match' ? (sim.time - sim.matchStart) : 0));
      circle = step(sim, SIM_DT);
      room.acc -= SIM_DT;
      steps += 1;
    }

    // If we hit the cap, drop any remaining backlog rather than stalling the event loop.
    if (steps >= MAX_SIM_STEPS_PER_TICK && room.acc >= SIM_DT) {
      room.acc = 0;
      droppedBacklog = true;
    }

    if (METRICS_ENABLED) {
      room._mSimSteps += steps;
      if (droppedBacklog) room._mSimCapDrops += 1;
    }

    if (!circle) {
      const elapsed = sim.matchState === 'lobby' ? 0 : (sim.time - sim.matchStart);
      circle = computeStorm(elapsed);
    }

    // Results auto-return to lobby (room-local)
    if (sim.matchState === 'results' && sim.matchEndAt != null) {
      if ((sim.time - sim.matchEndAt) >= RESULTS_HOLD_SEC) {
        enterLobby(sim, sim.time);
        removeBots(room);
        ensureJoinedPlayersInSim(room);
        for (const cid of room.peers) {
          const p = peers.get(cid);
          if (!p) continue;
          p.ready = false;
          p.lastMapIdSent = -1;
          p.weaponVote = null;
          p.mapVote = null;
        }
        room.countdownEndAt = null;
        sim.nextWeaponId = null;
        sim.nextMapVariant = null;
        clearWeaponVotes(room);
        clearMapVotes(room);
        eachConnectedPeerInRoom(room, (p) => send(p.ws, { t: 'toLobby' }));
      }
    }

    // Lobby auto-start (room-local)
    if (sim.matchState === 'lobby') {
      ensureJoinedPlayersInSim(room);
      if (METRICS_ENABLED && room._mFirstJoinAtSim == null && room.peers.size > 0) room._mFirstJoinAtSim = sim.time;

      const readyCount = Array.from(room.peers)
        .map(cid => peers.get(cid))
        .filter(p => p && p.ws && p.ws.readyState === 1 && p.joined && p.ready)
        .length;

      const minReady = minReadyForRoom(room);

      const nextMapId = (sim.mapId | 0) + 1;

      if (readyCount >= minReady) {
        if (room.countdownEndAt == null) {
          room.countdownEndAt = sim.time + START_COUNTDOWN_SEC;
        }

        sim.nextWeaponId = pickWeaponForNextMatch(room, nextMapId, { fallback: true });
        sim.nextMapVariant = pickMapForNextMatch(room, nextMapId, { fallback: true });

        if (sim.time >= room.countdownEndAt) {
          resetMatch(sim, sim.time);

          // Metrics: match start
          if (METRICS_ENABLED) {
            metrics.matchesStarted += 1;
            if (room._mFirstJoinAtSim != null) {
              metrics.lobbyTimeToStartSum += Math.max(0, sim.time - room._mFirstJoinAtSim);
              metrics.lobbyTimeToStartCount += 1;
            }
            room._mMatchStartedAtSim = sim.time;
            room._mFirstJoinAtSim = null;
            logMetrics('match_start');
          }

          ensureBotsInMatch(room);

          for (const cid of room.peers) {
            const p = peers.get(cid);
            if (p) p.ready = false;
          }
          room.countdownEndAt = null;

          eachConnectedPeerInRoom(room, (p) => {
            // New map for this match: send map packet to everyone (then matchStart)
            sendMap(room, p.ws, p);
            send(p.ws, { t: 'matchStart', weaponId: sim.matchWeaponId || 'pistol' });
          });
        }
      } else {
        room.countdownEndAt = null;
        sim.nextWeaponId = pickWeaponForNextMatch(room, nextMapId, { fallback: false });
        sim.nextMapVariant = pickMapForNextMatch(room, nextMapId, { fallback: false });
      }
    } else {
      room.countdownEndAt = null;
    }


    // Metrics: detect match end (match -> results)
    if (METRICS_ENABLED && prevState !== sim.matchState) {
      if (prevState === 'match' && sim.matchState === 'results') {
        metrics.matchesEnded += 1;
        if (room._mMatchStartedAtSim != null) {
          metrics.matchDurationSum += Math.max(0, sim.time - room._mMatchStartedAtSim);
          metrics.matchDurationCount += 1;
        }
        room._mMatchStartedAtSim = null;
        logMetrics('match_end');
      }
    }
    room._mPrevState = sim.matchState;

    // Snapshot broadcast (room-local)
    if (sim.time - room.lastSnap >= SNAP_DT) {
      room.lastSnap = sim.time;
      const ss = makeSnapshot(sim, circle);

      // Namespace mapId to avoid collisions between rooms.
      ss.mapId = mapIdOut(room, ss.mapId);

      // Attach lobby info and ready/vote flags.
      if (sim.matchState === 'lobby') {
        const readyCount = Array.from(room.peers)
          .map(cid => peers.get(cid))
          .filter(p => p && p.ws && p.ws.readyState === 1 && p.joined && p.ready)
          .length;

        const minReady = minReadyForRoom(room);
        ss.lobby = {
          minReady,
          readyCount,
          countdown: room.countdownEndAt ? Math.max(0, room.countdownEndAt - sim.time) : null,
          botsEnabled: room.botsEnabled,
          botsCount: sanitizeBotsCount(room.botsCount),
          maxPlayers: ROOM_MAX_PLAYERS
        };

        const { pool: weaponPool, counts: weaponVotes } = computeWeaponVoteCounts(room);
        ss.lobby.weaponPool = weaponPool;
        ss.lobby.weaponVotes = weaponVotes;

        const { pool: mapPool, counts: mapVotes } = computeMapVoteCounts(room);
        ss.lobby.mapPool = mapPool;
        ss.lobby.mapVotes = mapVotes;
      } else if (sim.matchState === 'results') {
        const minReady = minReadyForRoom(room);
        ss.lobby = {
          minReady,
          readyCount: 0,
          countdown: null,
          botsEnabled: room.botsEnabled,
          botsCount: sanitizeBotsCount(room.botsCount),
          maxPlayers: ROOM_MAX_PLAYERS
        };
      }

      const readyById = new Map();
      const voteById = new Map();
      const mapVoteById = new Map();
      for (const cid of room.peers) {
        const p = peers.get(cid);
        if (!p || !p.joined) continue;
        readyById.set(p.pid, !!p.ready);
        voteById.set(p.pid, p.weaponVote || null);
        mapVoteById.set(p.pid, p.mapVote || null);
      }
      if (Array.isArray(ss.players)) {
        ss.players = ss.players.map(pl => ({
          ...pl,
          ready: readyById.get(pl.id) || false,
          voteWeaponId: voteById.get(pl.id) || null,
          voteMapId: mapVoteById.get(pl.id) || null
        }));
      }

      // Cap large arrays to keep snapshot size bounded (especially important over tunnels/LTE).
      if (Array.isArray(ss.bullets) && ss.bullets.length > MAX_SS_BULLETS) ss.bullets = ss.bullets.slice(-MAX_SS_BULLETS);
      if (Array.isArray(ss.orbs) && ss.orbs.length > MAX_SS_ORBS) ss.orbs = downsampleEven(ss.orbs, MAX_SS_ORBS);
      if (Array.isArray(ss.buffPickups) && ss.buffPickups.length > MAX_SS_BUFFPICKUPS) ss.buffPickups = downsampleEven(ss.buffPickups, MAX_SS_BUFFPICKUPS);

      ss.roomCode = room.code || null;
      const payload = JSON.stringify({ t: 'ss', ...ss });
      const payloadBytes = Buffer.byteLength(payload);
      let sentCount = 0;
      let skippedCount = 0;

      eachConnectedPeerInRoom(room, (p) => {
        // Backpressure: if the outgoing buffer is already large, skip this snapshot for this peer.
        // This keeps latency bounded and avoids reconnect storms on slow links.
        if ((p.ws?.bufferedAmount || 0) > MAX_WS_BUFFERED_BYTES) {
          skippedCount += 1;
          // Track per-peer skipped snapshots (best-effort).
          p._mSnapSkipped = (p._mSnapSkipped || 0) + 1;
          return;
        }

        // Ensure client has current map before sending snapshots.
        if ((sim.matchState === 'match' || sim.matchState === 'results')) {
          const outId = mapIdOut(room, sim.mapId);
          if (outId > 0 && p.lastMapIdSent !== outId) {
            sendMap(room, p.ws, p);
          }
        }
        p.ws.send(payload);
        sentCount += 1;
      });

      if (METRICS_ENABLED) {
        room._mSnapCount += 1;
        room._mSnapBytes += payloadBytes * sentCount;
        room._mSnapSkipped = (room._mSnapSkipped || 0) + skippedCount;
      }
    }
  }

  if (METRICS_ENABLED) {
    const _workEnd = Number(process.hrtime.bigint()) / 1e6;
    const workMs = Math.max(0, _workEnd - _workStart);
    metrics._loopWorkMsSum += workMs;
    if (workMs > metrics._loopWorkMsMax) metrics._loopWorkMsMax = workMs;
  }
}, 16);