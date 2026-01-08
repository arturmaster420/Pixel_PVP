import { WSClient } from './net/wsClient.js';
import { InputController } from './input/inputController.js';
import { CanvasRenderer } from './render/canvasRenderer.js';
import { updateHUD } from './ui/hud.js';
import { maybeShowInterstitial, isAdsAvailable } from './portal/ads.js';
import { CONFIG, computeStorm, PROTOCOL_VERSION, BUILD_TAG } from 'be-try-core';

const canvas = document.getElementById('c');
const statsEl = document.getElementById('stats');
const pingMiniEl = document.getElementById('pingMini');
const lobbyPingMiniEl = document.getElementById('lobbyPingMini');
const buildTagEl = document.getElementById('buildTag');
const lobbyEl = document.getElementById('lobby');
const lobbyInfoEl = document.getElementById('lobbyInfo');
const nameInputEl = document.getElementById('nameInput');
const avatarButtonsEl = document.getElementById('avatarButtons');
const btnJoinEl = document.getElementById('btnJoin');
const btnJoinLeftEl = document.getElementById('btnJoinLeft');
const btnQuickPlayEl = document.getElementById('btnQuickPlay');
const btnReadyEl = document.getElementById('btnReady');
const roomCodeInputEl = document.getElementById('roomCodeInput');
const roomCodeStatusEl = document.getElementById('roomCodeStatus');
const btnGoPublicEl = document.getElementById('btnGoPublic');
const joinErrorEl = document.getElementById('joinError');
const btnCopyInviteEl = document.getElementById('btnCopyInvite');
const inviteHintEl = document.getElementById('inviteHint');
const lobbyStatusEl = document.getElementById('lobbyStatus');
const lobbyPlayersEl = document.getElementById('lobbyPlayers');
const botsToggleEl = document.getElementById('botsToggle');
const botsCountEl = document.getElementById('botsCount');
const botsLabelEl = document.getElementById('botsLabel');
const fxToggleEl = document.getElementById('fxToggle');
const weaponVoteEl = document.getElementById('weaponVote');
const weaponVoteStatusEl = document.getElementById('weaponVoteStatus');
const weaponVoteHintEl = document.getElementById('weaponVoteHint');
const mapVoteEl = document.getElementById('mapVote');
const mapVoteStatusEl = document.getElementById('mapVoteStatus');
const resultsEl = document.getElementById('results');
const resultsSummaryEl = document.getElementById('resultsSummary');
const resultsTableEl = document.getElementById('resultsTable');
const btnAgain = document.getElementById('btnAgain');
const btnNextMatch = document.getElementById('btnNextMatch');

const netBannerEl = document.getElementById('netBanner');
const netStatusTextEl = document.getElementById('netStatusText');
const btnRetryNetEl = document.getElementById('btnRetryNet');

// Portal wrapper (P0)
const portalOverlayEl = document.getElementById('portalOverlay');
const btnPortalStartEl = document.getElementById('btnPortalStart');
const btnPortalFullscreenEl = document.getElementById('btnPortalFullscreen');
const portalBarEl = document.getElementById('portalBar');
const btnFullscreenEl = document.getElementById('btnFullscreen');
const btnHelpEl = document.getElementById('btnHelp');
// Also present in the main menu (lobby)
const btnMenuFullscreenEl = document.getElementById('btnMenuFullscreen');
const btnMenuHelpEl = document.getElementById('btnMenuHelp');
const helpOverlayEl = document.getElementById('helpOverlay');
const btnHelpCloseEl = document.getElementById('btnHelpClose');
const helpDontShowEl = document.getElementById('helpDontShow');
const profileAvatarPreviewEl = document.getElementById('profileAvatarPreview');
const profLevelEl = document.getElementById('profLevel');
const profXpEl = document.getElementById('profXp');
const profAvEl = document.getElementById('profAv');
const profXpBarEl = document.getElementById('profXpBar');
const profNextEl = document.getElementById('profNext');
const profMatchesEl = document.getElementById('profMatches');
const profScoreWinsEl = document.getElementById('profScoreWins');
const profLastWinsEl = document.getElementById('profLastWins');
const profScoreWinRateEl = document.getElementById('profScoreWinRate');
const profLastWinRateEl = document.getElementById('profLastWinRate');
const profKillsEl = document.getElementById('profKills');
const profDeathsEl = document.getElementById('profDeaths');
const profAssistsEl = document.getElementById('profAssists');
const profBestEl = document.getElementById('profBest');
const profAvatarHintEl = document.getElementById('profAvatarHint');
const auraSelectEl = document.getElementById('auraSelect');
const trailSelectEl = document.getElementById('trailSelect');
const profBestScoreWinStreakEl = document.getElementById('profBestScoreWinStreak');
const profBestLastWinStreakEl = document.getElementById('profBestLastWinStreak');
const profBestBuffsEl = document.getElementById('profBestBuffs');

// Lobby profile tabs
const tabProfileBtnEl = document.getElementById('tabProfileBtn');
const tabRecordsBtnEl = document.getElementById('tabRecordsBtn');
const tabAchievementsBtnEl = document.getElementById('tabAchievementsBtn');
const profileTabProfileEl = document.getElementById('profileTabProfile');
const profileTabRecordsEl = document.getElementById('profileTabRecords');
const profileTabAchievementsEl = document.getElementById('profileTabAchievements');
const achListEl = document.getElementById('achList');

// Fatal error overlay (release safety net)
const fatalOverlayEl = document.getElementById('fatalOverlay');
const fatalSummaryEl = document.getElementById('fatalSummary');
const fatalDetailsEl = document.getElementById('fatalDetails');
const btnFatalCopyEl = document.getElementById('btnFatalCopy');
const btnFatalReloadEl = document.getElementById('btnFatalReload');

let wsRef = null;

// Single source of truth for visible build label.
// Keeps UI and protocol logs in sync even when the client is cached.
if (buildTagEl) buildTagEl.textContent = `(v${BUILD_TAG})`;
if (typeof document !== 'undefined') document.title = `Pixel PVP v${BUILD_TAG}`;

// Lobby profile: keep UI compact via tabs.
const LS_PROFILE_TAB = 'be_try_arena_profile_tab_v1';
function _readProfileTab(){
  try {
    const t = String(localStorage.getItem(LS_PROFILE_TAB) || 'profile');
    if (t === 'records') return 'records';
    if (t === 'achievements') return 'achievements';
    return 'profile';
  } catch { return 'profile'; }
}
function setProfileTab(which){
  const w = (which === 'records') ? 'records' : (which === 'achievements') ? 'achievements' : 'profile';
  try { localStorage.setItem(LS_PROFILE_TAB, w); } catch {}

  if (profileTabProfileEl) profileTabProfileEl.style.display = (w === 'profile') ? 'flex' : 'none';
  if (profileTabRecordsEl) profileTabRecordsEl.style.display = (w === 'records') ? 'flex' : 'none';
  if (profileTabAchievementsEl) profileTabAchievementsEl.style.display = (w === 'achievements') ? 'flex' : 'none';

  if (tabProfileBtnEl) {
    tabProfileBtnEl.classList.toggle('sel', w === 'profile');
    tabProfileBtnEl.setAttribute('aria-selected', w === 'profile' ? 'true' : 'false');
  }
  if (tabRecordsBtnEl) {
    tabRecordsBtnEl.classList.toggle('sel', w === 'records');
    tabRecordsBtnEl.setAttribute('aria-selected', w === 'records' ? 'true' : 'false');
  }
  if (tabAchievementsBtnEl) {
    tabAchievementsBtnEl.classList.toggle('sel', w === 'achievements');
    tabAchievementsBtnEl.setAttribute('aria-selected', w === 'achievements' ? 'true' : 'false');
  }

  if (w === 'achievements') {
    try { refreshAchievementsUI(); } catch {}
  }
}
tabProfileBtnEl?.addEventListener('click', () => setProfileTab('profile'));
tabRecordsBtnEl?.addEventListener('click', () => setProfileTab('records'));
tabAchievementsBtnEl?.addEventListener('click', () => setProfileTab('achievements'));
setProfileTab(_readProfileTab());

const PORTAL = (typeof window !== 'undefined') ? (window.__BE_TRY_PORTAL__ = (window.__BE_TRY_PORTAL__ || {})) : { };
if (typeof PORTAL.started !== 'boolean') PORTAL.started = false;
PORTAL.hidden = !!document.hidden;
PORTAL.bgFps = PORTAL.bgFps ?? 15;

const renderer = new CanvasRenderer(canvas);
const input = new InputController(canvas);

// Simple client-side VFX/UI state (hitmarker, hurt flash, killfeed, damage text)
const FX = {
  hitMarkerUntilMs: 0,
  hurtUntilMs: 0,
  killFeed: [], // { text, untilMs }
  dmgTexts: [], // { x, y, text, bornMs }
  explosions: [] // { x, y, r, bornMs }
};
const SEEN_EVENTS = new Map(); // key -> lastSeenMs
let lastEventSeqSeen = 0; // monotonic event sequence from server
// id -> { name, avatarId }
let lastNames = new Map();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h);

  // Place Fullscreen/Help to the left of the radar (radar is flush top-right).
  // Radar size is computed the same way as in CanvasRenderer._drawMinimap.
  if (portalBarEl) {
    const radarSize = Math.max(110, Math.min(180, Math.floor(Math.min(w, h) * 0.22), w, h));
    const pad = (w <= 520) ? 8 : 10;
    const right = Math.max(pad, Math.min(w - 20, radarSize + pad));
    portalBarEl.style.right = `${right}px`;
    portalBarEl.style.top = `${pad}px`;
  }
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------
// Fatal error safety net (release)
// - Captures unhandled exceptions and shows a reload/copy overlay
// - Optionally reports a compact error to the server (for portal debugging)
// ---------------------------------------------------------------------
const __BUILD_FOR_DEBUG = BUILD_TAG;
const __PROTO_FOR_DEBUG = PROTOCOL_VERSION;

let fatalShown = false;
let lastClientErrSentAtMs = 0;

function clampStr(s, maxLen) {
  const str = String(s ?? '');
  return str.length > maxLen ? (str.slice(0, maxLen) + '…') : str;
}

function buildFatalDebug(kind, err) {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
  const href = (typeof location !== 'undefined' && location.href) ? location.href : '';
  const msg = (err && (err.message || err.toString)) ? (err.message || String(err)) : String(err ?? '');
  const stack = err && err.stack ? String(err.stack) : '';
  return {
    kind: clampStr(kind, 32),
    msg: clampStr(msg, 320),
    stack: clampStr(stack, 1800),
    href: clampStr(href, 320),
    ua: clampStr(ua, 320),
    build: __BUILD_FOR_DEBUG,
    proto: __PROTO_FOR_DEBUG,
  };
}

function tryReportClientError(payload) {
  const now = performance.now();
  if (now - lastClientErrSentAtMs < 5000) return;
  lastClientErrSentAtMs = now;
  try {
    if (!wsRef || typeof wsRef.send !== 'function') return;
    wsRef.send({
      t: 'clientErr',
      kind: payload.kind,
      msg: payload.msg,
      stack: payload.stack,
      href: payload.href,
      build: payload.build,
      proto: payload.proto,
    });
  } catch {
    // ignore
  }
}

function showFatalOverlay(kind, err) {
  if (fatalShown) return;
  fatalShown = true;

  const p = buildFatalDebug(kind, err);

  if (fatalOverlayEl) fatalOverlayEl.style.display = 'flex';
  if (fatalSummaryEl) fatalSummaryEl.textContent = p.msg || 'Unexpected error.';
  if (fatalDetailsEl) {
    const lines = [];
    lines.push(`Build: ${p.build}`);
    lines.push(`Proto: ${p.proto}`);
    lines.push(`Kind: ${p.kind}`);
    if (p.href) lines.push(`URL: ${p.href}`);
    if (p.ua) lines.push(`UA: ${p.ua}`);
    lines.push('');
    if (p.stack) lines.push(p.stack);
    else lines.push(p.msg);
    fatalDetailsEl.textContent = lines.join('\n');
  }

  tryReportClientError(p);
}

btnFatalReloadEl?.addEventListener('click', () => {
  try { location.reload(); } catch { /* ignore */ }
});

btnFatalCopyEl?.addEventListener('click', async () => {
  try {
    const txt = fatalDetailsEl ? (fatalDetailsEl.textContent || '') : '';
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(txt);
    }
  } catch {
    // ignore
  }
});

window.addEventListener('error', (ev) => {
  try {
    showFatalOverlay('error', ev?.error ?? ev?.message ?? 'error');
  } catch {
    // ignore
  }
});

window.addEventListener('unhandledrejection', (ev) => {
  try {
    showFatalOverlay('promise', ev?.reason ?? 'unhandledrejection');
  } catch {
    // ignore
  }
});

// --- Portal wrapper (P0) behavior ---
const LS_PORTAL_STARTED = 'be_try_portal_started';
const LS_HELP_SEEN = 'be_try_arena_help_seen';
const LS_PROFILE = 'be_try_arena_profile_v1';
const LS_LOW_FX = 'be_try_arena_low_fx';

// Mobile heuristics (helps reduce jitter/GC spikes on phones)
const IS_MOBILE = (() => {
  try {
    return (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  } catch {
    return false;
  }
})();

// --- Perf/Net diagnostics overlay (P0 smoothness) ---
// Toggle: F2 (desktop) or the small ⏱ button (mobile/desktop).
const PERF = {
  enabled: false,
  lastFrameMs: 0,
  fps: 0,
  frameAvgMs: 0,
  frameMaxMs: 0,
  spikes: 0,
  // snapshot / interp debug
  snapAgeSec: 0,
  bufLen: 0,
  bufSpanSec: 0,
  headroomSec: 0,
  dtAheadSec: 0,
  // net stats (filled from ws.getStats())
  msgPerSec: 0,
  bytesPerSec: 0,
  parseLastMs: 0,
  parseAvgMs: 0,
  parseMaxMs: 0,
};

let perfOverlayEl = null;
let perfBtnEl = null;

function initPerfOverlay() {
  // Overlay (monospace, pointer-events none).
  perfOverlayEl = document.createElement('div');
  perfOverlayEl.id = 'perfOverlay';
  perfOverlayEl.style.position = 'fixed';
  perfOverlayEl.style.left = '6px';
  perfOverlayEl.style.top = '6px';
  perfOverlayEl.style.zIndex = '9999';
  perfOverlayEl.style.padding = '6px 8px';
  perfOverlayEl.style.borderRadius = '8px';
  perfOverlayEl.style.background = 'rgba(0,0,0,0.55)';
  perfOverlayEl.style.color = '#fff';
  perfOverlayEl.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  perfOverlayEl.style.fontSize = '12px';
  perfOverlayEl.style.lineHeight = '1.25';
  perfOverlayEl.style.whiteSpace = 'pre';
  perfOverlayEl.style.pointerEvents = 'none';
  perfOverlayEl.style.display = 'none';
  document.body.appendChild(perfOverlayEl);

  // Toggle button.
  perfBtnEl = document.createElement('button');
  perfBtnEl.id = 'btnPerf';
  perfBtnEl.textContent = '⏱';
  perfBtnEl.title = 'Perf overlay (F2)';
  perfBtnEl.style.position = 'fixed';
  perfBtnEl.style.right = '6px';
  perfBtnEl.style.top = '6px';
  perfBtnEl.style.zIndex = '10000';
  perfBtnEl.style.width = '30px';
  perfBtnEl.style.height = '30px';
  perfBtnEl.style.borderRadius = '999px';
  perfBtnEl.style.border = '1px solid rgba(255,255,255,0.25)';
  perfBtnEl.style.background = 'rgba(0,0,0,0.35)';
  perfBtnEl.style.color = '#fff';
  perfBtnEl.style.opacity = '0.55';
  perfBtnEl.style.cursor = 'pointer';
  perfBtnEl.style.userSelect = 'none';
  perfBtnEl.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    PERF.enabled = !PERF.enabled;
    if (perfOverlayEl) perfOverlayEl.style.display = PERF.enabled ? 'block' : 'none';
    if (perfBtnEl) perfBtnEl.style.opacity = PERF.enabled ? '0.95' : '0.55';
  });
  document.body.appendChild(perfBtnEl);

  window.addEventListener('keydown', (e) => {
    // Do not toggle while typing.
    const tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'F2') {
      PERF.enabled = !PERF.enabled;
      if (perfOverlayEl) perfOverlayEl.style.display = PERF.enabled ? 'block' : 'none';
      if (perfBtnEl) perfBtnEl.style.opacity = PERF.enabled ? '0.95' : '0.55';
      e.preventDefault();
      e.stopPropagation();
    }
  }, { capture: true });
}

try { initPerfOverlay(); } catch { /* ignore */ }

let lowFx = false;
let hasLowFxPref = false;
try {
  const v = localStorage.getItem(LS_LOW_FX);
  hasLowFxPref = v !== null;
  lowFx = v === '1';
} catch {}
// Default low-FX ON for mobile unless user explicitly chose otherwise.
if (!hasLowFxPref && IS_MOBILE) lowFx = true;

if (fxToggleEl) {
  fxToggleEl.checked = !!lowFx;
  fxToggleEl.addEventListener('change', () => {
    lowFx = !!fxToggleEl.checked;
    try { localStorage.setItem(LS_LOW_FX, lowFx ? '1' : '0'); } catch {}
    renderer.setLowFx?.(lowFx);
  });
}
renderer.setLowFx?.(lowFx);

