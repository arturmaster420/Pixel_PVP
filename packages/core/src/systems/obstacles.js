import { CONFIG, clamp } from '../sim/constants.js';
import { aabbOverlap } from '../math/collision.js';

// Random obstacle generation.
// Obstacles are axis-aligned rectangles: { id, x, y, w, h }
//
// Design goal (per user feedback):
// - Not only long, uniform walls
// - Many varied covers: "glyph" shapes (letters like Z,V,X,F,H,K,Y,U,O,P...)
// - Balanced scale so they feel readable and not repetitive

// Map variants
// - default: scattered covers (glyphs + short walls)
// - labyrinth: a deterministic maze-like layout
// - pillars: grid-ish small cover pillars (high readability)
// - cross: 4-quadrant blocks with open lanes (fast rotations)

function mixU32(x) {
  // Cheap integer hash / mixer for deterministic randomness.
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}

function mapVariantFor(sim) {
  // Deterministic per (seed, mapId) without consuming sim._rngState,
  // so orbField RNG doesn't get coupled to the obstacle generator complexity.
  const midU = (sim.mapId >>> 0) || 0;
  // When no server lock is provided, cycle maps deterministically by mapId.
  // mapId starts from 1 after the first resetMatch.
  const variants = ['default', 'labyrinth', 'pillars', 'cross'];
  if (midU <= 0) return 'default';
  const idx = ((midU - 1) % variants.length + variants.length) % variants.length;
  return variants[idx];
}

function rand01(sim) {
  // Same LCG as orbField (shared sim._rngState)
  if (sim._rngState == null) sim._rngState = (sim.seed >>> 0) || 1;
  sim._rngState = (sim._rngState * 1664525 + 1013904223) >>> 0;
  return sim._rngState / 4294967296;
}

function randRange(sim, a, b) {
  return a + rand01(sim) * (b - a);
}

function randInt(sim, a, b) {
  // inclusive
  const x = Math.floor(randRange(sim, a, b + 1));
  return Math.max(a, Math.min(b, x));
}

function tieredRange(sim, min, max, smallCut = 0.48, midCut = 0.78) {
  // Produces more small/medium obstacles and occasional large ones.
  const u = rand01(sim);
  const span = max - min;
  const a = min;
  const b = min + span * smallCut;
  const c = min + span * midCut;
  if (u < 0.58) return randRange(sim, a, b);
  if (u < 0.92) return randRange(sim, b, c);
  return randRange(sim, c, max);
}

function dist(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

function insideCircle(x, y, circle, margin = 0) {
  return dist(x, y, circle.cx, circle.cy) <= (circle.r - margin);
}

function randomPointInAnnulus(sim, circle, rMin, rMax) {
  const a = rand01(sim) * Math.PI * 2;
  const u = rand01(sim);
  const r = Math.sqrt(u * (rMax * rMax - rMin * rMin) + rMin * rMin);
  return { x: circle.cx + Math.cos(a) * r, y: circle.cy + Math.sin(a) * r };
}

function groupBounds(rects) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x - r.w / 2);
    maxX = Math.max(maxX, r.x + r.w / 2);
    minY = Math.min(minY, r.y - r.h / 2);
    maxY = Math.max(maxY, r.y + r.h / 2);
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function computeGroupRadius(rects) {
  const b = groupBounds(rects);
  const hx = b.w / 2;
  const hy = b.h / 2;
  return Math.sqrt(hx * hx + hy * hy);
}

function canPlaceGroup(existing, group, pad) {
  for (const g of group) {
    for (const r of existing) {
      if (aabbOverlap(g.x, g.y, g.w, g.h, r.x, r.y, r.w, r.h, pad)) return false;
    }
  }
  return true;
}

function commitGroup(sim, existing, group) {
  for (const g of group) {
    existing.push({ id: `ob_${sim.nextObstacleId++}`, x: g.x, y: g.y, w: g.w, h: g.h });
  }
}

function rotateRectLocal(rect, rot) {
  // rect: {x,y,w,h} around origin (0,0)
  if (rot === 0) return rect;
  if (rot === 1) {
    // 90°: (x,y)->(y,-x), swap w/h
    return { x: rect.y, y: -rect.x, w: rect.h, h: rect.w };
  }
  if (rot === 2) {
    // 180°
    return { x: -rect.x, y: -rect.y, w: rect.w, h: rect.h };
  }
  // 270°
  return { x: -rect.y, y: rect.x, w: rect.h, h: rect.w };
}

function makeDiagSquares(x1, y1, x2, y2, steps, thick) {
  const out = [];
  const n = Math.max(2, steps | 0);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1));
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    out.push({ x, y, w: thick, h: thick });
  }
  return out;
}

