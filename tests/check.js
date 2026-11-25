// check.js — does the logged-in browser still work for several Claude sessions at once?
//
// Starts N copies of the `playwright-auth` server EXACTLY as configured in ~/.claude.json
// (so it tests the own-window proxy + the installed @playwright/mcp + the configured extension token),
// drives them at the same time, and asserts, for every session:
//   - it sees its own page (no cross-talk between sessions)
//   - the page is visible and runs at full speed (rAF >= 30/s, 50ms timer >= 15/s)
//   - after one session closes its browser, the others keep working and it gets a fresh window
//
// Usage:  node check.js [N=3]
// Exit:   0 pass · 1 a check failed (real regression) · 2 could not run (Chrome/extension not reachable)
'use strict';
const { start } = require('./mcp.js');
const N = +process.argv[2] || 3;

const probe = `async () => {
  const raf = await new Promise(r => { let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); }; requestAnimationFrame(f);
    setTimeout(() => r(n), 1500); });
  const tmo = await new Promise(r => { let n = 0; const iv = setInterval(() => n++, 50); setTimeout(() => { clearInterval(iv); r(n); }, 1000); });
  return JSON.stringify({ href: location.href, vis: document.visibilityState, raf, tmo });
}`;
const parse = (r) => { try { return JSON.parse(r.text.match(/\{.*\}/)[0].replace(/\\"/g, '"')); } catch { return null; } };
const CANT_RUN = /did not connect|Extension disconnected|not connected|ECONNREFUSED/i;

(async () => {
  const cs = Array.from({ length: N }, (_, i) => start('playwright-auth', 'check' + i));
  const fails = [];
  let cantRun = false;
  const t0 = Date.now();
  try {
    await Promise.all(cs.map((c) => c.init(60000)));
    async function round(tag) {
      const nav = await Promise.all(cs.map((c, i) => c.call('browser_navigate', { url: `https://example.com/?check=${i}&r=${tag}` }, 120000)
        .catch((e) => ({ isError: true, text: e.message }))));
      nav.forEach((r, i) => {
        if (!r.isError) return;
        if (CANT_RUN.test(r.text)) cantRun = true;
        fails.push(`${tag} s${i} navigate: ${r.text.replace(/\s+/g, ' ').slice(0, 200)}`);
      });
      if (cantRun) return;
      // Steady state, not the ~1s window while a starting session's setup tab briefly sits in the
      // most recently focused window (known, documented in README).
      await new Promise((r) => setTimeout(r, 2000));
      const ev = await Promise.all(cs.map((c) => c.call('browser_evaluate', { function: probe }, 60000).catch((e) => ({ isError: true, text: e.message }))));
      ev.forEach((r, i) => {
        const v = parse(r);
        const line = `${tag} s${i}: ${v ? JSON.stringify(v) : r.text.replace(/\s+/g, ' ').slice(0, 200)}`;
        console.log(line);
        if (!v) return fails.push(line);
        if (!v.href.includes(`check=${i}&r=${tag}`)) fails.push(`${tag} s${i} sees another session's page: ${v.href} | navigate said: ${(nav[i].text || '').replace(/s+/g, ' ').slice(0, 160)}`);
        if (v.vis !== 'visible') fails.push(`${tag} s${i} page is ${v.vis} (own-window setup not working?)`);
        if (v.raf < 30) fails.push(`${tag} s${i} rAF ${v.raf}/s (throttled)`);
        if (v.tmo < 15) fails.push(`${tag} s${i} timers ${v.tmo}/s (throttled)`);
      });
    }
    await round('a');
    if (!cantRun) {
      const c = await cs[0].call('browser_close', {}, 30000).catch((e) => ({ isError: true, text: e.message }));
      if (c.isError) fails.push('s0 browser_close: ' + c.text.slice(0, 200));
      await round('b'); // s0 must get a fresh window; s1..sN must be unaffected
      if (process.env.CHECK_HOLD) await new Promise((r) => setTimeout(r, +process.env.CHECK_HOLD));
    }
  } catch (e) {
    if (CANT_RUN.test(e.message)) cantRun = true;
    fails.push('harness: ' + e.message);
  } finally {
    await Promise.allSettled(cs.map((c) => c.call('browser_close', {}, 15000)));
    await Promise.all(cs.map((c) => c.close()));
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (cantRun) { console.log(`CANNOT RUN (${secs}s): Claude's Chrome or its Playwright extension is not reachable\n  ` + fails.join('\n  ')); process.exit(2); }
  if (fails.length) { console.log(`FAIL (${secs}s), ${fails.length} problem(s):\n  ` + fails.join('\n  ')); process.exit(1); }
  console.log(`PASS (${secs}s): ${N} concurrent sessions, own pages, all visible at full speed, survived a browser_close`);
  process.exit(0);
})();