// --- Cosmetics unlocks (client-only; portal retention; no gameplay impact) ---
// L1 unlocks first N avatars; every profile level unlocks more.
const AVATAR_UNLOCK_BASE = 8;        // L1: first 8 avatars
const AVATAR_UNLOCK_PER_LEVEL = 2;   // +2 avatars per level (L2: 10, L3: 12, ...)

function avatarRequiredLevelForIndex(i) {
  const id = (i | 0);
  if (id < AVATAR_UNLOCK_BASE) return 1;
  return 2 + Math.floor((id - AVATAR_UNLOCK_BASE) / Math.max(1, AVATAR_UNLOCK_PER_LEVEL));
}

function unlockedAvatarCountForLevel(level, total) {
  const t = Math.max(0, total | 0);
  if (t <= 0) return 0;
  const lv = Math.max(1, level | 0);
  const unlocked = AVATAR_UNLOCK_BASE + (lv - 1) * AVATAR_UNLOCK_PER_LEVEL;
  return Math.max(1, Math.min(t, unlocked));
}

function loadStatsProfile() {
  try {
    const raw = localStorage.getItem(LS_PROFILE);
    const base = raw ? JSON.parse(raw) : {};
    const p = {
      xp: Math.max(0, (base.xp | 0) || 0),
      level: Math.max(1, (base.level | 0) || 1),
      matches: Math.max(0, (base.matches | 0) || 0),
      wins: Math.max(0, (base.wins | 0) || 0),
      kills: Math.max(0, (base.kills | 0) || 0),
      deaths: Math.max(0, (base.deaths | 0) || 0),
      assists: Math.max(0, (base.assists | 0) || 0),
      bestStreak: Math.max(0, (base.bestStreak | 0) || 0),

      // New: cosmetics + achievements (non-gameplay, client-side retention)
      winStreak: Math.max(0, (base.winStreak | 0) || 0),
      bestWinStreak: Math.max(0, (base.bestWinStreak | 0) || 0),

      auraId: Math.max(0, (base.auraId | 0) || 0),
      trailId: Math.max(0, (base.trailId | 0) || 0),

      unlockedAuras: Array.isArray(base.unlockedAuras) ? base.unlockedAuras.map(x => x ? 1 : 0) : [],
      unlockedTrails: Array.isArray(base.unlockedTrails) ? base.unlockedTrails.map(x => x ? 1 : 0) : [],
      achievements: (base.achievements && typeof base.achievements === 'object') ? base.achievements : {}
    };
    return normalizeStatsProfile(p);
  } catch {
    return normalizeStatsProfile({ xp: 0, level: 1, matches: 0, wins: 0, kills: 0, deaths: 0, assists: 0, bestStreak: 0, winStreak: 0, bestWinStreak: 0, auraId: 0, trailId: 0, unlockedAuras: [], unlockedTrails: [], achievements: {} });
  }
}

function saveStatsProfile(p) {
  try { localStorage.setItem(LS_PROFILE, JSON.stringify(p)); } catch {}
}

function normalizeStatsProfile(p) {
  const aN = Array.isArray(CONFIG.AURAS) ? CONFIG.AURAS.length : 0;
  const tN = Array.isArray(CONFIG.TRAILS) ? CONFIG.TRAILS.length : 0;

  if (!Array.isArray(p.unlockedAuras)) p.unlockedAuras = [];
  if (!Array.isArray(p.unlockedTrails)) p.unlockedTrails = [];
  while (p.unlockedAuras.length < aN) p.unlockedAuras.push(0);
  while (p.unlockedTrails.length < tN) p.unlockedTrails.push(0);

  if (aN > 0) p.unlockedAuras[0] = 1; // Default always unlocked
  if (tN > 0) p.unlockedTrails[0] = 1; // Default always unlocked

  p.auraId = Math.max(0, (p.auraId | 0) || 0);
  p.trailId = Math.max(0, (p.trailId | 0) || 0);
  if (aN > 0 && (!p.unlockedAuras[p.auraId])) p.auraId = 0;
  if (tN > 0 && (!p.unlockedTrails[p.trailId])) p.trailId = 0;

  if (!p.achievements || typeof p.achievements !== 'object') p.achievements = {};
  if (!p.achDone || typeof p.achDone !== 'object') p.achDone = {};
  // If Pacifist was already claimed in older builds, keep it shown as completed.
  if (p.achievements && p.achievements.pacifist) p.achDone.pacifist = 1;

  // Records / progression (migrates older saves)
  // Older builds used `wins` (score-based) and `winStreak`.
  if (p.scoreWins == null) p.scoreWins = Math.max(0, (p.wins | 0) || 0);
  if (p.lastWins == null) p.lastWins = 0;
  p.matches = Math.max(0, (p.matches | 0) || 0);
  p.kills = Math.max(0, (p.kills | 0) || 0);
  p.deaths = Math.max(0, (p.deaths | 0) || 0);
  p.assists = Math.max(0, (p.assists | 0) || 0);
  p.bestStreak = Math.max(0, (p.bestStreak | 0) || 0);

  p.scoreWinStreak = Math.max(0, (p.scoreWinStreak | 0) || (p.winStreak | 0) || 0);
  p.bestScoreWinStreak = Math.max(0, (p.bestScoreWinStreak | 0) || (p.bestWinStreak | 0) || 0);
  p.lastWinStreak = Math.max(0, (p.lastWinStreak | 0) || 0);
  p.bestLastWinStreak = Math.max(0, (p.bestLastWinStreak | 0) || 0);
  p.bestBuffsInMatch = Math.max(0, (p.bestBuffsInMatch | 0) || 0);

  // Keep legacy fields for backwards-compat (no longer displayed).
  p.winStreak = Math.max(0, (p.winStreak | 0) || 0);
  p.bestWinStreak = Math.max(0, (p.bestWinStreak | 0) || 0);

  return p;
}

function recomputeStatsProfileLevel(p) {
  // Simple level curve for portals: every 100 XP = +1 level.
  p.level = Math.max(1, 1 + Math.floor((p.xp | 0) / 100));
}

function renderStatsProfileLine() {
  const p = statsProfile || {
    xp: 0,
    level: 1,
    matches: 0,
    scoreWins: 0,
    lastWins: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    bestStreak: 0,
    bestScoreWinStreak: 0,
    bestLastWinStreak: 0,
    bestBuffsInMatch: 0
  };

  const totalAv = Array.isArray(CONFIG.AVATARS) ? CONFIG.AVATARS.length : 0;
  const unlocked = unlockedAvatarCountForLevel(p.level ?? 1, totalAv);
  const nextReq = (totalAv > 0 && unlocked < totalAv) ? avatarRequiredLevelForIndex(unlocked) : 0;

  // Basic level progress: every 100 XP = +1 level.
  const xp = Math.max(0, (p.xp | 0) || 0);
  const xpInLevel = xp % 100;
  const pct = Math.max(0, Math.min(1, xpInLevel / 100));

  if (profLevelEl) profLevelEl.textContent = String(Math.max(1, (p.level | 0) || 1));
  if (profXpEl) profXpEl.textContent = String(xp);
  if (profAvEl) profAvEl.textContent = totalAv ? `${unlocked}/${totalAv}` : '—';
  if (profAvatarHintEl) profAvatarHintEl.textContent = totalAv ? `${unlocked}/${totalAv}` : '';
  if (profXpBarEl) profXpBarEl.style.width = `${Math.round(pct * 100)}%`;

  const matches = Math.max(0, (p.matches | 0) || 0);
  const scoreWins = Math.max(0, (p.scoreWins | 0) || 0);
  const lastWins = Math.max(0, (p.lastWins | 0) || 0);

  if (profMatchesEl) profMatchesEl.textContent = String(matches);
  if (profScoreWinsEl) profScoreWinsEl.textContent = String(scoreWins);
  if (profLastWinsEl) profLastWinsEl.textContent = String(lastWins);

  const scoreWinRate = matches > 0 ? Math.round((scoreWins / matches) * 100) : 0;
  const lastWinRate = matches > 0 ? Math.round((lastWins / matches) * 100) : 0;
  if (profScoreWinRateEl) profScoreWinRateEl.textContent = String(scoreWinRate);
  if (profLastWinRateEl) profLastWinRateEl.textContent = String(lastWinRate);

  if (profKillsEl) profKillsEl.textContent = String(Math.max(0, (p.kills | 0) || 0));
  if (profDeathsEl) profDeathsEl.textContent = String(Math.max(0, (p.deaths | 0) || 0));
  if (profAssistsEl) profAssistsEl.textContent = String(Math.max(0, (p.assists | 0) || 0));
  if (profBestEl) profBestEl.textContent = String(Math.max(0, (p.bestStreak | 0) || 0));

  if (profBestScoreWinStreakEl) profBestScoreWinStreakEl.textContent = String(Math.max(0, (p.bestScoreWinStreak | 0) || 0));
  if (profBestLastWinStreakEl) profBestLastWinStreakEl.textContent = String(Math.max(0, (p.bestLastWinStreak | 0) || 0));
  if (profBestBuffsEl) profBestBuffsEl.textContent = String(Math.max(0, (p.bestBuffsInMatch | 0) || 0));

  if (profNextEl) {
    if (!totalAv) {
      profNextEl.textContent = '';
    } else {
      const xpToNext = 100 - xpInLevel;
      const nextLevelTxt = `Next level: ${xpToNext} XP`;
      const nextAvatarTxt = (unlocked < totalAv && nextReq) ? `Next avatar at L${nextReq}` : 'All avatars unlocked';
      profNextEl.textContent = `${nextLevelTxt} • ${nextAvatarTxt}`;
    }
  }
}


// Persistent client-only profile (for portal retention; no gameplay impact).
let statsProfile = normalizeStatsProfile(loadStatsProfile());
recomputeStatsProfileLevel(statsProfile);
saveStatsProfile(statsProfile);
renderStatsProfileLine();
try { refreshAchievementsUI(); } catch {}

// Track per-match peak streak locally (so profile reflects the best streak achieved during the match,
// not just the streak value at match end which may be lower due to late deaths).
let matchPeakMapId = 0;
let matchPeakStreak = 0;
function updateMatchPeakStreakFromSS(ss) {
  try {
    const st = ss?.match?.state;
    const mapId = (ss?.mapId | 0) || 0;
    if (st === 'match' && mapId > 0) {
      if (mapId !== matchPeakMapId) {
        matchPeakMapId = mapId;
        matchPeakStreak = 0;
      }
      if (selfId && Array.isArray(ss.players)) {
        const self = ss.players.find(p => p && p.id === selfId);
        if (self) {
          const s = (self.streak | 0) || 0;
          if (s > matchPeakStreak) {
            matchPeakStreak = s;
          }
        }
      }
    } else if (st === 'lobby') {
      matchPeakMapId = 0;
      matchPeakStreak = 0;
    }
  } catch {}
}

// --- Achievements -> cosmetics unlocks (client-side, non-gameplay) ---
// Kill-Streak uses the SAME value as the HUD (ss.players[].streak). (per user request)

// NOTE: Many achievements have levels. In the Achievements tab we show ONLY the current level
// (the next unclaimed target). Claimed achievements are shown at the bottom as a history.
const ACH_DEFS = Object.freeze([
  // Score-based wins (top score)
  { key: 'score_ws_1', group: 'score', title: 'ScoreWinStreak', lvl: 1, kind: 'scoreWinStreak', target: 3, reward: { trailId: 4 }, req: 'Get 3 ScoreWins in a row.' },
  { key: 'score_ws_2', group: 'score', title: 'ScoreWinStreak', lvl: 2, kind: 'scoreWinStreak', target: 6, reward: { auraId: 4 }, req: 'Get 6 ScoreWins in a row.' },
  { key: 'score_ws_3', group: 'score', title: 'ScoreWinStreak', lvl: 3, kind: 'scoreWinStreak', target: 9, reward: { auraId: 7 }, req: 'Get 9 ScoreWins in a row.' },
  // Kept for older saves (was in legacy): 12 ScoreWins in a row.
  { key: 'score_ws_legacy_12', group: 'score', title: 'ScoreWinStreak', lvl: 4, kind: 'scoreWinStreak', target: 12, reward: { auraId: 1 }, req: 'Get 12 ScoreWins in a row.' },

  // Last-survivor wins (true BR win)
  { key: 'last_ws_1', group: 'last', title: 'LastWinStreak', lvl: 1, kind: 'lastWinStreak', target: 3, reward: { trailId: 7 }, req: 'Get 3 LastWins in a row.' },
  { key: 'last_ws_2', group: 'last', title: 'LastWinStreak', lvl: 2, kind: 'lastWinStreak', target: 6, reward: { auraId: 5 }, req: 'Get 6 LastWins in a row.' },
  { key: 'last_ws_3', group: 'last', title: 'LastWinStreak', lvl: 3, kind: 'lastWinStreak', target: 9, reward: { trailId: 6 }, req: 'Get 9 LastWins in a row.' },
  { key: 'last_ws_4', group: 'last', title: 'LastWinStreak', lvl: 4, kind: 'lastWinStreak', target: 12, reward: { auraId: 1 }, req: 'Get 12 LastWins in a row.' },

  // Kill streak achievements (single life, same as HUD)
  // Kept for older saves (was in legacy): 12/20
  { key: 'kill_12', group: 'kill', title: 'KillStreak', lvl: 1, kind: 'killStreak', target: 12, reward: { trailId: 1 }, req: 'Get KillStreak 12 (single life).' },
  { key: 'kill_20', group: 'kill', title: 'KillStreak', lvl: 2, kind: 'killStreak', target: 20, reward: { trailId: 2 }, req: 'Get KillStreak 20 (single life).' },
  { key: 'kill_30', group: 'kill', title: 'KillStreak', lvl: 3, kind: 'killStreak', target: 30, reward: { auraId: 2 }, req: 'Get KillStreak 30 (single life).' },
  { key: 'kill_40', group: 'kill', title: 'KillStreak', lvl: 4, kind: 'killStreak', target: 40, reward: { auraId: 3 }, req: 'Get KillStreak 40 (single life).' },
  { key: 'kill_50', group: 'kill', title: 'KillStreak', lvl: 5, kind: 'killStreak', target: 50, reward: { auraId: 6, trailId: 5 }, req: 'Get KillStreak 50 (single life).' },

  // Match volume
  { key: 'plays_10', group: 'plays', title: 'Matches Played', lvl: 1, kind: 'matchesPlayed', target: 10, reward: { trailId: 1 }, req: 'Play 10 matches.' },
  { key: 'plays_20', group: 'plays', title: 'Matches Played', lvl: 2, kind: 'matchesPlayed', target: 20, reward: { trailId: 2 }, req: 'Play 20 matches.' },
  { key: 'plays_50', group: 'plays', title: 'Matches Played', lvl: 3, kind: 'matchesPlayed', target: 50, reward: { trailId: 3 }, req: 'Play 50 matches.' },
  // No new cosmetic yet; give profile XP so the reward is still meaningful.
  { key: 'plays_100', group: 'plays', title: 'Matches Played', lvl: 4, kind: 'matchesPlayed', target: 100, reward: { xp: 150 }, req: 'Play 100 matches.' },

  // Playstyle
  { key: 'buff_30', group: 'buff', title: 'Buff Collector', lvl: 1, kind: 'buffCollector', target: 30, reward: { trailId: 6 }, req: 'Get 30 buffs in one match.' },
  { key: 'pacifist', group: 'buff', title: 'Pacifist', lvl: 1, kind: 'pacifist', target: 1, reward: { xp: 80 }, req: 'Win as Last Survivor with 0 kills.' },
]);

function _achRewardText(def) {
  const parts = [];
  const xp = (def?.reward?.xp != null) ? Math.max(0, def.reward.xp | 0) : 0;
  const aid = (def?.reward?.auraId != null) ? (def.reward.auraId | 0) : null;
  const tid = (def?.reward?.trailId != null) ? (def.reward.trailId | 0) : null;
  if (aid != null && Array.isArray(CONFIG.AURAS) && CONFIG.AURAS[aid]) parts.push(`Aura: ${CONFIG.AURAS[aid]}`);
  else if (aid != null) parts.push(`Aura: #${aid}`);
  if (tid != null && Array.isArray(CONFIG.TRAILS) && CONFIG.TRAILS[tid]) parts.push(`Trail: ${CONFIG.TRAILS[tid]}`);
  else if (tid != null) parts.push(`Trail: #${tid}`);
  if (xp > 0) parts.push(`+${xp} Profile XP`);
  return parts.length ? parts.join(' + ') : '—';
}

function _achProgress(def) {
  const t = (def?.target | 0) || 0;
  const kind = def?.kind || '';
  if (kind === 'scoreWinStreak') return { cur: Math.max(0, (statsProfile?.bestScoreWinStreak | 0) || 0), target: t };
  if (kind === 'lastWinStreak') return { cur: Math.max(0, (statsProfile?.bestLastWinStreak | 0) || 0), target: t };
  if (kind === 'killStreak') return { cur: Math.max(0, (statsProfile?.bestStreak | 0) || 0), target: t };
  if (kind === 'matchesPlayed') return { cur: Math.max(0, (statsProfile?.matches | 0) || 0), target: t };
  if (kind === 'buffCollector') return { cur: Math.max(0, (statsProfile?.bestBuffsInMatch | 0) || 0), target: t };
  if (kind === 'pacifist') {
    const done = !!(statsProfile?.achDone && statsProfile.achDone.pacifist);
    return { cur: done ? 1 : 0, target: 1 };
  }
  return { cur: 0, target: t };
}


function _achIsClaimed(key) {
  return !!(statsProfile?.achievements && statsProfile.achievements[key]);
}