function glyphLocalRects(type, scale, thick, steps) {
  // Build in local space around origin.
  const half = scale / 2;
  // inset controls how far strokes are from the edge (prevents huge flat blocks)
  const inset = clamp(thick * 1.15, thick * 0.85, half * 0.22);

  const left = -half + inset;
  const right = half - inset;
  const top = half - inset;
  const bottom = -half + inset;

  const midW = Math.max(thick, scale - inset * 2);
  const midH = Math.max(thick, scale - inset * 2);

  const rects = [];
  const add = (x, y, w, h) => rects.push({ x, y, w, h });

  switch (type) {
    case 'H': {
      add(left, 0, thick, scale);
      add(right, 0, thick, scale);
      add(0, 0, midW, thick);
      break;
    }
    case 'U': {
      const vH = Math.max(thick, midH * 0.92);
      add(left, thick * 0.10, thick, vH);
      add(right, thick * 0.10, thick, vH);
      add(0, bottom, midW, thick);
      break;
    }
    case 'O': {
      add(0, top, midW, thick);
      add(0, bottom, midW, thick);
      add(left, 0, thick, midH);
      add(right, 0, thick, midH);
      break;
    }
    case 'P': {
      add(left, 0, thick, scale);
      add(0, top, midW, thick);
      add(0, 0, midW * 0.92, thick);
      add(right, top * 0.35, thick, scale * 0.55);
      break;
    }
    case 'F': {
      add(left, 0, thick, scale);
      add(0, top, midW, thick);
      add(0, 0, midW * 0.85, thick);
      break;
    }
    case 'Z': {
      add(0, top, midW, thick);
      add(0, bottom, midW, thick);
      rects.push(...makeDiagSquares(right, top, left, bottom, steps, thick));
      break;
    }
    case 'V': {
      rects.push(...makeDiagSquares(left, top, 0, bottom, steps, thick));
      rects.push(...makeDiagSquares(right, top, 0, bottom, steps, thick));
      break;
    }
    case 'X': {
      rects.push(...makeDiagSquares(left, top, right, bottom, steps, thick));
      rects.push(...makeDiagSquares(left, bottom, right, top, steps, thick));
      break;
    }
    case 'Y': {
      rects.push(...makeDiagSquares(left, top, 0, thick * 0.15, steps, thick));
      rects.push(...makeDiagSquares(right, top, 0, thick * 0.15, steps, thick));
      add(0, -half * 0.28, thick, scale * 0.58);
      break;
    }
    case 'K': {
      add(left, 0, thick, scale);
      rects.push(...makeDiagSquares(-thick * 0.05, thick * 0.05, right, top, steps, thick));
      rects.push(...makeDiagSquares(-thick * 0.05, -thick * 0.05, right, bottom, steps, thick));
      break;
    }
    case 'T': {
      add(0, top, midW, thick);
      add(0, 0, thick, scale);
      break;
    }
    case 'L': {
      add(left, 0, thick, scale);
      add(0, bottom, midW, thick);
      break;
    }
    case 'E': {
      add(left, 0, thick, scale);
      add(0, top, midW, thick);
      add(0, 0, midW * 0.86, thick);
      add(0, bottom, midW, thick);
      break;
    }
    case 'C': {
      // Like 'O' but open on the right side.
      add(0, top, midW, thick);
      add(0, bottom, midW, thick);
      add(left, 0, thick, midH);
      // small right-side stubs to imply curvature
      add(right, top * 0.35, thick, scale * 0.22);
      add(right, bottom * 0.35, thick, scale * 0.22);
      break;
    }
    case 'S': {
      add(0, top, midW, thick);
      add(0, 0, midW * 0.92, thick);
      add(0, bottom, midW, thick);
      // upper-left and lower-right vertical strokes
      add(left, top * 0.28, thick, scale * 0.52);
      add(right, bottom * 0.28, thick, scale * 0.52);
      break;
    }
    case 'N': {
      add(left, 0, thick, scale);
      add(right, 0, thick, scale);
      rects.push(...makeDiagSquares(left, bottom, right, top, steps, thick));
      break;
    }
    case 'W': {
      // A "double V" made of 4 diagonal strokes.
      const x1 = left;
      const x2 = -scale * 0.18;
      const x3 = scale * 0.18;
      const x4 = right;
      rects.push(...makeDiagSquares(x1, top, x2, bottom, steps, thick));
      rects.push(...makeDiagSquares(x2, bottom, 0, top * 0.10, steps, thick));
      rects.push(...makeDiagSquares(0, top * 0.10, x3, bottom, steps, thick));
      rects.push(...makeDiagSquares(x3, bottom, x4, top, steps, thick));
      break;
    }
    case 'A': {
      rects.push(...makeDiagSquares(left, bottom, 0, top, steps, thick));
      rects.push(...makeDiagSquares(right, bottom, 0, top, steps, thick));
      add(0, 0, midW * 0.72, thick);
      break;
    }
    case 'M': {
      add(left, 0, thick, scale);
      add(right, 0, thick, scale);
      rects.push(...makeDiagSquares(left, top, 0, 0, steps, thick));
      rects.push(...makeDiagSquares(right, top, 0, 0, steps, thick));
      break;
    }
    case '+': {
      add(0, 0, midW * 0.80, thick);
      add(0, 0, thick, midH * 0.80);
      break;
    }
    default: {
      // fallback: short wall
      add(0, 0, scale, thick);
      break;
    }
  }

  return rects;
}

const GLYPH_TYPES = Object.freeze([
  'H','U','O','P','F','K','Y','V','X','Z','T','L','E',
  // New variety
  'C','S','N','W','A','M','+'
]);

// --- Spatial grid for faster collision queries ---------------------------
// Obstacles are static during a match, so we can index them once.
export function buildObstacleGrid(obstacles, cellSize = 420) {
  const map = new Map();
  const cs = Math.max(64, cellSize | 0);
  for (const o of obstacles) {
    const minX = o.x - o.w / 2;
    const maxX = o.x + o.w / 2;
    const minY = o.y - o.h / 2;
    const maxY = o.y + o.h / 2;
    const cx0 = Math.floor(minX / cs);
    const cx1 = Math.floor(maxX / cs);
    const cy0 = Math.floor(minY / cs);
    const cy1 = Math.floor(maxY / cs);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = `${cx},${cy}`;
        const arr = map.get(key);
        if (arr) arr.push(o);
        else map.set(key, [o]);
      }
    }
  }
  return { cellSize: cs, map };
}

