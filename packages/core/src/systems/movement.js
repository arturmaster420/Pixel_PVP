import { CONFIG } from '../sim/constants.js';
import { norm } from '../math/vec2.js';
import { resolveCircleAabb } from '../math/collision.js';
import { applyWorldBounds } from '../entities/player.js';
import { queryObstacleGrid } from './obstacles.js';

export function movePlayer(p, dt, now, obstaclesOrGrid = null) {
  if (p.dead) return;

  // Bloodlust speed bonus
  let speedMul = 1.0;
  if (now < p.bloodlustUntil) {
    speedMul += p.bloodlustStacks * CONFIG.BLOODLUST_MOVE_BONUS_PER_STACK;
  }

  // Temporary move-speed buff pickup
  if (now < (p.buffMsUntil || 0)) {
    speedMul *= (1 + (CONFIG.BUFF_BONUS_MUL ?? 0.20));
  }

  const [nx, ny] = norm(p.mvx, p.mvy);
  const speed = CONFIG.PLAYER_BASE_SPEED * speedMul;
  p.vx = nx * speed;
  p.vy = ny * speed;

  p.x += p.vx * dt;
  p.y += p.vy * dt;

  applyWorldBounds(p);

  // Collide with obstacles (server-authoritative). Use a spatial grid if available
  // to keep perf solid when we have many small rectangles.
  let obstacles = obstaclesOrGrid;
  if (obstaclesOrGrid && !Array.isArray(obstaclesOrGrid) && obstaclesOrGrid.map) {
    const m = 520; // query margin (bigger than typical cover pieces)
    obstacles = queryObstacleGrid(obstaclesOrGrid, p.x - m, p.y - m, p.x + m, p.y + m);
  }

  if (obstacles && obstacles.length) {
    for (let iter = 0; iter < 2; iter++) {
      let any = false;
      for (const o of obstacles) {
        const r = resolveCircleAabb(p.x, p.y, CONFIG.PLAYER_RADIUS, o.x, o.y, o.w, o.h);
        if (r.hit) {
          p.x = r.x;
          p.y = r.y;
          any = true;
        }
      }
      if (!any) break;
      applyWorldBounds(p);
    }
  }
}