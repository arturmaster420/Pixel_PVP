import { CONFIG, clamp } from '../sim/constants.js';
import { segmentCircleTOI, segmentAabbTOI } from '../math/collision.js';
import { makeOrb } from '../entities/orb.js';
import { makeBuffPickup } from '../entities/buffPickup.js';
import { applyXp } from '../entities/player.js';
import { queryObstacleGrid } from './obstacles.js';
import { circleAabbOverlap } from '../math/collision.js';

export function updateBulletsAndHits(sim, dt, now) {
  const players = sim.players;
  // Move bullets, check swept collisions (prevents tunneling through thin cover / close targets)
  for (let i = sim.bullets.length - 1; i >= 0; i--) {
    const b = sim.bullets[i];

    const age = now - b.spawnedAt;
    if (age > b.life) {
      // Expire bullet. Explosive bullets detonate at their last position.
      if (b.explosive && b.splashR > 0) {
        explode(sim, b.ownerId, b.x, b.y, b, now, null);
      }
      sim.bullets.splice(i, 1);
      continue;
    }

    const x0 = b.x;
    const y0 = b.y;
    const x1 = x0 + b.vx * dt;
    const y1 = y0 + b.vy * dt;

    // Piercing bullets (e.g. Railgun) can pass through players.
    if (!b.explosive && ((b.piercePlayersLeft | 0) > 0)) {
      const removed = _updatePiercingBullet(sim, b, x0, y0, x1, y1, now, players);
      if (removed) sim.bullets.splice(i, 1);
      continue;
    }

    // advance bullet
    b.x = x1;
    b.y = y1;

    let bestT = null;
    let bestKind = null;
    let bestVictimId = null;

    // Bullet vs obstacles (cover): find earliest hit along the segment.
    // Use the obstacle spatial grid when available for perf.
    let obs = sim.obstacles;
    if (sim.obstacleGrid && sim.obstacleGrid.map) {
      const minX = Math.min(x0, x1) - b.r;
      const maxX = Math.max(x0, x1) + b.r;
      const minY = Math.min(y0, y1) - b.r;
      const maxY = Math.max(y0, y1) + b.r;
      obs = queryObstacleGrid(sim.obstacleGrid, minX, minY, maxX, maxY);
    }

    if (obs && obs.length) {
      for (let k = 0; k < obs.length; k++) {
        const o = obs[k];
        const t = segmentAabbTOI(x0, y0, x1, y1, o.x, o.y, o.w, o.h, b.r);
        if (t !== null && (bestT === null || t < bestT)) {
          bestT = t;
          bestKind = 'wall';
          bestVictimId = null;
        }
      }
    }

    // Bullet vs players: earliest hit (but do not override a wall hit at the same t)
    for (const p of players.values()) {
      if (p.dead) continue;
      if (p.id === b.ownerId) continue;
      if (now < p.protectUntil) continue;

      const t = segmentCircleTOI(x0, y0, x1, y1, p.x, p.y, b.r + CONFIG.PLAYER_RADIUS);
      if (t !== null && (bestT === null || t < bestT)) {
        bestT = t;
        bestKind = 'player';
        bestVictimId = p.id;
      }
    }

    if (bestKind === 'wall') {
      const hx = x0 + (x1 - x0) * (bestT ?? 1);
      const hy = y0 + (y1 - y0) * (bestT ?? 1);
      if (b.explosive && b.splashR > 0) {
        explode(sim, b.ownerId, hx, hy, b, now, null);
      }
      sim.bullets.splice(i, 1);
      continue;
    }

    if (bestKind === 'player' && bestVictimId) {
      sim.bullets.splice(i, 1);

      const victim = sim.players.get(bestVictimId) || null;
      const hx = x0 + (x1 - x0) * (bestT ?? 1);
      const hy = y0 + (y1 - y0) * (bestT ?? 1);

      if (b.explosive && b.splashR > 0) {
        // Detonate on the victim for consistent full damage on direct hits.
        const ex = victim ? victim.x : hx;
        const ey = victim ? victim.y : hy;
        explode(sim, b.ownerId, ex, ey, b, now, bestVictimId);
      } else {
        const res = applyDamage(sim, b.ownerId, bestVictimId, b.dmg, now);
        sim._emit({ t: 'hit', at: now, a: b.ownerId, v: bestVictimId, d: Math.round(res.applied), x: hx, y: hy });
      }
      continue;
    }
  }
}

