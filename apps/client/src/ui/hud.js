import { CONFIG } from 'be-try-core';

// Ultra-compact in-game HUD (top-left)
// net: { rttMs?: number, rttJitterMs?: number, afkLeftSec?: number }
export function updateHUD(el, snapshot, selfId, net, pingEl = null) {
  const self = snapshot.players.find(p => p.id === selfId);

  const ping = (net && Number.isFinite(net.rttMs)) ? Math.max(0, net.rttMs) : null;
  if (pingEl) {
    if (ping == null) {
      pingEl.style.display = 'none';
    } else {
      pingEl.style.display = 'flex';
      pingEl.textContent = `Ping: ${Math.round(ping)}`;
    }
  }

  const afkLeft = (net && Number.isFinite(net.afkLeftSec)) ? Math.max(0, net.afkLeftSec) : 0;
  const afkStr = afkLeft > 0 ? `AFK: ${Math.ceil(afkLeft)}s` : '';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));

  const clampAvatarId = (id) => {
    const n = (Number.isFinite(id) ? (id | 0) : 0);
    const max = Array.isArray(CONFIG.AVATARS) ? (CONFIG.AVATARS.length - 1) : 0;
    return Math.max(0, Math.min(max, n));
  };
  const emojiFor = (p) => {
    const id = clampAvatarId(p?.avatarId);
    return Array.isArray(CONFIG.AVATARS) ? (CONFIG.AVATARS[id] || '') : '';
  };

  const top3 = [...(snapshot.players || [])]
    .sort((a, b) => (b.score | 0) - (a.score | 0))
    .slice(0, 3);

  const leftLines = [];
  const rightLines = [];

  // Active temporary buff indicators (compact)
  let buffsStr = '';
  let buffsTitle = '';
  if (self) {
    const parts = [];
    const titles = [];
    const sec = (ms) => Math.max(0, Math.ceil(ms));
    if ((self.bd | 0) > 0) { parts.push('💥'); titles.push(`DMG ${sec(self.bd)}s`); }
    if ((self.br | 0) > 0) { parts.push('💚'); titles.push(`REG ${sec(self.br)}s`); }
    if ((self.ba | 0) > 0) { parts.push('⚡'); titles.push(`AS ${sec(self.ba)}s`); }
    if ((self.bm | 0) > 0) { parts.push('🏃'); titles.push(`MS ${sec(self.bm)}s`); }
    buffsStr = parts.join('');
    buffsTitle = titles.join(' • ');
  }

  const dash = '—';
  leftLines.push({ t: 'LVL:', v: self ? `${String(self.level | 0)}${buffsStr ? ' ' + buffsStr : ''}` : dash, title: buffsTitle });
  leftLines.push({ t: 'Score:', v: self ? String(self.score | 0) : dash });
  leftLines.push({ t: 'K/D/A:', v: self ? `${self.kills | 0}/${self.deaths | 0}/${self.assists | 0}` : dash });
  leftLines.push({ t: 'Streak:', v: self ? String(self.streak | 0) : dash });
  if (afkStr) leftLines.push({ t: '', v: afkStr, muted: true });
  if (snapshot.match?.state === 'match' && Array.isArray(snapshot.obstacles) && snapshot.obstacles.length === 0) {
    leftLines.push({ t: '', v: 'Loading map…', muted: true });
  }

  rightLines.push({ hdr: true, v: 'TOP 3' });
  top3.forEach((p, i) => {
    const nm = esc(p?.name || '');
    const short = nm.length > 12 ? `${nm.slice(0, 12)}…` : nm;
    const emo = esc(emojiFor(p));
    rightLines.push({ t: `${i + 1}.`, v: `${emo ? emo + ' ' : ''}${short || '—'}` });
  });
  while (rightLines.length < 4) rightLines.push({ t: `${rightLines.length}.`, v: dash });

  const leftHtml = leftLines.map(o => {
    const cls = o.muted ? 'hudLine muted' : 'hudLine';
    const head = o.t ? `<span style="opacity:0.85">${esc(o.t)}</span> ` : '';
    const title = o.title ? ` title="${esc(o.title)}"` : '';
    return `<div class="${cls}"${title}>${head}${esc(o.v)}</div>`;
  }).join('');

  const rightHtml = rightLines.map((o) => {
    if (o.hdr) return `<div class="hudHdr">${esc(o.v)}</div>`;
    return `<div class="hudLine"><span style="opacity:0.85">${esc(o.t)}</span> ${esc(o.v)}</div>`;
  }).join('');

  el.innerHTML = `<div class="hudCols"><div class="hudCol">${leftHtml}</div><div class="hudCol small">${rightHtml}</div></div>`;
}
