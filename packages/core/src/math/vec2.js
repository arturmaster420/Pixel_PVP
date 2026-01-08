export function len(x, y) {
  return Math.hypot(x, y);
}

export function norm(x, y) {
  const l = Math.hypot(x, y);
  if (l < 1e-9) return [0, 0];
  return [x / l, y / l];
}

export function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function clampLen(x, y, maxLen) {
  const l = Math.hypot(x, y);
  if (l <= maxLen || l < 1e-9) return [x, y];
  const s = maxLen / l;
  return [x * s, y * s];
}
