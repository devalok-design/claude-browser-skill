# Chrome's own prompts (the bubbles under the URL bar)

Permission requests ("wants to: Show notifications / Use your cameras"), password warnings, download
warnings and infobars are drawn by **Chrome**, not by the page. Playwright can't see them: `browser_snapshot`
has no trace of them, and locators can't reach them. In extension mode the usual workaround is refused too:
`Browser.grantPermissions is not allowed: it changes the state of the browser, not of the tab`.
(Verified November 2026.)

**Windows UI Automation can see them.** Chrome exposes each prompt as a small child window with real
buttons. `tools/chrome-ui.ps1` lists them and clicks a button **only inside a prompt**, never on the page:

```powershell
powershell -File tools/chrome-ui.ps1 -Profile <part of the Chrome --user-data-dir> -List
powershell -File tools/chrome-ui.ps1 -Profile <…> -Window "<page title substring>" -Click "Never allow"
```

Then confirm from the page: `Notification.permission`, or
`(await navigator.permissions.query({ name: 'camera' })).state`.

What we saw:

| Trigger | Prompt the tool lists | Buttons |
|---|---|---|
| Notification request | `site wants to: Show notifications` | `Allow`, `Block` |
| Camera request | `site wants to: Use your cameras` | `Allow while visiting the site`, `Allow this time`, `Never allow` |
| Logging in with a leaked password | `Change your password` | `OK` |
| Every window the extension controls | `Infobar: "Playwright Extension" started debugging this browser` | `Cancel`, `Close` |

- **Never press `Cancel` on the "started debugging this browser" infobar.** It detaches the extension and
  drops every session using that browser. The tool refuses to do it.
- Button labels change between Chrome versions, so always `-List` first and use the exact label.
- **Pop-ups opened from `browser_evaluate` are not blocked.** Playwright runs page code as a user gesture,
  so `window.open` opens a real new window. Close it when you're done, because the wrapper only closes the
  session's own tabs.
- A choice you make here sticks in the Chrome profile for that site. Undo it in the site settings (the
  icon left of the URL).
- Windows only. On macOS the equivalent route would be the Accessibility API; untested.