export function queryObstacleGrid(grid, minX, minY, maxX, maxY) {
  if (!grid || !grid.map) return [];
  const cs = grid.cellSize;
  const cx0 = Math.floor(minX / cs);
  const cx1 = Math.floor(maxX / cs);
  const cy0 = Math.floor(minY / cs);
  const cy1 = Math.floor(maxY / cs);
  const out = [];
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const arr = grid.map.get(`${cx},${cy}`);
      if (arr) out.push(...arr);
    }
  }
  return out;
}

export function rebuildObstacleGrid(sim) {
  const cs = (CONFIG.OBSTACLES?.gridCellSize ?? 420);
  sim.obstacleGrid = buildObstacleGrid(sim.obstacles ?? [], cs);
}

function tryPlaceGlyph(sim, rects, circle) {
  const cfg = CONFIG.OBSTACLES;

  const type = GLYPH_TYPES[Math.floor(rand01(sim) * GLYPH_TYPES.length)];
  // Stronger size variety: many small/medium, occasional large.
  const scale = tieredRange(sim, cfg.glyphScaleMin, cfg.glyphScaleMax, 0.46, 0.78);
  const thick = tieredRange(sim, cfg.thickMin, cfg.thickMax, 0.55, 0.86);
  let steps = Math.round(randRange(sim, cfg.diagStepsMin, cfg.diagStepsMax));
  // Slightly more steps on larger glyphs so diagonals don't look too sparse.
  if (scale > (cfg.glyphScaleMin + (cfg.glyphScaleMax - cfg.glyphScaleMin) * 0.72)) steps += 1;
  steps = clamp(steps, 3, 7);

  // Local aspect ratio variance (wide/tall glyphs).
  let ax = 1;
  let ay = 1;
  if (rand01(sim) < 0.70) {
    ax = randRange(sim, 0.78, 1.38);
    ay = randRange(sim, 0.78, 1.38);
    // Keep most shapes only mildly stretched, with occasional stronger stretch.
    if (rand01(sim) < 0.65) {
      ax = clamp(ax, 0.86, 1.22);
      ay = clamp(ay, 0.86, 1.22);
    }
  }

  // Local rects around origin
  let local = glyphLocalRects(type, scale, thick, steps);
  if (ax !== 1 || ay !== 1) {
    local = local.map(r => ({
      x: r.x * ax,
      y: r.y * ay,
      w: Math.max(1, r.w * ax),
      h: Math.max(1, r.h * ay)
    }));
  }

  // Random transforms (mirror + rotate by 90° increments)
  const sx = rand01(sim) < 0.5 ? 1 : -1;
  const sy = rand01(sim) < 0.5 ? 1 : -1;
  const rot = Math.floor(rand01(sim) * 4);

  const transformed = local.map(r => {
    // mirror first
    const m = { x: r.x * sx, y: r.y * sy, w: r.w, h: r.h };
    // then rotate
    return rotateRectLocal(m, rot);
  });

  const groupR = computeGroupRadius(transformed) + cfg.pad;
  const rMin = circle.r * cfg.centerClearMul + groupR;
  const rMax = circle.r * cfg.edgeMarginMul - groupR;
  if (rMax <= rMin + 50) return false;

  const tries = 110;
  for (let t = 0; t < tries; t++) {
    const p = randomPointInAnnulus(sim, circle, rMin, rMax);

    // translate group
    const group = transformed.map(r => ({ x: p.x + r.x, y: p.y + r.y, w: r.w, h: r.h }));

    // quick inside check: group corners approx
    if (!insideCircle(p.x, p.y, circle, groupR)) continue;

    if (!canPlaceGroup(rects, group, cfg.pad)) continue;

    commitGroup(sim, rects, group);
    return true;
  }
  return false;
}