function _achIsCompleted(def) {
  const { cur, target } = _achProgress(def);
  return (target > 0) && (cur >= target);
}

function refreshAchievementsUI() {
  if (!achListEl) return;
  try {
    let html = '';

    // We show ONLY the current level for leveled achievements.
    // Claimed achievements are shown at the bottom (history).
    const groupOrder = ['score', 'last', 'kill', 'plays', 'buff'];
    const groupName = {
      score: 'ScoreWins',
      last: 'LastWins',
      kill: 'KillStreak',
      plays: 'Matches Played',
      buff: 'Playstyle',
    };

    const trackKinds = new Set(['scoreWinStreak', 'lastWinStreak', 'killStreak', 'matchesPlayed']);

    function pickCurrentLevel(defs) {
      const sorted = defs.slice().sort((a, b) => ((a?.target | 0) - (b?.target | 0)));
      for (const d of sorted) {
        if (!_achIsClaimed(d.key)) return d;
      }
      return null;
    }

    function renderRow(def, mode = 'main') {
      const claimed = _achIsClaimed(def.key);
      const completed = _achIsCompleted(def);
      const { cur, target } = _achProgress(def);
      const prog = (target > 0) ? `${Math.min(cur, target)}/${target}` : '';

      const pct = (target > 0) ? clamp01(cur / target) : 0;

      const icon =
        def.group === 'score' ? '🏁' :
        def.group === 'last' ? '👑' :
        def.group === 'kill' ? '⚔️' :
        def.group === 'plays' ? '🎮' :
        def.group === 'buff' ? '✨' :
        '🏆';

      const title = def.title;
      const lvlBadge = def.lvl ? `<span class="lvl">L${def.lvl}</span>` : '';

      // Reward pills (more readable than one long string)
      const rewardParts = [];
      const aid = (def?.reward?.auraId != null) ? (def.reward.auraId | 0) : null;
      const tid = (def?.reward?.trailId != null) ? (def.reward.trailId | 0) : null;
      const rxp = (def?.reward?.xp != null) ? Math.max(0, def.reward.xp | 0) : 0;
      if (aid != null) {
        const nm = (Array.isArray(CONFIG.AURAS) && CONFIG.AURAS[aid]) ? CONFIG.AURAS[aid] : `#${aid}`;
        rewardParts.push(`Aura: ${nm}`);
      }
      if (tid != null) {
        const nm = (Array.isArray(CONFIG.TRAILS) && CONFIG.TRAILS[tid]) ? CONFIG.TRAILS[tid] : `#${tid}`;
        rewardParts.push(`Trail: ${nm}`);
      }
      if (rxp > 0) rewardParts.push(`+${rxp} XP`);
      const rewardHtml = rewardParts.length
        ? rewardParts.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join('')
        : `<span class="pill muted">—</span>`;
      const req = def.req || def.desc || '';

      const rowCls = claimed ? 'claimed' : (completed ? 'ready' : '');
      const rightTop = prog ? `<div class="prog">${escapeHtml(prog)}</div>` : '';

      let rightBottom = `<div class="status">—</div>`;
      if (mode === 'history') {
        rightBottom = `<div class="status">Claimed</div>`;
      } else {
        if (completed) {
          rightBottom = claimed
            ? `<div class="status">Claimed</div>`
            : `<button class="btn achClaim" data-ach="${escapeHtml(def.key)}" type="button">Claim</button>`;
        } else {
          rightBottom = `<div class="status">In progress</div>`;
        }
      }

      const descLine = (!claimed && req) ? `<div class="desc">${escapeHtml(req)}</div>` : '';

      const bar = (target > 0 && !claimed)
        ? `<div class="bar"><div class="fill" style="width:${(pct * 100).toFixed(1)}%"></div></div>`
        : '';

      return `
        <div class="achRow ${rowCls}">
          <div class="left">
            <div class="top">
              <div class="ico" aria-hidden="true">${icon}</div>
              <div class="twrap">
                <div class="title">${escapeHtml(title)}${lvlBadge}</div>
                ${descLine}
              </div>
            </div>
            ${bar}
            <div class="reward">${rewardHtml}</div>
          </div>
          <div class="right">
            ${rightTop}
            ${rightBottom}
          </div>
        </div>
      `;
    }

    // Main section: for each group show current level for tracks + unclaimed single achievements.
    for (const g of groupOrder) {
      const defs = ACH_DEFS.filter(d => (d.group || '') === g);
      if (!defs.length) continue;

      const htmlParts = [];

      // Tracks: only current level
      const kindsInGroup = Array.from(new Set(defs.map(d => d.kind))).filter(k => trackKinds.has(k));
      for (const kind of kindsInGroup) {
        const d = pickCurrentLevel(defs.filter(x => x.kind === kind));
        if (d) htmlParts.push(renderRow(d, 'main'));
      }

      // Singles: show until claimed
      for (const d of defs) {
        if (trackKinds.has(d.kind)) continue;
        if (_achIsClaimed(d.key)) continue;
        htmlParts.push(renderRow(d, 'main'));
      }

      if (!htmlParts.length) continue;
      html += `<div class="achGroup">${escapeHtml(groupName[g] || g)}</div>`;
      html += htmlParts.join('');
    }

    // History: all claimed achievements at the very bottom (replaces the old legacy block).
    const claimed = ACH_DEFS
      .filter(d => _achIsClaimed(d.key))
      .slice()
      .sort((a, b) => {
        const ga = groupOrder.indexOf(a.group);
        const gb = groupOrder.indexOf(b.group);
        if (ga !== gb) return ga - gb;
        const ka = a.kind || '';
        const kb = b.kind || '';
        if (ka !== kb) return ka.localeCompare(kb);
        return ((a?.target | 0) - (b?.target | 0));
      });

    if (claimed.length) {
      html += `<div class="achGroup">Completed</div>`;
      for (const d of claimed) {
        html += renderRow(d, 'history');
      }
    }

    achListEl.innerHTML = html;
  } catch {
    achListEl.innerHTML = '';
  }
}

function unlockAura(id) {
  const n = Array.isArray(CONFIG.AURAS) ? CONFIG.AURAS.length : 0;
  const aid = clampAuraId(id);
  if (n && statsProfile.unlockedAuras) statsProfile.unlockedAuras[aid] = 1;
}
function unlockTrail(id) {
  const n = Array.isArray(CONFIG.TRAILS) ? CONFIG.TRAILS.length : 0;
  const tid = clampTrailId(id);
  if (n && statsProfile.unlockedTrails) statsProfile.unlockedTrails[tid] = 1;
}

function claimAchievement(achId) {
  if (!achId) return false;
  const def = ACH_DEFS.find(d => d.key === achId);
  if (!def) return false;

  if (!statsProfile.achievements) statsProfile.achievements = {};
  if (statsProfile.achievements[achId]) return false;

  if (!_achIsCompleted(def)) {
    toast('Not completed yet');
    return false;
  }

  statsProfile.achievements[achId] = 1;
  // Rewards are non-gameplay only (cosmetics + profile XP).
  const rxp = (def?.reward?.xp != null) ? Math.max(0, def.reward.xp | 0) : 0;
  const aid = (def?.reward?.auraId != null) ? (def.reward.auraId | 0) : null;
  const tid = (def?.reward?.trailId != null) ? (def.reward.trailId | 0) : null;
  if (aid != null) unlockAura(aid);
  if (tid != null) unlockTrail(tid);
  if (rxp > 0) {
    statsProfile.xp = Math.max(0, (statsProfile.xp | 0) || 0) + rxp;
    recomputeStatsProfileLevel(statsProfile);
  }

  normalizeStatsProfile(statsProfile);
  saveStatsProfile(statsProfile);
  renderStatsProfileLine();
  refreshAvatarButtonsUnlockState();
  refreshCosmeticsUI();
  try { refreshAchievementsUI(); } catch {}

  const toastTitle = def.lvl ? `${def.title} lvl${def.lvl}` : def.title;
  toast(`🏆 Claimed: ${toastTitle}${rxp > 0 ? ` (+${rxp} XP)` : ''}`);
  return true;
}

if (achListEl) {
  achListEl.addEventListener('click', (e) => {
    const btn = e?.target?.closest ? e.target.closest('button[data-ach]') : null;
    if (!btn) return;
    const k = btn.getAttribute('data-ach') || '';
    claimAchievement(k);
  });
}

function _helpSeen() {
  try { return localStorage.getItem(LS_HELP_SEEN) === '1'; } catch { return false; }
}

function _setHelpSeen(v) {
  try { localStorage.setItem(LS_HELP_SEEN, v ? '1' : '0'); } catch {}
}

function showHelpOverlay(force = false) {
  if (!helpOverlayEl) return;
  if (!force && _helpSeen()) return;
  helpOverlayEl.style.display = 'flex';
  if (helpDontShowEl) helpDontShowEl.checked = false;
}

function maybeShowHelpOverlay() {
  if (_helpSeen()) return;
  if (!PORTAL.started) {
    PORTAL._showHelpAfterStart = true;
    return;
  }
  showHelpOverlay(false);
}

function hideHelpOverlay() {
  if (!helpOverlayEl) return;
  if (helpDontShowEl?.checked) _setHelpSeen(true);
  helpOverlayEl.style.display = 'none';
}

btnHelpEl?.addEventListener('click', () => showHelpOverlay(true));
btnHelpCloseEl?.addEventListener('click', hideHelpOverlay);
helpOverlayEl?.addEventListener('pointerdown', (e) => {
  if (e?.target === helpOverlayEl) hideHelpOverlay();
});
if (typeof localStorage !== 'undefined') {
  if (localStorage.getItem(LS_PORTAL_STARTED) === '1') PORTAL.started = true;
}

function _setPortalOverlayVisible(v) {
  if (!portalOverlayEl) return;
  portalOverlayEl.style.display = v ? 'flex' : 'none';
}

async function _unlockAudioOnce() {
  // There may be no audio yet; this keeps the project portal-ready.
  if (PORTAL._audioUnlocked) return;
  PORTAL._audioUnlocked = true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      PORTAL._audioCtx = PORTAL._audioCtx || new AC();
      if (PORTAL._audioCtx.state === 'suspended') {
        await PORTAL._audioCtx.resume();
      }
    }
  } catch {}
}

function _isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function _toggleFullscreen() {
  try {
    if (_isFullscreen()) {
      await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
    } else {
      // Prefer fullscreening the canvas if possible.
      const el = document.documentElement;
      // Fullscreen the whole document so UI (lobby/results) stays visible.
await (el.requestFullscreen?.() || el.webkitRequestFullscreen?.());
    }
  } catch {}
}

function _syncFullscreenBtn() {
  const fs = _isFullscreen();
  if (btnFullscreenEl) btnFullscreenEl.textContent = fs ? 'Exit' : 'FS';
  if (btnPortalFullscreenEl) btnPortalFullscreenEl.textContent = fs ? 'Exit' : 'FS';
  if (btnMenuFullscreenEl) btnMenuFullscreenEl.textContent = fs ? 'Exit' : 'FS';
  // Ensure renderer/UI resizes correctly when entering/exiting fullscreen.
  try { resize(); } catch {}
  try { setTimeout(resize, 80); } catch {}
}

function _portalStart() {
  PORTAL.started = true;
  try { localStorage.setItem(LS_PORTAL_STARTED, '1'); } catch {}
  _setPortalOverlayVisible(false);
  // Unlock audio on the user gesture, and focus the canvas.
  void _unlockAudioOnce();
  try { canvas?.focus?.(); } catch {}

  // If help was pending (first-time UX), show it after the portal start gesture.
  if (PORTAL._showHelpAfterStart && !_helpSeen()) {
    PORTAL._showHelpAfterStart = false;
    showHelpOverlay(false);
  }
}

// Show overlay until user taps/clicks Start.
_setPortalOverlayVisible(!PORTAL.started);
btnPortalStartEl?.addEventListener('click', _portalStart);
portalOverlayEl?.addEventListener('pointerdown', (e) => {
  // Allow clicking the dim background to start (nice for mobile).
  if (e?.target === portalOverlayEl) _portalStart();
});

btnFullscreenEl?.addEventListener('click', _toggleFullscreen);
btnPortalFullscreenEl?.addEventListener('click', _toggleFullscreen);
btnMenuFullscreenEl?.addEventListener('click', _toggleFullscreen);
btnMenuHelpEl?.addEventListener('click', () => showHelpOverlay(true));
document.addEventListener('fullscreenchange', _syncFullscreenBtn);
document.addEventListener('webkitfullscreenchange', _syncFullscreenBtn);
_syncFullscreenBtn();

// Pause/mute-ish on tab hide: throttle rendering and send a single "stop" input.
document.addEventListener('visibilitychange', () => {
  PORTAL.hidden = !!document.hidden;
  if (PORTAL.hidden) {
    // Stop any stuck firing when tab is hidden.
    try { input.mouseDown = false; } catch {}
    // We can't safely send packets here (ws/seq may not be initialized yet).
    // Instead, request a single "stop input" on the next sendInput() tick.
    PORTAL._needStopInput = true;

    // Mute future audio (if any) cheaply.
    try { PORTAL._audioCtx?.suspend?.(); } catch {}
  } else {
    // Resume audio if user already started.
    if (PORTAL.started) {
      try { PORTAL._audioCtx?.resume?.(); } catch {}
    }
  }
});

let selfId = null;
let hasJoined = false;
let selfRole = 'none'; // 'player' | 'spectator' | 'none'
let joinLocked = false;
let lobbyInitialized = false;
let weaponVoteBound = false;
let optimisticWeaponVote = null; // UI hint until next snapshot arrives
// Avoid double-sending votes when both pointer/click fire.
let _lastWeaponVoteSentAtMs = 0;
let _lastWeaponVoteWid = null;
let mapVoteBound = false;
let optimisticMapVote = null;
let _lastMapVoteSentAtMs = 0;
let _lastMapVoteMid = null;
let lobbyManual = false; // user toggled with Esc during match
let cam = { x: 0, y: 0, w: canvas.width, h: canvas.height, zoom: 1 };

// Last received snapshot (for lobby UI)
let lastServerSS = null;
let lastMatchState = null;
let lastMatchXpGain = 0;
let lastMatchXpKey = null;
// Map packets: obstacles are sent out-of-band and cached by mapId.
const MAP_CACHE = new Map(); // mapId -> obstacles[]
let lastMapId = 0;

// Ready state (server-authoritative via snapshots)
let selfReady = false;

// Connection state (used by lobby Join button)
let wsConnected = false;
let pendingJoin = null; // { name, roomCode?, avatarId }
let autoReadyAfterJoin = false; // Quick Play arms this
let currentRoomCode = null; // server-authoritative room code (null => public)
let inviteHintTimer = null;
let lastUrlRoomCode = undefined; // last code synchronized into URL

// --- Network banner / reconnect UX ---
let netState = 'connecting'; // connecting | open | authenticating | reconnecting | offline
let netRetryInMs = 0;
let updateRequired = false;
let updateMsg = null;

function setNetBanner(text, showRetry = true) {
  if (!netBannerEl || !netStatusTextEl) return;
  netStatusTextEl.textContent = text || '';
  netBannerEl.style.display = text ? 'flex' : 'none';
  if (btnRetryNetEl) btnRetryNetEl.style.display = showRetry ? 'inline-flex' : 'none';
}

function updateNetBanner() {
  // Show banner mainly when not fully ready (not connected/auth'd) OR when reconnecting during match.
  const online = (typeof navigator !== 'undefined' && 'onLine' in navigator) ? !!navigator.onLine : true;
  const st = netState;

  if (st === 'open') {
    // Still waiting for welcome/auth? Keep a small banner.
    setNetBanner('Connected. Authenticating...', false);
    return;
  }
  if (st === 'offline' || !online) {
    const s = netRetryInMs > 0 ? `Offline. Retry in ${Math.ceil(netRetryInMs / 1000)}s` : 'Offline. Waiting to reconnect...';
    setNetBanner(s, true);
    return;
  }
  if (st === 'reconnecting') {
    const s = netRetryInMs > 0 ? `Disconnected. Reconnecting in ${Math.ceil(netRetryInMs / 1000)}s` : 'Disconnected. Reconnecting...';
    setNetBanner(s, true);
    return;
  }
  if (st === 'connecting') {
    setNetBanner('Connecting...', true);
    return;
  }

  // Fully connected & welcomed -> hide.
  setNetBanner('', false);
}

function clearNetBannerIfReady() {
  // Called after welcome/join when the game is stable.
  if (wsConnected && welcomed) {
    netState = 'ready';
    netRetryInMs = 0;
    setNetBanner('', false);
  }
}

// --- Lobby profile (nickname + avatar) persisted in localStorage ---
const LS_NAME = 'be_try_arena_name';
const LS_AVATAR = 'be_try_arena_avatar';
const LS_BOTS = 'be_try_arena_bots_enabled'; // '1' or '0'
const LS_BOTS_COUNT = 'be_try_arena_bots_count'; // '2'|'4'|'6'
const LS_CID = 'be_try_arena_cid';
const LS_TOK = 'be_try_arena_tok';
const LS_AUTOJOIN = 'be_try_arena_autojoin'; // '1' once player joined at least once

function sanitizeBotsCount(v) {
  const n = (typeof v === 'number') ? (v | 0) : ((String(v ?? '').trim() | 0) || 0);
  if (n === 4) return 4;
  if (n === 6) return 6;
  return 2;
}

function clampAvatarId(v) {
  const n = Array.isArray(CONFIG.AVATARS) ? CONFIG.AVATARS.length : 0;
  if (!n) return 0;
  const id = (typeof v === 'number') ? (v | 0) : ((String(v ?? '').trim() | 0) || 0);
  if (id < 0) return 0;
  if (id >= n) return n - 1;
  return id;
}

