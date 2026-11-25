# Forms: dropdowns, fields, checkboxes, modals

Mined from 2,747 real Claude Code transcripts (10,650 browser calls) at a design studio, November 2026. "Cases" = real error→fix pairs
seen in those transcripts. Error rates by topic: dropdowns 20%, text fields 16%, checkboxes 15%, modals 12%.

**Before any recipe here: if a click/fill "resolved to <…>" then timed out "waiting for element to be visible,
enabled and stable", check `document.visibilityState` first.** In a hidden tab Playwright's stability check
never completes (verified: same click 15s timeout hidden, 3s ok visible). That was the single largest cause:
`browser_click` on `playwright-auth` failed 68% of the time before the own-window wrapper.

**MCP tool parameter:** `browser_click`, `browser_type`, `browser_select_option` and `browser_fill_form` take
**`target`** (a snapshot ref like `e41`/`f1e62`, or a selector) plus `element` (description). Passing the old
`ref` field fails: `Invalid input: expected string, received undefined → at target` (23 cases). Button *text*
is not a valid target. Use the ref, or `role=button[name="Deploy"]`.

**Never guess a selector twice.** List what's really there, then copy real attributes (worked in 7+ sessions):

```js
// browser_evaluate
() => [...document.querySelectorAll('input,textarea,select,button,[role=combobox],[contenteditable="true"]')]
  .filter(f => { const r = f.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
  .map(f => ({ tag: f.tagName, type: f.type, name: f.name, id: f.id, ph: f.placeholder,
               aria: f.getAttribute('aria-label'), role: f.getAttribute('role'),
               text: (f.value ?? f.innerText ?? '').slice(0, 40), disabled: f.disabled }))
```

## Dropdowns & comboboxes

**Decision rule**
- **Native `<select>`** → `page.selectOption('#id', value)` (or `browser_select_option`). Inside
  `browser_evaluate`: set via the element's own value setter, then dispatch `change`.
- **Custom combobox** (Radix/base-ui, ant-select, mat-select, MUI, Google jsaction) → open the trigger (snapshot
  ref), confirm `aria-expanded === 'true'`, pick `[role=option]` by text **across the whole document**: the
  list is usually portalled outside the trigger. Read the trigger text afterwards to verify.
- **Searchable / typeahead** → open first, then type into the **inner input that appears** (new ref), read
  options, pick. Typing into the `<div role=combobox>` wrapper fails:
  `Element is not an <input>, <textarea> or [contenteditable] element`.

**Trigger/option click times out after "locator resolved"** (10 cases: Cloudflare base-ui Select, Search
Console, Drive menus, ant-select). Many libraries open on `pointerdown`/`mousedown`, not `click`:

```js
// browser_evaluate
async () => {
  const press = el => { for (const t of ['pointerdown','mousedown','pointerup','mouseup','click'])
    el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, button: 0 })); };
  press(document.querySelector('form [role=combobox]'));
  await new Promise(r => setTimeout(r, 800));
  return [...document.querySelectorAll('[role=option]')].map(o => o.innerText.trim());
}
```

ant-select: `locator('.ant-select-selector').dispatchEvent('mousedown')`, then pick from
`.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option`. If it sits in a collapsed
`.ant-collapse` panel, expand the header (`aria-expanded !== 'true'`) first. "Expand all" didn't work.

**Option never appears: the list never opened** (3 cases):

```js
const cb = page.getByRole('combobox', { name: 'Credit limit Information' });
if (await cb.getAttribute('aria-expanded') !== 'true') { await cb.focus(); await page.keyboard.press('Enter'); }
await page.getByRole('option', { name: '$50' }).click({ timeout: 5000 });
```

**Go around it** (1 case each): page with the next-page button instead of a stuck rows-per-page select;
`page.goto` the URL a menu leads to; switch the widget to its "custom input" mode. Options that load async
(GitHub SelectPanel): poll for the option text, and report an in-panel error ("went wrong") verbatim.

**After a native select, a dependent field stayed `disabled`** (1 case): a change opens a gate. Re-read
disabled fields and visible `.modal`s before retrying.

## Filling fields & typing

**Decision rule**
- **`locator.fill()`** is the default, and it **works on React-controlled inputs** (≈15 samples: Cloudflare,
  GTM, Ahrefs, local Next apps). Don't reach for value-setter hacks first.
- **`pressSequentially(text, { delay: 40 })`** when the field reacts per keystroke (autocomplete, recipient
  pickers: Gmail To-field), then read `[role=listbox] [role=option]`.