function tryPlaceShortWall(sim, rects, circle) {
  // Extra variety: not only single bars.
  // We keep these "short wall" kits cheap (few rectangles), but they create
  // corners / zigzags / pillar clusters that feel more natural in PvP.
  const cfg = CONFIG.OBSTACLES;

  const baseLen = tieredRange(sim, cfg.wallLenMin, cfg.wallLenMax, 0.55, 0.86);
  const thick = tieredRange(sim, cfg.thickMin, cfg.thickMax, 0.60, 0.88);

  const u = rand01(sim);
  let variant = 'single';
  if (u < 0.22) variant = 'pillars';
  else if (u < 0.48) variant = 'corner';
  else if (u < 0.66) variant = 'zig';

  /** @type {{x:number,y:number,w:number,h:number}[]} */
  let local = [];

  if (variant === 'pillars') {
    const count = randInt(sim, 3, 7);
    const spread = randRange(sim, 90, 240);
    for (let i = 0; i < count; i++) {
      // Pillars have their own size variability.
      const w = tieredRange(sim, 28, 96, 0.55, 0.86);
      const h = tieredRange(sim, 28, 140, 0.55, 0.86);

      // Try a few times to avoid huge overlaps inside the same cluster.
      let px = 0, py = 0;
      for (let tr = 0; tr < 6; tr++) {
        px = randRange(sim, -spread, spread);
        py = randRange(sim, -spread, spread);
        let overlap = false;
        for (const r of local) {
          if (aabbOverlap(px, py, w, h, r.x, r.y, r.w, r.h, 4)) { overlap = true; break; }
        }
        if (!overlap) break;
      }
      local.push({ x: px, y: py, w, h });
    }
  } else if (variant === 'corner') {
    const lenA = baseLen;
    const lenB = Math.max(48, baseLen * randRange(sim, 0.55, 0.85));
    // L-shape: one long bar + one shorter bar perpendicular and offset.
    local.push({ x: 0, y: 0, w: lenA, h: thick });
    local.push({ x: -lenA * 0.32, y: lenB * 0.18, w: thick, h: lenB });
  } else if (variant === 'zig') {
    const lenA = Math.max(50, baseLen * 0.95);
    const lenB = Math.max(50, baseLen * 0.75);
    // Small zigzag cover made of 3 segments.
    local.push({ x: 0, y: 0, w: lenA, h: thick });
    local.push({ x: -lenA * 0.24, y: lenB * 0.18, w: thick, h: lenB });
    local.push({ x: -lenA * 0.20, y: lenB * 0.42, w: lenB, h: thick });
  } else {
    // single
    local.push({ x: 0, y: 0, w: baseLen, h: thick });
  }

  // Random transforms (rotate in 90° increments, plus mild mirroring).
  const sx = rand01(sim) < 0.5 ? 1 : -1;
  const sy = rand01(sim) < 0.5 ? 1 : -1;
  const rot = Math.floor(rand01(sim) * 4);
  const transformed = local.map(r => rotateRectLocal({ x: r.x * sx, y: r.y * sy, w: r.w, h: r.h }, rot));

  const groupR = computeGroupRadius(transformed) + cfg.pad;
  const rMin = circle.r * cfg.centerClearMul + groupR;
  const rMax = circle.r * cfg.edgeMarginMul - groupR;
  if (rMax <= rMin + 50) return false;

  const tries = 130;
  for (let t = 0; t < tries; t++) {
    const p = randomPointInAnnulus(sim, circle, rMin, rMax);
    if (!insideCircle(p.x, p.y, circle, groupR)) continue;

    const group = transformed.map(r => ({ x: p.x + r.x, y: p.y + r.y, w: r.w, h: r.h }));
    if (!canPlaceGroup(rects, group, cfg.pad)) continue;

    commitGroup(sim, rects, group);
    return true;
  }
  return false;
}

function addCoreCover(sim, rects, circle) {
  const cfg = CONFIG.OBSTACLES;
  const thick = randRange(sim, cfg.thickMin, cfg.thickMax);
  // Keep the core cover in the same "scale family" as the rest of the obstacles.
  // (User requested overall obstacles ~2-3x smaller.)
  const len = clamp(circle.r * 0.03, cfg.wallLenMin * 1.4, cfg.wallLenMax * 1.25);
  const coreR = clamp(circle.r * 0.11, 520, 980);

  const candidates = [
    { x: circle.cx + coreR, y: circle.cy, w: len, h: thick },
    { x: circle.cx - coreR, y: circle.cy, w: len, h: thick },
    { x: circle.cx, y: circle.cy + coreR, w: thick, h: len },
    { x: circle.cx, y: circle.cy - coreR, w: thick, h: len }
  ];

  for (const c of candidates) {
    if (!insideCircle(c.x, c.y, circle, 220)) continue;
    let ok = true;
    for (const r of rects) {
      if (aabbOverlap(c.x, c.y, c.w, c.h, r.x, r.y, r.w, r.h, cfg.pad)) { ok = false; break; }
    }
    if (ok) rects.push({ id: `ob_${sim.nextObstacleId++}`, ...c });
  }
}

// -----------------------------------------------------------------------------
// Labyrinth ("second map")
// Server-authoritative maze-like obstacle layout.
// We generate a cell-based maze and then merge contiguous wall segments into
// longer rectangles to keep obstacle count reasonable for network payload size.
// -----------------------------------------------------------------------------

function makeLocalRng(seedU32) {
  let s = (seedU32 >>> 0) || 1;
  return {
    nextU32() {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s;
    },
    next01() {
      return this.nextU32() / 4294967296;
    },
    int(a, b) {
      const u = this.next01();
      return a + Math.floor(u * (b - a + 1));
    },
    pick(arr) {
      return arr[this.int(0, arr.length - 1)];
    }
  };
}

function carveRoomsInMaze(vWalls, hWalls, w, h, rooms) {
  // Each room: {cx, cy, rx, ry} in cell units.
  const rm = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    // remove all 4 walls around this cell (internal joins handled by loops)
    // (keeps it more open)
    vWalls[x][y] = false;       // left
    vWalls[x + 1][y] = false;   // right
    hWalls[x][y] = false;       // top
    hWalls[x][y + 1] = false;   // bottom
  };

  for (const r of rooms) {
    const x0 = clamp((r.cx - r.rx) | 0, 0, w - 1);
    const x1 = clamp((r.cx + r.rx) | 0, 0, w - 1);
    const y0 = clamp((r.cy - r.ry) | 0, 0, h - 1);
    const y1 = clamp((r.cy + r.ry) | 0, 0, h - 1);

    // Clear internal walls between cells inside the room rectangle.
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        rm(x, y);

        // internal vertical boundaries
        if (x < x1) vWalls[x + 1][y] = false;
        // internal horizontal boundaries
        if (y < y1) hWalls[x][y + 1] = false;
      }
    }
  }
}