function isAvatarUnlockedId(id) {
  const total = Array.isArray(CONFIG.AVATARS) ? CONFIG.AVATARS.length : 0;
  if (!total) return true;
  const unlocked = unlockedAvatarCountForLevel(statsProfile?.level ?? 1, total);
  const i = (id | 0);
  return i >= 0 && i < unlocked;
}

function clampUnlockedAvatarId(v) {
  const total = Array.isArray(CONFIG.AVATARS) ? CONFIG.AVATARS.length : 0;
  if (!total) return 0;
  const unlocked = unlockedAvatarCountForLevel(statsProfile?.level ?? 1, total);
  const id = clampAvatarId(v);
  if (id < unlocked) return id;
  return Math.max(0, unlocked - 1);
}

function updateProfileAvatarPreview() {
  if (!profileAvatarPreviewEl) return;
  const list = Array.isArray(CONFIG.AVATARS) ? CONFIG.AVATARS : ['🙂'];
  const id = clampAvatarId(selectedAvatarId);
  profileAvatarPreviewEl.textContent = list[id] ?? list[0] ?? '🙂';
}






function clampAuraId(v) {
  const n = Array.isArray(CONFIG.AURAS) ? CONFIG.AURAS.length : 0;
  if (!n) return 0;
  const id = (typeof v === 'number') ? (v | 0) : ((String(v ?? '').trim() | 0) || 0);
  if (id < 0) return 0;
  if (id >= n) return n - 1;
  return id;
}
function clampTrailId(v) {
  const n = Array.isArray(CONFIG.TRAILS) ? CONFIG.TRAILS.length : 0;
  if (!n) return 0;
  const id = (typeof v === 'number') ? (v | 0) : ((String(v ?? '').trim() | 0) || 0);
  if (id < 0) return 0;
  if (id >= n) return n - 1;
  return id;
}
function isAuraUnlockedId(id) {
  const n = Array.isArray(CONFIG.AURAS) ? CONFIG.AURAS.length : 0;
  if (!n) return true;
  const i = clampAuraId(id);
  return !!(statsProfile?.unlockedAuras && statsProfile.unlockedAuras[i]);
}
function isTrailUnlockedId(id) {
  const n = Array.isArray(CONFIG.TRAILS) ? CONFIG.TRAILS.length : 0;
  if (!n) return true;
  const i = clampTrailId(id);
  return !!(statsProfile?.unlockedTrails && statsProfile.unlockedTrails[i]);
}
function clampUnlockedAuraId(v) {
  const n = Array.isArray(CONFIG.AURAS) ? CONFIG.AURAS.length : 0;
  if (!n) return 0;
  const id = clampAuraId(v);
  return isAuraUnlockedId(id) ? id : 0;
}
function clampUnlockedTrailId(v) {
  const n = Array.isArray(CONFIG.TRAILS) ? CONFIG.TRAILS.length : 0;
  if (!n) return 0;
  const id = clampTrailId(v);
  return isTrailUnlockedId(id) ? id : 0;
}

function toast(text, ms = 2400) {
  try {
    const nowMs = performance.now();
    FX.killFeed.push({ text: String(text || ''), untilMs: nowMs + ms });
    capTo(FX.killFeed, lowFx ? 4 : 8);
  } catch {}
}

function refreshCosmeticsUI() {
  // Keep selection clamped to unlocked.
  selectedAuraId = clampUnlockedAuraId(selectedAuraId);
  selectedTrailId = clampUnlockedTrailId(selectedTrailId);

  const buildOptions = (names, isUnlocked, getHint) => {
    const unlocked = [];
    const locked = [];
    for (let i = 0; i < names.length; i++) {
      const ok = !!isUnlocked(i);
      const hint = (typeof getHint === 'function') ? (getHint(i) || '') : '';
      (ok ? unlocked : locked).push({ i, name: names[i], ok, hint });
    }
    let html = '';
    const addOpt = (o, lockedFlag) => {
      const label = lockedFlag ? `🔒 ${o.name}` : o.name;
      const dis = lockedFlag ? 'disabled' : '';
      const title = o.hint ? ` title="${escapeHtml(o.hint)}"` : '';
      html += `<option value="${o.i}" ${dis}${title}>${escapeHtml(label)}</option>`;
    };
    unlocked.forEach(o => addOpt(o, false));
    if (locked.length) {
      html += `<option value="" disabled>── Locked ──</option>`;
      locked.forEach(o => addOpt(o, true));
    }
    return html;
  };

  if (auraSelectEl) {
    const names = Array.isArray(CONFIG.AURAS) ? CONFIG.AURAS : [];
    auraSelectEl.innerHTML = buildOptions(names, isAuraUnlockedId, (i) => {
      // Cosmetic unlock hints are shown in the Achievements tab; keep titles minimal here.
      return '';
    });
    auraSelectEl.value = String(selectedAuraId);
  }

  if (trailSelectEl) {
    const names = Array.isArray(CONFIG.TRAILS) ? CONFIG.TRAILS : [];
    trailSelectEl.innerHTML = buildOptions(names, isTrailUnlockedId, () => '');
    trailSelectEl.value = String(selectedTrailId);
  }
}

function refreshAvatarButtonsUnlockState() {
  if (!avatarButtonsEl) return;
  const total = Array.isArray(CONFIG.AVATARS) ? CONFIG.AVATARS.length : 0;
  const unlocked = unlockedAvatarCountForLevel(statsProfile?.level ?? 1, total);

  for (const b of avatarButtonsEl.querySelectorAll('button[data-aid]')) {
    const id = Number(b.getAttribute('data-aid') || '0') | 0;
    const req = avatarRequiredLevelForIndex(id);
    const ok = (id >= 0 && id < unlocked);
    b.disabled = !ok;
    if (!ok) b.classList.add('locked'); else b.classList.remove('locked');
    b.title = ok ? `Avatar ${id + 1}` : `Locked until L${req}`;
  }

  // Ensure saved selection always stays within unlocked range.
  const clamped = clampUnlockedAvatarId(selectedAvatarId);
  if (clamped !== selectedAvatarId) {
    selectedAvatarId = clamped;
    try { localStorage.setItem(LS_AVATAR, String(selectedAvatarId)); } catch {}
  }
  for (const b of avatarButtonsEl.querySelectorAll('button[data-aid]')) {
    const bid = Number(b.getAttribute('data-aid') || '0') | 0;
    if (bid === selectedAvatarId) b.classList.add('sel'); else b.classList.remove('sel');
  }
  updateProfileAvatarPreview();
  refreshCosmeticsUI();

}

function isBotId(id) {
  return typeof id === 'string' && id.startsWith('b_');
}

let selectedAvatarId = clampUnlockedAvatarId(localStorage.getItem(LS_AVATAR));
let selectedAuraId = clampUnlockedAuraId(statsProfile?.auraId ?? 0);
let selectedTrailId = clampUnlockedTrailId(statsProfile?.trailId ?? 0);

// Lobby settings (server-authoritative, but we keep a local preference to prefill the toggle)
let desiredBotsEnabled = (localStorage.getItem(LS_BOTS) ?? '1') !== '0';
let desiredBotsCount = sanitizeBotsCount(localStorage.getItem(LS_BOTS_COUNT));
let serverBotsEnabled = true;
let serverBotsCount = 2;

function clampNick(s) {
  const t = String(s ?? '').trim();
  if (!t) return `P${Math.floor(Math.random() * 900 + 100)}`;
  return t.slice(0, 16);
}

function sanitizeRoomCodeInput(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/\s+/g, '');
  // UI sanitization: keep only A-Z/0-9 (server will validate length).
  return s.replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function isValidRoomCode(code) {
  return /^[A-Z0-9]{3,8}$/.test(String(code || '').trim());
}

function parseRoomCodeFromUrl() {
  try {
    const u = new URL(window.location.href);
    let raw = u.searchParams.get('code') || '';
    // Some hosts/embeds may place query params after the hash (e.g. "#/play?code=AB12").
    if (!raw) {
      const h = String(window.location.hash || '');
      const qPos = h.indexOf('?');
      if (qPos >= 0) {
        raw = new URLSearchParams(h.slice(qPos + 1)).get('code') || '';
      } else {
        const m = h.match(/(?:^|[?#&])code=([A-Za-z0-9]{1,32})/);
        if (m) raw = m[1];
      }
    }
    const code = sanitizeRoomCodeInput(raw);
    return isValidRoomCode(code) ? code : null;
  } catch {
    return null;
  }
}

// Prefill room code from invite URL, if present.
// This must happen early so auto-rejoin and the first Join click both use the correct code.
const _urlPrefillCode = parseRoomCodeFromUrl();
if (roomCodeInputEl && _urlPrefillCode) {
  roomCodeInputEl.value = _urlPrefillCode;
  lastUrlRoomCode = _urlPrefillCode;
}

function buildInviteUrl(code) {
  const c = sanitizeRoomCodeInput(code);
  if (!isValidRoomCode(c)) return null;
  const u = new URL(window.location.href);
  u.searchParams.set('code', c);
  return u.toString();
}

function syncUrlToRoomCode(code, force = false) {
  const c = (typeof code === 'string' && code) ? sanitizeRoomCodeInput(code) : null;
  const next = (c && isValidRoomCode(c)) ? c : null;
  if (!force && lastUrlRoomCode === next) return;

  try {
    const u = new URL(window.location.href);
    if (next) u.searchParams.set('code', next);
    else u.searchParams.delete('code');

    const path = u.pathname + (u.search || '') + (u.hash || '');
    history.replaceState(null, '', path);
    lastUrlRoomCode = next;
  } catch {
    // ignore
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

function setInviteHint(text, ms = 1400) {
  if (!inviteHintEl) return;
  inviteHintEl.textContent = text || '';
  if (inviteHintTimer) clearTimeout(inviteHintTimer);
  if (text) {
    inviteHintTimer = setTimeout(() => {
      if (inviteHintEl) inviteHintEl.textContent = '';
      inviteHintTimer = null;
    }, ms);
  }
}

function getPendingRoomCode() {
  const v = roomCodeInputEl ? sanitizeRoomCodeInput(roomCodeInputEl.value) : '';
  return isValidRoomCode(v) ? v : null;
}

function updateRoomCodeStatusUI() {
  const pending = getPendingRoomCode();
  const effective = currentRoomCode || pending || null;

  if (roomCodeStatusEl) roomCodeStatusEl.textContent = roomLabel(effective);

  // Show a quick escape hatch back to public lobby when a code is set (typed or joined).
  if (btnGoPublicEl) {
    const show = !!effective;
    btnGoPublicEl.style.display = show ? 'inline-flex' : 'none';
    btnGoPublicEl.disabled = !show || !wsConnected;
    btnGoPublicEl.style.opacity = (!show || !wsConnected) ? '0.6' : '1';
  }

  if (btnCopyInviteEl) {
    btnCopyInviteEl.disabled = !effective;
    btnCopyInviteEl.style.opacity = effective ? '1' : '0.6';
  }
}

function roomLabel(code) {
  return code ? `Private: ${code}` : 'Public lobby';
}

function weaponLabelById(id) {
  const wid = String(id || '').trim();
  const w = (CONFIG.WEAPONS && CONFIG.WEAPONS[wid]) ? CONFIG.WEAPONS[wid] : null;
  return w ? w.name : (wid ? wid.toUpperCase() : '');
}

function mapLabelById(id) {
  const mid = String(id || '').trim().toLowerCase();
  if (mid === 'default' || mid === 'classic') return 'Classic';
  if (mid === 'labyrinth' || mid === 'maze') return 'Labyrinth';
  if (mid === 'pillars') return 'Pillars';
  if (mid === 'cross' || mid === 'crossroads') return 'Cross';
  return mid ? mid.toUpperCase() : '';
}

function loadProfile() {
  const name = clampNick(localStorage.getItem(LS_NAME));
  const avatarId = clampUnlockedAvatarId(localStorage.getItem(LS_AVATAR));
  return { name, avatarId };
}


function saveProfile(name, avatarId) {
  localStorage.setItem(LS_NAME, name);
  localStorage.setItem(LS_AVATAR, String(clampUnlockedAvatarId(avatarId)));
  localStorage.setItem(LS_AUTOJOIN, '1');
}



// --- Persistent reconnect identity (cid + tok) ---
function randHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(a);
  } else {
    for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0;
  }
  let s = '';
  for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
  return s;
}

function loadIdentity() {
  let cid = String(localStorage.getItem(LS_CID) || '').trim();
  let tok = String(localStorage.getItem(LS_TOK) || '').trim();
  if (!cid) {
    cid = randHex(12);
    localStorage.setItem(LS_CID, cid);
  }
  if (!tok) {
    tok = randHex(18);
    localStorage.setItem(LS_TOK, tok);
  }
  return { cid, tok };
}

const IDENTITY = loadIdentity();
let welcomed = false; // true after server sends welcome (post-hello auth)

function setLobbyVisible(v) {
  if (!lobbyEl) return;
  lobbyEl.style.display = v ? 'flex' : 'none';
}

function updateReadyButton() {
  if (!btnReadyEl) return;
  btnReadyEl.textContent = selfReady ? 'Unready' : 'Ready';
  btnReadyEl.style.background = selfReady ? 'rgba(125,255,155,0.18)' : 'rgba(120,170,255,0.14)';
  btnReadyEl.style.borderColor = selfReady ? 'rgba(125,255,155,0.35)' : 'rgba(255,255,255,0.18)';
}

function updateBotsUI() {
  if (!botsToggleEl) return;
  const st = lastServerSS?.match?.state;
  // Allow changing preference before join; once joined, only editable in lobby.
  const canEdit = wsConnected && ((!hasJoined) || (hasJoined && st === 'lobby'));

  // Effective setting comes from server when available; fall back to local preference before first snapshot.
  const effective = (lastServerSS?.lobby && typeof lastServerSS.lobby.botsEnabled === 'boolean')
    ? !!lastServerSS.lobby.botsEnabled
    : !!desiredBotsEnabled;
  const count = (lastServerSS?.lobby && typeof lastServerSS.lobby.botsCount === 'number')
    ? sanitizeBotsCount(lastServerSS.lobby.botsCount | 0)
    : sanitizeBotsCount(desiredBotsCount);

  serverBotsEnabled = effective;
  serverBotsCount = count;

  botsToggleEl.checked = effective;
  botsToggleEl.disabled = !canEdit;
  botsToggleEl.style.opacity = canEdit ? '1' : '0.6';

  if (botsCountEl) {
    botsCountEl.value = String(count);
    botsCountEl.disabled = !canEdit;
    botsCountEl.style.opacity = canEdit ? '1' : '0.6';
  }

  if (botsLabelEl) {
    botsLabelEl.textContent = effective ? `${count} bots` : 'No bots';
  }
}

function safeCssColor(input) {
  const c = String(input ?? '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
  // allow a few common safe formats (optional)
  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(c)) return c;
  if (/^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|0?\.\d+|1(\.0+)?)\s*\)$/.test(c)) return c;
  return '#55aaff';
}

function initLobbyUI() {
  if (!nameInputEl || !btnJoinEl) return;
  const prof = loadProfile();
  nameInputEl.value = prof.name;
  selectedAvatarId = clampUnlockedAvatarId(prof.avatarId);
  updateProfileAvatarPreview();
  refreshAvatarButtonsUnlockState();
  refreshCosmeticsUI();
  if (roomCodeInputEl) {
    // Keep user input stable across reconnects; only sanitize current value.
    roomCodeInputEl.value = sanitizeRoomCodeInput(roomCodeInputEl.value);
  }
  updateRoomCodeStatusUI();
  if (joinErrorEl) joinErrorEl.textContent = '';

  // Prefill bots toggle (server value will override once we receive snapshots)
  if (botsToggleEl) {
    botsToggleEl.checked = !!desiredBotsEnabled;
  }
  if (botsCountEl) {
    botsCountEl.value = String(desiredBotsCount);
  }

  // First-time setup only (avoid duplicate listeners on reconnect)
  if (!lobbyInitialized) {

    // Avatar picker (emoji)
    const setAvatar = (id) => {
      selectedAvatarId = clampUnlockedAvatarId(id);
      localStorage.setItem(LS_AVATAR, String(selectedAvatarId));
      if (avatarButtonsEl) {
        for (const b of avatarButtonsEl.querySelectorAll('button[data-aid]')) {
          const bid = Number(b.getAttribute('data-aid') || '0') | 0;
          if (bid === selectedAvatarId) b.classList.add('sel'); else b.classList.remove('sel');
        }
      }
      updateProfileAvatarPreview();
    };

    if (avatarButtonsEl) {
      avatarButtonsEl.innerHTML = '';
      const list = Array.isArray(CONFIG.AVATARS) ? CONFIG.AVATARS : ['🙂'];
      list.forEach((emo, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn avbtn';
        b.textContent = emo;
        b.setAttribute('data-aid', String(i));

        const req = avatarRequiredLevelForIndex(i);
        const ok = isAvatarUnlockedId(i);
        b.disabled = !ok;
        if (!ok) b.classList.add('locked');
        b.title = ok ? `Avatar ${i + 1}` : `Locked until L${req}`;

        b.addEventListener('click', () => setAvatar(i));
        avatarButtonsEl.appendChild(b);
      });
      setAvatar(selectedAvatarId);
      refreshAvatarButtonsUnlockState();
      refreshCosmeticsUI();

      if (auraSelectEl) {
        auraSelectEl.addEventListener('change', () => {
          const v = clampUnlockedAuraId(Number(auraSelectEl.value) | 0);
          selectedAuraId = v;
          statsProfile.auraId = v;
          saveStatsProfile(statsProfile);
        });
      }
      if (trailSelectEl) {
        trailSelectEl.addEventListener('change', () => {
          const v = clampUnlockedTrailId(Number(trailSelectEl.value) | 0);
          selectedTrailId = v;
          statsProfile.trailId = v;
          saveStatsProfile(statsProfile);
        });
      }
    }

    const doJoin = () => {
      const name = clampNick(nameInputEl.value);
      saveProfile(name, selectedAvatarId);
      const roomCodeRaw = roomCodeInputEl ? roomCodeInputEl.value : '';
      const roomCode = sanitizeRoomCodeInput(roomCodeRaw);
      if (roomCodeInputEl && roomCode !== roomCodeRaw) roomCodeInputEl.value = roomCode;
      pendingJoin = { name, roomCode, avatarId: selectedAvatarId, auraId: selectedAuraId, trailId: selectedTrailId }; 
      if (joinErrorEl) joinErrorEl.textContent = '';

      // If not connected/auth'd yet, keep the user informed and auto-send once ready.
      if (!wsConnected || !welcomed) {
        if (lobbyInfoEl) lobbyInfoEl.textContent = 'Connecting/authenticating...';
        return;
      }
      ws.send({ t: 'join', name, avatarId: selectedAvatarId, auraId: selectedAuraId, trailId: selectedTrailId, roomCode: pendingJoin.roomCode || '', cid: IDENTITY.cid, tok: IDENTITY.tok, proto: PROTOCOL_VERSION });
      if (lobbyInfoEl) lobbyInfoEl.textContent = 'Joining...';
      // If we are already in the match, this is just an "apply" for cosmetics.
      if (hasJoined) {
        const st = lastServerSS?.match?.state;
        if (st === 'match') {
          setLobbyVisible(false);
          lobbyManual = false;
        }
      }
    };

    // Quick Play: public lobby + bots ON + auto-ready.
    const doQuickPlay = () => {
      // Force bots ON locally (fallback). Server is authoritative and will override if needed.
      desiredBotsEnabled = true;
      try { localStorage.setItem(LS_BOTS, '1'); } catch {}
      if (botsToggleEl) botsToggleEl.checked = true;

      // Quick Play always uses PUBLIC lobby (ignore any typed room code).
      if (roomCodeInputEl) {
        roomCodeInputEl.value = '';
        updateRoomCodeStatusUI();
      }

      autoReadyAfterJoin = true;

      const st = lastServerSS?.match?.state;
      // If we're already in a lobby, just ready up.
      if (wsConnected && hasJoined && st === 'lobby') {
        try { ws.send({ t: 'bots', v: true, n: desiredBotsCount }); } catch {}
        selfReady = true;
        updateReadyButton();
        try { ws.send({ t: 'ready', v: true }); } catch {}
        if (lobbyInfoEl) lobbyInfoEl.textContent = 'Quick Play: readying...';
        return;
      }

      doJoin();
      if (lobbyInfoEl) lobbyInfoEl.textContent = 'Quick Play: joining...';
    };

    btnJoinEl.addEventListener('click', doJoin);
    btnJoinLeftEl?.addEventListener('click', doJoin);
    btnQuickPlayEl?.addEventListener('click', doQuickPlay);
    btnGoPublicEl?.addEventListener('click', () => {
      // Clear code and immediately re-apply into public lobby.
      if (roomCodeInputEl) roomCodeInputEl.value = '';
      currentRoomCode = null;
      updateRoomCodeStatusUI();
      try { syncUrlToRoomCode(null); } catch {}
      doJoin();
    });
    nameInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });

    roomCodeInputEl?.addEventListener('input', () => {
      const v = sanitizeRoomCodeInput(roomCodeInputEl.value);
      if (v !== roomCodeInputEl.value) roomCodeInputEl.value = v;
      updateRoomCodeStatusUI();
    });
    roomCodeInputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });

