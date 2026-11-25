// up-probe.js — playwright-auth uploads: does the file chooser path work, and does the in-page DataTransfer route?
'use strict';
const { start } = require('./mcp.js');
const fs = require('fs'), path = require('path'), os = require('os');
const FILE = path.join(os.tmpdir(), 'up-probe.txt');   // the chooser is refused before the path matters
fs.writeFileSync(FILE, 'upload probe\n');
process.on('exit', () => { try { fs.unlinkSync(FILE); } catch {} });
const short = (r) => r.text.replace(/\s+/g, ' ').slice(0, 170);
(async () => {
  const c = start('playwright-auth', 'up');
  try {
    await c.init(60000);
    await c.call('browser_navigate', { url: 'https://example.com/?up-probe' }, 120000);
    await c.call('browser_evaluate', { function: "() => { document.body.insertAdjacentHTML('beforeend', '<input id=f type=file>'); return 1; }" });
    const click = await c.call('browser_click', { target: '#f', element: 'file input' }, 30000);
    console.log('1 click opens chooser:', click.isError ? 'ERR ' + short(click) : (/file chooser|modal state|File chooser/i.test(click.text) ? 'chooser open' : short(click)));
    const up = await c.call('browser_file_upload', { paths: [FILE] }, 30000);
    console.log('2 browser_file_upload:', up.isError ? 'ERR ' + short(up) : 'ok');
    if (up.isError) await c.call('browser_file_upload', { paths: [] }, 15000).catch(() => {});
    const set = await c.call('browser_run_code_unsafe', { code: "async (page) => { try { await page.locator('#f').setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }); return 'setInputFiles ok'; } catch (e) { return 'setInputFiles ERR ' + e.message.split(String.fromCharCode(10))[0]; } }" }, 40000);
    console.log('3 setInputFiles (buffer):', short(set));
    const dt = await c.call('browser_evaluate', { function: "() => { const dt = new DataTransfer(); dt.items.add(new File([new TextEncoder().encode('hello from datatransfer')], 'dt.txt', { type: 'text/plain' })); const i = document.querySelector('#f'); let changed = 0; i.addEventListener('change', () => changed++); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return JSON.stringify({ files: i.files.length, name: i.files[0] && i.files[0].name, size: i.files[0] && i.files[0].size, changed }); }" });
    console.log('4 DataTransfer route:', short(dt));
    await c.call('browser_close', {}, 15000);
  } finally { await c.close(); }
  process.exit(0);
})();