function generateLabyrinthObstacles(sim, circle) {
  const rects = sim.obstacles;
  const cfg = CONFIG.OBSTACLES;

  // Expose deterministic spawn hint points for respawn logic.
  // This helps avoid rare cases where random sampling misses valid corridors
  // in dense maze layouts.
  sim.spawnPoints = [];

  // Maze parameters tuned for this project scale (circle radius ~8000)
  // User request: make passages narrower by placing walls closer and more often,
  // NOT by making walls thicker. We do this by using a smaller cell size and a
  // higher grid resolution, while keeping wall thickness the same.
  // Approx. clear corridor width ~= (cellSize - wallT).
  // Keep wall thickness unchanged; make the maze denser by using smaller cells
  // + a slightly higher grid resolution (but still under maxRects).
  const cellSize = 340;
  const wallT = 44;
  const w = 27;
  const h = 27;
  const spanX = w * cellSize;
  const spanY = h * cellSize;
  const ox = circle.cx - spanX / 2;
  const oy = circle.cy - spanY / 2;

  // Local deterministic RNG (do not touch sim._rngState)
  const seedU = (sim.seed >>> 0) || 1;
  const midU = (sim.mapId >>> 0) || 0;
  const rng = makeLocalRng(mixU32(seedU ^ Math.imul(midU + 11, 0x85ebca6b)));

  // Wall grids:
  // vWalls[i][j] for i=0..w (vertical boundaries), j=0..h-1
  // hWalls[i][j] for i=0..w-1, j=0..h (horizontal boundaries)
  const vWalls = Array.from({ length: w + 1 }, () => Array.from({ length: h }, () => true));
  const hWalls = Array.from({ length: w }, () => Array.from({ length: h + 1 }, () => true));

  // DFS maze carve
  const visited = Array.from({ length: w }, () => Array.from({ length: h }, () => false));
  const stack = [];
  const sx = rng.int(0, w - 1);
  const sy = rng.int(0, h - 1);
  stack.push([sx, sy]);
  visited[sx][sy] = true;

  const dirs = [
    [1, 0, 'E'],
    [-1, 0, 'W'],
    [0, 1, 'S'],
    [0, -1, 'N']
  ];

  const shuffleDirs = () => {
    // Fisher-Yates on a copy
    const a = dirs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    let progressed = false;
    for (const [dx, dy, d] of shuffleDirs()) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (visited[nx][ny]) continue;

      // remove wall between (cx,cy) and (nx,ny)
      if (d === 'E') vWalls[cx + 1][cy] = false;
      else if (d === 'W') vWalls[cx][cy] = false;
      else if (d === 'S') hWalls[cx][cy + 1] = false;
      else if (d === 'N') hWalls[cx][cy] = false;

      visited[nx][ny] = true;
      stack.push([nx, ny]);
      progressed = true;
      break;
    }
    if (!progressed) stack.pop();
  }

  // Add many loops + prune dead-ends (more passages, fewer "one-way" corridors).
  // A perfect DFS maze has lots of dead-ends. For PvP we want more cycles and connectivity.
  const cells = w * h;

  // Extra connections between random adjacent cells (opens walls regardless of visited state).
  // More passages requested: raise the amount of extra openings substantially.
  // We keep the maze "dense" (small cells) but add more connectivity, so it feels less like
  // a dead-end crawler and more like a PvP arena with multiple routes.
  const extraLoops = Math.max(200, Math.floor(cells * 0.62));
  for (let k = 0; k < extraLoops; k++) {
    const x = rng.int(0, w - 1);
    const y = rng.int(0, h - 1);
    const [dx, dy, d] = rng.pick(dirs);
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
    if (d === 'E') vWalls[x + 1][y] = false;
    else if (d === 'W') vWalls[x][y] = false;
    else if (d === 'S') hWalls[x][y + 1] = false;
    else if (d === 'N') hWalls[x][y] = false;
  }

  // Dead-end reduction pass: if a cell has only 0/1 exits, open an additional wall with high probability.
  // Do a few passes so we don't miss newly-created dead-ends.
  const degree = (x, y) => {
    let c = 0;
    // W
    if (x > 0 && vWalls[x][y] === false) c++;
    // E
    if (x < w - 1 && vWalls[x + 1][y] === false) c++;
    // N
    if (y > 0 && hWalls[x][y] === false) c++;
    // S
    if (y < h - 1 && hWalls[x][y + 1] === false) c++;
    return c;
  };

  const openRandomClosedWall = (x, y) => {
    const opts = [];
    // W
    if (x > 0 && vWalls[x][y] === true) opts.push('W');
    // E
    if (x < w - 1 && vWalls[x + 1][y] === true) opts.push('E');
    // N
    if (y > 0 && hWalls[x][y] === true) opts.push('N');
    // S
    if (y < h - 1 && hWalls[x][y + 1] === true) opts.push('S');

    if (!opts.length) return;
    const d = opts[rng.int(0, opts.length - 1)];
    if (d === 'E') vWalls[x + 1][y] = false;
    else if (d === 'W') vWalls[x][y] = false;
    else if (d === 'S') hWalls[x][y + 1] = false;
    else if (d === 'N') hWalls[x][y] = false;
  };

  for (let pass = 0; pass < 5; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (degree(x, y) <= 1 && rng.next01() < 0.97) {
          openRandomClosedWall(x, y);
        }
      }
    }
  }

  // If the maze still feels too "branchy" in a bad way (long 2-degree corridors),
  // open a few extra connections on degree-2 cells to add alternative routes.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (degree(x, y) === 2 && rng.next01() < 0.20) {
        openRandomClosedWall(x, y);
      }
    }
  }


  // Carve a few safe "rooms" to help spawns and make landmarks.
  carveRoomsInMaze(vWalls, hWalls, w, h, [
    { cx: (w / 2) | 0, cy: (h / 2) | 0, rx: 1, ry: 1 }, // center
    { cx: 3, cy: 3, rx: 1, ry: 1 },
    { cx: w - 4, cy: 3, rx: 1, ry: 1 },
    { cx: 3, cy: h - 4, rx: 1, ry: 1 },
    { cx: w - 4, cy: h - 4, rx: 1, ry: 1 }
  ]);

  // Record spawn hint points at the room centers (world coordinates).
  // These are guaranteed to be open due to room carving.
  const roomCenters = [
    [(w / 2) | 0, (h / 2) | 0],
    [3, 3],
    [w - 4, 3],
    [3, h - 4],
    [w - 4, h - 4]
  ];
  for (const [rcx, rcy] of roomCenters) {
    const x = ox + (rcx + 0.5) * cellSize;
    const y = oy + (rcy + 0.5) * cellSize;
    sim.spawnPoints.push({ x, y });
  }

  // Create 4 outer entrances (wider than 1 cell) so the maze is accessible from outside.
  const openSpan = 4;
  const midX = (w / 2) | 0;
  const midY = (h / 2) | 0;
  for (let t = -openSpan; t <= openSpan; t++) {
    const xi = clamp(midX + t, 0, w - 1);
    const yi = clamp(midY + t, 0, h - 1);
    // top/bottom
    hWalls[xi][0] = false;
    hWalls[xi][h] = false;
    // left/right
    vWalls[0][yi] = false;
    vWalls[w][yi] = false;
  }

  const pushRect = (x, y, rw, rh) => {
    // Keep everything comfortably inside the initial storm circle.
    const margin = Math.sqrt((rw / 2) * (rw / 2) + (rh / 2) * (rh / 2)) + 10;
    if (!insideCircle(x, y, circle, margin)) return;
    rects.push({ id: `ob_${sim.nextObstacleId++}`, x, y, w: rw, h: rh });
  };

  // Merge vertical wall segments into long rects.
  for (let i = 0; i <= w; i++) {
    let j = 0;
    while (j < h) {
      if (!vWalls[i][j]) { j++; continue; }
      const start = j;
      while (j < h && vWalls[i][j]) j++;
      const end = j - 1;
      const runLen = end - start + 1;
      const x = ox + i * cellSize;
      const y0 = oy + (start + 0.5) * cellSize;
      const y1 = oy + (end + 0.5) * cellSize;
      const y = (y0 + y1) / 2;
      pushRect(x, y, wallT, runLen * cellSize);
      if (rects.length >= cfg.maxRects) return;
    }
  }

  // Merge horizontal wall segments into long rects.
  for (let j = 0; j <= h; j++) {
    let i = 0;
    while (i < w) {
      if (!hWalls[i][j]) { i++; continue; }
      const start = i;
      while (i < w && hWalls[i][j]) i++;
      const end = i - 1;
      const runLen = end - start + 1;
      const y = oy + j * cellSize;
      const x0 = ox + (start + 0.5) * cellSize;
      const x1 = ox + (end + 0.5) * cellSize;
      const x = (x0 + x1) / 2;
      pushRect(x, y, runLen * cellSize, wallT);
      if (rects.length >= cfg.maxRects) return;
    }
  }
}

