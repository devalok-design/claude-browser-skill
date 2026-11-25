#!/usr/bin/env node
// own-window-proxy — stdio MCP proxy in front of `@playwright/mcp --extension`.
//
// Why: Chrome gives each WINDOW one active tab, and only that tab runs at full speed. Every
// other tab is `visibilityState: hidden` (requestAnimationFrame 0/s, timers throttled to ~1/s),
// so sites that wait for visibility never load. With several Claude sessions sharing one Chrome,
// they all fight over the one active slot. Measured 2026-11-25: giving each session its own
// popup window made 3 concurrent sessions all visible at 62fps / 20 timer ticks per second.
//
// What it does: passes every JSON-RPC message through unchanged, except that before the
// session's first browser tool call it (1) opens a popup window of its own, (2) selects it as
// the current tab, (3) closes the hidden tab it started from. If the window is later closed,
// the next browser call sets one up again.
//
// Usage: node own-window-proxy.js <real server command> [args...]
// Debug: OWN_WINDOW_LOG=<file> appends a line per event.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path'), os = require('os');

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) { process.stderr.write('own-window-proxy: missing server command\n'); process.exit(2); }

const W = +(process.env.OWN_WINDOW_WIDTH || 1440), H = +(process.env.OWN_WINDOW_HEIGHT || 900);
const logFile = process.env.OWN_WINDOW_LOG;
const log = (m) => { if (logFile) try { fs.appendFileSync(logFile, `${new Date().toISOString()} pid${process.pid} ${m}\n`); } catch {} };

// The extension token: PLAYWRIGHT_MCP_EXTENSION_TOKEN in the environment wins. Otherwise it is read from
// OWN_WINDOW_TOKEN_FILE, a dotenv-style file with a `PLAYWRIGHT_MCP_EXTENSION_TOKEN=…` line, so the secret
// can live in a generated/secret-managed file instead of ~/.claude.json. Without a token the extension
// connect hangs silently, so say so loudly.
if (!process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN && process.env.OWN_WINDOW_TOKEN_FILE) {
  const tokenFile = process.env.OWN_WINDOW_TOKEN_FILE.replace(/^~(?=[\\/])/, os.homedir());
  try {
    const m = fs.readFileSync(tokenFile, 'utf8').match(/^\s*(?:export\s+)?PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=\s*["']?([^"'\r\n]+)/m);
    if (m) process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = m[1].trim();
    else process.stderr.write(`own-window-proxy: no PLAYWRIGHT_MCP_EXTENSION_TOKEN line in ${tokenFile}\n`);
  } catch (e) { process.stderr.write(`own-window-proxy: cannot read ${tokenFile}: ${e.message}\n`); }
}
if (!process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN) {
  process.stderr.write('own-window-proxy: PLAYWRIGHT_MCP_EXTENSION_TOKEN is not set (env or OWN_WINDOW_TOKEN_FILE); the extension connect will hang.\n');
}

const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
child.on('exit', (code, sig) => { log(`server exited ${code} ${sig || ''}`); process.exit(code ?? 1); });
// Session ended (Claude Code closed stdin) without a browser_close: close our window anyway,
// otherwise it leaks. Bounded so a stuck server can't hold the exit.
process.stdin.on('end', () => {
  const done = () => child.stdin.end();
  if (!ready) return done();
  Promise.race([closeOwnTabs(), new Promise((r) => setTimeout(r, 5000))]).finally(done);
});

// ---- line framing -------------------------------------------------------------------------
function lines(stream, onLine) {
  let buf = '';
  stream.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onLine(l); }
  });
}
const toClient = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const toServer = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');

// ---- our own requests to the server (ids in a separate namespace) -------------------------
let seq = 0; const mine = new Map();
function call(name, a, timeoutMs = 60000) {
  const id = `own-window-${++seq}`;
  toServer({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: a } });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { mine.delete(id); reject(new Error(`${name} timed out`)); }, timeoutMs);
    mine.set(id, (m) => {
      clearTimeout(t);
      const text = (m.result?.content || []).map((c) => c.text || '').join('\n');
      if (m.error || m.result?.isError) reject(new Error(`${name}: ${m.error ? JSON.stringify(m.error) : text.slice(0, 400)}`));
      else resolve(text);
    });
  });
}

