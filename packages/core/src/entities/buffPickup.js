export function makeBuffPickup({ id, x, y, kind }) {
  return {
    id,
    x,
    y,
    // kind: 'ms' (move), 'as' (attack speed), 'dmg' (damage)
    kind
  };
}