btnCopyInviteEl?.addEventListener('click', async () => {
  const pending = getPendingRoomCode();
  const effective = currentRoomCode || pending || null;
  if (!effective) {
    setInviteHint('Enter a room code first');
    return;
  }
  const url = buildInviteUrl(effective);
  if (!url) {
    setInviteHint('Bad code (3–8 chars: A–Z / 0–9)');
    return;
  }
  const ok = await copyText(url);
  setInviteHint(ok ? 'Invite link copied' : 'Copy failed');
  // If user is preparing a code-room but isn't in it yet, keep URL in sync with what they copied.
  if (!currentRoomCode && pending) {
    syncUrlToRoomCode(pending, true);
  }
});


    // Ready / Unready toggle
    btnReadyEl?.addEventListener('click', () => {
      if (!wsConnected || !hasJoined) return;
      const next = !selfReady;
      selfReady = next;
      updateReadyButton();
      ws.send({ t: 'ready', v: next });
    });

    
    // Weapon vote (server-authoritative; editable only in lobby)
    // NOTE: on some browsers/event paths, e.target may be a Text node and not support .closest().
    // We also bind pointerdown to make voting feel instant and reliable on desktop.
    if (!weaponVoteBound && weaponVoteEl) {
      const findVoteButton = (e) => {
        const t = e?.target;
        if (t instanceof Element) {
          return t.closest('button[data-wid]');
        }
        const path = (typeof e?.composedPath === 'function') ? e.composedPath() : [];
        for (const n of path) {
          if (n instanceof Element) {
            const b = n.closest?.('button[data-wid]');
            if (b) return b;
          }
        }
        return null;
      };

      const onVote = (e) => {
        const btn = findVoteButton(e);
        if (!btn) return;
        const wid = (btn.getAttribute('data-wid') || '').trim();
        if (!wid) return;
        const st = lastServerSS?.match?.state;
        if (!wsConnected || !hasJoined || st !== 'lobby') return;

        // Dedup (some environments fire pointerdown + click for the same action).
        const nowMs = performance.now();
        if (_lastWeaponVoteWid === wid && (nowMs - _lastWeaponVoteSentAtMs) < 180) return;
        _lastWeaponVoteSentAtMs = nowMs;
        _lastWeaponVoteWid = wid;

        optimisticWeaponVote = wid;
        ws.send({ t: 'voteWeapon', weaponId: wid });
        // Prevent accidental text selection or other default behaviors.
        if (e?.preventDefault) e.preventDefault();
        if (e?.stopPropagation) e.stopPropagation();
      };

      weaponVoteEl.addEventListener('pointerdown', onVote, { passive: false });
      weaponVoteEl.addEventListener('click', onVote);
      weaponVoteBound = true;
    }

    // Map vote (server-authoritative; editable only in lobby)
    if (!mapVoteBound && mapVoteEl) {
      const findVoteButton = (e) => {
        const t = e?.target;
        if (t instanceof Element) {
          return t.closest('button[data-mid]');
        }
        const path = (typeof e?.composedPath === 'function') ? e.composedPath() : [];
        for (const n of path) {
          if (n instanceof Element) {
            const b = n.closest?.('button[data-mid]');
            if (b) return b;
          }
        }
        return null;
      };

      const onVote = (e) => {
        const btn = findVoteButton(e);
        if (!btn) return;
        const mid = (btn.getAttribute('data-mid') || '').trim();
        if (!mid) return;
        const st = lastServerSS?.match?.state;
        if (!wsConnected || !hasJoined || st !== 'lobby') return;

        // Dedup (some environments fire pointerdown + click for the same action).
        const nowMs = performance.now();
        if (_lastMapVoteMid === mid && (nowMs - _lastMapVoteSentAtMs) < 180) return;
        _lastMapVoteSentAtMs = nowMs;
        _lastMapVoteMid = mid;

        optimisticMapVote = mid;
        ws.send({ t: 'voteMap', mapId: mid });
        if (e?.preventDefault) e.preventDefault();
        if (e?.stopPropagation) e.stopPropagation();
      };

      mapVoteEl.addEventListener('pointerdown', onVote, { passive: false });
      mapVoteEl.addEventListener('click', onVote);
      mapVoteBound = true;
    }

// Bots enabled/disabled (server-authoritative; editable only in lobby)
    const pushBotsPrefToServer = () => {
      const st = lastServerSS?.match?.state;
      if (wsConnected && hasJoined && st === 'lobby') {
        try { ws.send({ t: 'bots', v: desiredBotsEnabled, n: desiredBotsCount }); } catch {}
      }
    };

    // Bots enabled/disabled (server-authoritative; editable only in lobby)
    botsToggleEl?.addEventListener('change', () => {
      desiredBotsEnabled = !!botsToggleEl.checked;
      try { localStorage.setItem(LS_BOTS, desiredBotsEnabled ? '1' : '0'); } catch {}
      pushBotsPrefToServer();

      // Optimistic UI update: we may not receive the next snapshot instantly.
      serverBotsEnabled = desiredBotsEnabled;
      if (lastServerSS?.lobby) lastServerSS.lobby.botsEnabled = desiredBotsEnabled;
      updateBotsUI();
    });

    // Bot count (2/4/6)
    botsCountEl?.addEventListener('change', () => {
      desiredBotsCount = sanitizeBotsCount(botsCountEl.value);
      try { localStorage.setItem(LS_BOTS_COUNT, String(desiredBotsCount)); } catch {}
      // Optimistically update label even if bots are off (keeps selection visible).
      serverBotsCount = desiredBotsCount;
      if (lastServerSS?.lobby) lastServerSS.lobby.botsCount = desiredBotsCount;
      pushBotsPrefToServer();
      updateBotsUI();
    });

    lobbyInitialized = true;
  }

  const joinLabel = hasJoined ? 'Apply' : 'Join';
  btnJoinEl.textContent = joinLabel;
  if (btnJoinLeftEl) btnJoinLeftEl.textContent = joinLabel;

  if (btnReadyEl) {
    btnReadyEl.style.display = hasJoined ? 'inline-flex' : 'none';
    btnReadyEl.disabled = !wsConnected || !hasJoined;
    btnReadyEl.style.opacity = (!wsConnected || !hasJoined) ? '0.6' : '1';
    updateReadyButton();
  }

  updateBotsUI();

  // Disable Join until websocket is connected.
  const joinDisabled = !wsConnected;
  btnJoinEl.disabled = joinDisabled;
  btnJoinEl.style.opacity = joinDisabled ? '0.6' : '1';
  if (btnJoinLeftEl) {
    btnJoinLeftEl.disabled = joinDisabled;
    btnJoinLeftEl.style.opacity = joinDisabled ? '0.6' : '1';
  }

  // Disable Quick Play until websocket is connected.
  if (btnQuickPlayEl) {
    btnQuickPlayEl.disabled = !wsConnected;
    btnQuickPlayEl.style.opacity = wsConnected ? '1' : '0.6';
  }

  setLobbyVisible(true);

  // First-time onboarding overlay (portal friendly). Safe to call on every init.
  maybeShowHelpOverlay();
}

function updateLobbyFromSS(ss) {
  if (!ss) return;

  const st = ss.match?.state;
  const players = Array.isArray(ss.players) ? ss.players : [];
  const lobby = ss.lobby || null;
  const maxPlayers = (lobby && typeof lobby.maxPlayers === 'number' && lobby.maxPlayers > 0) ? lobby.maxPlayers : null;

  // Room code status (server-authoritative).
  if (typeof ss.roomCode === 'string') {
    currentRoomCode = ss.roomCode || null;
    updateRoomCodeStatusUI();
    // Only sync URL once we are actually in a room (avoid wiping ?code before join).
    if (hasJoined) syncUrlToRoomCode(currentRoomCode);
  }

  const me = (selfId ? players.find(p => p.id === selfId) : null) || null;

  // Infer role from presence in sim.
  if (!hasJoined) {
    selfRole = 'none';
  } else if (me) {
    selfRole = 'player';
    joinLocked = false;
  } else if (st === 'match' || st === 'results') {
    selfRole = 'spectator';
  }

  // Sync selfReady from server snapshot (authoritative).
  if (me && typeof me.ready === 'boolean') {
    selfReady = me.ready;
  }

  // Auto-show lobby when not joined or when server is in lobby state.
  if (!hasJoined) {
    if (btnReadyEl) btnReadyEl.style.display = 'none';
    setLobbyVisible(true);
    lobbyManual = false;
  } else if (st === 'lobby') {
    if (btnReadyEl) btnReadyEl.style.display = 'inline-flex';
    setLobbyVisible(true);
    lobbyManual = false;
  } else if (st === 'match') {
    if (!lobbyManual) setLobbyVisible(false);
  } else if (st === 'results') {
    if (!lobbyManual) setLobbyVisible(false);
  }

  // Update lobby info line.
  if (lobbyInfoEl) {
    if (!wsConnected) {
      lobbyInfoEl.textContent = 'Connecting/authenticating...';
    } else if (!hasJoined) {
      const cap = maxPlayers ? `/${maxPlayers}` : '';
      lobbyInfoEl.textContent = `${roomLabel(currentRoomCode)} • Connected. Players: ${players.length}${cap}. Enter nickname and press Join.`;
    } else if (st === 'lobby') {
      const botText = serverBotsEnabled ? `Bots: ON (${serverBotsCount})` : 'Bots: OFF';
      const cap = maxPlayers ? `/${maxPlayers}` : '';
      lobbyInfoEl.textContent = `${roomLabel(currentRoomCode)} • Players: ${players.length}${cap} • Ready up to start. • ${botText}`;
    } else {
      const rem = ss.match?.remaining ?? 0;
      const elapsed = ss.match?.elapsed ?? Math.max(0, (CONFIG.MATCH_DURATION_SEC - rem));
      const stage = stormStageFromElapsed(elapsed);
      const wNow = ss.match?.weaponId ? `Weapon: ${weaponLabelById(ss.match.weaponId)}` : '';
      const spec = (hasJoined && !me && (st === 'match')) ? ' • SPECTATING (join next round)' : '';
      const cap = maxPlayers ? `/${maxPlayers}` : '';
      lobbyInfoEl.textContent = `${roomLabel(currentRoomCode)} • Players: ${players.length}${cap} • Time: ${formatTime(rem)} • Stage: ${stage}/5 • ${wNow}${spec}`;
    }
  }

  // Update lobby status (readyCount + countdown)
  if (lobbyStatusEl) {
    if (!hasJoined) {
      lobbyStatusEl.textContent = '';
    } else if (st === 'lobby') {
      const minReady = lobby?.minReady ?? 2;
      const readyCount = lobby?.readyCount ?? players.filter(p => p.ready).length;
      const cd = typeof lobby?.countdown === 'number' ? lobby.countdown : null;
      if (cd != null) {
        lobbyStatusEl.textContent = `Auto-start in ${Math.max(0, Math.ceil(cd))}s  •  Ready ${readyCount}/${minReady}`;
      } else {
        lobbyStatusEl.textContent = `Need ${minReady}+ ready to start  •  Ready ${readyCount}/${minReady}`;
      }
    } else {
      lobbyStatusEl.textContent = '';
    }
  }


  // Weapon vote UI
  if (weaponVoteEl && weaponVoteStatusEl) {
    if (!wsConnected) {
      weaponVoteEl.innerHTML = '';
      weaponVoteStatusEl.textContent = '—';
    } else if (!hasJoined || st !== 'lobby') {
      weaponVoteEl.innerHTML = '';
      weaponVoteStatusEl.textContent = '—';
    } else {
      const pool = lobby?.weaponPool ?? CONFIG.MATCH_WEAPON_POOL ?? ['pistol'];
      const votes = lobby?.weaponVotes ?? {};
      const meP = players.find(p => p.id === selfId) || null;
      const myVote = meP?.voteWeaponId ?? optimisticWeaponVote;

      // If server confirmed our vote, clear optimistic hint
      if (optimisticWeaponVote && meP?.voteWeaponId === optimisticWeaponVote) {
        optimisticWeaponVote = null;
      }

      const cd = typeof lobby?.countdown === 'number' ? lobby.countdown : null;
      const next = ss.match?.nextWeaponId || null;

      if (next) {
        weaponVoteStatusEl.textContent = (cd != null) ? `Locks in: ${weaponLabelById(next)}` : `Leading: ${weaponLabelById(next)}`;
      } else {
        weaponVoteStatusEl.textContent = 'Vote now';
      }

      let html = '';
      for (const wid of pool) {
        const c = votes[wid] ?? 0;
        const sel = wid === myVote;
        html += `<button class="btn wbtn${sel ? ' sel' : ''}" data-wid="${wid}">${weaponLabelById(wid)}<span class="count">(${c})</span></button>`;
      }
      weaponVoteEl.innerHTML = html;

      const total = pool.reduce((a, w) => a + (votes[w] ?? 0), 0);
    }
  }

  // Map vote UI
  if (mapVoteEl && mapVoteStatusEl) {
    if (!wsConnected) {
      mapVoteEl.innerHTML = '';
      mapVoteStatusEl.textContent = '—';
    } else if (!hasJoined || st !== 'lobby') {
      mapVoteEl.innerHTML = '';
      mapVoteStatusEl.textContent = '—';
    } else {
      const pool = lobby?.mapPool ?? ['default', 'labyrinth'];
      const votes = lobby?.mapVotes ?? {};
      const meP = players.find(p => p.id === selfId) || null;
      const myVote = meP?.voteMapId ?? optimisticMapVote;

      // If server confirmed our vote, clear optimistic hint
      if (optimisticMapVote && meP?.voteMapId === optimisticMapVote) {
        optimisticMapVote = null;
      }

      const cd = typeof lobby?.countdown === 'number' ? lobby.countdown : null;
      const next = ss.match?.nextMapVariant || null;

      if (next) {
        mapVoteStatusEl.textContent = (cd != null) ? `Locks in: ${mapLabelById(next)}` : `Leading: ${mapLabelById(next)}`;
      } else {
        mapVoteStatusEl.textContent = 'Vote now';
      }

      let html = '';
      for (const mid of pool) {
        const c = votes[mid] ?? 0;
        const sel = String(mid) === String(myVote);
        html += `<button class="btn mbtn${sel ? ' sel' : ''}" data-mid="${mid}">${mapLabelById(mid)}<span class="count">(${c})</span></button>`;
      }
      mapVoteEl.innerHTML = html;
    }
  }

  // Player list (with ready status)
  if (lobbyPlayersEl) {
    if (!players.length) {
      lobbyPlayersEl.innerHTML = '';
    } else {
      const list = [...players].sort((a, b) => {
        const ba = isBotId(a.id) ? 1 : 0;
        const bb = isBotId(b.id) ? 1 : 0;
        if (ba !== bb) return ba - bb; // humans first
        const ra = a.ready ? 0 : 1;
        const rb = b.ready ? 0 : 1;
        if (ra !== rb) return ra - rb; // ready first
        return String(a.name).localeCompare(String(b.name));
      });

      let html = '<div style="opacity:0.9; margin-bottom:4px;"><b>Players</b></div>';
      html += '<div style="display:flex; flex-direction:column; gap:4px;">';
      for (const p of list) {
        const emo = Array.isArray(CONFIG.AVATARS) ? (CONFIG.AVATARS[clampAvatarId(p.avatarId)] || '') : '';
        const tag = p.ready ? '<span style="opacity:0.9;">✅ ready</span>' : '<span style="opacity:0.65;">…</span>';
        const you = (p.id === selfId);
        const bot = isBotId(p.id);
        const badges = [
          you ? '<span style="opacity:0.9; font-size:12px; margin-left:8px;">YOU</span>' : '',
          bot ? '<span style="opacity:0.75; font-size:12px; margin-left:8px;">BOT</span>' : ''
        ].filter(Boolean).join('');
        html += `<div style="display:flex; justify-content:space-between; align-items:center;">`;
        html += `<div>${emo ? `<span style="margin-right:6px;">${emo}</span>` : ''}${escapeHtml(p.name || p.id)}${badges}</div><div>${tag}</div>`;
        html += '</div>';
      }
      html += '</div>';
      lobbyPlayersEl.innerHTML = html;
    }
  }

  updateBotsUI();
  updateReadyButton();
}

