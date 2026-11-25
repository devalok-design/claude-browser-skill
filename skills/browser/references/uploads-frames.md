# Uploads, iframes, shadow DOM, downloads

Uploads were the worst topic in the transcripts: **35% error rate**. Mined 2026-11-26; upload recipes below
re-verified live the same day.

## Uploads

**`playwright-auth` (logged-in, extension mode): the file chooser is blocked.**
`browser_file_upload` → `fileChooser.setFiles: Protocol error (DOM.setFileInputFiles): {"code":-32000,"message":"Not allowed"}`.
This happens even with an allowed path (6 cases in transcripts plus a live re-test). A chooser left open after
the failure blocks other tools: clear it with `browser_file_upload({ paths: [] })`.

**What works (verified 2026-11-26):** `setInputFiles` with a **buffer**, with the bytes fetched from a local
HTTP server (run_code has no `fs`/`require`):

```bash
# Bash: serve the folder holding the file (stop it afterwards)
cd "<folder with the file>" && python -m http.server 8765 --bind 127.0.0.1 &
```
```js
// browser_run_code_unsafe
async (page) => {
  const res = await page.request.get('http://127.0.0.1:8765/report.pdf');
  await page.locator('input[type=file]').setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: await res.body() });
  return page.evaluate(() => { const f = document.querySelector('input[type=file]').files[0]; return f && f.name + ' ' + f.size; });
}
```
Then stop the server (`Get-NetTCPConnection -LocalPort 8765 -State Listen | % { Stop-Process -Id $_.OwningProcess }`).
Equivalent in-page route (also verified): build `new File([...])`, add it to a `DataTransfer`, assign
`input.files = dt.files`, dispatch `change`. For a contenteditable drop zone the same `DataTransfer` worked as a
`ClipboardEvent('paste', { clipboardData: dt })`. Check the result: read `files[0].name/size`. A
"succeeded" inside `try/catch` proves nothing.

**`playwright` (isolated) and `chrome-devtools`:** `browser_file_upload` / `upload_file` work, but **paths
must be inside the server's allowed roots**:
`File access denied: … outside allowed roots. Allowed roots: <the server's --output-dir>, <session working dir>`.
Scratchpad and `%TEMP%` paths are refused, so copy the file into the `--output-dir` (or the working dir) first.
`chrome-devtools` has its own root list (`G:\My Drive\…` accepted, `H:\…` refused).
`file:` URLs are blocked outright on `playwright`.

**chrome-devtools `Failed to upload file. The element could not accept the file directly, and clicking it did
not trigger a file chooser.`** (10 cases): the uid is a wrapper or label. Re-snapshot after each upload (uids
shift when the form re-renders) and try the neighbouring uid, i.e. the real input or its button.

**Browse button `disabled`** (Ant Design upload, government portals): a document-type select must be set
first, and it opens on `mousedown` (see forms.md).

## Iframes

- **Snapshot refs with an `f` prefix (`f1e62`) address elements inside frames**: pass the ref as `target`.
  CSS targets only reach the main frame; `"e8 >>> internal:role=textbox" is not a valid target`.
- In run_code: `page.frameLocator('iframe[title="Content"]')` (open the menu inside the frame before clicking
  its items), or `page.frames().find(f => f.url().includes('…'))` then `f.evaluate(…)`.
- Drive's share dialog (cross-origin frame): `frameLocator` timed out; snapshot ref + `browser_type` with
  `slowly: true` worked.

## Shadow DOM

Playwright locators pierce **open** shadow roots. `document.querySelector` inside `browser_evaluate` does
**not**. Walk them:

```js
const walk = (root, d, hit) => { if (d > 6 || !root) return;
  root.querySelectorAll('*').forEach(el => { if (hit(el)) out.push(el); if (el.shadowRoot) walk(el.shadowRoot, d + 1, hit); }); };
```

## Downloads (logged-in)

`page.waitForEvent('download')` **never fires** in extension mode (12 timeouts in transcripts; verified live).
The file still lands in the browser's Downloads folder. Snapshot the folder listing, trigger the download, poll for
a new non-`.crdownload` file, check magic bytes, then move it. `page.request.get(url)` carries the session
cookies (verified) but can't write to disk.

## Drag-and-drop, date pickers

No real evidence either way in the transcripts. For dates, prefer typing the value into the input (or the app's
API) over driving a calendar widget; verify the field's value afterwards.
