import { CONFIG } from './constants.js';
import { makePlayer } from '../entities/player.js';
import { computeStorm } from '../systems/storm.js';
import { movePlayer } from '../systems/movement.js';
import { tryShoot } from '../systems/shooting.js';
import { updateBulletsAndHits, handleDeath } from '../systems/combat.js';
import { collectOrbs } from '../systems/orbs.js';
import { collectBuffPickups } from '../systems/buffPickups.js';
import { updateOrbField } from '../systems/orbField.js';
import { updateBuffField } from '../systems/buffField.js';
import { survivalTick } from '../systems/scoring.js';
import { applyStormDamage } from '../systems/stormDamage.js';
import { tryRespawn, spawnIntoCircle } from '../systems/respawn.js';
import { generateObstacles, ensureCoverNearPlayers, rebuildObstacleGrid } from '../systems/obstacles.js';

export function createSim({ seed = 1 } = {}) {
  const sim = {
    seed,
    time: 0,
    matchStart: 0,
    matchEndAt: null,
    // 'lobby' -> waiting/ready-up, no gameplay simulation.
    // 'match' -> active gameplay.
    // 'results' -> frozen gameplay + scoreboard.
    matchState: 'lobby',

    // During the final minute we disable respawns so the match resolves to a single survivor.
    respawnEnabled: true,
    // Winner by last-survivor (authoritative). Used by the results overlay.
    winnerId: null,

    players: new Map(),
    bullets: [],
    orbs: [],
    buffPickups: [],
    obstacles: [],

    mapId: 0,
    nextObstacleId: 1,

    // Featured Weapon per match
    matchWeaponId: 'pistol',
    nextWeaponId: null,

    // Map variant per match (used by obstacle generator)
    // - matchMapVariant: chosen variant for the current match (null => default picker)
    // - nextMapVariant: voted/picked variant for the next match while in lobby
    matchMapVariant: null,
    nextMapVariant: null,

    nextBulletId: 1,
    nextOrbId: 1,
    nextBuffPickupId: 1,

    events: [],
    eventSeq: 0,

    // internal helper for storm kills
    _pendingStormDeaths: []
  };

  // Deterministic pick based on (seed, upcoming mapId). No RNG coupling with obstacles.
  sim._pickWeaponId = (mapIdNext) => {
    const pool = CONFIG.MATCH_WEAPON_POOL ?? ['pistol'];
    const seedU = (sim.seed >>> 0) || 1;
    const midU = (mapIdNext >>> 0) || 0;
    const x = (((midU * 1103515245) >>> 0) + ((seedU * 12345) >>> 0)) >>> 0;
    return pool[x % pool.length] ?? pool[0] ?? 'pistol';
  };

  sim._emit = (e) => {
    if (!e) return;
    sim.eventSeq = (sim.eventSeq | 0) + 1;
    e.seq = sim.eventSeq;
    sim.events.push(e);
  };

  return sim;
}


function pruneEvents(sim) {
  const max = CONFIG.EVENT_BUFFER_MAX;
  const keepSec = CONFIG.EVENT_BUFFER_KEEP_SEC;
  const cutoff = sim.time - keepSec;

  // Drop very old events first (time-based), but always keep at least 'max' newest.
  while (sim.events.length > max && sim.events[0] && sim.events[0].at < cutoff) {
    sim.events.shift();
  }

  // Hard cap
  if (sim.events.length > max) {
    sim.events.splice(0, sim.events.length - max);
  }
}

export function addPlayer(sim, { id, name, color, avatarId, auraId, trailId } = {}) {
  const pid = id ?? `p_${Math.random().toString(16).slice(2, 10)}`;
  const p = makePlayer(pid);
  if (name) p.name = name;
  if (color) p.color = color;
  if (avatarId != null) p.avatarId = avatarId;
  if (auraId != null) p.auraId = auraId;
  if (trailId != null) p.trailId = trailId;

  // Spawn inside current safe circle.
  // In lobby we always use a full-size circle (elapsed=0).
  const elapsed = sim.matchState === 'lobby' ? 0 : Math.max(0, sim.time - sim.matchStart);
  const circle = computeStorm(elapsed);
  spawnIntoCircle(sim, p, circle, sim.time);

  sim.players.set(pid, p);
  return p;
}

export function removePlayer(sim, id) {
  sim.players.delete(id);
}

export function applyInput(sim, id, input) {
  const p = sim.players.get(id);
  if (!p) return;

  // Hardening:
  // - never allow NaN/Infinity into sim state (would break norm/hypot)
  // - clamp move to a sane range (-1..1)
  // - clamp aim to avoid extreme values
  const finite = (v) => (Number.isFinite(v) ? v : 0);
  const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

  if (Array.isArray(input.mv)) {
    const x = finite(+input.mv[0]);
    const y = finite(+input.mv[1]);
    p.mvx = clamp(x, -1, 1);
    p.mvy = clamp(y, -1, 1);
  }
  if (Array.isArray(input.aim)) {
    const x = finite(+input.aim[0]);
    const y = finite(+input.aim[1]);
    // Aim can be in world-space deltas; keep it large enough for any canvas size,
    // but finite so math stays stable.
    p.aimx = clamp(x, -1_000_000, 1_000_000);
    p.aimy = clamp(y, -1_000_000, 1_000_000);
  }
  p.fire = !!input.fire;
}