// -----------------------------------------------------------------------------
// Pillars map
// Readable arena with many small covers. Good for learning weapons.
// Deterministic per (seed,mapId), does not touch sim._rngState.
// -----------------------------------------------------------------------------

function generatePillarsObstacles(sim, circle) {
  const rects = sim.obstacles;
  const cfg = CONFIG.OBSTACLES;

  // Provide spawn hints: 8 points around mid-ring.
  sim.spawnPoints = [];
  const spR = circle.r * 0.55;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    sim.spawnPoints.push({ x: circle.cx + Math.cos(a) * spR, y: circle.cy + Math.sin(a) * spR });
  }

  const seedU = (sim.seed >>> 0) || 1;
  const midU = (sim.mapId >>> 0) || 0;
  const rng = makeLocalRng(mixU32(seedU ^ Math.imul(midU + 101, 0x9e3779b1)));

  const area = circle.r * 0.78;
  const spacing = 780;
  const jitter = 90;

  // Keep the very center slightly clearer.
  const centerClear = circle.r * 0.14;

  const startX = circle.cx - area + rng.next01() * spacing * 0.5;
  const startY = circle.cy - area + rng.next01() * spacing * 0.5;

  const tryPush = (x, y, w, h) => {
    const margin = Math.sqrt((w / 2) * (w / 2) + (h / 2) * (h / 2)) + 12;
    if (!insideCircle(x, y, circle, margin)) return false;
    for (let i = 0; i < rects.length; i++) {
      const o = rects[i];
      if (aabbOverlap(x, y, w, h, o.x, o.y, o.w, o.h, cfg.pad)) return false;
    }
    rects.push({ id: `ob_${sim.nextObstacleId++}`, x, y, w, h });
    return true;
  };

  // Pillars grid (thinned). We bias toward more pillars outside the center.
  for (let y = startY; y <= circle.cy + area; y += spacing) {
    for (let x = startX; x <= circle.cx + area; x += spacing) {
      if (rects.length >= cfg.maxRects) break;
      // Thin the grid slightly to keep movement flowing.
      if (rng.next01() > 0.62) continue;

      const jx = (rng.next01() * 2 - 1) * jitter;
      const jy = (rng.next01() * 2 - 1) * jitter;
      const px = x + jx;
      const py = y + jy;

      const d = dist(px, py, circle.cx, circle.cy);
      if (d < centerClear && rng.next01() < 0.75) continue;

      const s = 110 + rng.next01() * 120;
      const w = s;
      const h = s;
      tryPush(px, py, w, h);
    }
    if (rects.length >= cfg.maxRects) break;
  }

  // Add a little core cover (4 small bars), but keep it light for readability.
  const coreR = circle.r * 0.16;
  const len = 520;
  const thick = 64;
  const core = [
    { x: circle.cx + coreR, y: circle.cy, w: len, h: thick },
    { x: circle.cx - coreR, y: circle.cy, w: len, h: thick },
    { x: circle.cx, y: circle.cy + coreR, w: thick, h: len },
    { x: circle.cx, y: circle.cy - coreR, w: thick, h: len }
  ];
  for (const c of core) {
    if (rects.length >= cfg.maxRects) break;
    tryPush(c.x, c.y, c.w, c.h);
  }
}

