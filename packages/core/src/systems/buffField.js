import { CONFIG, clamp } from '../sim/constants.js';
import { makeBuffPickup } from '../entities/buffPickup.js';
import { queryObstacleGrid } from './obstacles.js';
import { circleAabbOverlap } from '../math/collision.js';

function rand01(sim) {
  // Simple LCG; deterministic per server run (good enough for MVP)
  sim._rngState = (sim._rngState * 1664525 + 1013904223) >>> 0;
  return sim._rngState / 4294967296;
}

function pointBlocked(sim, x, y, pad = ((CONFIG.PLAYER_RADIUS ?? 14) + (CONFIG.BUFF_PICKUP_RADIUS ?? 18) + 10)) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  // Ensure the pickup spawns in a spot the player circle can actually reach.
  // We treat obstacles as expanded by `pad`.
  const q = 120 + pad;
  const obstacles = (sim?.obstacleGrid?.map)
    ? queryObstacleGrid(sim.obstacleGrid, x - q, y - q, x + q, y + q)
    : (sim?.obstacles || []);
  for (const o of obstacles) {
    if (circleAabbOverlap(x, y, pad, o.x, o.y, o.w, o.h)) return true;
  }
  return false;
}

// Rare temporary buff pickups spawner.
// Keeps a small baseline count of buff pickups inside the current safe circle,
// and prunes ones that end up far outside as the circle shrinks.
export function updateBuffField(sim, dt, now, circle) {
  if (!CONFIG.BUFF_FIELD?.enabled) return;
  if (!circle) return;

  // Storm center is stable; computeStorm returns {cx,cy,r,...}
  const cx = Number.isFinite(circle.cx) ? circle.cx : 0;
  const cy = Number.isFinite(circle.cy) ? circle.cy : 0;

  if (sim._nextBuffSpawnAt == null) {
    sim._nextBuffSpawnAt = now + (CONFIG.BUFF_FIELD.spawnIntervalMinSec || 10);
  }

  // Prune outside circle as it shrinks (keeps pickups relevant)
  const pruneMul = CONFIG.BUFF_FIELD.pruneOutsideMul ?? 1.15;
  const pr = circle.r * pruneMul;
  const pr2 = pr * pr;
  for (let i = sim.buffPickups.length - 1; i >= 0; i--) {
    const pu = sim.buffPickups[i];
    // Also prune any malformed pickups (e.g. NaN from older builds)
    if (!Number.isFinite(pu.x) || !Number.isFinite(pu.y)) {
      sim.buffPickups.splice(i, 1);
      continue;
    }
    const dx = pu.x - cx;
    const dy = pu.y - cy;
    if (dx * dx + dy * dy > pr2) {
      sim.buffPickups.splice(i, 1);
    }
  }

  if (now < sim._nextBuffSpawnAt) return;

  let alive = 0;
  for (const p of sim.players.values()) if (p && !p.dead) alive++;

  const baseTarget = CONFIG.BUFF_FIELD.baseTarget ?? 1;
  const perAlive = CONFIG.BUFF_FIELD.perAlivePlayer ?? 0.25;
  const maxTarget = CONFIG.BUFF_FIELD.maxTarget ?? 5;

  const target = clamp(Math.floor(baseTarget + perAlive * alive), 0, maxTarget);
  if (sim.buffPickups.length >= target) {
    // schedule next check
    const interval = (CONFIG.BUFF_FIELD.spawnIntervalMinSec ?? 10) +
      rand01(sim) * ((CONFIG.BUFF_FIELD.spawnIntervalMaxSec ?? 18) - (CONFIG.BUFF_FIELD.spawnIntervalMinSec ?? 10));
    sim._nextBuffSpawnAt = now + interval;
    return;
  }
  const kinds = CONFIG.BUFF_KINDS ?? ['ms', 'as', 'dmg'];
  const rMax = circle.r * (CONFIG.BUFF_FIELD.spawnInsideMul ?? 0.88);
  const burstMax = CONFIG.BUFF_FIELD.spawnBurstMax ?? 2;
  const missing = Math.max(0, target - sim.buffPickups.length);
  const spawnCount = clamp(missing, 1, burstMax);

  for (let s = 0; s < spawnCount; s++) {
    const kind = kinds[(rand01(sim) * kinds.length) | 0] ?? 'ms';
    let placed = false;
    for (let t = 0; t < 24; t++) {
      const a = rand01(sim) * Math.PI * 2;
      const r = Math.sqrt(rand01(sim)) * rMax;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (pointBlocked(sim, x, y)) continue;
      sim.buffPickups.push(makeBuffPickup({
        id: `pu_${sim.nextBuffPickupId++}`,
        x,
        y,
        kind
      }));
      placed = true;
      break;
    }
    if (!placed) break;
  }

  const interval = (CONFIG.BUFF_FIELD.spawnIntervalMinSec ?? 10) +
    rand01(sim) * ((CONFIG.BUFF_FIELD.spawnIntervalMaxSec ?? 18) - (CONFIG.BUFF_FIELD.spawnIntervalMinSec ?? 10));
  sim._nextBuffSpawnAt = now + interval;
}
