# Tests

Each script starts the real MCP servers exactly as `~/.claude.json` configures them and talks JSON-RPC to them
over stdio, the same way Claude Code does. They need Chrome running on the `playwright-auth` profile with
the Playwright extension connected. Pages used: `example.com` and `httpbin.org`.

## The one that matters

```
node check.js 3
```

Three concurrent `playwright-auth` sessions through the wrapper. For each one it checks that the session:
- sees only its own page
- shows the page as `visible`, with rAF ≥ 30/s and a 50ms timer ≥ 15/s
- survives another session's `browser_close`, while that session gets a fresh window

Exit codes: `0` pass, `1` regression, `2` could not run (browser not reachable). Run it after every
`@playwright/mcp` upgrade and roll back on `1`. Set `CHECK_HOLD=<ms>` to keep the windows open at the end so you
can look at them.

## Probes (each one answers a single question)

| Script | Question | Result (Nov 2026) |
|---|---|---|
| `click-probe.js` | Does a click time out in a hidden tab? | Hidden: 15s timeout. Own window: ok in 3s. |
| `up-probe.js` | Can `playwright-auth` upload? | Chooser: `DOM.setFileInputFiles "Not allowed"`. `setInputFiles` with a buffer: works. DataTransfer: works. |
| `dl-probe.js` | Do downloads work? | `waitForEvent('download')` never fires; the file lands in Downloads anyway (delete `pw-dl-probe.txt` afterwards). `page.request.get` works. |
| `close-probe.js <tabs-close\|page-close\|window-close>` | Which close actually removes the window? | All three do. `browser_close` alone only detaches. |

`mcp.js` is the shared client: `start(name | {command,args,env})` returns `init`, `call`, `close` (graceful: it
ends stdin and lets the wrapper clean up) and `kill`.