function _updatePiercingBullet(sim, b, x0, y0, x1, y1, now, players) {
  // Note: b.explosive is false here.
  let sx = x0;
  let sy = y0;
  const ex = x1;
  const ey = y1;

  // Safety cap: rail can at most hit a couple of players per tick.
  for (let iter = 0; iter < 4; iter++) {
    let bestT = null;
    let bestKind = null;
    let bestVictimId = null;

    // Obstacles first (earliest hit on the segment).
    let obs = sim.obstacles;
    if (sim.obstacleGrid && sim.obstacleGrid.map) {
      const minX = Math.min(sx, ex) - b.r;
      const maxX = Math.max(sx, ex) + b.r;
      const minY = Math.min(sy, ey) - b.r;
      const maxY = Math.max(sy, ey) + b.r;
      obs = queryObstacleGrid(sim.obstacleGrid, minX, minY, maxX, maxY);
    }
    if (obs && obs.length) {
      for (let k = 0; k < obs.length; k++) {
        const o = obs[k];
        const t = segmentAabbTOI(sx, sy, ex, ey, o.x, o.y, o.w, o.h, b.r);
        if (t !== null && (bestT === null || t < bestT)) {
          bestT = t;
          bestKind = 'wall';
          bestVictimId = null;
        }
      }
    }

    // Players: earliest hit, but do not override a wall hit at the same t.
    for (const p of players.values()) {
      if (!p || p.dead) continue;
      if (p.id === b.ownerId) continue;
      if (now < p.protectUntil) continue;
      if (b.lastHitId && p.id === b.lastHitId && now < (b.ignoreHitUntil || 0)) continue;

      const t = segmentCircleTOI(sx, sy, ex, ey, p.x, p.y, b.r + CONFIG.PLAYER_RADIUS);
      if (t !== null && (bestT === null || t < bestT)) {
        bestT = t;
        bestKind = 'player';
        bestVictimId = p.id;
      }
    }

    if (bestT === null) {
      // No hit, advance bullet normally.
      b.x = ex;
      b.y = ey;
      return false;
    }

    const hx = sx + (ex - sx) * bestT;
    const hy = sy + (ey - sy) * bestT;

    if (bestKind === 'wall') {
      // Stop at wall.
      b.x = hx;
      b.y = hy;
      return true;
    }

    if (bestKind === 'player' && bestVictimId) {
      const res = applyDamage(sim, b.ownerId, bestVictimId, b.dmg, now);
      sim._emit({ t: 'hit', at: now, a: b.ownerId, v: bestVictimId, d: Math.round(res.applied), x: hx, y: hy });

      if ((b.piercePlayersLeft | 0) > 0) {
        b.piercePlayersLeft = (b.piercePlayersLeft | 0) - 1;
        b.lastHitId = bestVictimId;
        b.ignoreHitUntil = now + 0.06;

        // Continue along the remaining segment (skip past the victim).
        const dx = ex - sx;
        const dy = ey - sy;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) {
          b.x = hx;
          b.y = hy;
          return true;
        }
        const ux = dx / len;
        const uy = dy / len;
        sx = hx + ux * (b.r + CONFIG.PLAYER_RADIUS + 2);
        sy = hy + uy * (b.r + CONFIG.PLAYER_RADIUS + 2);

        // If we've effectively reached the end, keep bullet alive at end.
        if (Math.hypot(ex - sx, ey - sy) < 1e-3) {
          b.x = ex;
          b.y = ey;
          return false;
        }
        continue;
      }

      // No pierce left: bullet consumed on hit.
      b.x = hx;
      b.y = hy;
      return true;
    }

    // Fallback: advance.
    b.x = ex;
    b.y = ey;
    return false;
  }

  // If we hit too many times in one tick, just advance to end (safety).
  b.x = ex;
  b.y = ey;
  return false;
}




