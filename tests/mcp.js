// Minimal MCP stdio client: spawns a server exactly as Claude Code would (from ~/.claude.json, or a {command,args,env} object).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os');
const cfg = JSON.parse(fs.readFileSync(os.homedir() + '/.claude.json', 'utf8')).mcpServers;

// The extension token a server config would end up with: env value, else its OWN_WINDOW_TOKEN_FILE.
function token(server) {
  const env = { ...process.env, ...(server.env || {}) };
  if (env.PLAYWRIGHT_MCP_EXTENSION_TOKEN) return env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
  if (!env.OWN_WINDOW_TOKEN_FILE) throw new Error('no PLAYWRIGHT_MCP_EXTENSION_TOKEN or OWN_WINDOW_TOKEN_FILE in config/env');
  const m = fs.readFileSync(env.OWN_WINDOW_TOKEN_FILE.replace(/^~(?=[\\/])/, os.homedir()), 'utf8')
    .match(/^\s*(?:export\s+)?PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=\s*["']?([^"'\r\n]+)/m);
  if (!m) throw new Error('no PLAYWRIGHT_MCP_EXTENSION_TOKEN line in ' + env.OWN_WINDOW_TOKEN_FILE);
  return m[1].trim();
}

function start(name, tag) {
  const c = typeof name === 'object' ? name : cfg[name];
  const t0 = Date.now();
  const p = spawn(c.command, c.args, { env: { ...process.env, ...(c.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'], cwd: process.env.MCP_CWD || process.cwd() });
  let buf = '', id = 0; const pending = new Map(); let stderr = '';
  p.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  p.stderr.on('data', d => { stderr += d; });
  const exited = new Promise(r => p.on('exit', code => r(code)));
  function rpc(method, params, timeoutMs = 60000) {
    const myId = ++id;
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
    return Promise.race([
      new Promise(r => pending.set(myId, r)),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${method} ${timeoutMs}ms`)), timeoutMs)),
      exited.then(code => { throw new Error(`server exited ${code}: ${stderr.slice(-300)}`); }),
    ]);
  }
  async function init(timeoutMs) {
    const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'race-' + tag, version: '1' } }, timeoutMs);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return { ms: Date.now() - t0, r };
  }
  async function call(tool, args, timeoutMs) {
    const t = Date.now();
    const r = await rpc('tools/call', { name: tool, arguments: args || {} }, timeoutMs);
    const text = (r.result?.content || []).map(c => c.text || '').join('\n');
    return { ms: Date.now() - t, isError: !!(r.error || r.result?.isError), text: r.error ? JSON.stringify(r.error) : text };
  }
  // close(): end stdin like Claude Code does on session exit, so the server (and own-window proxy)
  // can clean up; force-kill only if it hasn't exited after graceMs. kill() is the hard stop.
  const close = (graceMs = 8000) => { try { p.stdin.end(); } catch {} return Promise.race([exited, new Promise((r) => setTimeout(() => { try { p.kill(); } catch {} r('killed'); }, graceMs))]); };
  return { p, init, call, close, kill: () => { try { p.kill(); } catch {} }, stderr: () => stderr };
}
module.exports = { start, token };
