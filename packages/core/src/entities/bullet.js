export function makeBullet({
  id,
  ownerId,
  x,
  y,
  vx,
  vy,
  dmg,
  r,
  life,
  spawnedAt,
  // optional fields for special bullets
  weaponId = null,
  explosive = false,
  splashR = 0,
  splashMinMul = 0.25,
  selfMul = 0.5,
  piercePlayersLeft = 0,
  lastHitId = null,
  ignoreHitUntil = 0
}) {
  return {
    id,
    ownerId,
    x,
    y,
    vx,
    vy,
    dmg,
    r,
    life,
    spawnedAt,
    weaponId,
    explosive,
    splashR,
    splashMinMul,
    selfMul,
    piercePlayersLeft,
    lastHitId,
    ignoreHitUntil
  };
}