export function applyDamage(sim, attackerId, victimId, dmg, now) {
  const a = sim.players.get(attackerId);
  const v = sim.players.get(victimId);
  if (!v || v.dead) return { applied: 0, shielded: false, killed: false };

  const amount = Math.max(0, +dmg || 0);

  // shield consumes first
  if (v.shield > 0) {
    v.shield = 0;
    return { applied: 0, shielded: true, killed: false };
  }

  v.hp -= amount;
  v.damageFrom.set(attackerId, now);

  if (v.hp <= 0) {
    handleDeath(sim, attackerId, victimId, now);
    return { applied: amount, shielded: false, killed: true };
  }

  return { applied: amount, shielded: false, killed: false };
}

export function handleDeath(sim, killerId, victimId, now) {
  const killer = sim.players.get(killerId);
  const victim = sim.players.get(victimId);
  if (!victim || victim.dead) return;

  // victim stats
  victim.deaths = (victim.deaths || 0) + 1;

  // Drop 30% XP as orbs
  const dropXp = Math.floor(victim.xp * CONFIG.DROP_XP_RATIO_ON_DEATH);
  if (dropXp > 0) {
    victim.xp = Math.max(0, victim.xp - dropXp);
    victim.level = Math.max(1, Math.min(10, computeLevelFromThresholds(victim.xp)));

    const orbCount = clamp(Math.floor(dropXp / 25), 6, 20);
    const perOrb = Math.max(1, Math.floor(dropXp / orbCount));

    for (let i = 0; i < orbCount; i++) {
      const ang = (i / orbCount) * Math.PI * 2;
      const rad = 18 + (i % 3) * 10;
      sim.orbs.push(makeOrb({
        id: `o_${sim.nextOrbId++}`,
        x: victim.x + Math.cos(ang) * rad,
        y: victim.y + Math.sin(ang) * rad,
        value: perOrb
      }));
    }
  }

  // Victim state

  // Drop temporary buff pickups if victim had any active at death.
  // If multiple buffs are active, drop each (rare).
  const dropKinds = [];
  if (now < (victim.buffMsUntil || 0)) dropKinds.push('ms');
  if (now < (victim.buffAsUntil || 0)) dropKinds.push('as');
  if (now < (victim.buffDmgUntil || 0)) dropKinds.push('dmg');
  if (now < (victim.buffRegenUntil || 0)) dropKinds.push('regen');
  if (dropKinds.length) {
    for (const kind of dropKinds) {
      const pad = ((CONFIG.PLAYER_RADIUS ?? 14) + (CONFIG.BUFF_PICKUP_RADIUS ?? 18) + 10);
      const q = 120 + pad;
      // Try a few offsets so the pickup does not end up inside cover.
      let px = victim.x, py = victim.y;
      for (let t = 0; t < 6; t++) {
        const ang = (t / 6) * Math.PI * 2;
        const rad = (t === 0) ? 0 : (18 + t * 6);
        const x = victim.x + Math.cos(ang) * rad;
        const y = victim.y + Math.sin(ang) * rad;
        const obs = (sim && sim.obstacleGrid && sim.obstacleGrid.map)
          ? queryObstacleGrid(sim.obstacleGrid, x - q, y - q, x + q, y + q)
          : (sim.obstacles || []);
        let blocked = false;
        for (const o of obs) {
          if (circleAabbOverlap(x, y, pad, o.x, o.y, o.w, o.h)) { blocked = true; break; }
        }
        if (!blocked) { px = x; py = y; break; }
      }
      sim.buffPickups.push(makeBuffPickup({
        id: `pu_${sim.nextBuffPickupId++}`,
        x: px,
        y: py,
        kind
      }));
    }
  }
  // Buffs do not persist through death.
  victim.buffMsUntil = 0;
  victim.buffAsUntil = 0;
  victim.buffDmgUntil = 0;
  victim.buffRegenUntil = 0;
  victim.dead = true;
  victim.hp = 0;
  victim.streak = 0;
  victim.bloodlustStacks = 0;
  victim.bloodlustUntil = 0;
  victim.shield = 0;
  if (sim && sim.respawnEnabled === false) {
    // Sudden death: no more respawns.
    victim.respawnAt = 1e15;
    victim.protectUntil = 0;
  } else {
    victim.respawnAt = now + CONFIG.RESPAWN_DELAY_SEC;
    victim.protectUntil = victim.respawnAt + CONFIG.SPAWN_PROTECT_SEC;
  }

  // Killer rewards
  if (killer && !killer.dead) {
    killer.kills = (killer.kills || 0) + 1;
    killer.streak += 1;
    killer.score += CONFIG.SCORE_KILL + (CONFIG.SCORE_STREAK_BONUS_PER_KILL * killer.streak);
    applyXp(killer, CONFIG.XP_KILL);

    // Bloodlust
    killer.bloodlustStacks = Math.min(CONFIG.BLOODLUST_MAX_STACKS, killer.bloodlustStacks + 1);
    killer.bloodlustUntil = now + CONFIG.BLOODLUST_DURATION_SEC;
    if (killer.bloodlustStacks >= CONFIG.BLOODLUST_SHIELD_AT_STACKS) {
      killer.shield = 1;
    }
  }

  // Assists (anyone who damaged within window)
  for (const [aid, t] of victim.damageFrom.entries()) {
    if (aid === killerId) continue;
    if (now - t <= CONFIG.ASSIST_WINDOW_SEC) {
      const ap = sim.players.get(aid);
      if (!ap || ap.dead) continue;
      ap.assists = (ap.assists || 0) + 1;
      ap.score += CONFIG.SCORE_ASSIST;
      applyXp(ap, CONFIG.XP_ASSIST);
      sim._emit({ t: 'assist', at: now, a: aid, v: victimId });
    }
  }

  victim.damageFrom.clear();
  sim._emit({ t: 'kill', at: now, k: killerId, v: victimId });
}