// -----------------------------------------------------------------------------
// Cross map
// Four quadrant blocks leaving clear lanes along X/Y (fast rotations).
// Deterministic per (seed,mapId), does not touch sim._rngState.
// -----------------------------------------------------------------------------

function generateCrossObstacles(sim, circle) {
  const rects = sim.obstacles;
  const cfg = CONFIG.OBSTACLES;

  // Spawn hints: 8 points on diagonals and axes.
  sim.spawnPoints = [];
  const spR = circle.r * 0.58;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    sim.spawnPoints.push({ x: circle.cx + Math.cos(a) * spR, y: circle.cy + Math.sin(a) * spR });
  }

  const seedU = (sim.seed >>> 0) || 1;
  const midU = (sim.mapId >>> 0) || 0;
  const rng = makeLocalRng(mixU32(seedU ^ Math.imul(midU + 777, 0x7f4a7c15)));

  const gap = 1500;
  const block = 2600;
  const off = gap * 0.5 + block * 0.5;

  const tryPush = (x, y, w, h) => {
    const margin = Math.sqrt((w / 2) * (w / 2) + (h / 2) * (h / 2)) + 12;
    if (!insideCircle(x, y, circle, margin)) return false;
    for (let i = 0; i < rects.length; i++) {
      const o = rects[i];
      if (aabbOverlap(x, y, w, h, o.x, o.y, o.w, o.h, cfg.pad)) return false;
    }
    rects.push({ id: `ob_${sim.nextObstacleId++}`, x, y, w, h });
    return true;
  };


// Quadrant blocks: split each big block into 2-7 smaller squares (more cover variety).
// Keeps the central X/Y lanes open by constraining square centers away from the lane edges.
const blocks = [
  { sx: 1, sy: 1 },
  { sx: -1, sy: 1 },
  { sx: 1, sy: -1 },
  { sx: -1, sy: -1 }
];

const laneEdge = gap * 0.5;
const jitter = block * 0.18;

for (const b of blocks) {
  const count = 2 + (rng.nextU32() % 6); // 2..7
  let placed = 0;
  let tries = 0;

  const placeSquare = (side) => {
    // Sample around the quadrant center, but clamp away from the central lanes.
    let cx = circle.cx + b.sx * off + (rng.next01() * 2 - 1) * jitter;
    let cy = circle.cy + b.sy * off + (rng.next01() * 2 - 1) * jitter;

    if (b.sx > 0) {
      const minCx = circle.cx + laneEdge + side * 0.5 + 110;
      cx = Math.max(cx, minCx);
    } else {
      const maxCx = circle.cx - laneEdge - side * 0.5 - 110;
      cx = Math.min(cx, maxCx);
    }

    if (b.sy > 0) {
      const minCy = circle.cy + laneEdge + side * 0.5 + 110;
      cy = Math.max(cy, minCy);
    } else {
      const maxCy = circle.cy - laneEdge - side * 0.5 - 110;
      cy = Math.min(cy, maxCy);
    }

    return tryPush(cx, cy, side, side);
  };

  // Anchor square (bigger), then smaller ones around it.
  const anchorSide = clamp(1100 + rng.next01() * 700, 900, block * 0.82);
  if (placeSquare(anchorSide)) placed += 1;

  while (placed < count && tries < count * 24) {
    tries++;
    const side = clamp(720 + rng.next01() * 880, 560, block * 0.74);
    if (placeSquare(side)) placed++;
  }
}

  // Corner pillars at the lane junctions to add cover without blocking lanes.
  const p = gap * 0.5;
  const ps = 220;
  const corners = [
    { x: circle.cx + p, y: circle.cy + p },
    { x: circle.cx - p, y: circle.cy + p },
    { x: circle.cx + p, y: circle.cy - p },
    { x: circle.cx - p, y: circle.cy - p }
  ];
  for (const c of corners) {
    if (rects.length >= cfg.maxRects) break;
    const s = ps + (rng.next01() * 2 - 1) * 50;
    tryPush(c.x, c.y, s, s);
  }

  // Add 2 thin bars near center (do not seal the lanes).
  const barLen = 900;
  const barT = 64;
  const barOff = 520;
  tryPush(circle.cx + barOff, circle.cy, barLen, barT);
  tryPush(circle.cx - barOff, circle.cy, barLen, barT);
  tryPush(circle.cx, circle.cy + barOff, barT, barLen);
  tryPush(circle.cx, circle.cy - barOff, barT, barLen);
}

