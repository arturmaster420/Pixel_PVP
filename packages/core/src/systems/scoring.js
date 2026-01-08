import { CONFIG } from '../sim/constants.js';
import { applyXp } from '../entities/player.js';

export function survivalTick(sim, dt) {
  for (const p of sim.players.values()) {
    if (p.dead) continue;
    p.score += CONFIG.SCORE_SURVIVAL_PER_SEC * dt;
    applyXp(p, CONFIG.XP_SURVIVAL_PER_SEC * dt);

    // Regen buff: heals over time (server-authoritative).
    if (sim.time < (p.buffRegenUntil || 0)) {
      const rate = (CONFIG.BUFF_REGEN_HP_PER_SEC ?? 2.0);
      if (rate > 0 && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + rate * dt);
      }
    }
  }
}