function explode(sim, attackerId, x, y, bullet, now, directVictimId) {
  const radius = Math.max(0, +bullet.splashR || 0);
  if (radius <= 0) return;

  const minMul = (bullet.splashMinMul == null) ? 0.25 : +bullet.splashMinMul;
  const selfMul = (bullet.selfMul == null) ? 0.5 : +bullet.selfMul;
  const base = Math.max(0, +bullet.dmg || 0);

  // Visual event (client-side explosion VFX)
  sim._emit({ t: 'explode', at: now, a: attackerId, x, y, r: radius });

  // Apply splash damage with linear falloff.
  for (const p of sim.players.values()) {
    if (!p || p.dead) continue;
    if (now < p.protectUntil) continue;

    let dist = Math.hypot(p.x - x, p.y - y);
    if (directVictimId && p.id === directVictimId) dist = 0;

    if (dist > radius + CONFIG.PLAYER_RADIUS) continue;

    const t = Math.max(0, Math.min(1, 1 - (dist / Math.max(1e-6, radius))));
    const mul = minMul + (1 - minMul) * t;
    let dmg = base * mul;

    if (p.id === attackerId) dmg *= selfMul;

    const res = applyDamage(sim, attackerId, p.id, dmg, now);
    // Emit hit feedback per affected player (keeps it readable and matches existing FX).
    sim._emit({ t: 'hit', at: now, a: attackerId, v: p.id, d: Math.round(res.applied), x: p.x, y: p.y });
  }
}

function computeLevelFromThresholds(xp) {
  const t = CONFIG.XP_THRESHOLDS;
  let lvl = 1;
  for (let i = 0; i < t.length; i++) {
    if (xp >= t[i]) lvl = i + 1;
  }
  return Math.min(10, lvl);
}