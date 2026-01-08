export class WSClient {
  constructor(url, opts = {}) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();

    this._connecting = false;
    this._retryTimer = null;
    this._nextRetryAtMs = 0;

    this._attempt = 0;
    this._baseDelayMs = Math.max(50, opts.baseDelayMs ?? 250);
    this._maxDelayMs = Math.max(this._baseDelayMs, opts.maxDelayMs ?? 8000);

    this._state = 'idle'; // idle | connecting | open | reconnecting | offline | closed
    this._manualStop = false;

    // Lightweight ingress stats (helps diagnose mobile stutter).
    const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    this._stats = {
      // rolling 1s window
      winStartMs: nowMs,
      winBytes: 0,
      winMsgs: 0,
      bytesPerSec: 0,
      msgsPerSec: 0,
      // parse timing
      parseLastMs: 0,
      parseAvgMs: 0,
      parseMaxMs: 0,
      // last message
      lastMsgAtMs: 0,
      lastMsgType: '',
    };
  }

  on(type, fn) {
    this.handlers.set(type, fn);
  }

  _emit(type, payload = {}) {
    const fn = this.handlers.get(type);
    if (fn) fn({ t: type, ...payload });
  }

  _setState(state, payload = {}) {
    this._state = state;
    const fn = this.handlers.get('status');
    if (fn) fn({ t: 'status', state, ...payload });
  }

  getState() {
    return this._state;
  }

  getRetryInMs() {
    const left = this._nextRetryAtMs - Date.now();
    return Math.max(0, left | 0);
  }

  getStats() {
    // Compute rates on demand (no timers).
    const s = this._stats;
    const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const dt = nowMs - (s.winStartMs || nowMs);
    if (dt >= 900) {
      const k = 1000 / Math.max(1, dt);
      s.bytesPerSec = Math.round((s.winBytes || 0) * k);
      s.msgsPerSec = Math.round((s.winMsgs || 0) * k);
      s.winStartMs = nowMs;
      s.winBytes = 0;
      s.winMsgs = 0;
      s.parseMaxMs = 0;
    }
    return { ...s };
  }

  connect() {
    if (this._manualStop) this._manualStop = false;

    // If already open or connecting, do nothing.
    if (this._connecting) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;

    // Cancel any pending retry.
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
      this._nextRetryAtMs = 0;
    }

    // If offline, wait a bit and retry.
    const online = (typeof navigator !== 'undefined' && 'onLine' in navigator) ? !!navigator.onLine : true;
    if (!online) {
      const d = Math.min(this._maxDelayMs, Math.max(1200, this._baseDelayMs * 2));
      this._scheduleReconnect(d, 'offline');
      return;
    }

    this._connecting = true;
    this._setState('connecting');

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this._connecting = false;
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._connecting = false;
      this._attempt = 0;
      this._setState('open');
      this._emit('open');
    };

    this.ws.onmessage = (ev) => {
      let msg = null;
      const s = this._stats;
      const raw = ev?.data;
      const bytes = (typeof raw === 'string') ? raw.length : ((raw && (raw.byteLength | 0)) || 0);
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      try { msg = JSON.parse(raw); } catch { return; }
      const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const parseMs = Math.max(0, t1 - t0);
      // Update rolling stats.
      s.winBytes += bytes;
      s.winMsgs += 1;
      s.parseLastMs = parseMs;
      s.parseAvgMs = (s.parseAvgMs * 0.90) + (parseMs * 0.10);
      s.parseMaxMs = Math.max(s.parseMaxMs || 0, parseMs);
      s.lastMsgAtMs = t1;
      s.lastMsgType = (msg && msg.t) ? String(msg.t) : '';
      if (!msg?.t) return;
      const fn = this.handlers.get(msg.t);
      if (fn) fn(msg);
    };

    this.ws.onerror = () => {
      this._emit('error');
      // onclose will follow in most browsers
    };

    this.ws.onclose = (ev) => {
      this._connecting = false;
      this._emit('close', { code: ev?.code, reason: ev?.reason, wasClean: ev?.wasClean });
      this._scheduleReconnect();
    };
  }

  _scheduleReconnect(forcedDelayMs = null, mode = 'reconnecting') {
    if (this._manualStop) return;

    // Exponential backoff with jitter.
    if (forcedDelayMs == null) {
      this._attempt = Math.min(10, this._attempt + 1);
      const pow = Math.pow(2, Math.max(0, this._attempt - 1));
      forcedDelayMs = Math.min(this._maxDelayMs, this._baseDelayMs * pow);
      // jitter ±15%
      forcedDelayMs = Math.floor(forcedDelayMs * (0.85 + Math.random() * 0.30));
    }

    const d = Math.max(60, forcedDelayMs | 0);
    this._nextRetryAtMs = Date.now() + d;
    this._setState(mode === 'offline' ? 'offline' : 'reconnecting', { retryInMs: d, attempt: this._attempt });

    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.connect();
    }, d);
  }

  retryNow() {
    this._attempt = 0;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    this._nextRetryAtMs = 0;

    try {
      if (this.ws && this.ws.readyState !== 3) this.ws.close();
    } catch {}

    this.ws = null;
    this._connecting = false;
    this.connect();
  }

  close() {
    this._manualStop = true;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    this._nextRetryAtMs = 0;
    this._setState('closed');

    try { this.ws?.close(); } catch {}
    this.ws = null;
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(obj));
  }
}
