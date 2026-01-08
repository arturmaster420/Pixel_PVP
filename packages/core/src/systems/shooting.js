import { CONFIG } from '../sim/constants.js';
import { norm } from '../math/vec2.js';
import { makeBullet } from '../entities/bullet.js';

export function tryShoot(sim, p, now) {
  if (p.dead) return;
  if (!p.fire) return;
  if (now < p.nextShotAt) return;

  const wid = sim.matchWeaponId || 'pistol';
  const weapon = (CONFIG.WEAPONS && CONFIG.WEAPONS[wid]) ? CONFIG.WEAPONS[wid] : CONFIG.PISTOL;
  const lvl = Math.max(1, Math.min(10, p.level));

  let dmgMul = 1 + weapon.dmgPerLevel * (lvl - 1);
  let fireMul = 1 + weapon.firePerLevel * (lvl - 1);
  const rangeMul = 1 + weapon.rangePerLevel * (lvl - 1);
  const speedMul = 1 + weapon.bulletSpeedPerLevel * (lvl - 1);

  if (now < p.bloodlustUntil) {
    fireMul *= (1 + p.bloodlustStacks * CONFIG.BLOODLUST_FIRE_BONUS_PER_STACK);
  }

  // Temporary buff pickups (+20% for 30s)
  if (now < (p.buffAsUntil || 0)) {
    fireMul *= (1 + (CONFIG.BUFF_BONUS_MUL ?? 0.20));
  }
  if (now < (p.buffDmgUntil || 0)) {
    dmgMul *= (1 + (CONFIG.BUFF_BONUS_MUL ?? 0.20));
  }

  const fireRate = weapon.baseFireRate * fireMul;
  const shotInterval = 1 / Math.max(0.1, fireRate);
  p.nextShotAt = now + shotInterval;

  const [ax, ay] = norm(p.aimx, p.aimy);
  if (ax === 0 && ay === 0) return;

  const bulletSpeed = weapon.baseBulletSpeed * speedMul;

  const explosive = !!weapon.explosive;
  const splashR = +weapon.splashRadius || 0;
  const splashMinMul = (weapon.splashMinMul == null) ? 0.25 : +weapon.splashMinMul;
  const selfMul = (weapon.selfMul == null) ? 0.5 : +weapon.selfMul;
  const piercePlayers = Math.max(0, weapon.piercePlayers | 0);

  const pellets = Math.max(1, weapon.pellets | 0);
  const spreadDeg = Math.max(0, +weapon.spreadDeg || 0);
  const spreadRad = spreadDeg * Math.PI / 180;

  // Deterministic spread pattern (no RNG). Symmetric around aim.
  for (let i = 0; i < pellets; i++) {
    let t = 0;
    if (pellets > 1) {
      t = (i / (pellets - 1)) * 2 - 1; // -1..1
    }
    const ang = Math.atan2(ay, ax) + t * (spreadRad * 0.5);
    const px = Math.cos(ang);
    const py = Math.sin(ang);
    const vx = px * bulletSpeed;
    const vy = py * bulletSpeed;

    // Keep bullet travel distance consistent with the weapon "range".
    // Previously, lifetime was a fixed seconds value, which could let bullets
    // fly beyond the intended range (and beyond camera framing).
    const maxDist = (weapon.baseRange * rangeMul);
    const lifeByRange = maxDist / Math.max(1, bulletSpeed);
    const life = Math.min(weapon.bulletLifeSec * rangeMul, lifeByRange);

    sim.bullets.push(makeBullet({
      id: `b_${sim.nextBulletId++}`,
      ownerId: p.id,
      x: p.x + px * (CONFIG.PLAYER_RADIUS + 2),
      y: p.y + py * (CONFIG.PLAYER_RADIUS + 2),
      vx,
      vy,
      dmg: weapon.baseDamage * dmgMul,
      r: weapon.bulletRadius,
      life,
      spawnedAt: now,
      weaponId: wid,
      explosive,
      splashR,
      splashMinMul,
      selfMul,
      piercePlayersLeft: piercePlayers
    }));
  }
}