export function step(sim, dt) {
  // Keep recent events across frames so clients don't miss them between snapshots.

  sim.time += dt;

  // Lobby: freeze gameplay, keep time moving (server uses this for countdown).
  if (sim.matchState === 'lobby') {
    const circle = computeStorm(0);
    pruneEvents(sim);
    return circle;
  }

  // Results: freeze gameplay state but keep server time moving.
  if (sim.matchState === 'results') {
    const circle = computeStorm(CONFIG.MATCH_DURATION_SEC);
    pruneEvents(sim);
    return circle;
  }

  const elapsed = sim.time - sim.matchStart;
  const circle = computeStorm(elapsed);

  // Final minute: disable respawns (sudden-death style).
  if (sim.respawnEnabled && elapsed >= (CONFIG.MATCH_DURATION_SEC - 60)) {
    sim.respawnEnabled = false;
    sim._emit({ t: 'respawnOff', at: sim.time });
  }

  // Players
  for (const p of sim.players.values()) {
    // respawn
    tryRespawn(sim, p, sim.time, circle);

    // movement
    movePlayer(p, dt, sim.time, sim.obstacleGrid ?? sim.obstacles);

    // shooting
    tryShoot(sim, p, sim.time);
  }

  // Combat
  updateBulletsAndHits(sim, dt, sim.time);

  // Survival + XP
  survivalTick(sim, dt);

  // Neutral orb field (keeps baseline orbs in the world)
  updateOrbField(sim, dt, sim.time, circle);
  // Rare buff pickups (keeps a few temporary boosts on the map)
  updateBuffField(sim, dt, sim.time, circle);

  // Orbs
  collectOrbs(sim, sim.time);

  // Buff pickups
  collectBuffPickups(sim, sim.time);

  // Storm damage
  sim._pendingStormDeaths.length = 0;
  applyStormDamage(sim, dt, circle);
  for (const victimId of sim._pendingStormDeaths) {
    // killerId is a pseudo id 'storm'
    handleDeath(sim, 'storm', victimId, sim.time);
  }

  // Match end
  if (!sim.respawnEnabled) {
    const alive = Array.from(sim.players.values()).filter(p => p && !p.dead).length;
    if (alive <= 1) {
      const winner = Array.from(sim.players.values()).find(p => p && !p.dead);
      sim.winnerId = winner ? winner.id : null;
      sim.matchState = 'results';
      if (sim.matchEndAt == null) sim.matchEndAt = sim.time;
    }
  }

  if (sim.matchState === 'match' && elapsed >= CONFIG.MATCH_DURATION_SEC) {
    // Time limit reached. If multiple are alive, it's a time-out (no forced winner).
    sim.winnerId = null;
    sim.matchState = 'results';
    if (sim.matchEndAt == null) sim.matchEndAt = sim.time;
  }

  pruneEvents(sim);

  return circle;
}

export function makeSnapshot(sim, circle) {
  const elapsedRaw = sim.time - sim.matchStart;
  // In lobby we keep the timer at 0 for UI stability.
  const elapsedBase = (sim.matchState === 'lobby') ? 0 : elapsedRaw;
  const elapsed = Math.min(CONFIG.MATCH_DURATION_SEC, Math.max(0, elapsedBase));
  return {
    // Map packets (obstacles) are sent out-of-band as a separate "map" message.
    // Snapshots only reference the active mapId.
    mapId: (sim.matchState === 'lobby') ? 0 : sim.mapId,
    serverTime: sim.time,
    match: {
      state: sim.matchState,
      elapsed,
      remaining: Math.max(0, CONFIG.MATCH_DURATION_SEC - elapsed),
      respawnEnabled: !!sim.respawnEnabled,
      winnerId: sim.winnerId || null,
      weaponId: sim.matchWeaponId || 'pistol',
      nextWeaponId: sim.nextWeaponId || null,
      mapVariant: sim.matchMapVariant || null,
      nextMapVariant: sim.nextMapVariant || null
    },
    circle,
    players: Array.from(sim.players.values()).map(p => {
      const lvl = Math.max(1, Math.min(10, p.level));
      const wid = sim.matchWeaponId || 'pistol';
      const weapon = (CONFIG.WEAPONS && CONFIG.WEAPONS[wid]) ? CONFIG.WEAPONS[wid] : CONFIG.PISTOL;
      const rangeMul = 1 + weapon.rangePerLevel * (lvl - 1);
      const range = weapon.baseRange * rangeMul;
      return ({
      id: p.id,
      name: p.name,
      color: p.color,
      avatarId: (p.avatarId | 0) || 0,
      auraId: (p.auraId | 0) || 0,
      trailId: (p.trailId | 0) || 0,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      hp: p.hp,
      maxHp: p.maxHp,
      xp: Math.floor(p.xp),
      level: p.level,
      range,
      score: Math.floor(p.score),
      streak: p.streak,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      maxLevel: p.maxLevel,
      maxXp: Math.floor(p.maxXp),
      bloodlust: (sim.time < p.bloodlustUntil) ? p.bloodlustStacks : 0,
       bm: Math.max(0, (p.buffMsUntil || 0) - sim.time),
       ba: Math.max(0, (p.buffAsUntil || 0) - sim.time),
       bd: Math.max(0, (p.buffDmgUntil || 0) - sim.time),
       br: Math.max(0, (p.buffRegenUntil || 0) - sim.time),
      bc: (p.buffsCollected | 0) || 0,
      shield: p.shield,
      dead: p.dead,
      prot: Math.max(0, p.protectUntil - sim.time)
      });
    }),
    bullets: sim.bullets.map(b => ({
      id: b.id,
      o: b.ownerId,
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy
    })),
    orbs: sim.orbs.map(o => ({
      id: o.id,
      x: o.x,
      y: o.y,
      v: o.value
    })),
    buffPickups: sim.buffPickups.map(pu => ({
      id: pu.id,
      x: pu.x,
      y: pu.y,
      k: pu.kind
    })),
    events: sim.events
  };
}

