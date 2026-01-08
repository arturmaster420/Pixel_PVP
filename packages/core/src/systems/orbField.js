import { CONFIG, clamp } from '../sim/constants.js';
import { makeOrb } from '../entities/orb.js';

// Neutral orb field spawner:
// - Keeps a baseline amount of XP orbs on the map (not only death drops)
// - Spawns small clusters inside the current safe circle
// - Prunes orbs that are far outside the safe circle as it shrinks

function rand01(sim) {
  // Simple LCG; deterministic per server run (good enough for MVP)
  sim._rngState = (sim._rngState * 1664525 + 1013904223) >>> 0;
  return sim._rngState / 4294967296;
}

function pointBlocked(sim, x, y, margin = 10) {
  const obs = sim.obstacles;
  if (!obs || !obs.length) return false;
  for (const o of obs) {
    const hw = o.w * 0.5 + margin;
    const hh = o.h * 0.5 + margin;
    if (Math.abs(x - o.x) <= hw && Math.abs(y - o.y) <= hh) return true;
  }
  return false;
}

function randomPointInCircle(sim, circle, marginMul = 0.92) {
  // Try a few times to avoid spawning inside cover.
  for (let t = 0; t < 10; t++) {
    const a = rand01(sim) * Math.PI * 2;
    // Uniform by area
    const r = Math.sqrt(rand01(sim)) * circle.r * marginMul;
    const x = circle.cx + Math.cos(a) * r;
    const y = circle.cy + Math.sin(a) * r;
    if (!pointBlocked(sim, x, y, 10)) return { x, y };
  }
  return { x: circle.cx, y: circle.cy };
}

export function updateOrbField(sim, dt, now, circle) {
  if (sim.matchState !== 'match') return;

  // Prune orbs that ended up far outside the safe circle.
  const pruneR = circle.r * CONFIG.ORB_FIELD.pruneOutsideMul;
  const pruneR2 = pruneR * pruneR;
  for (let i = sim.orbs.length - 1; i >= 0; i--) {
    const o = sim.orbs[i];
    const dx = o.x - circle.cx;
    const dy = o.y - circle.cy;
    if (dx * dx + dy * dy > pruneR2) {
      sim.orbs.splice(i, 1);
    }
  }

  // Target count scales with alive players.
  let alive = 0;
  for (const p of sim.players.values()) if (!p.dead) alive++;
  const target = clamp(
    CONFIG.ORB_FIELD.baseTarget + alive * CONFIG.ORB_FIELD.perAlivePlayer,
    CONFIG.ORB_FIELD.baseTarget,
    CONFIG.ORB_FIELD.maxTarget
  );

  // Lazy init.
  if (sim._rngState == null) sim._rngState = (sim.seed >>> 0) || 1;
  if (sim._nextFieldSpawnAt == null) sim._nextFieldSpawnAt = now;

  if (sim.orbs.length >= target) return;
  if (now < sim._nextFieldSpawnAt) return;

  // Spawn: mostly single orbs sprinkled around, sometimes a cluster.
  const need = target - sim.orbs.length;
  const useSingles = (rand01(sim) < CONFIG.ORB_FIELD.singleChance) || (need < CONFIG.ORB_FIELD.clusterMin);

  if (useSingles) {
    const burst = clamp(
      Math.floor(CONFIG.ORB_FIELD.singleBurstMin + rand01(sim) * (CONFIG.ORB_FIELD.singleBurstMax - CONFIG.ORB_FIELD.singleBurstMin + 1)),
      CONFIG.ORB_FIELD.singleBurstMin,
      CONFIG.ORB_FIELD.singleBurstMax
    );
    const n = Math.min(need, burst);
    for (let i = 0; i < n; i++) {
      const p = randomPointInCircle(sim, circle, 0.94);
      // Rare case: if we hit cover, retry a bit
      if (pointBlocked(sim, p.x, p.y, 10)) continue;
      sim.orbs.push(makeOrb({
        id: `o_${sim.nextOrbId++}`,
        x: p.x,
        y: p.y,
        value: CONFIG.XP_ORB_VALUE
      }));
    }
  } else {
    const center = randomPointInCircle(sim, circle, 0.92);
    let count = clamp(
      Math.floor(CONFIG.ORB_FIELD.clusterMin + rand01(sim) * (CONFIG.ORB_FIELD.clusterMax - CONFIG.ORB_FIELD.clusterMin + 1)),
      CONFIG.ORB_FIELD.clusterMin,
      CONFIG.ORB_FIELD.clusterMax
    );
    count = Math.min(need, count);

    for (let i = 0; i < count; i++) {
      // Try a few times to place each orb not inside cover
      for (let t = 0; t < 4; t++) {
        const a = rand01(sim) * Math.PI * 2;
        const r = Math.sqrt(rand01(sim)) * CONFIG.ORB_FIELD.clusterRadius;
        const x = center.x + Math.cos(a) * r;
        const y = center.y + Math.sin(a) * r;
        if (pointBlocked(sim, x, y, 10)) continue;
        sim.orbs.push(makeOrb({
          id: `o_${sim.nextOrbId++}`,
          x,
          y,
          value: CONFIG.XP_ORB_VALUE
        }));
        break;
      }
    }
  }

  const interval = CONFIG.ORB_FIELD.spawnIntervalMinSec +
    rand01(sim) * (CONFIG.ORB_FIELD.spawnIntervalMaxSec - CONFIG.ORB_FIELD.spawnIntervalMinSec);
  sim._nextFieldSpawnAt = now + interval;
}