function handleMatchTransitions(ss) {
  const st = ss?.match?.state || 'none';
  if (st === 'results' && lastMatchState !== 'results') {
    onMatchEnded(ss);
  }
  lastMatchState = st;
}

function onMatchEnded(ss) {
  if (!ss || !Array.isArray(ss.players) || !selfId) return;
  const mapId = (ss.mapId | 0) || 0;
  if (mapId <= 0) return;
  const key = `m${mapId}`;
  if (lastMatchXpKey === key) return;
  lastMatchXpKey = key;

  const self = ss.players.find(p => p.id === selfId);
  if (!self) return;

  const top = [...ss.players].sort((a, b) => (b.score - a.score));
  const scoreWin = (top[0] && top[0].id === selfId);
  const lastWin = !!(ss?.match && ss.match.winnerId && ss.match.winnerId === selfId);

  const kills = (self.kills | 0) || 0;
  const deaths = (self.deaths | 0) || 0;
  const assists = (self.assists | 0) || 0;
  const streak = (self.streak | 0) || 0;
  const score = (self.score | 0) || 0;

  // Portal-friendly XP gain: simple, readable, no gameplay impact.
  // We reward BR-winning (LastWin) slightly more than score-leading.
  const xpGain = Math.max(1, Math.floor(score / 50) + kills * 5 + (scoreWin ? 10 : 0) + (lastWin ? 25 : 0));
  lastMatchXpGain = xpGain;

  const buffsThisMatch = Math.max(0, (self.bc | 0) || 0);

  statsProfile.matches = Math.max(0, (statsProfile.matches | 0) || 0) + 1;
  if (scoreWin) statsProfile.scoreWins = Math.max(0, (statsProfile.scoreWins | 0) || 0) + 1;
  if (lastWin) statsProfile.lastWins = Math.max(0, (statsProfile.lastWins | 0) || 0) + 1;

  // Consecutive streaks (client-side; based on authoritative end-of-match results)
  if (scoreWin) statsProfile.scoreWinStreak = Math.max(0, (statsProfile.scoreWinStreak | 0) || 0) + 1;
  else statsProfile.scoreWinStreak = 0;
  statsProfile.bestScoreWinStreak = Math.max((statsProfile.bestScoreWinStreak | 0) || 0, (statsProfile.scoreWinStreak | 0) || 0);

  if (lastWin) statsProfile.lastWinStreak = Math.max(0, (statsProfile.lastWinStreak | 0) || 0) + 1;
  else statsProfile.lastWinStreak = 0;
  statsProfile.bestLastWinStreak = Math.max((statsProfile.bestLastWinStreak | 0) || 0, (statsProfile.lastWinStreak | 0) || 0);

  statsProfile.bestBuffsInMatch = Math.max((statsProfile.bestBuffsInMatch | 0) || 0, buffsThisMatch);

  // One-time achievement flags (completion tracked, rewards claimed manually).
  if (!statsProfile.achDone || typeof statsProfile.achDone !== 'object') statsProfile.achDone = {};
  if (lastWin && kills === 0) statsProfile.achDone.pacifist = 1;

  // Backwards-compat (legacy fields)
  statsProfile.wins = Math.max(0, (statsProfile.wins | 0) || 0) + (scoreWin ? 1 : 0);
  statsProfile.winStreak = (statsProfile.scoreWinStreak | 0) || 0;
  statsProfile.bestWinStreak = Math.max((statsProfile.bestWinStreak | 0) || 0, (statsProfile.winStreak | 0) || 0);
  statsProfile.kills += kills;
  statsProfile.deaths += deaths;
  statsProfile.assists += assists;
  const peakStreak = (matchPeakMapId === mapId && matchPeakStreak > 0) ? matchPeakStreak : streak;
  statsProfile.bestStreak = Math.max(statsProfile.bestStreak, peakStreak);
  statsProfile.xp += xpGain;
  recomputeStatsProfileLevel(statsProfile);
  normalizeStatsProfile(statsProfile);
  saveStatsProfile(statsProfile);
  renderStatsProfileLine();
  refreshAvatarButtonsUnlockState();
  try { refreshAchievementsUI(); } catch {}

  // Optional portal monetization hook: show an interstitial at match end.
  // This is a no-op unless the portal injects window.__BT_ADS__.
  if (isAdsAvailable()) {
    maybeShowInterstitial({ reason: 'match_end', mapId });
  }
}

// Snapshot interpolation buffer (reduces jitter). We keep a small render delay
// behind server time for smooth interpolation; for LAN this can be much lower.
const SNAP_BUFFER = [];
const MAX_SNAPS = 80;
let interpDelaySec = 0.06; // dynamic (will adapt using ping RTT)
let interpBaseSec = 0.06;  // RTT-based baseline; auto-tuned further using buffer headroom
let clockOffset = 0; // serverTime - localTime (sec), smoothed

// RTT-based adaptation (client pings server; we keep a small safety margin).
let rttMs = 0;
let rttJitterMs = 0;
let afkKickAtMs = 0;
let pingSeq = 1;
const pendingPings = new Map(); // seq -> sentAtMs
let pingTimer = null;

function computeBaseInterpDelaySec() {
  // Render delay ~= half-RTT + jitter margin, clamped.
  // Mobile devices are more jittery (Wi‑Fi + GC), so keep a slightly bigger buffer there.
  const halfRtt = rttMs * 0.5;
  const margin = (IS_MOBILE ? 18 : 12) + rttJitterMs * (IS_MOBILE ? 1.0 : 0.8);
  const baseMs = IS_MOBILE ? 42 : 30;
  const targetMs = baseMs + halfRtt + margin;

  const minDelay = IS_MOBILE ? 0.05 : 0.04;
  const maxDelay = IS_MOBILE ? 0.18 : 0.12;
  return clamp(targetMs / 1000, minDelay, maxDelay);
}

function updateInterpDelay() {
  interpBaseSec = computeBaseInterpDelaySec();
  // smooth changes so it doesn't oscillate
  interpDelaySec = interpDelaySec * 0.85 + interpBaseSec * 0.15;
}

function autoTuneInterpDelay(nowLocalSec) {
  // If our render target gets too close to the newest snapshot, we start to "freeze then jump"
  // under GC/Wi‑Fi jitter. Add a small extra safety buffer based on headroom.
  if (SNAP_BUFFER.length < 2) return;

  const serverNow = nowLocalSec + clockOffset;
  const last = SNAP_BUFFER[SNAP_BUFFER.length - 1]?.ss;
  const first = SNAP_BUFFER[0]?.ss;
  const lastST = (last && typeof last.serverTime === 'number') ? last.serverTime : 0;
  const firstST = (first && typeof first.serverTime === 'number') ? first.serverTime : lastST;
  const bufSpan = Math.max(0, lastST - firstST);
  const targetST = serverNow - interpDelaySec;
  const headroom = lastST - targetST; // how far behind newest snapshot we are

  // Desired headroom: higher on mobile and under WAN jitter.
  // We intentionally bias higher than LAN defaults to avoid the characteristic
  // "micro-freeze then jump" feel when packets arrive in uneven bursts.
  const desiredBase = IS_MOBILE ? 0.22 : 0.10;
  const desiredJit = Math.min(IS_MOBILE ? 0.75 : 0.30, (rttJitterMs / 1000) * (IS_MOBILE ? 1.05 : 0.85));
  const desired = desiredBase + desiredJit;
  const deficit = desired - headroom;

  let extra = 0;
  if (deficit > 0) extra += clamp(deficit * 0.90, 0, IS_MOBILE ? 0.70 : 0.35);

  // If the buffer span is tiny, we don't have enough history to interpolate smoothly.
  const spanNeed = IS_MOBILE ? 0.14 : 0.10;
  const spanDef = spanNeed - bufSpan;
  if (spanDef > 0) extra += clamp(spanDef * 0.55, 0, IS_MOBILE ? 0.16 : 0.10);

  const minDelay = IS_MOBILE ? 0.08 : 0.05;
  const maxDelay = IS_MOBILE ? 0.90 : 0.28;
  const target = clamp(interpBaseSec + extra, minDelay, maxDelay);

  // Gentle drift (avoid oscillation)
  interpDelaySec = interpDelaySec * 0.90 + target * 0.10;

  // Perf overlay inputs
  PERF.bufLen = SNAP_BUFFER.length;
  PERF.bufSpanSec = bufSpan;
  PERF.headroomSec = headroom;
  PERF.snapAgeSec = Math.max(0, serverNow - lastST);
}

// Local prediction for OUR player only (keeps controls snappy)
let predSelf = null;
let lastFrameAt = performance.now() / 1000;
let lastHudUpdateMs = 0;


// Persistent WS override for hosted builds (GitHub Pages etc.).
// You can pass ?ws=wss://your-server.example.com (URL-encoded) and it will be stored in localStorage.
const LS_WS_URL_KEY = 'pixel_pvp_ws_url';

function sanitizeWsUrl(v) {
  const s = (v ?? '').toString().trim();
  if (!s) return '';
  if (s.startsWith('ws://') || s.startsWith('wss://')) return s;
  return '';
}

function resolveWsUrl() {
  // 1) Runtime override (useful for mirrors without rebuilding):
  //    window.__BE_TRY_WS_URL__ = 'wss://yourdomain.com/ws'
  try {
    const rt = (typeof window !== 'undefined' && window.__BE_TRY_WS_URL__) ? String(window.__BE_TRY_WS_URL__).trim() : '';
    if (rt) return rt;
  } catch {}

  // 1b) URL param override (for hosted builds without rebuilding):
  //     https://<site>/?ws=wss%3A%2F%2Fyour-server.example.com%2Fws
  //     The value is stored in localStorage so you only need to do it once.
  try {
    const p = new URLSearchParams(location.search).get('ws');
    if (p) {
      const qp = sanitizeWsUrl(p);
      if (qp) {
        try { localStorage.setItem(LS_WS_URL_KEY, qp); } catch {}
        return qp;
      }
      // Special: ?ws=clear clears the stored override.
      if (String(p).trim().toLowerCase() === 'clear') {
        try { localStorage.removeItem(LS_WS_URL_KEY); } catch {}
      }
    }
  } catch {}

  // 1c) Stored override (from previous ?ws=...)
  try {
    const stored = sanitizeWsUrl(localStorage.getItem(LS_WS_URL_KEY));
    if (stored) return stored;
  } catch {}

  // 2) Build-time config via Vite env:
  //    VITE_WS_URL=ws://localhost:8080
  //    VITE_WS_URL=wss://yourdomain.com/ws
  try {
    const envUrl = (import.meta.env?.VITE_WS_URL ?? '').trim();
    if (envUrl) return envUrl;
  } catch {}

  // 3) Smart default:
  //    - in dev (localhost or non-standard port): ws://<host>:8080
  //    - in prod (same host via reverse proxy):  wss://<host>/ws  (or ws:// on http)
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || (location.port && location.port !== '80' && location.port !== '443');
  return isDev ? `${proto}://${location.hostname}:8080` : `${proto}://${location.host}/ws`;
}

const ws = new WSClient(resolveWsUrl());
wsRef = ws;

// Retry button for flaky connections
btnRetryNetEl?.addEventListener('click', () => {
  if (updateRequired) {
    // Cached/outdated client; a reload is the only safe action.
    try { location.reload(); } catch { /* ignore */ }
    return;
  }
  if (lobbyInfoEl) lobbyInfoEl.textContent = 'Retrying connection...';
  if (ws.retryNow) ws.retryNow();
  else ws.connect();
});

window.addEventListener('online', () => {
  // Network came back - reconnect immediately.
  if (ws.retryNow) ws.retryNow();
  netState = 'connecting';
  netRetryInMs = 0;
  updateNetBanner();
});
window.addEventListener('offline', () => {
  netState = 'offline';
  netRetryInMs = ws.getRetryInMs ? ws.getRetryInMs() : 0;
  updateNetBanner();
});
ws.on('open', () => {
  netState = 'open';
  netRetryInMs = 0;
  updateNetBanner();
  wsConnected = true;
  welcomed = false;
  if (lobbyInfoEl) lobbyInfoEl.textContent = 'Connected. Authenticating...';
  // Keep Join disabled until we receive a stable welcome id (post-hello auth).
  if (btnJoinEl) {
    btnJoinEl.disabled = true;
    btnJoinEl.style.opacity = '0.6';
  }
  if (btnJoinLeftEl) {
    btnJoinLeftEl.disabled = true;
    btnJoinLeftEl.style.opacity = '0.6';
  }

  // Authenticate / bind stable player id for reconnects.
  ws.send({ t: 'hello', cid: IDENTITY.cid, tok: IDENTITY.tok, proto: PROTOCOL_VERSION });

  initLobbyUI();

  // Start RTT pings (helps reduce interpolation delay on LAN).
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    const c = pingSeq++;
    pendingPings.set(c, performance.now());
    ws.send({ t: 'ping', c });
    // keep map small
    if (pendingPings.size > 20) {
      const first = pendingPings.keys().next().value;
      pendingPings.delete(first);
    }
  }, 500);
});

ws.on('authFail', (msg) => {
  // msg: {t:'authFail', reason}
  if (msg?.reason === 'update_required') {
    updateRequired = true;
    updateMsg = msg;
    // Show a clear banner and convert Retry -> Reload.
    if (btnRetryNetEl) btnRetryNetEl.textContent = 'Reload';
    const serverProto = msg?.serverProto ?? '?';
    const clientProto = msg?.clientProto ?? '?';
    const serverBuild = msg?.serverBuild ?? '?';
    setNetBanner(`Update required. Refresh the page. (server ${serverBuild}, proto ${serverProto}; you proto ${clientProto})`, true);
    if (lobbyInfoEl) lobbyInfoEl.textContent = 'Update required. Please reload the page.';
    if (btnJoinEl) {
      btnJoinEl.disabled = true;
      btnJoinEl.style.opacity = '0.6';
    }
    if (btnJoinLeftEl) {
      btnJoinLeftEl.disabled = true;
      btnJoinLeftEl.style.opacity = '0.6';
    }
    return;
  }
  // Legacy behavior:
  localStorage.removeItem(LS_CID);
  localStorage.removeItem(LS_TOK);
  if (lobbyInfoEl) lobbyInfoEl.textContent = 'Auth failed. Please reload the page.';
});
ws.on('close', () => {
  if (updateRequired) {
    // Keep the update banner visible; do not spam reconnect text.
    return;
  }
  netState = 'reconnecting';
  netRetryInMs = ws.getRetryInMs ? ws.getRetryInMs() : 0;
  updateNetBanner();
  wsConnected = false;
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  pendingPings.clear();
  if (lobbyInfoEl) lobbyInfoEl.textContent = 'Disconnected. Reconnecting...';
  if (btnJoinEl) {
    btnJoinEl.disabled = true;
    btnJoinEl.style.opacity = '0.6';
  }
  if (btnJoinLeftEl) {
    btnJoinLeftEl.disabled = true;
    btnJoinLeftEl.style.opacity = '0.6';
  }
  initLobbyUI();
});

