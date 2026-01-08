import { CONFIG } from '../sim/constants.js';
import { circlesOverlap } from '../math/collision.js';
import { applyXp } from '../entities/player.js';

export function collectOrbs(sim, now) {
  for (let i = sim.orbs.length - 1; i >= 0; i--) {
    const o = sim.orbs[i];
    for (const p of sim.players.values()) {
      if (p.dead) continue;
      if (circlesOverlap(p.x, p.y, CONFIG.PLAYER_RADIUS + 12, o.x, o.y, 3)) {
        applyXp(p, o.value);
        p.score += 1; // tiny score for pickup (optional)
        sim.orbs.splice(i, 1);
        break;
      }
    }
  }
}
