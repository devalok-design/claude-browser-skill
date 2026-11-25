# Setup: three servers, one wrapper

Tested on Windows 11 with Chrome, `@playwright/mcp` 0.0.86 and Playwright extension 0.6.0 (November 2026).
The wrapper is plain Node and should run anywhere; macOS and Linux are untested.

## The three servers

```jsonc
// ~/.claude.json → "mcpServers"
"playwright": {                       // logged-out, parallel-safe
  "command": "node",
  "args": ["<pwmcp>/node_modules/@playwright/mcp/cli.js", "--isolated", "--headless", "--browser", "chrome",
           "--timeout-action", "15000", "--timeout-navigation", "90000", "--output-dir", "<output-dir>"]
},
"playwright-auth": {                  // the user's logins, via the Playwright extension
  "command": "node",
  "args": ["<repo>/wrapper/own-window-proxy.js",
           "node", "<pwmcp>/node_modules/@playwright/mcp/cli.js", "--extension",
           "--user-data-dir", "<chrome-profile-dir>", "--browser", "chrome",
           "--timeout-action", "15000", "--timeout-navigation", "90000", "--output-dir", "<output-dir>"],
  "env": { "OWN_WINDOW_TOKEN_FILE": "<file holding PLAYWRIGHT_MCP_EXTENSION_TOKEN=…>",
           "OWN_WINDOW_LOG": "<output-dir>/own-window.log" }
},
"chrome-devtools": {                  // observer: network, performance, emulation
  "command": "npx", "args": ["chrome-devtools-mcp@<pinned>", "--isolated", "--headless"]
}
```

- **Pin `@playwright/mcp` to a local install.** `npx …@latest` hits the registry on every session start and
  drifts silently. After each upgrade, run `node tests/check.js 3` and roll back if it exits `1`.
- **`--timeout-action` defaults to 5000ms**, separate from `--timeout-navigation`. Raise both.
- **Never point `--user-data-dir` at a profile without `--extension` or `--isolated`.** Chrome locks a profile
  directory to one browser. Every other session then fails with `Browser is already in use`. Attach, don't launch.
- **`--extension` needs `PLAYWRIGHT_MCP_EXTENSION_TOKEN`.** Without it the connection hangs silently. The
  extension's `manage.html` page shows and regenerates it. Keep it out of `~/.claude.json`: the wrapper reads it
  from `OWN_WINDOW_TOKEN_FILE` (a dotenv-style line). A session started before a token change keeps the old one
  and fails with `did not connect within 30s` until it restarts.
- Optional, to stop focus stealing: `PLAYWRIGHT_MCP_BACKGROUND=1` and `PLAYWRIGHT_MCP_NO_TAB_GROUP=1` (user env).
  With the wrapper, background mode no longer leaves pages hidden.
- **Keep one tab open in that Chrome profile** (a pinned page): Chrome quits when its last tab closes.

## What the wrapper does (`wrapper/own-window-proxy.js`)

A stdio JSON-RPC proxy in front of `@playwright/mcp --extension`:

1. Before a session's first browser call it opens a popup window of its own, selects it and closes the hidden
   starting tab. Chrome runs only the active tab of each **window** at full speed, so one window per session
   means every session's page is `visible`.
2. Windows cascade diagonally from the opener's own screen (`screen.availLeft/Top`), sized to fit, 8 slots ×
   40px. A plain `left=` on a secondary monitor is relative to the primary monitor, so Chrome clamped every
   window to one x position. The middle window was then fully covered, and Windows treats a fully covered
   window as hidden.
3. `browser_close` in extension mode only detaches, so the wrapper closes the session's own tabs first. It
   does the same when the session exits.
4. If setup fails, the call goes through anyway in the old shared tab, and the error is written to stderr.

Known limits: **a window fully covered by another app counts as hidden too.** Windows reports it as occluded
and Chrome stops it. This happens easily on a single laptop screen with a maximised editor or terminal in
front. In our tests, 3 sessions passed 10 out of 10 runs on a two-monitor desk, but only 2 out of 8 after
undocking to the laptop screen alone. A minimised window is always hidden. When a session starts, another session's page can blip
to hidden for about a second. Beyond 8 concurrent sessions, windows reuse positions. `claude --chrome`
(Claude in Chrome) uses per-session tab groups but one window, so the active-tab limit still applies there.

## Stranded "Connect to Playwright" tabs

The extension normally reuses its connect tab as the session's first page. A tab is stranded only when a
connection never completes (bad token, process killed mid-connect). The relay link lives in the extension's
background, so closing a stranded tab disconnects nobody. Don't identify tabs by omnibox text: Chrome
shows an elided URL.
