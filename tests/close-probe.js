// close-probe.js — which way of closing actually removes the session's window from Chrome?
// (In extension mode `browser_close` only detaches: the page stays open.)
// Usage: node close-probe.js <tabs-close|page-close|window-close>
'use strict';
const { start } = require('./mcp.js');
const { execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const method = process.argv[2];
// The Chrome profile playwright-auth attaches to, taken from the user's own config (--user-data-dir).
const args = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).mcpServers['playwright-auth'].args;
const PROFILE = path.basename(args[args.indexOf('--user-data-dir') + 1]).replace(/'/g, '');
const countWindows = () => +execSync(`powershell -NoProfile -c "Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes; $A=[Windows.Automation.AutomationElement]; $p=(Get-CimInstance Win32_Process -Filter \\"name='chrome.exe'\\" | ? { $_.CommandLine -match '${PROFILE}' -and $_.CommandLine -notmatch '--type=' }).ProcessId; ($A::RootElement.FindAll([Windows.Automation.TreeScope]::Children,(New-Object Windows.Automation.PropertyCondition($A::ProcessIdProperty,[int]$p))) | ? { $_.Current.Name -like 'Example Domain*' }).Count"`).toString().trim();
(async () => {
  const c = start('playwright-auth', 'probe');
  await c.init(60000);
  await c.call('browser_navigate', { url: 'https://example.com/?probe=' + method }, 120000);
  const before = countWindows();
  let r;
  if (method === 'tabs-close') r = await c.call('browser_tabs', { action: 'close' }, 30000);
  if (method === 'page-close') r = await c.call('browser_run_code_unsafe', { code: 'async (page) => { await page.close(); return "closed"; }' }, 30000);
  if (method === 'window-close') r = await c.call('browser_evaluate', { function: '() => { setTimeout(() => window.close(), 0); return "closing"; }' }, 30000);
  await new Promise((res) => setTimeout(res, 1500));
  const after = countWindows();
  console.log(`${method}: Example Domain windows before=${before} after=${after} -> ${after < before ? 'REALLY CLOSED' : 'STILL OPEN'} | tool said: ${(r?.text || '').replace(/\s+/g, ' ').slice(0, 100)}`);
  c.kill(); process.exit(0);
})();