// ---- own-window setup ---------------------------------------------------------------------
// Tools that must NOT trigger setup: they don't need a visible page, or would fight it.
const SKIP = new Set(['browser_close', 'browser_install', 'browser_tabs', 'browser_resize']);
let ready = false; let setupPromise = null; const queue = [];

// Windows marks a FULLY covered window as occluded, and Chrome then treats its page as hidden.
// Identical windows stack exactly on top of each other, so each live proxy claims a slot and
// staggers its window by STEP px. Slots are files named by slot number holding the owner pid;
// a slot whose pid is dead is free again.
const SLOT_DIR = path.join(os.tmpdir(), 'own-window-slots'), STEP = 40, SLOTS = 8;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function claimSlot() {
  fs.mkdirSync(SLOT_DIR, { recursive: true });
  for (let s = 0; s < SLOTS; s++) {
    const f = path.join(SLOT_DIR, String(s));
    try { fs.writeFileSync(f, String(process.pid), { flag: 'wx' }); return s; } catch {}
    const owner = +fs.readFileSync(f, 'utf8');
    if (owner === process.pid) return s;
    if (!alive(owner)) { try { fs.unlinkSync(f); fs.writeFileSync(f, String(process.pid), { flag: 'wx' }); return s; } catch {} }
  }
  return process.pid % SLOTS; // all taken: best effort
}
let slot = null;
process.on('exit', () => { if (slot != null) try { if (+fs.readFileSync(path.join(SLOT_DIR, String(slot)), 'utf8') === process.pid) fs.unlinkSync(path.join(SLOT_DIR, String(slot))); } catch {} });
// Diagonal cascade measured from the opener's OWN screen (screen.availLeft/Top: on a secondary
// monitor, plain left= is taken relative to the primary and Chrome clamps every window to the same
// x, leaving only a vertical stagger that sandwiches the middle window fully covered). Windows are
// shrunk so the whole cascade fits on that screen: then each window keeps an uncovered STEPxSTEP
// corner strip, so none is ever fully occluded by the others.
const openCode = (s) => `async (page) => {
  const [p] = await Promise.all([
    page.waitForEvent('popup', { timeout: 15000 }),
    page.evaluate(() => {
      const s = ${s}, STEP = ${STEP}, SLOTS = ${SLOTS}, M = 20;
      const sc = window.screen;
      const w = Math.min(${W}, sc.availWidth - 2 * M - (SLOTS - 1) * STEP);
      const h = Math.min(${H}, sc.availHeight - 2 * M - (SLOTS - 1) * STEP);
      const left = (sc.availLeft || 0) + M + s * STEP, top = (sc.availTop || 0) + M + s * STEP;
      window.open('about:blank', '_blank', 'popup,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
    }),
  ]);
  return 'own-window-opened';
}`;

function parseTabs(text) {
  // lines like: "- 1: (current) [Title](url)"  or  "- 0: [about:blank](about:blank)"
  return [...text.matchAll(/^- (\d+):\s*(\(current\))?\s*\[(.*?)\]\((.*?)\)/gm)]
    .map((m) => ({ index: +m[1], current: !!m[2], url: m[4] }));
}

