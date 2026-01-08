#!/usr/bin/env node
/*
  WebSocket smoke test for Be_Try Arena BR.

  Checks:
  - helloReq -> hello -> welcome
  - update_required gate on wrong protocol
  - join public lobby, enable bots, ready
  - receives map + matchStart + snapshots (ss)

  Usage: npm run smoke
*/

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import { PROTOCOL_VERSION } from 'be-try-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_CWD = path.resolve(__dirname, '..');

function randId(len = 16) {
  // base64url-like (only [A-Za-z0-9_-])
  return randomBytes(Math.ceil(len * 0.75)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    .slice(0, len);
}

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function wsOnce(ws, timeoutMs, predicate) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ws message (${timeoutMs}ms)`));
    }, timeoutMs);

    const onMsg = (data) => {
      let msg = null;
      try { msg = JSON.parse(String(data)); } catch {}
      if (!msg) return;
      if (predicate && !predicate(msg)) return;
      cleanup();
      resolve(msg);
    };

    const onClose = (code, reason) => {
      cleanup();
      reject(new Error(`ws closed early (${code}) ${String(reason || '')}`));
    };

    const onErr = (err) => {
      cleanup();
      reject(err);
    };

    function cleanup() {
      clearTimeout(t);
      ws.off('message', onMsg);
      ws.off('close', onClose);
      ws.off('error', onErr);
    }

    ws.on('message', onMsg);
    ws.on('close', onClose);
    ws.on('error', onErr);
  });
}

async function startServer() {
  const port = 18000 + Math.floor(Math.random() * 8000);
  const env = {
    ...process.env,
    PORT: String(port),
    METRICS: '0'
  };

  const proc = spawn('node', ['src/index.js'], {
    cwd: SERVER_CWD,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let ready = false;
  const out = [];

  const onLine = (buf) => {
    const s = String(buf);
    out.push(s);
    if (!ready && s.includes(`ws://localhost:${port}`)) ready = true;
  };

  proc.stdout.on('data', onLine);
  proc.stderr.on('data', onLine);

  const startAt = Date.now();
  while (!ready) {
    if (Date.now() - startAt > 5000) {
      try { proc.kill('SIGTERM'); } catch {}
      throw new Error(`server did not become ready. output:\n${out.join('')}`);
    }
    await sleep(50);
  }

  return { proc, port, out };
}

async function stopServer(proc) {
  if (!proc) return;
  try { proc.kill('SIGTERM'); } catch {}
  await sleep(150);
  try { proc.kill('SIGKILL'); } catch {}
}

async function testUpdateRequired(port) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise((r) => ws.once('open', r));

  const helloReq = await wsOnce(ws, 1500, (m) => m.t === 'helloReq');
  must(helloReq && typeof helloReq.proto === 'number', 'missing helloReq.proto');

  ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION + 1, cid: randId(16), tok: randId(24) }));

  const authFail = await wsOnce(ws, 1500, (m) => m.t === 'authFail');
  must(authFail.reason === 'update_required', 'expected update_required');

  // server should close shortly after
  await new Promise((resolve) => ws.once('close', resolve));
}

async function testQuickPlayFlow(port) {
  const cid = randId(16);
  const tok = randId(24);

  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise((r) => ws.once('open', r));

  await wsOnce(ws, 1500, (m) => m.t === 'helloReq');
  ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION, cid, tok }));

  const welcome = await wsOnce(ws, 1500, (m) => m.t === 'welcome');
  must(welcome.protocol === PROTOCOL_VERSION, 'welcome.protocol mismatch');

  ws.send(JSON.stringify({ t: 'join', name: 'Smoke', avatarId: 0, roomCode: '' }));
  const joined = await wsOnce(ws, 1500, (m) => m.t === 'joined');
  must(joined && joined.role === 'player', 'expected joined role=player');

  // Quick Play semantic: bots ON + ready ON
  ws.send(JSON.stringify({ t: 'bots', v: true }));
  ws.send(JSON.stringify({ t: 'ready', v: true }));

  // Wait for map + matchStart
  const mapMsg = await wsOnce(ws, 15000, (m) => m.t === 'map');
  must(Array.isArray(mapMsg.obstacles), 'expected map.obstacles array');

  const matchStart = await wsOnce(ws, 15000, (m) => m.t === 'matchStart');
  must(typeof matchStart.weaponId === 'string', 'expected matchStart.weaponId');

  // Wait for snapshots
  const ss = await wsOnce(ws, 2000, (m) => m.t === 'ss');
  must(ss && ss.match && ss.match.state === 'match', 'expected match snapshot');

  ws.close();
  await new Promise((resolve) => ws.once('close', resolve));
}

async function main() {
  let proc = null;
  try {
    const srv = await startServer();
    proc = srv.proc;

    await testUpdateRequired(srv.port);
    await testQuickPlayFlow(srv.port);

    console.log('[smoke] OK');
    await stopServer(proc);
    process.exit(0);
  } catch (err) {
    console.error('[smoke] FAILED:', err?.stack || err);
    await stopServer(proc);
    process.exit(1);
  }
}

main();
