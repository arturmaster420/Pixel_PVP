import { CONFIG } from 'be-try-core';

function clampAvatarId(v) {
  const n = Array.isArray(CONFIG.AVATARS) ? CONFIG.AVATARS.length : 0;
  if (!n) return 0;
  const id = (typeof v === 'number') ? (v | 0) : ((String(v ?? '0').trim() === '') ? 0 : (Number(v) | 0));
  if (!Number.isFinite(id)) return 0;
  return Math.max(0, Math.min(n - 1, id | 0));
}


export class CanvasRenderer {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');

    // Cosmetic trails (purely visual).
    // id -> [{x,y,at,level,color}]
    this._trails = new Map();
    // id -> {x,y}
    this._trailLastPos = new Map();

    // Cached hashes for cosmetic randomness (stable per-id).
    this._idHash = new Map();

    // Client perf toggle: reduce costly FX layers on low-end portal devices.
    this.lowFx = false;
  }

  setLowFx(v) {
    this.lowFx = !!v;
  }

  _hashId(id) {
    const key = String(id ?? '');
    const cached = this._idHash.get(key);
    if (typeof cached === 'number') return cached;
    // FNV-1a 32-bit
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h >>>= 0;
    this._idHash.set(key, h);
    return h;
  }

  _mix32(x) {
    // 32-bit mix to produce decent pseudo-randomness.
    x >>>= 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  }

  _rand01(x) {
    return (this._mix32(x) >>> 0) / 4294967296;
  }

  resize(w, h) {
    this.c.width = w;
    this.c.height = h;
  }

  clear() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.c.width, this.c.height);
  }

  render(snapshot, selfId, aheadSec = 0, fx = null, inputOverlay = null) {
    const ctx = this.ctx;
    const w = this.c.width;
    const h = this.c.height;

    const now = (typeof snapshot?.serverTime === 'number') ? snapshot.serverTime : (performance.now() / 1000);

    const self = snapshot.players.find(p => p.id === selfId) ?? snapshot.players[0];

    // Camera zoom (UPDATED): fixed world height (independent from weapon range).
    // The user requested a fixed camera height for all weapons.
    // World height visible (top-to-bottom) in world units.
    // Tweak this number to zoom in/out globally.
    const FIXED_WORLD_HEIGHT = 900;
    const zoom = h / FIXED_WORLD_HEIGHT;
    const cam = {
      x: self?.x ?? 0,
      y: self?.y ?? 0,
      w,
      h,
      // Allow tighter zoom on tall mobile screens.
      zoom: Math.max(0.25, Math.min(4.0, zoom))
    };

    // Background (light theme)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Center glow (helps readability like slither)
    {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.1, w / 2, h / 2, Math.min(w, h) * 0.95);
      g.addColorStop(0, 'rgba(90,150,255,0.06)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // Base grid (hex)
    this._drawHexGrid(ctx, cam, 0.065);

    // Draw storm safe zone tint + border + outside darkness (BR feel)
    const circle = snapshot.circle;
    const cx = w/2 + (circle.cx - cam.x) * cam.zoom;
    const cy = h/2 + (circle.cy - cam.y) * cam.zoom;
    const cr = circle.r * cam.zoom;

    // fill safe zone lightly
    ctx.fillStyle = 'rgba(120,170,255,0.045)';
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();

    // Outside storm darkness (punch a hole for safe zone)
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Safe-zone border with a bit of glow
    ctx.save();
    ctx.strokeStyle = 'rgba(120,170,255,0.70)';
    ctx.lineWidth = 3.2;
    ctx.shadowColor = 'rgba(120,170,255,0.35)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Grid overlay on top of storm darkness (so the grid never "disappears")
    ctx.save();
    // Draw grid on top so it stays visible even under the storm overlay (dark grid on light bg)
    ctx.globalCompositeOperation = 'multiply';
    this._drawHexGrid(ctx, cam, 0.035);
    ctx.restore();

    // Obstacles (indestructible cover)
    if (Array.isArray(snapshot.obstacles) && snapshot.obstacles.length) {
      this._drawObstacles(ctx, cam, snapshot.obstacles);
    }

    // Draw orbs
    for (const o of snapshot.orbs) {
      const sx = w/2 + (o.x - cam.x) * cam.zoom;
      const sy = h/2 + (o.y - cam.y) * cam.zoom;
      ctx.fillStyle = 'rgba(120,255,180,0.9)';
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI*2);
      ctx.fill();
    }

    // Draw rare buff pickups
    const buffs = snapshot.buffPickups || [];
    if (buffs.length) {
      for (const pu of buffs) {
        if (!Number.isFinite(pu.x) || !Number.isFinite(pu.y)) continue;
        const sx = w/2 + (pu.x - cam.x) * cam.zoom;
        const sy = h/2 + (pu.y - cam.y) * cam.zoom;
        const k = pu.k || pu.kind || 'ms';
        const label = (k === 'regen') ? 'REG' : (k === 'as') ? 'AS' : (k === 'dmg') ? 'DMG' : 'MS';

        // Color coding (player color is not used; pickups are neutral UI objects)
        const col = (k === 'regen')
          ? { glow: 'rgba(90,255,140,0.70)', fill: 'rgba(90,255,140,0.14)', text: 'rgba(170,255,205,0.98)' }
          : (k === 'dmg')
            ? { glow: 'rgba(255,70,70,0.70)', fill: 'rgba(255,70,70,0.16)', text: 'rgba(255,110,110,0.98)' }
            : (k === 'as')
              ? { glow: 'rgba(255,230,90,0.65)', fill: 'rgba(255,230,90,0.14)', text: 'rgba(255,245,170,0.98)' }
              : { glow: 'rgba(120,220,255,0.70)', fill: 'rgba(120,220,255,0.14)', text: 'rgba(210,245,255,0.98)' };
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.shadowColor = col.glow;
        ctx.shadowBlur = 16;
        ctx.fillStyle = col.fill;
        ctx.beginPath();
        ctx.arc(sx, sy, 9, 0, Math.PI*2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = col.text;
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, sx, sy + 0.5);
        ctx.restore();
      }
    }

    // Draw bullets (slight client-side prediction)
    // Some builds pass a dedicated bulletAheadSec to avoid per-frame bullet array allocations.
    const bulletAheadSec = (typeof snapshot.bulletAheadSec === 'number') ? snapshot.bulletAheadSec : aheadSec;
    const widNow = snapshot.match?.weaponId || '';
    const bombMode = widNow === 'pistol'; // pistol is "Bombomet"
    for (const b of (snapshot.bullets || [])) {
      const bx = b.x + (b.vx || 0) * bulletAheadSec;
      const by = b.y + (b.vy || 0) * bulletAheadSec;
      const sx = w/2 + (bx - cam.x) * cam.zoom;
      const sy = h/2 + (by - cam.y) * cam.zoom;

      if (bombMode) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,170,70,0.95)';
        ctx.shadowColor = 'rgba(255,140,40,0.55)';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(255,220,120,0.9)';
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI*2);
        ctx.fill();
      }
    }

    // Trails (purely cosmetic)
    this._updateTrails(snapshot, aheadSec);
    this._drawTrails(ctx, cam);

    // Draw players (slight client-side prediction)
    for (const p of snapshot.players) {
      const px = p.x + (p.vx || 0) * aheadSec;
      const py = p.y + (p.vy || 0) * aheadSec;
      const sx = w/2 + (px - cam.x) * cam.zoom;
      const sy = h/2 + (py - cam.y) * cam.zoom;

      const lvl = Math.max(1, (p.level | 0) || 1);
      // Emoji is the primary identifier. Keep aura present but not oversized.
      const aura = Math.min(26, 14 + lvl * 0.9);

      // Aura: soft edge diffusion + stronger pulse/flicker ("fire" feel), no per-player colors.
      this._drawAura(ctx, sx, sy, aura, p.dead, p.id, now, (p.auraId|0)||0);
      // body: no color circle; only a tiny almost-invisible center dot so the emoji isn't "floating".
      const avE = (Array.isArray(CONFIG.AVATARS) ? (CONFIG.AVATARS[clampAvatarId(p.avatarId)] || '') : '');
      ctx.fillStyle = p.dead ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.03)';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2, 0, Math.PI*2);
      ctx.fill();
      if (avE) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.22)';
        ctx.shadowBlur = 3;
        // User request: emoji avatar is bigger (primary identifier).
        ctx.font = '24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = p.dead ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.92)';
        ctx.fillText(avE, sx, sy + 0.5);
        ctx.restore();
      }
      // hp bar
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(sx - 18, sy - 18, 36, 4);
      ctx.fillStyle = 'rgba(120,255,160,0.9)';
      const hw = 36 * Math.max(0, Math.min(1, p.hp / p.maxHp));
      ctx.fillRect(sx - 18, sy - 18, hw, 4);

      // avatar + name
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.textAlign = 'center';
      ctx.font = '12px system-ui';
      ctx.fillText(`${p.name} L${p.level}`, sx, sy - 26);

      // protection ring
      if (p.prot > 0 && !p.dead) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 14, 0, Math.PI*2);
        ctx.stroke();
      }
    }

    // Tiny aim-direction hint for the local player (shows where the next shot will go).
    this._drawAimIndicator(ctx, snapshot, selfId, cam);

    // Top-center HUD overlay (time + phase) so it is always visible
    this._drawMatchOverlay(ctx, snapshot);

    // Simple compass arrow (helps find action / orbs without "searching")
    this._drawCompass(ctx, snapshot, selfId);

    // Minimap (local radar): more than main camera, shows enemies/cover within minimap.
    this._drawMinimap(ctx, snapshot, selfId, cam);

    // Local warning when outside safe zone
    this._drawStormWarning(ctx, snapshot, selfId, aheadSec);

    // Local low-HP pulse (<= 15%)
    this._drawLowHpPulse(ctx, snapshot, selfId);

    // Client-side FX (hitmarker, hurt flash, killfeed, damage numbers)
    if (fx) {
      this._drawFx(ctx, cam, snapshot, fx);
    }

    
    // Mobile dual-stick overlay (if available)
    if (inputOverlay && (inputOverlay.left || inputOverlay.right)) {
      this._drawJoysticks(ctx, inputOverlay);
    }
