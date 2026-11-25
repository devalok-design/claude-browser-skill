# claude-browser-skill

A skill that teaches Claude Code to work a real browser well, plus the small wrapper and tests that make it
hold up when many sessions share one logged-in Chrome.

We built it at Devalok after our own sessions kept getting stuck in the browser: charts that never finished
loading, clicks that timed out, uploads that failed. We measured what was going on, fixed what we could, then
read through 2,747 of our own Claude Code transcripts (10,650 browser calls) to learn how sessions actually got
past dropdowns, form fields, modals, uploads and timeouts. This repository is what came out of that.
We are sharing it because the problems were not ours alone.

## What we found

- **Only the active tab of a Chrome window is alive.** Every other tab reports `visibilityState: "hidden"`,
  `requestAnimationFrame` stops, and timers slow to about one tick a second. Playwright waits for an element to
  be "stable" before it clicks, and that check needs animation frames. So in a background tab every click
  times out. In our transcripts, `browser_click` on the logged-in browser failed 68% of the time.
  The same click took a 15-second timeout in a hidden tab and succeeded in 3 seconds in its own window.
- **Subagents inside one session share one tab.** Two subagents navigating at once land on each other's page.
  Separate sessions stay isolated from each other.
- **In extension mode, `browser_close` only detaches.** The tab stays open, and leftover windows pile up on
  top of new ones.
- **Uploads through the file chooser are refused** with `DOM.setFileInputFiles … "Not allowed"`.
  `setInputFiles` with a buffer works.
- **Download events never fire**, even though the file still arrives in the Downloads folder.

## What is here

| Path | What it is |
|---|---|
| `skills/browser/` | The skill: choosing the right tool, reading an app's own API from inside a logged-in page, and a table that maps each symptom to its fix. |
| `skills/browser/references/` | Recipes mined from the transcripts: `forms.md` (dropdowns, fields, checkboxes, modals), `uploads-frames.md`, `waiting-lists.md`, and `setup.md`. |
| `wrapper/own-window-proxy.js` | A stdio proxy for `@playwright/mcp --extension`. It gives each session its own window, staggered so no window covers another, and closes that window when the session is done. |
| `tools/chrome-ui.ps1` | Lists and answers Chrome's own prompts under the URL bar (permissions, password warnings), which Playwright can't see, through Windows UI Automation. It refuses to press Cancel on the extension's debugging bar. |
| `tests/` | `check.js` runs three sessions at once against your real setup and fails if any page is hidden or slow. Each probe answers one question. |

## Install

1. Copy or link `skills/browser` into `~/.claude/skills/browser`.
2. Configure the three browser servers and the wrapper as shown in
   [`skills/browser/references/setup.md`](skills/browser/references/setup.md).
3. Run `node tests/check.js 3`. Exit code `0` means every session got its own visible window.

If you want the skill to know your machine (profile path, Downloads folder, your rules for logged-in accounts),
add a `skills/browser/references/local.md`. The skill reads it first, and `.gitignore` keeps it out of commits.

## Status

Tested on Windows 11 with Chrome, `@playwright/mcp` 0.0.86 and Playwright extension 0.6.0, in November 2026.
macOS and Linux have not been tried. Pages stall in a minimised window, and page calls stopped answering
while the display was switched off (see `setup.md`). Every number in the skill comes from a measurement or from cases in those
transcripts. Anything we have not tested is labelled as such.

Issues and pull requests are welcome, especially results from other setups.

## License

MIT. Made at [Devalok](https://devalok.in), a design and strategy studio.
