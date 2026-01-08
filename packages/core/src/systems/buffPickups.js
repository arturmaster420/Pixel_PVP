import { CONFIG } from '../sim/constants.js';
import { circlesOverlap } from '../math/collision.js';

function applyBuff(p, kind, now) {
  const dur = CONFIG.BUFF_DURATION_SEC ?? 30;
  const until = now + dur;

  if (kind === 'ms') p.buffMsUntil = until;
  else if (kind === 'as') p.buffAsUntil = until;
  else if (kind === 'dmg') p.buffDmgUntil = until;
  else if (kind === 'regen') p.buffRegenUntil = until;

  // Track per-match pickup count (for achievements/UI only)
  p.buffsCollected = ((p.buffsCollected | 0) || 0) + 1;
}

export function collectBuffPickups(sim, now) {
  const rPickup = CONFIG.BUFF_PICKUP_RADIUS ?? 10;

  for (let i = sim.buffPickups.length - 1; i >= 0; i--) {
    const pu = sim.buffPickups[i];
    // Defensive: older builds could create malformed pickups (NaN positions). Remove them.
    if (!pu || !Number.isFinite(pu.x) || !Number.isFinite(pu.y)) {
      sim.buffPickups.splice(i, 1);
      continue;
    }
    for (const p of sim.players.values()) {
      if (!p || p.dead) continue;
      // Slightly generous pickup radius so it feels responsive even under net smoothing.
      const pr = (CONFIG.PLAYER_RADIUS ?? 14) + 16;
      if (circlesOverlap(p.x, p.y, pr, pu.x, pu.y, rPickup)) {
        applyBuff(p, pu.kind, now);
        // Small event hook (client may ignore)
        sim._emit?.({ t: 'buff', at: now, p: p.id, k: pu.kind });
        sim.buffPickups.splice(i, 1);
        break;
      }
    }
  }
}
