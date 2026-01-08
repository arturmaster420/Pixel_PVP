import { CONFIG } from '../sim/constants.js';

export function applyStormDamage(sim, dt, circle) {
  for (const p of sim.players.values()) {
    if (p.dead) continue;

    const dx = p.x - circle.cx;
    const dy = p.y - circle.cy;
    const dist = Math.hypot(dx, dy);

    if (dist > circle.r) {
      p.hp -= circle.dmgPerSec * dt;
      if (p.hp <= 0) {
        // Environmental deaths: no killerId -> victim drops XP only, no kill rewards
        // We treat as killed by 'storm' pseudo id
        sim._emit({ t: 'stormDeath', at: sim.time, v: p.id });

        // Reuse death handling by calling combat.handleDeath through sim wrapper (done in sim.js)
        sim._pendingStormDeaths.push(p.id);
      }
    }
  }
}