export function generateObstacles(sim, circle) {
  sim.obstacles.length = 0;
  // Reset optional spawn hints each time we (re)generate a map.
  // Some maps (e.g. labyrinth) provide deterministic spawn centers.
  sim.spawnPoints = null;
  if (!CONFIG.OBSTACLES.enabled) return;

  // Reset obstacle id counter per map for cleanliness.
  sim.nextObstacleId = 1;

  // Decide which map variant to generate for this match.
  // Server may lock a variant for the current match via sim.matchMapVariant.
  const locked = (typeof sim?.matchMapVariant === 'string' && sim.matchMapVariant) ? sim.matchMapVariant : null;
  const variant = locked || mapVariantFor(sim);
  sim.mapVariant = variant;
  if (variant === 'labyrinth') {
    generateLabyrinthObstacles(sim, circle);
    // Cap (network safety)
    const cfg = CONFIG.OBSTACLES;
    if (sim.obstacles.length > cfg.maxRects) sim.obstacles.length = cfg.maxRects;
    return;
  }

  if (variant === 'pillars') {
    generatePillarsObstacles(sim, circle);
    const cfg = CONFIG.OBSTACLES;
    if (sim.obstacles.length > cfg.maxRects) sim.obstacles.length = cfg.maxRects;
    return;
  }

  if (variant === 'cross') {
    generateCrossObstacles(sim, circle);
    const cfg = CONFIG.OBSTACLES;
    if (sim.obstacles.length > cfg.maxRects) sim.obstacles.length = cfg.maxRects;
    return;
  }

  const rects = sim.obstacles;
  const cfg = CONFIG.OBSTACLES;

  // First: a small predictable core cover (helps readability + fight hotspot)
  addCoreCover(sim, rects, circle);

  // Then: varied glyph shapes
  let gPlaced = 0;
  const gTries = cfg.glyphCount * 3;
  for (let i = 0; i < gTries && gPlaced < cfg.glyphCount; i++) {
    if (tryPlaceGlyph(sim, rects, circle)) gPlaced++;
    if (rects.length >= cfg.maxRects) break;
  }

  // Then: short walls for extra micro-cover
  let wPlaced = 0;
  const wTries = cfg.shortWallCount * 3;
  for (let i = 0; i < wTries && wPlaced < cfg.shortWallCount; i++) {
    if (tryPlaceShortWall(sim, rects, circle)) wPlaced++;
    if (rects.length >= cfg.maxRects) break;
  }

  // Safety: ensure we always have some cover.
  if (rects.length < 18) {
    // Add a few guaranteed short walls closer to mid-ring
    const target = 18;
    for (let i = rects.length; i < target; i++) {
      const len = randRange(sim, cfg.wallLenMin, Math.min(cfg.wallLenMax, 420));
      const thick = randRange(sim, cfg.thickMin, cfg.thickMax);
      const vertical = rand01(sim) < 0.5;
      const w = vertical ? thick : len;
      const h = vertical ? len : thick;

      const groupR = Math.sqrt((w / 2) * (w / 2) + (h / 2) * (h / 2)) + cfg.pad;
      const rMin = circle.r * 0.18 + groupR;
      const rMax = circle.r * 0.55 - groupR;
      if (rMax <= rMin + 50) continue;

      const p = randomPointInAnnulus(sim, circle, rMin, rMax);
      if (!insideCircle(p.x, p.y, circle, groupR)) continue;

      let ok = true;
      for (const r of rects) {
        if (aabbOverlap(p.x, p.y, w, h, r.x, r.y, r.w, r.h, cfg.pad)) { ok = false; break; }
      }
      if (!ok) continue;
      rects.push({ id: `ob_${sim.nextObstacleId++}`, x: p.x, y: p.y, w, h });
    }
  }

  // Cap (network safety)
  if (rects.length > cfg.maxRects) rects.length = cfg.maxRects;
}

// Ensure each player's spawn has at least some cover within a reasonable distance.
// This makes obstacles feel "present" immediately, without needing to roam far.
export function ensureCoverNearPlayers(sim, circle, players) {
  // Labyrinth map already has strong, structured cover; don't "patch" extra walls into corridors.
  if (sim?.mapVariant === 'labyrinth') return;
  if (!sim?.obstacles) return;
  const rects = sim.obstacles;
  const cfg = CONFIG.OBSTACLES;
  if (!cfg.enabled) return;

  for (const p of players) {
    // Find nearest existing rect center
    let best = Infinity;
    for (const o of rects) {
      const d = dist(p.x, p.y, o.x, o.y);
      if (d < best) best = d;
    }

    const wantWithin = 1400;
    if (best <= wantWithin) continue;

    // Drop a small wall near the player, still inside the safe circle.
    const tries = 70;
    const len = randRange(sim, cfg.wallLenMin, Math.min(cfg.wallLenMax, 420));
    const thick = randRange(sim, cfg.thickMin, cfg.thickMax);

    for (let t = 0; t < tries; t++) {
      const ang = rand01(sim) * Math.PI * 2;
      const rad = 520 + rand01(sim) * 520;
      const x = p.x + Math.cos(ang) * rad;
      const y = p.y + Math.sin(ang) * rad;
      if (!insideCircle(x, y, circle, 240)) continue;

      const vertical = rand01(sim) < 0.5;
      const w = vertical ? thick : len;
      const h = vertical ? len : thick;

      let ok = true;
      for (const r of rects) {
        if (aabbOverlap(x, y, w, h, r.x, r.y, r.w, r.h, cfg.pad)) { ok = false; break; }
      }
      if (!ok) continue;

      rects.push({ id: `ob_${sim.nextObstacleId++}`, x, y, w, h });
      if (rects.length > cfg.maxRects) rects.length = cfg.maxRects;
      break;
    }
  }
}
