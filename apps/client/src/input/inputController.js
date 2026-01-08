export class InputController {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();

    // Mouse
    this.mouseDown = false;
    this.mouseX = 0;
    this.mouseY = 0;

    // Touch (mobile): split screen
    // Left half = movement, Right half = aim+fire.
    // No visible joysticks. Control is "anchored" to the touch START point:
    // where you touched becomes the center, and we use delta from that point.
    this.touchMode = false;
    this.touchDeadzone = 12; // px
    this.touchMaxDist = 120; // px (scaled by screen later)

    // Touch state per half.
    // ax/ay = anchor (touch start), x/y = current pointer.
    this.left = { active: false, id: null, ax: 0, ay: 0, x: 0, y: 0, w: 0, h: 0 };
    this.right = { active: false, id: null, ax: 0, ay: 0, x: 0, y: 0, w: 0, h: 0 };

    this._lastAim = [1, 0];

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    // Mouse listeners (desktop)
    window.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouseDown = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    // Touch / Pointer listeners (mobile + tablets)
    // We listen on canvas so UI overlays (lobby/results) keep working.
    const opts = { passive: false };

    canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e), opts);
    canvas.addEventListener('pointermove', (e) => this._onPointerMove(e), opts);
    window.addEventListener('pointerup', (e) => this._onPointerUp(e), opts);
    window.addEventListener('pointercancel', (e) => this._onPointerUp(e), opts);

    // Prevent long-press context menu on mobile
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _canvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      w: rect.width,
      h: rect.height
    };
  }

  _assignSide(pos) {
    // Prefer side by screen half, but fall back if the chosen side is already taken.
    const wantLeft = pos.x < pos.w * 0.5;
    if (wantLeft) {
      if (!this.left.active) return 'left';
      if (!this.right.active) return 'right';
      return null;
    } else {
      if (!this.right.active) return 'right';
      if (!this.left.active) return 'left';
      return null;
    }
  }

  _onPointerDown(e) {
    // Only touch/pen should control joysticks.
    if (e.pointerType === 'mouse') return;

    const pos = this._canvasPos(e);
    const side = this._assignSide(pos);
    if (!side) return;

    this.touchMode = true;

    const joy = side === 'left' ? this.left : this.right;
    joy.active = true;
    joy.id = e.pointerId;
    // Anchor joystick at touch position.
    joy.ax = pos.x;
    joy.ay = pos.y;
    joy.x = pos.x;
    joy.y = pos.y;
    joy.w = pos.w;
    joy.h = pos.h;

    try { this.canvas.setPointerCapture(e.pointerId); } catch {}

    e.preventDefault();
  }

  _onPointerMove(e) {
    if (!this.touchMode) return;

    const pos = this._canvasPos(e);

    if (this.left.active && e.pointerId === this.left.id) {
      this.left.x = pos.x;
      this.left.y = pos.y;
      this.left.w = pos.w;
      this.left.h = pos.h;
      e.preventDefault();
      return;
    }

    if (this.right.active && e.pointerId === this.right.id) {
      this.right.x = pos.x;
      this.right.y = pos.y;
      this.right.w = pos.w;
      this.right.h = pos.h;
      e.preventDefault();
      return;
    }
  }

  _onPointerUp(e) {
    if (this.left.active && e.pointerId === this.left.id) {
      this.left.active = false;
      this.left.id = null;
      this.left.ax = this.left.ay = 0;
    }
    if (this.right.active && e.pointerId === this.right.id) {
      this.right.active = false;
      this.right.id = null;
      this.right.ax = this.right.ay = 0;
    }

    // Keep touchMode enabled once user touched (so hint makes sense),
    // but if no touches are active we stop firing/moving anyway.
  }

  _touchVec(sideJoy, which) {
    if (!sideJoy.active) return [0, 0];

    const w = sideJoy.w || this.canvas.width;
    const h = sideJoy.h || this.canvas.height;

    // Anchor is where the player touched.
    // This avoids the feeling that the joystick is "stuck" to the middle of the half-screen.
    const ax = sideJoy.ax;
    const ay = sideJoy.ay;

    const dx = sideJoy.x - ax;
    const dy = sideJoy.y - ay;
    const len = Math.hypot(dx, dy);

    const maxDist = Math.max(70, Math.min(this.touchMaxDist, Math.min(w, h) * 0.30));
    if (len < this.touchDeadzone) return [0, 0];

    const k = Math.min(1, len / maxDist);
    return [dx / len * k, dy / len * k];
  }

  getMoveVec() {
    // Touch left-half overrides keyboard movement.
    const tv = this._touchVec(this.left, 'left');
    if (tv[0] !== 0 || tv[1] !== 0) return tv;

    // Keyboard WASD
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;

    const len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    return [x, y];
  }

  getAimVec(cam, selfX, selfY) {
    // Touch right-half sets aim direction.
    const av = this._touchVec(this.right, 'right');
    if (av[0] !== 0 || av[1] !== 0) {
      this._lastAim = av;
      return av;
    }

    // Mouse aim (desktop)
    const rect = this.canvas.getBoundingClientRect();
    const cx = this.mouseX - rect.left;
    const cy = this.mouseY - rect.top;

    // convert screen -> world
    const wx = cam.x + (cx - cam.w / 2) / cam.zoom;
    const wy = cam.y + (cy - cam.h / 2) / cam.zoom;

    const vx = wx - selfX;
    const vy = wy - selfY;
    const len = Math.hypot(vx, vy);
    if (len > 0.0001) {
      this._lastAim = [vx / len, vy / len];
      return this._lastAim;
    }
    return this._lastAim;
  }

  getFire() {
    // On touch, fire while finger is on the right half.
    if (this.right.active) return true;
    return this.mouseDown;
  }

  getTouchOverlayState() {
    // No visible joysticks for this control scheme.
    return null;
  }
}
