// click-probe.js — does a click time out when the page is hidden (background tab), and work in an own window?
'use strict';
const { start } = require('./mcp.js');
const { token } = require('./mcp.js');
const cfg = require(require('os').homedir() + '/.claude.json').mcpServers['playwright-auth'];
// bypass own-window-proxy: args[0] is the proxy script, args[1..] the real server command
const raw = { command: cfg.args[1], args: cfg.args.slice(2), env: { PLAYWRIGHT_MCP_EXTENSION_TOKEN: token(cfg) } };
async function trial(label, server) {
  const c = start(server, label);
  try {
    await c.init(60000);
    await c.call('browser_navigate', { url: 'https://example.com/?click-probe=' + label }, 120000);
    const vis = (await c.call('browser_evaluate', { function: '() => document.visibilityState' })).text.match(/"(visible|hidden)"/)?.[1];
    const t0 = Date.now();
    const r = await c.call('browser_click', { target: 'a', element: 'the only link' }, 60000);
    console.log(`${label}: visibility=${vis} click ${r.isError ? 'FAILED' : 'ok'} in ${Date.now() - t0}ms ${r.isError ? '| ' + r.text.replace(/\s+/g, ' ').slice(0, 140) : ''}`);
    await c.call('browser_tabs', { action: 'close' }, 15000);   // browser_close alone only detaches (leaks the tab)
    await c.call('browser_close', {}, 15000);
  } finally { await c.close(); }
}
(async () => {
  await trial('hidden-tab(no proxy)', raw);
  await trial('own-window(proxy)', 'playwright-auth');
  process.exit(0);
})();
