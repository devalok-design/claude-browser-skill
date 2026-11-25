// dl-probe.js — how do downloads behave in playwright-auth (extension mode)?
'use strict';
const { start } = require('./mcp.js');
const URL_ = 'https://httpbin.org/response-headers?Content-Disposition=attachment%3B%20filename%3Dpw-dl-probe.txt';
(async () => {
  const c = start('playwright-auth', 'dl');
  try {
    await c.init(60000);
    await c.call('browser_navigate', { url: 'https://example.com/?dl-probe' }, 120000);
    const r1 = await c.call('browser_run_code_unsafe', { code: `async (page) => {
      const p = page.waitForEvent('download', { timeout: 15000 }).then(d => 'download event: ' + d.suggestedFilename()).catch(e => 'NO download event: ' + e.message.split(String.fromCharCode(10))[0]);
      await page.evaluate(u => { const a = document.createElement('a'); a.href = u; a.download = ''; document.body.appendChild(a); a.click(); }, ${JSON.stringify(URL_)});
      return await p; }` }, 40000);
    console.log('A (click link, waitForEvent):', r1.text.replace(/\s+/g, ' ').slice(0, 300));
    const r2 = await c.call('browser_run_code_unsafe', { code: `async (page) => {
      const res = await page.request.get(${JSON.stringify(URL_)});
      return 'page.request: status ' + res.status() + ' cd=' + res.headers()['content-disposition'] + ' bytes=' + (await res.body()).length; }` }, 40000);
    console.log('B (page.request.get):', r2.text.match(/### Result\s*([\s\S]*?)(###|$)/)?.[1].trim().slice(0, 200) || r2.text.slice(0, 200));
    const r3 = await c.call('browser_evaluate', { function: `async () => { const r = await fetch(${JSON.stringify(URL_)}); const b = await r.arrayBuffer(); return 'in-page fetch: ' + r.status + ' bytes=' + b.byteLength; }` }, 40000);
    console.log('C (in-page fetch):', r3.text.match(/### Result\s*([\s\S]*?)(###|$)/)?.[1].trim().slice(0, 200) || r3.text.slice(0, 200));
    await c.call('browser_close', {}, 30000);
  } finally { await c.close(); }
  process.exit(0);
})();