return cam;
  }

  _drawAimIndicator(ctx, snapshot, selfId, cam) {
    try {
      const aim = snapshot?.selfAim;
      if (!aim || !Array.isArray(aim)) return;
      const ax = +aim[0], ay = +aim[1];
      if (!Number.isFinite(ax) || !Number.isFinite(ay)) return;
      const len2 = ax * ax + ay * ay;
      if (len2 < 1e-6) return;
      const inv = 1 / Math.sqrt(len2);
      const dx = ax * inv;
      const dy = ay * inv;

      const self = snapshot.players?.find(p => p.id === selfId);
      if (!self || self.dead) return;

      const sx = (this.c.width / 2) + (self.x - cam.x) * cam.zoom;
      const sy = (this.c.height / 2) + (self.y - cam.y) * cam.zoom;

      // Screen-space indicator (keeps it readable at any zoom)
      const L = 20;
      const ex = sx + dx * L;
      const ey = sy + dy * L;

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.shadowColor = 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = 6;

      ctx.strokeStyle = 'rgba(255,255,255,0.70)';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(ex, ey, 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    } catch {
      // ignore
    }
  }

  _updateTrails(snapshot, aheadSec) {
    const players = Array.isArray(snapshot?.players) ? snapshot.players : [];
    const now = typeof snapshot?.serverTime === 'number' ? snapshot.serverTime : (performance.now() / 1000);
    this._trailNow = now;

    const DEFAULT_TTL = 0.65;

    const present = new Set();
    for (const p of players) {
      if (!p || p.dead) continue;
      const id = p.id;
      if (!id) continue;
      present.add(id);

      const tid = (p.trailId | 0) || 0;
      // Cosmetic: vary how long the trail stays on-screen.
      const ttl = (tid === 2) ? 0.95 : (tid === 1) ? 0.55 : DEFAULT_TTL;

      const x = (p.x ?? 0) + (p.vx || 0) * aheadSec;
      const y = (p.y ?? 0) + (p.vy || 0) * aheadSec;

      const last = this._trailLastPos.get(id);
      if (!last) {
        this._trailLastPos.set(id, { x, y, tid });
        continue;
      }

      const dx = x - last.x;
      const dy = y - last.y;
      const d2 = dx * dx + dy * dy;

      // Drop a point only when the player moved enough (avoids noisy stationary blobs).
      // Low FX mode drops fewer points to reduce overdraw.
      let minMove2 = this.lowFx ? 140 : 70;
      if (tid === 1) minMove2 *= 2.6;  // Dotted: big gaps (very visible).
      if (tid === 2) minMove2 *= 0.55; // Comet: denser.
      if (tid === 3) minMove2 *= 0.95; // Spark: slightly denser.

      if (d2 > minMove2) {
        last.x = x;
        last.y = y;
        last.tid = tid;

        const arr = this._trails.get(id) || [];
        // Trail is cosmetic; style/color comes from trailId (cosmetics).
        arr.push({ x, y, at: now, ttl, level: (p.level | 0) || 1, trailId: tid });

        // Cap points for memory/perf.
        const cap = this.lowFx ? 28 : 52;
        if (arr.length > cap) arr.splice(0, arr.length - cap);
        this._trails.set(id, arr);
      }
    }

    // Prune old / disconnected.
    for (const [id, arr] of this._trails.entries()) {
      if (!present.has(id)) {
        this._trails.delete(id);
        this._trailLastPos.delete(id);
        continue;
      }
      // In-place prune to avoid per-frame allocations (important on mobile).
      let w = 0;
      for (let j = 0; j < arr.length; j++) {
        const pt = arr[j];
        const ttl = pt.ttl ?? DEFAULT_TTL;
        if ((now - pt.at) <= ttl) arr[w++] = pt;
      }
      if (w <= 0) {
        this._trails.delete(id);
      } else {
        if (w !== arr.length) arr.length = w;
      }
    }
  }


  _drawTrails(ctx, cam) {
    const now = (typeof this._trailNow === 'number') ? this._trailNow : (performance.now() / 1000);
    const DEFAULT_TTL = 0.65;

    // Trail cosmetics: differ by color + shape.
    // IMPORTANT: this is cosmetic only. Player identification remains the emoji avatar.
    const CFG = [
      { color: '#ffffff', style: 'line',   rMul: 1.00, a: 0.20 }, // 0 Default (White)
      { color: '#55ccff', style: 'dotted', rMul: 0.88, a: 0.20 }, // 1 Dotted (Cyan)
      { color: '#b070ff', style: 'comet',  rMul: 1.35, a: 0.22 }, // 2 Comet (Purple)
      { color: '#ffb84d', style: 'spark',  rMul: 1.05, a: 0.20 }, // 3 Spark (Amber)
      { color: '#55ff88', style: 'squares',rMul: 1.00, a: 0.20 }, // 4 Neon (Green Squares)
      { color: '#ff4d4d', style: 'laser',  rMul: 0.92, a: 0.22 }, // 5 Laser (Red Beam)
      { color: '#ffe066', style: 'star',   rMul: 1.10, a: 0.20 }, // 6 Star (Yellow)
      { color: '#88ccff', style: 'ice',    rMul: 0.94, a: 0.19 }, // 7 Ice (Blue Triangles)
    ];

    const drawDiamond = (x, y, r) => {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
    };

    const drawSparkCross = (x, y, r) => {
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
      ctx.stroke();
    };

    const drawSquare = (x, y, r) => {
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };

    const drawTri = (x, y, r) => {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
      ctx.fill();
    };

    const drawStar4 = (x, y, r) => {
      // 4-point star (plus + diagonals)
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
      const d = r * 0.72;
      ctx.moveTo(x - d, y - d);
      ctx.lineTo(x + d, y + d);
      ctx.moveTo(x - d, y + d);
      ctx.lineTo(x + d, y - d);
      ctx.stroke();
    };

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const arr of this._trails.values()) {
      let prev = null;
      for (let i = 0; i < arr.length; i++) {
        const pt = arr[i];
        const ttl = pt.ttl ?? DEFAULT_TTL;
        const age = now - pt.at;
        if (age < 0 || age > ttl) { prev = pt; continue; }
        const t = 1 - (age / ttl);

        const sx = (this.c.width / 2) + (pt.x - cam.x) * cam.zoom;
        const sy = (this.c.height / 2) + (pt.y - cam.y) * cam.zoom;
        const tid = (pt.trailId | 0) || 0;
        const cfg = CFG[tid] || CFG[0];

        // Base sizing scales slightly with level (keeps the “wide trail” feel).
        let r = (4.2 + Math.min(6, (pt.level || 1) * 0.15)) * cfg.rMul;
        let a = cfg.a;

        // Dotted: show every other point and use a diamond shape.
        if (cfg.style === 'dotted') {
          if (i & 1) { prev = pt; continue; }
          r *= 0.92;
          a *= 0.95;
        }

        // Ice: also skip some points (feels crystalline) and use triangles.
        if (cfg.style === 'ice') {
          if (i % 3 === 2) { prev = pt; continue; }
          r *= 0.92;
        }

        // Mild smoothing line for line/comet/laser trails.
        if (prev && (cfg.style === 'line' || cfg.style === 'comet' || cfg.style === 'laser')) {
          const psx = (this.c.width / 2) + (prev.x - cam.x) * cam.zoom;
          const psy = (this.c.height / 2) + (prev.y - cam.y) * cam.zoom;
          const ddx = sx - psx;
          const ddy = sy - psy;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < 1400) {
            const k = (cfg.style === 'comet') ? 0.16 : (cfg.style === 'laser') ? 0.20 : 0.10;
            ctx.globalAlpha = k * t;
            ctx.strokeStyle = cfg.color;
            const lwMul = (cfg.style === 'comet') ? 0.62 : (cfg.style === 'laser') ? 0.38 : 0.52;
            ctx.lineWidth = Math.max(1.3, r * lwMul);
            ctx.beginPath();
            ctx.moveTo(psx, psy);
            ctx.lineTo(sx, sy);
            ctx.stroke();
          }
        }

        // Spark: flicker + little crosses.
        if (cfg.style === 'spark') {
          a *= (0.70 + 0.60 * Math.sin((now * 16.0) + (pt.x + pt.y) * 0.02));
        }

        // Laser: sharper pulse.
        if (cfg.style === 'laser') {
          a *= (0.85 + 0.55 * Math.sin((now * 18.0) + (pt.x + pt.y) * 0.03));
        }

        // Main mark
        ctx.globalAlpha = (a * t);
        ctx.fillStyle = cfg.color;

        if (cfg.style === 'dotted') {
          drawDiamond(sx, sy, Math.max(1.8, r * 0.85));
        } else if (cfg.style === 'squares') {
          drawSquare(sx, sy, Math.max(1.6, r * 0.80));
        } else if (cfg.style === 'ice') {
          drawTri(sx, sy, Math.max(1.6, r * 0.85));
        } else {
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
        }

        // Extra sparklets (colored) for Spark trail
        if (cfg.style === 'spark') {
          const seed = Math.sin((pt.x * 12.9898 + pt.y * 78.233 + pt.at * 37.719) * 0.5) * 43758.5453;
          const f = seed - Math.floor(seed);
          const ang1 = f * Math.PI * 2;
          const ang2 = ((f * 2.17) % 1) * Math.PI * 2;
          const rr1 = 2.4 + 3.2 * ((f * 1.7) % 1);
          const rr2 = 2.0 + 2.8 * ((f * 3.1) % 1);

          ctx.strokeStyle = cfg.color;
          ctx.lineWidth = Math.max(1.0, r * 0.22);

          ctx.globalAlpha = 0.10 * t;
          drawSparkCross(sx + Math.cos(ang1) * rr1, sy + Math.sin(ang1) * rr1, Math.max(1.2, r * 0.30));

          ctx.globalAlpha = 0.08 * t;
          drawSparkCross(sx + Math.cos(ang2) * rr2, sy + Math.sin(ang2) * rr2, Math.max(1.0, r * 0.26));
        }

        // Star: draw small star strokes (keeps white-ish readability but in trail color).
        if (cfg.style === 'star') {
          ctx.strokeStyle = cfg.color;
          ctx.lineWidth = Math.max(1.0, r * 0.22);
          ctx.globalAlpha = 0.10 * t;
          drawStar4(sx, sy, Math.max(1.6, r * 0.48));
        }

        // Laser: occasional bright head highlight.
        if (cfg.style === 'laser') {
          const head = 0.12 + 0.10 * t;
          ctx.globalAlpha = head;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(1.2, r * 0.55), 0, Math.PI * 2);
          ctx.fill();
        }

        prev = pt;
      }
    }

    ctx.restore();
  }
  _drawAura(ctx, sx, sy, baseR, dead, id, now, auraId = 0) {
    const h = this._hashId(id);
    const phase = (h % 1024) / 1024 * Math.PI * 2;

    // Aura cosmetics: choose a soft palette (no hard contour).
    // 0=default, 1=crown, 2=predator, 3=void, 4=emerald, 5=frost, 6=inferno, 7=prism.
    const aid = (auraId | 0) || 0;
    const prism = (aid === 7);
    const prismPal = (() => {
      if (!prism) return null;
      const s = now * 1.35 + phase;
      const r0 = 170 + 70 * Math.sin(s);
      const g0 = 170 + 70 * Math.sin(s + 2.09);
      const b0 = 170 + 70 * Math.sin(s + 4.18);
      const r1 = 160 + 85 * Math.sin(s + 1.1);
      const g1 = 160 + 85 * Math.sin(s + 3.2);
      const b1 = 160 + 85 * Math.sin(s + 5.3);
      const r2 = 130 + 95 * Math.sin(s + 0.4);
      const g2 = 130 + 95 * Math.sin(s + 2.5);
      const b2 = 130 + 95 * Math.sin(s + 4.6);
      const clamp = (x) => Math.max(0, Math.min(255, x | 0));
      return { a: [clamp(r0), clamp(g0), clamp(b0)], b: [clamp(r1), clamp(g1), clamp(b1)], c: [clamp(r2), clamp(g2), clamp(b2)] };
    })();

    let pal;
    if (prismPal) pal = prismPal;
    else if (aid === 1) pal = { a: [255, 235, 140], b: [255, 190, 70], c: [255, 160, 60] };           // Crown
    else if (aid === 2) pal = { a: [255, 150, 150], b: [255, 90, 70], c: [255, 60, 60] };             // Predator
    else if (aid === 3) pal = { a: [210, 170, 255], b: [150, 110, 255], c: [120, 80, 255] };           // Void
    else if (aid === 4) pal = { a: [170, 255, 200], b: [80, 220, 140], c: [50, 185, 120] };            // Emerald
    else if (aid === 5) pal = { a: [220, 250, 255], b: [150, 220, 255], c: [90, 190, 255] };           // Frost
    else if (aid === 6) pal = { a: [255, 220, 170], b: [255, 145, 80], c: [255, 90, 50] };             // Inferno
    else pal = { a: [220, 245, 255], b: [130, 200, 255], c: [90, 150, 255] };                           // Default

    // Stronger pulse + faster micro-flicker so the aura feels alive (not a flat blot).
    const pulse = 1
      + 0.08 * Math.sin(now * 2.35 + phase)
      + 0.05 * Math.sin(now * 10.40 + phase * 1.7);

    const r = Math.max(6, baseR * pulse);
    const outer = r * 1.38;
    const inner = Math.max(0.8, r * 0.14);

    // Dead: keep it calm and muted.
    if (dead) {
      const g = ctx.createRadialGradient(sx, sy, inner, sx, sy, outer);
      g.addColorStop(0, 'rgba(180,180,180,0.10)');
      g.addColorStop(0.55, 'rgba(140,140,140,0.06)');
      g.addColorStop(1, 'rgba(120,120,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, outer, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.save();

    // Base glow with soft edge diffusion.
    ctx.globalCompositeOperation = 'lighter';
    {
      // Bigger amplitude flicker.
      const flick = 0.78 + 0.35 * Math.sin(now * 12.5 + phase * 1.3);
      const g = ctx.createRadialGradient(sx, sy, inner, sx, sy, outer);
      g.addColorStop(0, `rgba(${pal.a[0]},${pal.a[1]},${pal.a[2]},${0.20 * flick})`);
      g.addColorStop(0.28, `rgba(${pal.b[0]},${pal.b[1]},${pal.b[2]},${0.16 * flick})`);
      g.addColorStop(0.70, `rgba(${pal.c[0]},${pal.c[1]},${pal.c[2]},${0.075 * flick})`);
      g.addColorStop(1, `rgba(${pal.c[0]},${pal.c[1]},${pal.c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, outer, 0, Math.PI * 2);
      ctx.fill();
    }

    // Flicker "tongues" near the edge to mimic a small flame.
    // Deterministic per id, animated by tick so it doesn't crawl every frame.
    const tick = (now * 14.0) | 0;
    const tongues = this.lowFx ? 6 : 10;
    for (let i = 0; i < tongues; i++) {
      const s0 = (h ^ (tick + i * 1337)) >>> 0;
      const u0 = this._rand01(s0);
      const u1 = this._rand01(s0 + 11);
      const u2 = this._rand01(s0 + 97);

      // Bias upward a bit (fire feel), but keep it mostly circular.
      const ang = (-Math.PI / 2) + (u0 - 0.5) * (Math.PI * 1.6);
      const dist = r * (0.30 + 0.32 * u1);
      const ox = Math.cos(ang) * dist;
      const oy = Math.sin(ang) * dist;
      const br = r * (0.22 + 0.22 * u2);

      const g = ctx.createRadialGradient(sx + ox, sy + oy, br * 0.12, sx + ox, sy + oy, br);
      g.addColorStop(0, 'rgba(255,255,255,0.20)');
      g.addColorStop(0.35, `rgba(${pal.b[0]},${pal.b[1]},${pal.b[2]},0.15)`);
      g.addColorStop(1, `rgba(${pal.c[0]},${pal.c[1]},${pal.c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx + ox, sy + oy, br, 0, Math.PI * 2);
      ctx.fill();
    }

    // Extra tiny sparks on the outer edge (adds visible shimmering without a hard contour).
    const tick2 = (now * 22.0) | 0;
    const sparks = this.lowFx ? 2 : 4;
    for (let i = 0; i < sparks; i++) {
      const s0 = (h ^ (tick2 + i * 733)) >>> 0;
      const u0 = this._rand01(s0);
      const u1 = this._rand01(s0 + 19);
      const u2 = this._rand01(s0 + 211);
      const ang = (u0 * Math.PI * 2);
      const dist = r * (0.82 + 0.28 * u1);
      const ox = Math.cos(ang) * dist;
      const oy = Math.sin(ang) * dist;
      const br = r * (0.10 + 0.06 * u2);
      const g = ctx.createRadialGradient(sx + ox, sy + oy, br * 0.10, sx + ox, sy + oy, br);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(0.45, `rgba(${pal.b[0]},${pal.b[1]},${pal.b[2]},0.08)`);
      g.addColorStop(1, `rgba(${pal.c[0]},${pal.c[1]},${pal.c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx + ox, sy + oy, br, 0, Math.PI * 2);
      ctx.fill();
    }

    // No contour stroke — keep the aura purely diffused.

    ctx.restore();
  }

  _drawMinimap(ctx, snapshot, selfId, cam) {
    const w = this.c.width;
    const h = this.c.height;
    if (!w || !h) return;

    const worldHalf = (CONFIG?.WORLD_HALF_SIZE ?? 9000);
    if (!Number.isFinite(worldHalf) || worldHalf <= 0) return;

    const self = Array.isArray(snapshot?.players) ? snapshot.players.find(p => p.id === selfId) : null;
    if (!self || !cam) return;

    // Size scales with screen; keep compact.
    const size = Math.max(110, Math.min(180, Math.floor(Math.min(w, h) * 0.22), w, h));

    // User request: radar is flush in the top-right corner.
    const x0 = Math.max(0, w - size);
    const y0 = 0;

    const innerPad = 7;
    const ix = x0 + innerPad;
    const iy = y0 + innerPad;
    const is = size - innerPad * 2;

    // Main camera visible radius (world units). Minimap shows more than that.
    const camHalfW = w / (2 * cam.zoom);
    const camHalfH = h / (2 * cam.zoom);
    const camVisR = Math.max(camHalfW, camHalfH);
    const radarR = Math.min(worldHalf, Math.max(450, camVisR * 1.5));
    const scale = is / (radarR * 2);

    const toMini = (x, y) => ({
      x: ix + (x - self.x + radarR) * scale,
      y: iy + (y - self.y + radarR) * scale
    });

    const roundRectPath = (x, y, rw, rh, r) => {
      const rr = Math.max(0, Math.min(r, Math.min(rw, rh) / 2));
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + rw - rr, y);
      ctx.quadraticCurveTo(x + rw, y, x + rw, y + rr);
      ctx.lineTo(x + rw, y + rh - rr);
      ctx.quadraticCurveTo(x + rw, y + rh, x + rw - rr, y + rh);
      ctx.lineTo(x + rr, y + rh);
      ctx.quadraticCurveTo(x, y + rh, x, y + rh - rr);
      ctx.lineTo(x, y + rr);
      ctx.quadraticCurveTo(x, y, x + rr, y);
      ctx.closePath();
    };

    ctx.save();

    // Panel (no white frame / no outline)
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    roundRectPath(x0, y0, size, size, 10);
    ctx.fill();

    // Clip to inner area (so huge safe circle doesn't draw outside).
    roundRectPath(ix, iy, is, is, 6);
    ctx.clip();

    // Background for radar area (dark so cover/players pop).
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(ix, iy, is, is);

    // Safe circle (local slice). Keep only the border so it doesn't look like "whole-map".
    const c = snapshot.circle;
    if (c && Number.isFinite(c.cx) && Number.isFinite(c.cy) && Number.isFinite(c.r)) {
      const mc = toMini(c.cx, c.cy);
      const mr = Math.max(0, c.r * scale);
      ctx.strokeStyle = 'rgba(120,170,255,0.55)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(mc.x, mc.y, mr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Obstacles (only those inside radar view).
    const minX = self.x - radarR;
    const maxX = self.x + radarR;
    const minY = self.y - radarR;
    const maxY = self.y + radarR;
    if (Array.isArray(snapshot.obstacles)) {
      // Light cover blocks over dark radar background.
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.strokeStyle = 'rgba(255,255,255,0.80)';
      ctx.lineWidth = 1;
      for (const r of snapshot.obstacles) {
        // Obstacles are stored as center (x,y) + size (w,h) in the sim.
        // The main renderer draws them centered; radar must match that.
        const rx = r.x ?? 0;
        const ry = r.y ?? 0;
        const rw = r.w ?? 0;
        const rh = r.h ?? 0;
        const hw = rw * 0.5;
        const hh = rh * 0.5;

        const left = rx - hw;
        const right = rx + hw;
        const top = ry - hh;
        const bottom = ry + hh;

        // Cull outside radar bounds.
        if (left > maxX || right < minX || top > maxY || bottom < minY) continue;

        // Convert top-left corner to minimap coords.
        const p0 = toMini(left, top);
        const pw = rw * scale;
        const ph = rh * scale;
        ctx.fillRect(p0.x, p0.y, pw, ph);
        ctx.strokeRect(p0.x, p0.y, pw, ph);
      }
    }

    // Players/enemies within radar view.
    if (Array.isArray(snapshot.players)) {
      for (const p of snapshot.players) {
        if (p.dead) continue;
        const isSelf = (p.id === selfId);
        const dx = (p.x ?? 0) - self.x;
        const dy = (p.y ?? 0) - self.y;
        if (!isSelf && (dx*dx + dy*dy) > radarR*radarR) continue;
        const mp = isSelf ? { x: ix + is/2, y: iy + is/2 } : toMini(p.x ?? 0, p.y ?? 0);
        const rr = isSelf ? 3.8 : 2.6;
        // No per-player colors on the radar.
        const col = isSelf ? 'rgba(0,0,0,0.92)' : 'rgba(255,255,255,0.92)';

        // outline for readability
        ctx.fillStyle = 'rgba(255,255,255,0.90)';
        ctx.beginPath();
        ctx.arc(mp.x, mp.y, rr + 1.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(mp.x, mp.y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // (Removed) camera view rectangle overlay — radar should stay clean.

    // Unclip for label
    ctx.restore();

    // Tiny label
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('RADAR', x0 + 10, y0 + 16);
    ctx.restore();
  }

  _drawFx(ctx, cam, snapshot, fx) {
    const nowMs = performance.now();

    // Hurt flash (vignette)
    if (fx.hurtUntilMs && fx.hurtUntilMs > nowMs) {
      const t = Math.max(0, Math.min(1, (fx.hurtUntilMs - nowMs) / 220));
      const w = this.c.width;
      const h = this.c.height;
      ctx.save();
      ctx.fillStyle = `rgba(255,50,50,${0.08 + 0.12 * t})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // Hit marker at screen center
    if (fx.hitMarkerUntilMs && fx.hitMarkerUntilMs > nowMs) {
      const w = this.c.width;
      const h = this.c.height;
      const t = Math.max(0, Math.min(1, (fx.hitMarkerUntilMs - nowMs) / 140));
      const a = 0.35 + 0.55 * t;
      const cx = w / 2;
      const cy = h / 2;
      const s = 8;
      const g = 5;
      ctx.save();
      ctx.strokeStyle = `rgba(0,0,0,${a})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(255,255,255,0.55)';
      ctx.shadowBlur = 6;
      // 4 small lines
      ctx.beginPath();
      ctx.moveTo(cx - g - s, cy - g - s);
      ctx.lineTo(cx - g, cy - g);
      ctx.moveTo(cx + g + s, cy - g - s);
      ctx.lineTo(cx + g, cy - g);
      ctx.moveTo(cx - g - s, cy + g + s);
      ctx.lineTo(cx - g, cy + g);
      ctx.moveTo(cx + g + s, cy + g + s);
      ctx.lineTo(cx + g, cy + g);
      ctx.stroke();
      ctx.restore();
    }

    // Explosions (world -> screen)
    if (Array.isArray(fx.explosions)) {
      for (const ex of fx.explosions) {
        const age = nowMs - ex.bornMs;
        const t = Math.max(0, Math.min(1, age / 520));
        const sx = this.c.width / 2 + (ex.x - cam.x) * cam.zoom;
        const sy = this.c.height / 2 + (ex.y - cam.y) * cam.zoom;
        const r0 = Math.max(10, (ex.r || 120) * cam.zoom);
        const r = r0 * (0.35 + 0.9 * t);
        ctx.save();
        ctx.globalAlpha = (1 - t);
        // inner flash
        ctx.fillStyle = 'rgba(255,200,120,0.22)';
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        // shock ring
        ctx.strokeStyle = 'rgba(255,160,80,0.95)';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(255,140,60,0.55)';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Damage texts (world -> screen)
    if (Array.isArray(fx.dmgTexts)) {
      for (const d of fx.dmgTexts) {
        const age = nowMs - d.bornMs;
        const t = Math.max(0, Math.min(1, age / 900));
        const sx = this.c.width / 2 + (d.x - cam.x) * cam.zoom;
        const sy = this.c.height / 2 + (d.y - cam.y) * cam.zoom - 18 - 18 * t;
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(255,255,255,0.85)';
        ctx.shadowBlur = 10;
        ctx.fillText(d.text, sx, sy);
        ctx.restore();
      }
    }

    // Killfeed top-right (below radar)
    if (Array.isArray(fx.killFeed) && fx.killFeed.length) {
      const w = this.c.width;
      ctx.save();
      ctx.textAlign = 'right';
      ctx.font = '12px system-ui';
      ctx.shadowColor = 'rgba(255,255,255,0.85)';
      ctx.shadowBlur = 8;
      // Keep the area above the radar clean.
      const h = this.c.height;
      const radarSize = Math.max(110, Math.min(180, Math.floor(Math.min(w, h) * 0.22), w, h));
      let y = radarSize + 22;
      for (let i = fx.killFeed.length - 1; i >= 0; i--) {
        const it = fx.killFeed[i];
        const a = Math.max(0, Math.min(1, (it.untilMs - nowMs) / 4200));
        ctx.fillStyle = `rgba(0,0,0,${0.12 + 0.68 * a})`;
        ctx.fillText(it.text, w - 16, y);
        y += 16;
        if (y > (h - 32)) break;
      }
      ctx.restore();
    }
  }

  _drawMatchOverlay(ctx, snapshot) {
    const w = this.c.width;
    const remaining = snapshot.match?.remaining ?? 0;
    const phase = snapshot.circle?.phase ?? 0;
    const wid = snapshot.match?.weaponId;
    const wDef = (wid && CONFIG.WEAPONS && CONFIG.WEAPONS[wid]) ? CONFIG.WEAPONS[wid] : null;
    const wText = wDef ? wDef.name : (wid ? String(wid).toUpperCase() : '');

    ctx.save();
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.shadowColor = 'rgba(255,255,255,0.70)';
    ctx.shadowBlur = 8;
        const elapsed = snapshot.match?.elapsed ?? Math.max(0, (CONFIG.MATCH_DURATION_SEC - remaining));
    const stage = stormStageFromElapsed(elapsed);
    ctx.fillText(`${formatTime(remaining)}  •  Stage ${stage}/5${wText ? '  •  ' + wText : ''}`, w / 2, 24);
    ctx.restore();
  }

  _drawCompass(ctx, snapshot, selfId) {
    if (!snapshot?.match || snapshot.match.state !== 'match') return;
    const self = snapshot.players.find(p => p.id === selfId);
    if (!self || self.dead) return;

    // Find nearest enemy (alive)
    let bestEnemy = null;
    let bestEnemyD2 = Infinity;
    for (const p of snapshot.players) {
      if (p.id === selfId) continue;
      if (p.dead) continue;
      const dx = p.x - self.x;
      const dy = p.y - self.y;
      const d2 = dx*dx + dy*dy;
      if (d2 < bestEnemyD2) { bestEnemyD2 = d2; bestEnemy = p; }
    }

    // Find nearest orb
    let bestOrb = null;
    let bestOrbD2 = Infinity;
    for (const o of snapshot.orbs) {
      const dx = o.x - self.x;
      const dy = o.y - self.y;
      const d2 = dx*dx + dy*dy;
      if (d2 < bestOrbD2) { bestOrbD2 = d2; bestOrb = o; }
    }

    // Choose target:
    // - If an enemy is "close enough", point to enemy (keeps fights happening)
    // - Otherwise point to orbs (guides movement)
    const ENEMY_PREF_DIST = 2400;
    const enemyClose = bestEnemy && bestEnemyD2 <= ENEMY_PREF_DIST * ENEMY_PREF_DIST;
    const target = enemyClose ? bestEnemy : (bestOrb ?? bestEnemy);
    if (!target) return;

    const tx = target.x;
    const ty = target.y;
    const dx = tx - self.x;
    const dy = ty - self.y;
    const ang = Math.atan2(dy, dx);

    const w = this.c.width;
    const x = w / 2;
    const y = 46;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);

    // (Removed) text pill / label (user request). Arrow-only indicator.

    // arrow triangle
    ctx.fillStyle = enemyClose ? 'rgba(255,90,90,0.95)' : 'rgba(90,220,140,0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(6, -7);
    ctx.lineTo(6, 7);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  _drawStormWarning(ctx, snapshot, selfId, aheadSec) {
    const self = snapshot.players.find(p => p.id === selfId);
    if (!self) return;
    const circle = snapshot.circle;
    if (!circle) return;

    const px = self.x + (self.vx || 0) * aheadSec;
    const py = self.y + (self.vy || 0) * aheadSec;
    const dx = px - circle.cx;
    const dy = py - circle.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= circle.r) return;

    const w = this.c.width;
    const h = this.c.height;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 140);

    ctx.save();
    ctx.fillStyle = `rgba(255,70,70,${0.05 + 0.06 * pulse})`;
    ctx.fillRect(0, 0, w, h);
    ctx.font = '16px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255,210,210,${0.85 + 0.1 * pulse})`;
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 10;
    ctx.fillText('OUTSIDE SAFE ZONE', w / 2, 52);
    ctx.restore();
  }

  _drawLowHpPulse(ctx, snapshot, selfId) {
    const self = snapshot.players.find(p => p.id === selfId);
    if (!self || self.dead) return;
    const r = self.maxHp > 0 ? self.hp / self.maxHp : 1;
    if (r > 0.15) return;

    // Stronger pulse the lower the HP gets.
    const k = Math.max(0, Math.min(1, (0.15 - r) / 0.15));
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
    const a = (0.04 + 0.10 * pulse) * (0.55 + 0.45 * k);

    const w = this.c.width;
    const h = this.c.height;
    ctx.save();
    ctx.fillStyle = `rgba(255,60,60,${a})`;
    ctx.fillRect(0, 0, w, h);
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255,240,240,${0.55 + 0.35 * pulse})`;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 10;
    ctx.fillText('LOW HP', w / 2, 76);
    ctx.restore();
  }


  _drawJoysticks(ctx, overlay) {
    ctx.save();
    ctx.lineWidth = 2;

    const drawOne = (j) => {
      if (!j) return;
      // base
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = 'rgba(200,225,255,0.35)';
      ctx.beginPath();
      ctx.arc(j.sx, j.sy, j.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // knob
      ctx.fillStyle = 'rgba(200,225,255,0.16)';
      ctx.strokeStyle = 'rgba(200,225,255,0.55)';
      ctx.beginPath();
      ctx.arc(j.kx, j.ky, Math.max(18, j.r * 0.35), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    drawOne(overlay.left);
    drawOne(overlay.right);

    ctx.restore();
  }

  _drawHexGrid(ctx, cam, alpha = 0.04) {
    const w = this.c.width;
    const h = this.c.height;
    const zoom = cam.zoom;

    // Hex size in world units (center-to-corner)
    const R = 170;
    const stepX = Math.sqrt(3) * R;  // horizontal center spacing
    const stepY = 1.5 * R;           // vertical center spacing

    const left = cam.x - (w / 2) / zoom;
    const right = cam.x + (w / 2) / zoom;
    const top = cam.y - (h / 2) / zoom;
    const bottom = cam.y + (h / 2) / zoom;

    // Add a small padding so edges don't pop
    const pad = R * 2;

    // IMPORTANT: anchor the row parity to WORLD coordinates, not to the current frame.
    // If we base the odd/even row offset on an arbitrary 'row++' counter starting at 0,
    // the whole grid can "jump" when yStart changes. We instead use the absolute row index.
    const rowStart = Math.floor((top - pad) / stepY);
    const rowEnd = Math.ceil((bottom + pad) / stepY);

    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;

    // Perf: draw the whole grid in ONE path + ONE stroke.
    // This removes hundreds of beginPath/stroke calls per frame (big on mobile).
    ctx.beginPath();
    for (let r = rowStart; r <= rowEnd; r++) {
      const y = r * stepY;
      const xOff = (r & 1) ? (stepX / 2) : 0;

      const colStart = Math.floor((left - pad - xOff) / stepX);
      const colEnd = Math.ceil((right + pad - xOff) / stepX);
      for (let c = colStart; c <= colEnd; c++) {
        const x = c * stepX + xOff;
        const sx = w / 2 + (x - cam.x) * zoom;
        const sy = h / 2 + (y - cam.y) * zoom;
        // quick reject
        if (sx < -R * zoom || sx > w + R * zoom || sy < -R * zoom || sy > h + R * zoom) continue;
        this._strokeHex(ctx, sx, sy, R * zoom);
      }
    }
    ctx.stroke();
  }

  _strokeHex(ctx, cx, cy, r) {
    // Pointy-top hex
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i + 30);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  _drawObstacles(ctx, cam, obstacles) {
    const w = this.c.width;
    const h = this.c.height;
    ctx.save();
    // Make cover very visible on both light background and storm-darkened areas.
    ctx.fillStyle = 'rgba(40,40,40,0.92)';
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 10;
    for (const o of obstacles) {
      const sx = w / 2 + (o.x - cam.x) * cam.zoom;
      const sy = h / 2 + (o.y - cam.y) * cam.zoom;
      const sw = o.w * cam.zoom;
      const sh = o.h * cam.zoom;

      // Simple rounded rect for nicer look
      const r = Math.max(2, Math.min(10, Math.min(sw, sh) * 0.12));
      this._roundRect(ctx, sx - sw / 2, sy - sh / 2, sw, sh, r);
      ctx.fill();
      ctx.stroke();

      // Subtle hatch lines so blocks remain readable even if colors blend.
      ctx.save();
      ctx.clip();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      const step = Math.max(10, Math.min(22, Math.min(sw, sh) * 0.18));
      const x0 = sx - sw / 2 - sh;
      const y0 = sy - sh / 2;
      for (let x = x0; x < sx + sw / 2 + sh; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x + sh, y0 + sh);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // (old duplicate _drawObstacles removed)
}

function stormStageFromElapsed(elapsed) {
  // Keep 5 stages for UI stability (matches the original Phase 1/5 display).
  // Stages correspond to major circle sizes, not micro-phases (holds/shrinks).
  const t = Math.max(0, elapsed || 0);
  if (t < 210) return 1;
  if (t < 390) return 2;
  if (t < 540) return 3;
  if (t < 660) return 4;
  return 5;
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}