import { CONFIG } from '../sim/constants.js';
import { circleAabbOverlap } from '../math/collision.js';

// Pick a respawn position that is inside the safe circle and tries to avoid
// spawning right on top of other players.
function pickSafeSpawn(sim, circle) {
  const players = Array.from(sim.players.values()).filter(p => !p.dead);

  // Prefer spawning within 80% of the safe radius to reduce immediate storm pressure.
  const maxR = circle.r * 0.8;

  const spawnHints = Array.isArray(sim.spawnPoints) ? sim.spawnPoints : null;

  const isBlocked = (x, y) => {
    const pad = CONFIG.PLAYER_RADIUS + 2;
    const obs = sim.obstacles;
    if (!obs || !obs.length) return false;

    // Prefer spatial grid if available (built once per match).
    const grid = sim.obstacleGrid;
    if (grid && grid.map) {
      // Inline query to avoid extra imports (keep respawn system minimal).
      const cs = grid.cellSize;
      const minX = x - pad;
      const maxX = x + pad;
      const minY = y - pad;
      const maxY = y + pad;
      const cx0 = Math.floor(minX / cs);
      const cx1 = Math.floor(maxX / cs);
      const cy0 = Math.floor(minY / cs);
      const cy1 = Math.floor(maxY / cs);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const arr = grid.map.get(`${cx},${cy}`);
          if (!arr) continue;
          for (const o of arr) {
            if (circleAabbOverlap(x, y, pad, o.x, o.y, o.w, o.h)) return true;
          }
        }
      }
      return false;
    }

    // Fallback: linear scan.
    for (const o of obs) {
      if (circleAabbOverlap(x, y, pad, o.x, o.y, o.w, o.h)) return true;
    }
    return false;
  };

  // Target distance: try to respawn far from enemies early, relax in late storm.
  // This avoids spawn-kills without causing respawn failures in small circles.
  const targetDist = Math.max(520, Math.min(1800, circle.r * 0.42));
  const targetD2 = targetDist * targetDist;

  let best = null;
  let bestMinDist2 = -1;
  const tries = 64;

  for (let i = 0; i < tries; i++) {
    let x = 0, y = 0;

    // If the current map provides deterministic spawn hint points (e.g. labyrinth rooms),
    // bias sampling around them. This improves spawn reliability in dense obstacle layouts.
    if (spawnHints && spawnHints.length && Math.random() < 0.65) {
      const a = spawnHints[(Math.random() * spawnHints.length) | 0];
      const jitter = 460;
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * jitter;
      x = a.x + Math.cos(ang) * rad;
      y = a.y + Math.sin(ang) * rad;

      // Keep inside the safe circle (use a slightly smaller radius).
      const dx = x - circle.cx;
      const dy = y - circle.cy;
      const d = Math.hypot(dx, dy) || 1;
      const lim = maxR;
      if (d > lim) {
        const k = lim / d;
        x = circle.cx + dx * k;
        y = circle.cy + dy * k;
      }
    } else {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * maxR;
      x = circle.cx + Math.cos(ang) * rad;
      y = circle.cy + Math.sin(ang) * rad;
    }

    // Avoid spawning inside an obstacle.
    if (isBlocked(x, y)) continue;

    // Score by distance to the closest other player.
    let minD2 = Infinity;
    for (const op of players) {
      const dx = x - op.x;
      const dy = y - op.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2) minD2 = d2;
    }

    // If the lobby is empty, accept immediately.
    if (players.length === 0) return { x, y };

    // If we're safely far from everyone, accept early.
    if (minD2 >= targetD2) return { x, y };

    if (minD2 > bestMinDist2) {
      bestMinDist2 = minD2;
      best = { x, y };
    }
  }

  // Fallback: guarantee a non-blocked point.
  if (!best) {
    // 1) try exact spawn hints first (room centers)
    if (spawnHints && spawnHints.length) {
      for (const a of spawnHints) {
        if (!isBlocked(a.x, a.y)) {
          best = { x: a.x, y: a.y };
          break;
        }
      }
    }

    // 2) spiral search from the circle center
    if (!best) {
      const stepR = 180;
      const stepA = Math.PI / 6;
      for (let r = 0; r <= maxR; r += stepR) {
        for (let a = 0; a < Math.PI * 2; a += stepA) {
          const x = circle.cx + Math.cos(a) * r;
          const y = circle.cy + Math.sin(a) * r;
          if (!isBlocked(x, y)) {
            best = { x, y };
            break;
          }
        }
        if (best) break;
      }
    }

    // 3) last resort: center (even if blocked, extremely unlikely)
    if (!best) best = { x: circle.cx, y: circle.cy };
  }
  return best;
}

export function tryRespawn(sim, p, now, circle) {
  if (!p.dead) return;
  if (sim && sim.respawnEnabled === false) return;
  if (now < p.respawnAt) return;

  const pos = pickSafeSpawn(sim, circle);
  p.x = pos.x;
  p.y = pos.y;
  p.vx = 0;
  p.vy = 0;
  p.hp = p.maxHp;
  p.dead = false;
  // Extra safety: ensure protect window is set even if the kill flow changes.
  p.protectUntil = now + CONFIG.SPAWN_PROTECT_SEC;
}

export function spawnIntoCircle(sim, p, circle, now) {
  const pos = pickSafeSpawn(sim, circle);
  p.x = pos.x;
  p.y = pos.y;
  p.vx = 0;
  p.vy = 0;
  p.hp = p.maxHp;
  p.dead = false;
  p.respawnAt = 0;
  p.protectUntil = now + CONFIG.SPAWN_PROTECT_SEC;
}