export function resetMatch(sim, now) {
  sim.matchStart = now;
  sim.matchEndAt = null;
  sim.matchState = 'match';
  sim.respawnEnabled = true;
  sim.winnerId = null;

  const nextMapId = (sim.mapId | 0) + 1;
  sim.mapId = nextMapId;

  // Pick featured weapon for this match.
  // If the server preselected nextWeaponId (e.g., during countdown), use it.
  sim.matchWeaponId = sim.nextWeaponId || sim._pickWeaponId(nextMapId);
  sim.nextWeaponId = null;

  // Pick map variant for this match.
  // If the server preselected nextMapVariant (e.g., during countdown), use it.
  sim.matchMapVariant = sim.nextMapVariant || null;
  sim.nextMapVariant = null;

  sim.bullets.length = 0;
  sim.orbs.length = 0;
  sim.buffPickups.length = 0;
  sim.obstacles.length = 0;
  sim.events.length = 0;
  sim._pendingStormDeaths.length = 0;

  // Reset all players but keep identity + cosmetics
  const circle = computeStorm(0);
  // Generate a fresh obstacle map for the new match.
  generateObstacles(sim, circle);
  // Re-position players for a fair match start (and to avoid newly-generated obstacles).
  for (const p of sim.players.values()) {
    spawnIntoCircle(sim, p, circle, now);
    p.protectUntil = now + CONFIG.SPAWN_PROTECT_SEC;

    p.xp = 0;
    p.level = 1;
    p.score = 0;
    p.streak = 0;
    p.bloodlustStacks = 0;
    p.bloodlustUntil = 0;
    p.shield = 0;

    p.kills = 0;
    p.deaths = 0;
    p.assists = 0;
    p.maxLevel = 1;
    p.maxXp = 0;

    p.damageFrom.clear();
    // Clear temporary buffs between matches/lobby
    p.buffMsUntil = 0;
    p.buffAsUntil = 0;
    p.buffDmgUntil = 0;
    p.buffRegenUntil = 0;
    p.buffsCollected = 0;
    p.nextShotAt = 0;
  }

  // If spawns are very "open" relative to generated cover, seed a little cover near each player
  // so the match immediately feels like it has walls/corners.
  ensureCoverNearPlayers(sim, circle, Array.from(sim.players.values()));

  // Obstacles are static for the match; build a spatial grid for faster collisions.
  rebuildObstacleGrid(sim);
}

// Transition to lobby (waiting room). Gameplay is frozen until the server
// switches back to 'match' (typically via resetMatch()).
export function enterLobby(sim, now) {
  sim.matchState = 'lobby';
  sim.matchStart = now; // keep timers stable for UI
  sim.matchEndAt = null;
  sim.respawnEnabled = true;
  sim.winnerId = null;

  // In lobby we clear the preselected weapon until the server starts the countdown.
  sim.nextWeaponId = null;

  // In lobby we clear any preselected map variant until the server starts the countdown.
  sim.nextMapVariant = null;

  // Remove transient entities.
  sim.bullets.length = 0;
  sim.orbs.length = 0;
  sim.buffPickups.length = 0;
  sim.obstacles.length = 0;
  sim.obstacleGrid = null;
  sim.events.length = 0;
  sim._pendingStormDeaths.length = 0;

  // Put everyone safely into the initial circle.
  const circle = computeStorm(0);
  for (const p of sim.players.values()) {
    p.hp = p.maxHp;
    p.dead = false;
    p.respawnAt = 0;
    p.protectUntil = now + CONFIG.SPAWN_PROTECT_SEC;
    // Clear temporary buffs between matches/lobby
    p.buffMsUntil = 0;
    p.buffAsUntil = 0;
    p.buffDmgUntil = 0;
    p.buffRegenUntil = 0;
    p.buffsCollected = 0;
    p.nextShotAt = 0;
    spawnIntoCircle(sim, p, circle, now);
  }
}