ws.on('status', (msg) => {
  // msg: {t:'status', state:'connecting'|'open'|'reconnecting'|'offline', retryInMs?}
  if (msg?.state === 'connecting') netState = 'connecting';
  else if (msg?.state === 'open') netState = 'open';
  else if (msg?.state === 'offline') netState = 'offline';
  else if (msg?.state === 'reconnecting') netState = 'reconnecting';
  netRetryInMs = (typeof msg?.retryInMs === 'number') ? msg.retryInMs : (ws.getRetryInMs ? ws.getRetryInMs() : 0);
  updateNetBanner();
});

ws.on('pong', (msg) => {
  // msg: {t:'pong', c, s}
  const c = msg?.c;
  const sentAt = pendingPings.get(c);
  if (sentAt == null) return;
  pendingPings.delete(c);
  const nowMs = performance.now();
  const sample = Math.max(0, nowMs - sentAt);
  // Smooth RTT and estimate jitter
  const prev = rttMs || sample;
  rttMs = prev * 0.85 + sample * 0.15;
  const jit = Math.abs(sample - prev);
  rttJitterMs = rttJitterMs * 0.85 + jit * 0.15;
  updateInterpDelay();
});
ws.on('welcome', (msg) => {
  // Reset update state on successful handshake.
  updateRequired = false;
  updateMsg = null;
  if (btnRetryNetEl) btnRetryNetEl.textContent = 'Retry';
  welcomed = true;
  // Auth handshake finished.
  netState = 'ready';
  netRetryInMs = 0;
  updateNetBanner();
  selfId = msg.id;
  hasJoined = false;
  selfRole = 'none';
  joinLocked = false;
  predSelf = null;
  // Reset cached maps on reconnect (server may have restarted / new map ids).
  MAP_CACHE.clear();
  lastMapId = 0;
  // Reset event dedupe on reconnect / new session
  lastEventSeqSeen = 0;
  SEEN_EVENTS.clear();
  if (typeof msg.serverTime === 'number') {
    const now = performance.now() / 1000;
    clockOffset = msg.serverTime - now;
  }
  // Ensure lobby UI exists (we keep the player out of the match until join)
  initLobbyUI();

  // Enable Join after auth handshake.
  if (btnJoinEl) {
    btnJoinEl.disabled = false;
    btnJoinEl.style.opacity = '1';
  }
  if (btnJoinLeftEl) {
    btnJoinLeftEl.disabled = false;
    btnJoinLeftEl.style.opacity = '1';
  }

  // Auto-rejoin if we joined before (or if user clicked Join while reconnecting).
  if (!pendingJoin && localStorage.getItem(LS_AUTOJOIN) === '1') {
    const prof = loadProfile();
    pendingJoin = { name: prof.name, avatarId: clampUnlockedAvatarId(prof.avatarId), auraId: clampUnlockedAuraId(statsProfile?.auraId ?? 0), trailId: clampUnlockedTrailId(statsProfile?.trailId ?? 0), roomCode: sanitizeRoomCodeInput(roomCodeInputEl ? roomCodeInputEl.value : '') };
  }
  if (pendingJoin && !hasJoined) {
    ws.send({ t: 'join', name: pendingJoin.name, avatarId: clampUnlockedAvatarId(pendingJoin.avatarId), auraId: clampUnlockedAuraId(pendingJoin.auraId ?? 0), trailId: clampUnlockedTrailId(pendingJoin.trailId ?? 0), roomCode: pendingJoin.roomCode || '', cid: IDENTITY.cid, tok: IDENTITY.tok, proto: PROTOCOL_VERSION });
    if (lobbyInfoEl) lobbyInfoEl.textContent = 'Rejoining...';
  } else {
    if (lobbyInfoEl) lobbyInfoEl.textContent = 'Connected. Enter nickname and press Join.';
  }
});

ws.on('authFail', (msg) => {
  // Server can use authFail for protocol gating (cached/outdated client).
  if (msg?.reason === 'update_required') {
    updateRequired = true;
    updateMsg = msg;
    // Swap Retry -> Reload.
    if (btnRetryNetEl) btnRetryNetEl.textContent = 'Reload';
    const sProto = (typeof msg.serverProto === 'number') ? msg.serverProto : null;
    const cProto = (typeof msg.clientProto === 'number') ? msg.clientProto : null;
    const sBuild = msg.serverBuild || '';
    const details = sProto != null ? ` (server proto ${sProto}${cProto != null ? `, client proto ${cProto}` : ''}${sBuild ? `, build ${sBuild}` : ''})` : '';
    setNetBanner(`Update required. Refresh the page${details}.`, true);
    if (lobbyInfoEl) lobbyInfoEl.textContent = 'Update required. Please reload the page.';
    if (btnJoinEl) { btnJoinEl.disabled = true; btnJoinEl.style.opacity = '0.6'; }
    if (btnJoinLeftEl) { btnJoinLeftEl.disabled = true; btnJoinLeftEl.style.opacity = '0.6'; }
    if (btnReadyEl) btnReadyEl.disabled = true;
    return;
  }
  // Identity mismatch (e.g., localStorage was wiped/changed).
  // Clear stored identity so next reconnect generates a fresh one.
  localStorage.removeItem(LS_CID);
  localStorage.removeItem(LS_TOK);
  if (lobbyInfoEl) lobbyInfoEl.textContent = 'Auth failed. Please reload the page.';
});

ws.on('joinFail', (msg) => {
  const r = msg?.reason || 'unknown';
  const count = (typeof msg?.count === 'number') ? msg.count : null;
  const max = (typeof msg?.max === 'number') ? msg.max : null;
  const cap = (count != null && max != null) ? ` (${count}/${max})` : '';
  const text =
    r === 'bad_code' ? 'Bad code (3–8 chars: A–Z / 0–9)' :
    r === 'room_full' ? `Room full${cap}. Try Quick Play or Go Public.` :
    r === 'room_in_match' ? 'Room in match. Try again later or Go Public.' :
    r === 'rate_limited' ? 'Too many requests. Try again in a moment.' :
    'Join failed';
  if (joinErrorEl) joinErrorEl.textContent = text;
});

ws.on('afkWarn', (msg) => {
  const left = (msg?.left | 0) || 0;
  if (left > 0) {
    // Store an approximate kick deadline locally for HUD display.
    afkKickAtMs = performance.now() + left * 1000;
  }
});

ws.on('kicked', (msg) => {
  const reason = String(msg?.reason || 'kick');
  const text = (reason === 'afk')
    ? 'Kicked for AFK. Press Quick Play (or Apply) to rejoin.'
    : `Kicked (${reason}). Press Quick Play (or Apply) to rejoin.`;
  if (joinErrorEl) joinErrorEl.textContent = text;
  // Reset local joined state so UI returns to lobby.
  hasJoined = false;
  selfReady = false;
  selfRole = 'none';
  joinLocked = false;
  setLobbyVisible(true);
  lobbyManual = false;
});


ws.on('joined', (msg) => {
  // Some environments can miss the initial "welcome" message; joined contains our id too.
  if (msg?.id && !selfId) selfId = msg.id;
  hasJoined = true;
  if (msg?.role) selfRole = msg.role;
  if (typeof msg?.joinLocked === 'boolean') joinLocked = msg.joinLocked;
  selfReady = false;
  currentRoomCode = (typeof msg?.roomCode === 'string' && msg.roomCode) ? msg.roomCode : null;
  updateRoomCodeStatusUI();
  // Keep the browser URL in sync with the actual room we joined (public vs code-room).
  syncUrlToRoomCode(currentRoomCode);
  if (joinErrorEl) joinErrorEl.textContent = '';
  updateReadyButton();

  // Apply our lobby preference (bots on/off) once we are joined.
  // Server will ignore this outside the lobby.
  if (wsConnected) {
    ws.send({ t: 'bots', v: !!desiredBotsEnabled, n: desiredBotsCount });
  }

  // Quick Play: auto-ready after joining (bots fallback).
  if (autoReadyAfterJoin) {
    autoReadyAfterJoin = false;
    // Ensure bots are ON for solo fallback.
    desiredBotsEnabled = true;
    try { localStorage.setItem(LS_BOTS, '1'); } catch {}
    try { ws.send({ t: 'bots', v: true, n: desiredBotsCount }); } catch {}

    selfReady = true;
    updateReadyButton();
    // Slight delay to ensure the server processed join/bots before ready.
    setTimeout(() => {
      try {
        if (wsConnected && hasJoined) ws.send({ t: 'ready', v: true });
      } catch {}
    }, 40);
  }
  // Keep lobby open if the server is currently in lobby phase.
  const st = lastServerSS?.match?.state;
  if (st === 'match') {
    setLobbyVisible(false);
    lobbyManual = false;
  } else {
    initLobbyUI();
  }
});

ws.on('toLobby', () => {
  // Server forced a return to lobby (after results or on admin action).
  selfReady = false;
  lobbyManual = false;
  // Re-apply our preference in case the server was restarted.
  if (wsConnected && hasJoined) {
    ws.send({ t: 'bots', v: !!desiredBotsEnabled, n: desiredBotsCount });
  }
  initLobbyUI();
});

ws.on('matchStart', (msg) => {
  // A new match started.
  selfReady = false;
  joinLocked = false;
  updateReadyButton();
  if (!lobbyManual) setLobbyVisible(false);
});

ws.on('map', (msg) => {
  // Map packet contains the static obstacle list for a given mapId.
  const mapId = (msg?.mapId | 0) || 0;
  if (mapId <= 0) return;
  if (!Array.isArray(msg.obstacles)) return;
  MAP_CACHE.set(mapId, msg.obstacles);
  lastMapId = mapId;
});
ws.on('ss', (msg) => {
  const now = performance.now() / 1000;

  // Keep the latest server snapshot for lobby/UI decisions.
  lastServerSS = msg;

  // Map packets: snapshots only reference mapId.
  const mapId = (msg.mapId | 0) || 0;
  const st = msg.match?.state;
  if ((st === 'match' || st === 'results') && mapId > 0) {
    lastMapId = mapId;
    if (!MAP_CACHE.has(mapId)) {
      // Request the current map packet if we don't have it yet.
      ws.send({ t: 'mapReq', mapId });
    }
  } else {
    lastMapId = 0;
  }

  // Smooth clock offset estimation (serverTime is authoritative)
  if (typeof msg.serverTime === 'number') {
    const obs = msg.serverTime - now;
    clockOffset = clockOffset * 0.90 + obs * 0.10;
  }

  // Precompute a tiny id->player map per snapshot. This avoids per-frame Map/Set churn
  // and reduces GC spikes on mobile.
  const pMap = Array.isArray(msg.players) ? new Map(msg.players.map(p => [p.id, p])) : null;
  SNAP_BUFFER.push({ ss: msg, pMap });
  while (SNAP_BUFFER.length > MAX_SNAPS) SNAP_BUFFER.shift();

  // Update id->name/avatar map for killfeed strings (colors are not used; emoji is the identifier)
  if (Array.isArray(msg.players)) {
    lastNames = new Map(msg.players.map(p => [p.id, { name: p.name, avatarId: p.avatarId }]));
  }

  // Process events immediately on arrival (more reliable than sampling from interpolated snapshots)
  if (Array.isArray(msg.events) && msg.events.length) {
    processEvents(msg.events);
  }

  // Update lobby UI (join / ready / countdown / player list)
  updateLobbyFromSS(msg);
  // Keep track of the best streak achieved during the current match for profile stats.
  updateMatchPeakStreakFromSS(msg);
  handleMatchTransitions(msg);
});
ws.connect();

// Ensure lobby click handlers exist even if the server handshake is delayed.
initLobbyUI();

btnAgain?.addEventListener('click', () => {
  ws.send({ t: 'again' });
});

let seq = 0;
let lastSentAt = 0;
let lastSent = { mv: [0, 0], aim: [1, 0], fire: false };
let _lastRenderMs = 0;
function sendInput() {
  // Portal wrapper: don't keep sending inputs in background tabs.
  // If the tab just became hidden, send ONE stop packet to avoid "stuck firing".
  if (document.hidden) {
    if (PORTAL && PORTAL._needStopInput) {
      PORTAL._needStopInput = false;
      try {
        const now = performance.now() / 1000;
        ws.send({ t: 'in', seq: seq++, mv: [0, 0], aim: lastSent.aim || [1, 0], fire: false, ct: now });
      } catch {}
    }
    return;
  }
  if (PORTAL && PORTAL.started === false && portalOverlayEl) return;
  if (!selfId) return;

  const now = performance.now() / 1000;
  const snap = getRenderSnapshot(now);
  if (!snap) return;
  if (snap.match?.state !== 'match') return;
  const self = snap.players.find(p => p.id === selfId);
  if (!self) return;

  const mv = input.getMoveVec();
  // Use predicted self position for aim if available (feels less "laggy")
  const sx = predSelf ? predSelf.x : self.x;
  const sy = predSelf ? predSelf.y : self.y;
  const aim = input.getAimVec(cam, sx, sy);
  const fire = input.getFire();

  // Throttle to 40hz and only send when changed (keeps controls responsive on LAN)
  const changed =
    fire !== lastSent.fire ||
    Math.abs(mv[0] - lastSent.mv[0]) > 0.001 ||
    Math.abs(mv[1] - lastSent.mv[1]) > 0.001 ||
    Math.abs(aim[0] - lastSent.aim[0]) > 0.01 ||
    Math.abs(aim[1] - lastSent.aim[1]) > 0.01;

  if (changed || (now - lastSentAt) >= (1 / 40)) {
    lastSentAt = now;
    lastSent = { mv, aim, fire };
    ws.send({ t: 'in', seq: seq++, mv, aim, fire, ct: now });
  }
}

function loop() {
  requestAnimationFrame(loop);

  // Limit FPS when tab is hidden (portals/mobile): reduces CPU/battery.
  const nowMs = performance.now();

  // Frame-time stats (for perf overlay / diagnostics).
  if (!PERF.lastFrameMs) PERF.lastFrameMs = nowMs;
  const fdt = Math.max(0, nowMs - PERF.lastFrameMs);
  PERF.lastFrameMs = nowMs;
  PERF.frameAvgMs = PERF.frameAvgMs ? (PERF.frameAvgMs * 0.90 + fdt * 0.10) : fdt;
  PERF.frameMaxMs = Math.max(PERF.frameMaxMs || 0, fdt);
  PERF.fps = PERF.frameAvgMs > 1e-3 ? (1000 / PERF.frameAvgMs) : 0;
  if (fdt > (IS_MOBILE ? 50 : 40)) PERF.spikes += 1;

  // Reset spike/max counters once per second (keeps numbers meaningful).
  if (!PERF._frameWinStartMs) PERF._frameWinStartMs = nowMs;
  if (nowMs - PERF._frameWinStartMs >= 1000) {
    PERF._frameWinStartMs = nowMs;
    PERF.frameMaxMs = 0;
    PERF.spikes = 0;
  }

  if (document.hidden) {
    const minDt = 1000 / (PORTAL?.bgFps || 15);
    if (nowMs - _lastRenderMs < minDt) return;
  }
  _lastRenderMs = nowMs;
  const now = nowMs / 1000;

  // Adaptive interpolation delay using buffer headroom (prevents freeze->jump when packets are late).
  try { autoTuneInterpDelay(now); } catch {}

  const snap = getRenderSnapshot(now);
  if (!snap) {
    statsEl.textContent = 'Connecting...';
    return;
  }

  // Perf overlay update (throttled).
  if (PERF.enabled && perfOverlayEl) {
    const ns = ws.getStats ? ws.getStats() : null;
    if (ns) {
      PERF.msgPerSec = ns.msgsPerSec || 0;
      PERF.bytesPerSec = ns.bytesPerSec || 0;
      PERF.parseLastMs = ns.parseLastMs || 0;
      PERF.parseAvgMs = ns.parseAvgMs || 0;
      PERF.parseMaxMs = ns.parseMaxMs || 0;
    }
    // Update text at ~6Hz to keep DOM churn low.
    if (!PERF._nextTextMs || nowMs >= PERF._nextTextMs) {
      PERF._nextTextMs = nowMs + 160;
      const kb = Math.round((PERF.bytesPerSec || 0) / 1024);
      const snapAgeMs = Math.round((PERF.snapAgeSec || 0) * 1000);
      const spanMs = Math.round((PERF.bufSpanSec || 0) * 1000);
      const headMs = Math.round((PERF.headroomSec || 0) * 1000);
      const dtAheadMs = Math.round((PERF.dtAheadSec || 0) * 1000);
      const delayMs = Math.round((interpDelaySec || 0) * 1000);
      const baseMs = Math.round((interpBaseSec || 0) * 1000);
      perfOverlayEl.textContent =
        `Pixel PVP ${BUILD_TAG}\n` +
        `FPS ${Math.round(PERF.fps)} | avg ${PERF.frameAvgMs.toFixed(1)}ms | max ${PERF.frameMaxMs.toFixed(1)}ms | spikes ${PERF.spikes}\n` +
        `RTT ${Math.round(rttMs)}ms | jit ${Math.round(rttJitterMs)}ms\n` +
        `NET ${PERF.msgPerSec} msg/s | ${kb} KB/s | parse ${PERF.parseLastMs.toFixed(1)} (avg ${PERF.parseAvgMs.toFixed(1)} max ${PERF.parseMaxMs.toFixed(1)}) ms\n` +
        `SS age ${snapAgeMs}ms | buf ${PERF.bufLen} span ${spanMs}ms | head ${headMs}ms | ahead ${dtAheadMs}ms\n` +
        `delay ${delayMs}ms (base ${baseMs}ms)`;
    }
  }

  // Local prediction for our own player (camera + self draw), reconciled to interpolated snapshot
  const dt = Math.min(0.05, Math.max(0.0, now - lastFrameAt));
  lastFrameAt = now;
  const renderSnap = applyLocalPrediction(snap, dt);
  // Client-only: show a tiny aim-direction hint (next shot direction).
  renderSnap.selfAim = lastSent.aim;

  cam = renderer.render(renderSnap, selfId, 0, FX, input.getTouchOverlayState());

  const inResults = renderSnap.match?.state === 'results';
  const afkLeftSec = (afkKickAtMs && afkKickAtMs > nowMs) ? Math.ceil((afkKickAtMs - nowMs) / 1000) : 0;

  // DOM HUD updates can cause small GC spikes on mobile; throttle them a bit for smoother motion.
  const hudThrottleMs = IS_MOBILE ? 90 : 0;
  const canUpdateHud = (!hudThrottleMs) || (nowMs - lastHudUpdateMs) >= hudThrottleMs || inResults;
  if (canUpdateHud) {
    lastHudUpdateMs = nowMs;
    updateHUD(statsEl, renderSnap, selfId, { rttMs, rttJitterMs, afkLeftSec }, pingMiniEl);
    // Lobby ping chip (shown next to FS/Help in the main menu)
    if (lobbyPingMiniEl) {
      if (Number.isFinite(rttMs) && rttMs > 0) {
        lobbyPingMiniEl.style.display = 'flex';
        lobbyPingMiniEl.textContent = `Ping: ${Math.round(rttMs)}`;
      } else {
        lobbyPingMiniEl.style.display = 'none';
        lobbyPingMiniEl.textContent = 'Ping: —';
      }
    }
    updateResultsOverlay(resultsEl, resultsSummaryEl, resultsTableEl, renderSnap, selfId);
  }
  if (inResults) {
    // show overlay (DOM handles display)
  }
  sendInput();
}
loop();

