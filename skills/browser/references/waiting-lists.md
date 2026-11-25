# Waiting, timeouts, long lists

Mined 2026-11-26 from 133 timeout errors in the transcripts. Fix the class, not the timeout value.

| Class | Share | Call log shows | Fix |
|---|---|---|---|
| Matched but never actionable | 41 | `locator resolved to <…>` → `waiting for element to be visible, enabled and stable` | **Hidden tab**: Playwright's stability check needs `requestAnimationFrame`, which is 0/s in a hidden tab (verified: 15s timeout hidden vs 3s visible). Check `document.visibilityState`. With the own-window wrapper it's visible. Fallbacks: `el.click()` in evaluate, `click({ force: true })`, `page.goto(link.href)`, or put the state in the URL. |
| Locator never matched | 55 | `waiting for getByText(…)`, no "resolved" line | Wrong text or not rendered yet: collapsed panel, unopened menu, hidden duplicate, iframe. List real elements (forms.md), open the containing state, `.filter({ visible: true })`. |
| Navigation never "loaded" | 10 | `page.goto` / `page.reload` timeout | Don't use `networkidle` on apps that poll or hold sockets open (it hung twice; fine on static localhost). Use `waitUntil: 'domcontentloaded'` and then wait for the page's own content. Don't `reload` heavy dashboards (Stripe, Google Admin timed out); read the DOM as it is. |
| `download` / `filechooser` events | 10 | `waitForEvent` timeout | Extension mode: see uploads-frames.md. |
| Page died mid-sleep | 12 | `page.waitForTimeout: Target page … has been closed` | Fixed sleeps soak up the wall time; replace them with condition waits. |

```js
// heavy dashboards: navigate light, then wait for the thing you need
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.getByRole('button', { name: /add a site/i }).waitFor({ timeout: 30000 });
```

**`waitForTimeout` appeared in 46 of 70 working samples**, usually as padding. Replace with
`locator.waitFor()`, `expect.poll`-style loops that end on a condition, or `page.waitForResponse(r => r.url().includes('/api/…'))`
(the last is untested in these transcripts).

**Local dev servers**: `Execution context was destroyed, most likely because of a navigation`. Retry the
`goto` + `waitForSelector` up to 3 times, and log `framenavigated` to catch redirects.

**One run_code doing 24 `page.goto`s went silent for 1800s** and was aborted. Split long loops across calls, or
use the app's API.

## Virtualised and infinite lists

Off-screen rows unmount, so one `innerText` read misses most of the list. Scroll the **real container**
(not `window`) and collect rows keyed by a unique field:

```js
// browser_evaluate
async () => {
  const seen = new Map();
  const sc = [...document.querySelectorAll('div,section,main')]
    .filter(e => e.scrollHeight > e.clientHeight + 50 && e.clientHeight > 200)
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || document.scrollingElement;
  const grab = () => document.querySelectorAll('[role=row], li').forEach(r => {
    const k = r.getAttribute('data-id') || r.innerText.slice(0, 80); if (k) seen.set(k, r.innerText.slice(0, 300)); });
  for (let i = 0; i < 60; i++) {
    grab(); sc.scrollTop += Math.max(200, sc.clientHeight * 0.7);
    await new Promise(r => setTimeout(r, 250));
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 5) { grab(); break; }
  }
  return { n: seen.size, rows: [...seen.values()] };
}
```
Better: find the paging API in `browser_network_requests` and call it with the page's cursor.
Lazy images: step `scrollTo` 400px with 50–150ms pauses, then check `img.complete && img.naturalWidth > 0`.
Scroll-triggered analytics need real wheel events: `page.mouse.wheel(0, 900)`.