async function setup() {
  log('setup: start');
  // A page must exist before we can window.open from it; navigating to about:blank creates/attaches one.
  await call('browser_navigate', { url: 'about:blank' }, 90000);
  const before = parseTabs(await call('browser_tabs', { action: 'list' }));
  const origin = before.find((t) => t.current) || before[before.length - 1];
  if (slot == null) slot = claimSlot();
  log('setup: slot ' + slot);
  await call('browser_run_code_unsafe', { code: openCode(slot) }, 30000);
  const after = parseTabs(await call('browser_tabs', { action: 'list' }));
  const fresh = after.filter((t) => !before.some((b) => b.index === t.index)).pop() || after[after.length - 1];
  if (!fresh || (origin && fresh.index === origin.index)) throw new Error(`could not find the new window in tab list: ${JSON.stringify(after)}`);
  await call('browser_tabs', { action: 'select', index: fresh.index });
  if (origin) {
    // Close the hidden starting tab. Indexes shift after a close, so re-list and close by position.
    await call('browser_tabs', { action: 'close', index: origin.index }).catch((e) => log('close origin failed: ' + e.message));
  }
  // Closing a tab can move the "current" pointer back to a tab that is about to vanish (seen as a
  // first call landing on about:blank). Re-list and explicitly select our window's tab.
  let final = parseTabs(await call('browser_tabs', { action: 'list' }));
  // After the origin close exactly one tab should remain (our popup). If the close failed,
  // the popup is the newest, i.e. the highest index.
  const target = final[final.length - 1];
  if (target && !target.current) {
    await call('browser_tabs', { action: 'select', index: target.index });
    final = parseTabs(await call('browser_tabs', { action: 'list' }));
  }
  if (final.length !== 1) log('setup: WARNING expected 1 tab, have ' + JSON.stringify(final));
  log('setup: done ' + JSON.stringify(final));
}

function ensureWindow() {
  if (ready) return Promise.resolve();
  if (!setupPromise) {
    setupPromise = setup().then(
      () => { ready = true; setupPromise = null; },
      (e) => { setupPromise = null; log('setup FAILED ' + e.message); throw e; },
    );
  }
  return setupPromise;
}

// browser_tabs action=close (no index) closes the current tab for real; repeat until none are left.
async function closeOwnTabs() {
  for (let i = 0; i < 20; i++) {
    let text;
    try { text = await call('browser_tabs', { action: 'close' }, 15000); }
    catch (e) { if (!/No open tabs/i.test(e.message)) log('closeOwnTabs: ' + e.message.slice(0, 160)); return; }
    if (/No open tabs/i.test(text)) { log('closeOwnTabs: closed ' + (i + 1)); return; }
  }
  log('closeOwnTabs: gave up after 20');
}

// ---- message routing ----------------------------------------------------------------------
lines(process.stdin, (line) => {
  let m; try { m = JSON.parse(line); } catch { child.stdin.write(line + '\n'); return; }
  const tool = m.method === 'tools/call' ? m.params?.name : null;
  if (tool === 'browser_close') {
    // In extension mode browser_close only DETACHES: the tab/window stays open in Chrome. Leaked
    // windows pile up at the same slot positions and fully cover new ones, which makes those hidden.
    // Close our own tabs for real first, then forward the close.
    ready = false;
    closeOwnTabs().finally(() => toServer(m));
    return;
  }
  if (!tool || SKIP.has(tool) || ready) { toServer(m); return; }
  ensureWindow().then(
    () => toServer(m),
    (e) => {
      // Setup failure must not hide the real call: forward it anyway (old behaviour, hidden tab), and log loudly.
      process.stderr.write(`own-window-proxy: own-window setup failed, falling back to shared tab: ${e.message}\n`);
      toServer(m);
    },
  );
});

lines(child.stdout, (line) => {
  let m; try { m = JSON.parse(line); } catch { process.stdout.write(line + '\n'); return; }
  if (m.id != null && mine.has(m.id)) { const r = mine.get(m.id); mine.delete(m.id); r(m); return; }
  // A page/context-closed error means our window is gone: set up a fresh one next time.
  if (m.result?.isError) {
    const text = (m.result.content || []).map((c) => c.text || '').join(' ');
    if (/has been closed|Extension disconnected|No open (tabs|pages)/i.test(text)) { ready = false; log('window lost: ' + text.slice(0, 120)); }
  }
  toClient(m);
});