- **`keyboard.type`** after focus is already in place (Ctrl+K palettes, an opened ant-select).
- **`focus()` + `keyboard.insertText(text)` + `press('Enter')`** for chat-style `contenteditable` boxes where
  `click` times out (Gemini).
- **Native value setter + `input`/`change`** only inside `browser_evaluate` (no Playwright there). Walk the
  element's own prototype: `HTMLInputElement.prototype`'s setter on a `<textarea>` throws `Illegal invocation`:

```js
const set = (el, v) => { let p = Object.getPrototypeOf(el), d;
  while (p && !(d = Object.getOwnPropertyDescriptor(p, 'value'))) p = Object.getPrototypeOf(p);
  d.set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
```

**`fill` hangs until timeout, the field exists** (8 cases: GTM side sheets, Cloudflare expression editor,
government portals): the field is behind UI state (collapsed accordion, mode switch, an editor overlay). Run the
field-listing recipe, open the state that reveals it, then `fill`. Cloudflare's editor switch ignored
`click({ force: true })`; the pointer-event sequence above opened it.

**Wrapper, not the editable** (Quill `<connect-quill-input role=textbox>`): target the inner
`.ql-editor` / `[contenteditable=true]`. GTM title `div[contenteditable]`: `click()`, `Control+A`,
`keyboard.type(…)`, `Tab`.

**Strict mode on fill** (`getByRole('spinbutton', { name: 'L' }) resolved to 3 elements`): accessible-name
match is substring by default. Use `{ exact: true }` or a unique `#id`.

**Disabled field** (2 cases): it's computed from another field. Fill the upstream field (e.g. a CIN), press
`Tab` to trigger the lookup, then read the disabled one. Don't fight it.

**Chip/tag inputs**: `fill()`, then `dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })`.
**Sliders**: `focus()`, `press('End')`, `ArrowLeft` × n. **Plain HTML form whose `fill` hung** (1 site):
set `.value` and `form.submit()` in evaluate.

Untested in the transcripts: Monaco/CodeMirror 6/ProseMirror/Lexical as fill targets, multi-box OTP inputs,
masked inputs (a single-box OTP worked with `fill('001945')`).

## Checkboxes, radios, toggles

**Custom control, real `<input>` hidden** (11 cases: Ant Design, Nebular, Material, Cloudflare, GitHub,
Google OAuth): `locator.check` waits for the hidden input to become visible, forever. Click the label/DOM
element and **read the state back**:

```js
// browser_evaluate
() => {
  const r = [...document.querySelectorAll('input[type=radio]')].find(x => x.value === 'Innovative');
  if (!r) return 'missing';
  if (!r.checked) (r.closest('label') || r).click();
  return r.checked;
}
```

If React ignores `.click()` (Cloudflare radios), dispatch the pointer sequence to both input and label.
Switches/Material: verify via `aria-checked`. A force-click that "succeeds" without changing state is common.
Always read the state.

**Consent / permission controls**: checking "I agree", choosing "Trusted access", or pressing a consent
dialog's Continue is **denied by the auto-mode classifier** (`[Consent Given For The User]`,
`[Permission Grant]`). Stop and tell the user. **Setting `checked = true` via evaluate to get past it is routing
around the classifier: never.**

## Modals, overlays, menus

- **× close is an icon, not text** → `browser_press_key({ key: 'Escape' })` (4 cases).
- **Two dialogs match** → `page.getByRole('dialog', { name: 'Add Agent' })`.
- **`browser_handle_dialog` only handles native `alert/confirm/prompt`.** An in-page `[role=dialog]` is
  ordinary DOM: `The tool "browser_handle_dialog" can only be used when there is related modal state present.`
- **Something covers the target**: dismiss known interstitials first (Google Cloud billing "Do this later",
  "Update Timezone", "Skip for now"). A sticky header was neutralised with
  `page.addStyleTag({ content: '.header-new { pointer-events:none !important }' })`.
- **Text locator hits a hidden duplicate** (tooltip copies): `.filter({ visible: true }).first()`, scoped to `main`.
- **Row "More options" menus** (Stripe API keys, 5 cases): reopen the trigger if the item isn't visible, then
  `item.click({ force: true })`.
- **Hover-only buttons** (Gemini "Download full size image"): wait for `img.naturalWidth > 300`,
  `img.hover({ force: true })`, then `button.dispatchEvent('click')`, or `focus()` + `Enter`.
- Verify instead of assuming: `dialog.open`, `document.activeElement`, toasts in `[role=alert], [role=status]`.