function processEvents(events) {
  const nowMs = performance.now();

  const avatarEmojiForId = (id) => {
    if (!id) return '';
    if (id === 'storm') return '🌀';
    const rec = lastNames.get(id);
    const emo = Array.isArray(CONFIG.AVATARS)
      ? (CONFIG.AVATARS[clampAvatarId(rec?.avatarId)] || '')
      : '';
    return emo;
  };

  const capTo = (arr, max) => {
    if (!Array.isArray(arr)) return;
    const m = Math.max(0, max | 0);
    if (m && arr.length > m) arr.splice(0, arr.length - m);
  };

  // Cleanup seen event keys
  for (const [k, t] of SEEN_EVENTS) {
    if (nowMs - t > 6000) SEEN_EVENTS.delete(k);
  }

  for (const e of events) {
    // Primary dedupe: monotonic event sequence (server re-sends a short tail each snapshot)
    if (typeof e.seq === 'number') {
      if (e.seq <= lastEventSeqSeen) continue;
      if (e.seq > lastEventSeqSeen) lastEventSeqSeen = e.seq;
    } else {
      // Fallback dedupe (older servers)
      const key = `${e.t}|${e.at}|${e.a ?? ''}|${e.k ?? ''}|${e.v ?? ''}|${e.d ?? ''}`;
      if (SEEN_EVENTS.has(key)) continue;
      SEEN_EVENTS.set(key, nowMs);
    }

    if (e.t === 'explode') {
      // Explosion VFX (world coords)
      if (typeof e.x === 'number' && typeof e.y === 'number') {
        FX.explosions.push({ x: e.x, y: e.y, r: +e.r || 0, bornMs: nowMs });
        capTo(FX.explosions, lowFx ? 8 : 16);
      }
    }

    if (e.t === 'hit') {
      // Hit marker when WE hit someone
      if (selfId && e.a === selfId) {
        FX.hitMarkerUntilMs = nowMs + 140;
      }
      // Hurt flash when WE get hit
      if (selfId && e.v === selfId) {
        FX.hurtUntilMs = nowMs + 220;
      }
      // Damage text at hit position (world coords) if provided
      if (typeof e.x === 'number' && typeof e.y === 'number') {
        FX.dmgTexts.push({ x: e.x, y: e.y, text: `-${e.d ?? ''}`, bornMs: nowMs });
        capTo(FX.dmgTexts, lowFx ? 10 : 18);
      }
    }

    if (e.t === 'kill') {
      const killerId = e.k;
      const victimId = e.v;
      const kName = killerId === 'storm'
        ? 'STORM'
        : (lastNames.get(killerId)?.name ?? killerId);
      const vName = lastNames.get(victimId)?.name ?? victimId;
      const kEmo = avatarEmojiForId(killerId);
      const vEmo = avatarEmojiForId(victimId);
      const text = `${kEmo ? (kEmo + ' ') : ''}${kName} ☠ ${vEmo ? (vEmo + ' ') : ''}${vName}`;
      FX.killFeed.push({ text, untilMs: nowMs + 4200 });
      capTo(FX.killFeed, lowFx ? 4 : 8);
    }

    if (e.t === 'assist') {
      const aName = lastNames.get(e.a)?.name ?? e.a;
      const vName = lastNames.get(e.v)?.name ?? e.v;
      const aEmo = avatarEmojiForId(e.a);
      const vEmo = avatarEmojiForId(e.v);
      FX.killFeed.push({ text: `${aEmo ? (aEmo + ' ') : ''}${aName} assisted ${vEmo ? (vEmo + ' ') : ''}${vName}`, untilMs: nowMs + 3000 });
      capTo(FX.killFeed, lowFx ? 4 : 8);
    }

    if (e.t === 'buff') {
      // Temporary buff pickup collected (server authoritative)
      // Only toast for ourselves to avoid clutter.
      if (selfId && e.p === selfId) {
        const k = e.k || '';
        const label = (k === 'regen') ? 'REG' : (k === 'dmg') ? 'DMG' : (k === 'as') ? 'AS' : 'MS';
        const icon = (k === 'regen') ? '💚' : (k === 'dmg') ? '💥' : (k === 'as') ? '⚡' : '🏃';
        FX.killFeed.push({ text: `${icon} ${label} ${k === 'regen' ? '+HP/s' : '+20%'} (30s)`, untilMs: nowMs + 1800 });
        capTo(FX.killFeed, lowFx ? 4 : 8);
      }
    }

    if (e.t === 'respawnOff') {
      FX.killFeed.push({ text: `⛔ Respawn OFF (final minute)`, untilMs: nowMs + 2600 });
      capTo(FX.killFeed, lowFx ? 4 : 8);
    }
  }

  // Cleanup expired feed/text
  FX.killFeed = FX.killFeed.filter(x => x.untilMs > nowMs);
  FX.dmgTexts = FX.dmgTexts.filter(x => (nowMs - x.bornMs) < 900);
  FX.explosions = FX.explosions.filter(x => (nowMs - x.bornMs) < 520);
}

function getRenderSnapshot(nowLocalSec) {
  if (SNAP_BUFFER.length === 0) return null;

  // Estimate server "now" and render slightly in the past for smooth interpolation.
  const serverNow = nowLocalSec + clockOffset;
  let targetServerTime = serverNow - interpDelaySec;

  // Never render ahead of the newest snapshot.
  // On WAN (especially via tunnels) packets can arrive in bursts; if we run too close to the
  // newest snapshot we alternate between interpolation and extrapolation ("micro-freeze then jump").
  // Clamping the render time a little behind the newest snapshot avoids that oscillation.
  const newestST = SNAP_BUFFER[SNAP_BUFFER.length - 1]?.ss?.serverTime ?? targetServerTime;
  const minHeadroom = IS_MOBILE ? 0.07 : 0.04;
  if (targetServerTime > newestST - minHeadroom) {
    targetServerTime = newestST - minHeadroom;
  }

  // Find bracketing snapshots.
  let wa = null;
  let wb = null;
  for (let i = 0; i < SNAP_BUFFER.length; i++) {
    const w = SNAP_BUFFER[i];
    const ss = w.ss;
    if (ss.serverTime <= targetServerTime) wa = w;
    if (ss.serverTime >= targetServerTime) { wb = w; break; }
  }
  if (!wa) wa = SNAP_BUFFER[0];
  if (!wb) wb = SNAP_BUFFER[SNAP_BUFFER.length - 1];

  const a = wa.ss;
  const b = wb.ss;

  const denom = Math.max(1e-6, (b.serverTime - a.serverTime));
  const t = clamp01((targetServerTime - a.serverTime) / denom);

  // Interpolate match elapsed for smooth timer.
  const ea = a.match?.elapsed ?? 0;
  const eb = b.match?.elapsed ?? ea;
  const elapsed = lerp(ea, eb, t);
  const remaining = Math.max(0, CONFIG.MATCH_DURATION_SEC - elapsed);

  // Interpolate circle (center is stable, radius shrinks)
  const circleA = a.circle ?? computeStorm(ea);
  const circleB = b.circle ?? computeStorm(eb);
  const circle = {
    cx: lerp(circleA.cx, circleB.cx, t),
    cy: lerp(circleA.cy, circleB.cy, t),
    r: lerp(circleA.r, circleB.r, t),
    phase: circleB.phase ?? circleA.phase ?? 0
  };

  // Players interpolation (+ tiny extrapolation if we run past the newest snapshot).
  // Extrapolation prevents visible "freezes" on mobile when GC / Wi‑Fi jitter briefly delays packets.
  const mapA = wa.pMap || (Array.isArray(a.players) ? new Map(a.players.map(p => [p.id, p])) : null);
  const mapB = wb.pMap || (Array.isArray(b.players) ? new Map(b.players.map(p => [p.id, p])) : null);
  const dtAhead = Math.min(0.12, Math.max(0, targetServerTime - b.serverTime));
  PERF.dtAheadSec = dtAhead;
  const h = CONFIG.WORLD_HALF_SIZE;
  const players = [];

  if (mapB) {
    for (const [id, pb] of mapB) {
      const pa = mapA ? mapA.get(id) : null;
      if (pa) {
        const vx = lerp(pa.vx ?? 0, pb.vx ?? 0, t);
        const vy = lerp(pa.vy ?? 0, pb.vy ?? 0, t);
        let x = lerp(pa.x, pb.x, t) + vx * dtAhead;
        let y = lerp(pa.y, pb.y, t) + vy * dtAhead;
        x = clamp(x, -h, h);
        y = clamp(y, -h, h);
        players.push({ ...pb, x, y, vx, vy });
      } else {
        const vx = pb.vx ?? 0;
        const vy = pb.vy ?? 0;
        let x = (pb.x ?? 0) + vx * dtAhead;
        let y = (pb.y ?? 0) + vy * dtAhead;
        x = clamp(x, -h, h);
        y = clamp(y, -h, h);
        players.push({ ...pb, x, y, vx, vy });
      }
    }
  }
  // Include any players that existed in A but not in B (rare; e.g. instant disconnect).
  if (mapA && mapB) {
    for (const [id, pa] of mapA) {
      if (mapB.has(id)) continue;
      players.push({ ...pa });
    }
  }

  // Bullets: avoid per-frame allocations by keeping the array from snapshot A
  // and letting the renderer predict forward.
  const bulletAheadSec = Math.max(0, targetServerTime - a.serverTime);
  const bullets = (a.bullets ?? []);

  const activeMapId = (b.mapId | 0) || (a.mapId | 0) || 0;
  const obstacles = (activeMapId > 0 && MAP_CACHE.has(activeMapId))
    ? (MAP_CACHE.get(activeMapId) ?? [])
    : [];

  return {
    serverTime: targetServerTime,
    match: { ...(b.match ?? a.match), elapsed, remaining },
    circle,
    players,
    bullets,
    bulletAheadSec,
    // Discrete world items should use the newer snapshot so removals (e.g. collected pickups)
    // are reflected immediately.
    orbs: (b.orbs ?? a.orbs ?? []),
    buffPickups: (b.buffPickups ?? a.buffPickups ?? []),
    mapId: activeMapId,
    obstacles,
    events: b.events ?? []
  };
}

function applyLocalPrediction(snap, dt) {
  if (!selfId) return snap;
  const idx = snap.players.findIndex(p => p.id === selfId);
  if (idx === -1) return snap;

  const base = snap.players[idx];
  if (!predSelf) {
    predSelf = { x: base.x, y: base.y };
  }

  // Predict step from current input
  const mv = input.getMoveVec();
  const [nx, ny] = norm(mv[0], mv[1]);
  let speedMul = 1.0;
  if ((base.bloodlust | 0) > 0) {
    speedMul += (base.bloodlust | 0) * (CONFIG.BLOODLUST_MOVE_BONUS_PER_STACK ?? 0);
  }
  if ((base.bm || 0) > 0) {
    speedMul *= (1 + (CONFIG.BUFF_BONUS_MUL ?? 0.20));
  }
  const speed = CONFIG.PLAYER_BASE_SPEED * speedMul;
  predSelf.x += nx * speed * dt;
  predSelf.y += ny * speed * dt;
  const h = CONFIG.WORLD_HALF_SIZE;
  predSelf.x = clamp(predSelf.x, -h, h);
  predSelf.y = clamp(predSelf.y, -h, h);

  // Reconcile to interpolated server position
  const err = dist(predSelf.x, predSelf.y, base.x, base.y);
  const k = err > 140 ? 0.35 : 0.12;
  predSelf.x = predSelf.x + (base.x - predSelf.x) * k;
  predSelf.y = predSelf.y + (base.y - predSelf.y) * k;

  // Patch self player in snapshot for rendering + aiming
  const players = snap.players.slice();
  players[idx] = { ...base, x: predSelf.x, y: predSelf.y };
  return { ...snap, players };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function norm(x, y) {
  const d = Math.sqrt(x * x + y * y);
  if (d < 1e-6) return [0, 0];
  return [x / d, y / d];
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function updateResultsOverlay(root, summaryEl, tableEl, snapshot, selfId) {
  if (!root || !summaryEl || !tableEl) return;

  const state = snapshot.match?.state;
  if (state !== 'results') {
    root.style.display = 'none';
    return;
  }
  root.style.display = 'flex';

  const remaining = snapshot.match?.remaining ?? 0;
  const total = CONFIG.MATCH_DURATION_SEC;
  const self = snapshot.players.find(p => p.id === selfId);

  const mapId = (snapshot.mapId | 0) || 0;
  const mKey = mapId > 0 ? `m${mapId}` : null;
  const xpGain = (mKey && lastMatchXpKey === mKey) ? (lastMatchXpGain | 0) : 0;

  const winnerId = snapshot.match?.winnerId || null;
  const sorted = [...snapshot.players].sort((a, b) => {
    if (winnerId) {
      const aw = a.id === winnerId;
      const bw = b.id === winnerId;
      if (aw && !bw) return -1;
      if (!aw && bw) return 1;
    }
    return (b.score - a.score);
  });
  const top = sorted.slice(0, 10);

  const myLine = self
    ? `You: score ${self.score} • K/D/A ${self.kills}/${self.deaths}/${self.assists} • L${self.level} (max L${self.maxLevel}) • XP ${self.xp}`
    : `Players: ${snapshot.players.length}`;

  const profLine = xpGain > 0
    ? ` • +${xpGain} Profile XP (L${statsProfile.level}, XP ${statsProfile.xp})`
    : '';

  let winLine = '';
  if (winnerId) {
    const w = snapshot.players.find(p => p.id === winnerId);
    const emo = Array.isArray(CONFIG.AVATARS) ? (CONFIG.AVATARS[clampAvatarId(w?.avatarId)] || '') : '';
    const name = w ? w.name : 'Unknown';
    winLine = ` Winner: ${emo ? (emo + ' ') : ''}${name}.`;
  }
  summaryEl.textContent = `Match ended (${formatTime(total)}).${winLine} ${myLine}${profLine}`;

  let html = '<table><thead><tr>';
  html += '<th>#</th><th>Name</th><th>Score</th><th>K</th><th>D</th><th>A</th><th>Max L</th><th>Max XP</th>';
  html += '</tr></thead><tbody>';
  top.forEach((p, i) => {
    const isMe = p.id === selfId;
    const bot = isBotId(p.id);
    const isWinner = !!winnerId && p.id === winnerId;
    html += `<tr style="${isMe ? 'background: rgba(120,170,255,0.12);' : ''}">`;
    const badges = [
      isWinner ? '<span style="opacity:0.95; font-size:12px; margin-left:8px;">WINNER</span>' : '',
      isMe ? '<span style="opacity:0.9; font-size:12px; margin-left:8px;">YOU</span>' : '',
      bot ? '<span style="opacity:0.75; font-size:12px; margin-left:8px;">BOT</span>' : ''
    ].filter(Boolean).join('');
    const emo = Array.isArray(CONFIG.AVATARS) ? (CONFIG.AVATARS[clampAvatarId(p.avatarId)] || '') : '';
    const label = `${emo ? (emo + ' ') : ''}${escapeHtml(p.name)}`;
    html += `<td>${i+1}</td><td>${label}${badges}</td><td>${p.score}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.assists}</td><td>${p.maxLevel}</td><td>${p.maxXp}</td>`;
    html += '</tr>';
  });
  html += '</tbody></table>';
  tableEl.innerHTML = html;
}

function stormStageFromElapsed(elapsed) {
  const t = Math.max(0, elapsed || 0);
  if (t < 210) return 1;
  if (t < 390) return 2;
  if (t < 540) return 3;
  if (t < 660) return 4;
  return 5;
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2,'0')}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}