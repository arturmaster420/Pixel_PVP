export function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

export function send(ws, obj) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(obj));
}
