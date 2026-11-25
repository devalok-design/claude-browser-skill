---
name: browser
description: Use when a task drives a web page - acting in the user's logged-in accounts, checking what a logged-out visitor or Googlebot sees, scraping, downloads, uploads, dropdowns, forms, 2FA, or pulling data out of a web app. Also on a spinner that never ends, "waiting for element to be visible, enabled and stable", "Ref not found", "did not connect within 30s", "Not allowed" on upload, or before running browser work in parallel subagents.
---

# Browser

**The browser is the slowest, flakiest way to get data. Use it to get *into* a logged-in app, then read the
app's own API from inside the page.** Clicking through UI is the fallback.

If `references/local.md` exists, read it first: it holds this machine's profile, paths and the user's rules.

## Pick the tool

| Need | Use |
|---|---|
| The user's logins | `playwright-auth` (Playwright MCP `--extension`, attached to their Chrome) |
| What a logged-out visitor sees | `playwright` (`--isolated --headless`) |
| What the **server** sent, i.e. whether Google can see it | `curl`. Every browser runs JS, so hydrated DOM looks like server HTML. |
| Mobile emulation, performance, network waterfall | `chrome-devtools` MCP (`emulate`, `performance_*`) |
| Just text or PDFs | A fetch/extract service; no browser |
| The service has its own MCP, CLI or API | That, before any dashboard |

Load deferred tool schemas first: `ToolSearch("select:mcp__playwright-auth__browser_navigate,…")`.

## Facts that decide everything (`playwright-auth`)

- **Only a window's active tab is alive.** Every other tab is `visibilityState: "hidden"`: rAF 0/s, timers
  ~1/s. Clicks there time out at *"waiting for element to be visible, enabled and stable"* (Playwright's
  stability check needs rAF). Measured: same click 15s timeout hidden, 3s ok visible. Run behind
  `own-window-proxy.js` so each session gets its own window, and never minimise those windows.
- **Subagents in ONE session share ONE tab**: they share the parent's MCP connection, and one subagent's
  navigation lands on the other's page. Separate sessions are isolated. For parallel logged-in work, run separate
  `claude -p` processes, or go sequential.
- **`browser_close` only detaches**: the tab stays open. The wrapper closes the session's tabs for real.
- **File chooser blocked**: `DOM.setFileInputFiles … "Not allowed"`. **`download` events never fire**: files
  still land in the Downloads folder. **No `newCDPSession`** (`Not allowed`). **No `require`/`import()`** in
  `browser_run_code_unsafe`.
- Interaction tools take **`target`** (snapshot ref or selector) + `element`, never `ref`.

## Power moves

**Read the app's API in-page** (same origin, the user's cookies). Find endpoints with `browser_network_requests`
first, and return only the fields you need:

```js
// browser_evaluate
async () => {
  const r = await fetch('/api/projects/1234/dashboards/5678/', { credentials: 'include' });
  if (!r.ok) return `HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`;
  return (await r.json()).tiles.map(t => ({ name: t.insight?.name, result: t.insight?.result }));
}
```
Cross-origin → `page.request.get()` in run_code (carries cookies). Writes need the app's CSRF header, copied
from a captured request.

**Batch** 20 click/snapshot round-trips into one `browser_run_code_unsafe` loop. Wait for the thing, never
sleep. **Prefer the app's export/CSV.** **Tables**: one `browser_evaluate` over `tbody tr`, then check the
count against the page's total.

## When a page won't cooperate

| Symptom | Do |
|---|---|
| Spinner forever / blank chart / click "resolved" then timed out on *stable* | `document.visibilityState` first. Hidden → the window is minimised, covered or a background tab; use the API meanwhile. |
| Timeout with no "resolved" line | The locator never matched. List the real elements (`references/forms.md`); never guess a selector twice. |
| `Ref … not found` | Snapshot again; refs die on re-render. |
| `strict mode violation … resolved to N elements` | `{ exact: true }`, scope to a container, or `.filter({ visible: true })`. |
| Dropdown, combobox, typeahead, checkbox, modal, overlay | `references/forms.md` |
| Upload, iframe, shadow DOM, download | `references/uploads-frames.md` |
| Timeouts, `networkidle` hangs, infinite or virtual lists | `references/waiting-lists.md` |
| `did not connect within 30s` | Token mismatch, or Chrome isn't running (`references/setup.md`). |
| Login, 2FA, CAPTCHA | Stop. Tell the user the account and page; they finish it in the browser; then snapshot and continue. Never ask for codes in chat. |
| Permission classifier denied an action | Report it. Never route around it (e.g. `checked = true` on a consent box). |

## Finish clean

Close what you opened (`browser_close`, with the wrapper). Never close tabs you didn't open. Delete downloads
you only needed to process. Read state back after every action that matters: `checked`, `aria-expanded`, the
field's value, the request's status. A click that "succeeded" proves nothing.

## Red flags

- 2+ subagents about to use `playwright-auth` → they will hijack each other's tab.
- Third screenshot of the same spinner → check visibility and the network.
- More than ~8 click/snapshot calls for a data question → find the API.
- `waitForEvent('download')`, `waitForTimeout(…)` as padding, `require(` in run_code.
- `playwright-auth` used to judge what Google or a logged-out visitor sees.
- "Not found" after one page view → say which pages and filters you checked.

Health check: `node tests/check.js 3` (exit `0` pass, `1` regression, `2` browser not reachable).
