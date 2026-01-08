import { distSq } from './vec2.js';

export function circlesOverlap(ax, ay, ar, bx, by, br) {
  const r = ar + br;
  return distSq(ax, ay, bx, by) <= r * r;
}

// Axis-aligned rectangle is represented by center (rx, ry) and size (rw, rh).
export function circleAabbOverlap(cx, cy, cr, rx, ry, rw, rh) {
  const hw = rw * 0.5;
  const hh = rh * 0.5;
  // closest point on rect to circle center
  const px = Math.max(rx - hw, Math.min(cx, rx + hw));
  const py = Math.max(ry - hh, Math.min(cy, ry + hh));
  const dx = cx - px;
  const dy = cy - py;
  return (dx * dx + dy * dy) <= cr * cr;
}

// Resolve circle-vs-AABB overlap by pushing the circle out.
// Returns { x, y, hit }.
export function resolveCircleAabb(cx, cy, cr, rx, ry, rw, rh) {
  const hw = rw * 0.5;
  const hh = rh * 0.5;

  const minX = rx - hw;
  const maxX = rx + hw;
  const minY = ry - hh;
  const maxY = ry + hh;

  const px = Math.max(minX, Math.min(cx, maxX));
  const py = Math.max(minY, Math.min(cy, maxY));

  let dx = cx - px;
  let dy = cy - py;
  const d2 = dx * dx + dy * dy;
  const r2 = cr * cr;
  if (d2 > r2) return { x: cx, y: cy, hit: false };

  // If circle center is inside rect, dx=dy=0; choose nearest side.
  if (d2 === 0) {
    const relX = cx - rx;
    const relY = cy - ry;
    const penX = (hw + cr) - Math.abs(relX);
    const penY = (hh + cr) - Math.abs(relY);
    if (penX < penY) {
      const sx = relX >= 0 ? 1 : -1;
      return { x: cx + sx * penX, y: cy, hit: true };
    }
    const sy = relY >= 0 ? 1 : -1;
    return { x: cx, y: cy + sy * penY, hit: true };
  }

  const dist = Math.sqrt(d2);
  const pen = cr - dist;
  dx /= dist;
  dy /= dist;
  return { x: cx + dx * pen, y: cy + dy * pen, hit: true };
}

export function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh, pad = 0) {
  const hw = (aw + bw) * 0.5 + pad;
  const hh = (ah + bh) * 0.5 + pad;
  return Math.abs(ax - bx) <= hw && Math.abs(ay - by) <= hh;
}


// Time of impact (TOI) for segment vs circle.
// Returns t in [0,1] where segment point = a + (b-a)*t hits the circle, or null if no hit.
export function segmentCircleTOI(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;

  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;

  // No movement (or extremely tiny): treat as point test.
  if (a <= 1e-12) {
    return c <= 0 ? 0 : null;
  }

  // If starting inside, immediate hit.
  if (c <= 0) return 0;

  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const s = Math.sqrt(disc);
  const t1 = (-b - s) / (2 * a);
  const t2 = (-b + s) / (2 * a);

  // Smallest t within [0,1]
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return null;
}

// Time of impact (TOI) for segment vs axis-aligned bounding box (AABB).
// AABB given by center (rx,ry) and size (rw,rh). `pad` expands the AABB by pad on each side.
// Returns t in [0,1] or null.
export function segmentAabbTOI(x0, y0, x1, y1, rx, ry, rw, rh, pad = 0) {
  const minX = rx - rw * 0.5 - pad;
  const maxX = rx + rw * 0.5 + pad;
  const minY = ry - rh * 0.5 - pad;
  const maxY = ry + rh * 0.5 + pad;

  const dx = x1 - x0;
  const dy = y1 - y0;

  let tmin = 0;
  let tmax = 1;

  // X slab
  if (Math.abs(dx) < 1e-12) {
    if (x0 < minX || x0 > maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - x0) * inv;
    let t2 = (maxX - x0) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return null;
  }

  // Y slab
  if (Math.abs(dy) < 1e-12) {
    if (y0 < minY || y0 > maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - y0) * inv;
    let t2 = (maxY - y0) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return null;
  }

  // If start is inside, tmin can be negative: clamp to 0.
  if (tmin < 0) tmin = 0;
  if (tmin > 1) return null;
  return tmin;
}
