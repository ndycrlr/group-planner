# Plan: Knowledge Work footer

spec: _specs/knowledge-work-footer.md

## Context
Spec `_specs/knowledge-work-footer.md` (merged in #12) asks for a permanent link to Knowledge Work
(https://www.knowledgework.co.uk) in a footer pinned to the bottom of the viewport on desktop and
mobile. Decisions settled with the user:
- Text **"Built by Knowledge Work"**, only "Knowledge Work" is the link
- Opens in a **new tab**
- On **all four pages**: index, event, results and admin
- **Code first**, with no Penpot board beforehand

Today no page has a footer or any `position: fixed` element. `body` already has a bottom padding
of 5rem, or 4rem below 30rem.

## Approach

### 0. Branch
Start from an up-to-date `main`: `git checkout -b feat/knowledge-work-footer`.

### 1. Markup: static HTML in each page
Put the same block after `</main>` and before the `<script type="module">` in
`public/index.html`, `public/event.html`, `public/results.html` and `public/admin.html`:

- `<footer class="site-footer">` is a direct child of `body`, so it gets the contentinfo landmark
  implicitly.
- Content: `Built by <a class="link" href="https://www.knowledgework.co.uk" target="_blank" rel="noopener">Knowledge Work<span class="visually-hidden"> (opens in a new tab)</span></a>`
- Reuse the existing `.link` style (styles.css ~367) and `.visually-hidden` (~140). The global
  `a:focus-visible` outline (~297) already gives it a focus ring.
- Use plain HTML rather than a JS-injected element, so the footer still shows when a page's script
  fails, including the admin "not configured" state. The four pages already repeat their head
  markup the same way.
- Add `viewport-fit=cover` to each page's viewport meta. Without it,
  `env(safe-area-inset-bottom)` is always 0 on iPhones.

### 2. Styles: one block in `public/styles.css`
Put a `/* --- Site footer --- */` section before the "Narrow screens" section. It needs no new
`@media` block, so the contract's `media` list stays unchanged.

- `.site-footer`: `position: fixed; inset: auto 0 0 0`, a `z-index` above the page, and
  `background: var(--card)` with `border-top: 1px solid var(--line)`. That picks up dark mode
  from the tokens automatically.
- Text: `color: var(--muted)`, around 0.8rem, centred, `white-space: nowrap`. The line is short
  enough to fit at 320px.
- Padding: `0.55rem 1rem calc(0.55rem + env(safe-area-inset-bottom))`, plus left and right
  padding of `max(1rem, env(safe-area-inset-left/right))` for iPhones in landscape.
- Add a short *why* comment: fixed rather than sticky, and the body padding below.
- **Make sure nothing ends up behind it.** Define a `--footer-space` custom property on `:root`,
  next to the other tokens but *not* added to `design/contract.js` TOKENS, about 3rem plus the
  safe-area inset. Then base `body`'s `padding-bottom` on it: the existing 5rem, or 4rem at 30rem,
  plus `--footer-space`. The last thing on each page (the submit row and `#status`, the results
  card, the admin list) can then always scroll fully clear of the footer.

Expected effect on the design contract: it reads `:root` tokens only from the `TOKENS` list,
component probes that don't include body or footer, and `@media` conditions. So
`design/design.json` should not change. If `tests/design.spec.js` flags something, run
`npm run design:extract`, check the diff was intended, and note it for Penpot.

### 3. Tests: new `tests/footer.spec.js`
Use the helpers `createEvent`, `FORTNIGHT` and `pickButton` from `tests/helpers.js`. Keep
`tests/mobile.spec.js` the only file that overrides the viewport through a file-level `test.use`.
For 320px, use a `test.describe` block with its own `test.use`, or `page.setViewportSize`.

- **Every page has the link.** Loop over `/`, `/event.html?id=…`, `/results.html?id=…` and
  `/admin.html`. Check that `getByRole('contentinfo')` contains a link named
  /Knowledge Work/ with `href` `https://www.knowledgework.co.uk`, `target="_blank"`, and a `rel`
  containing `noopener`.
- **The footer stays pinned.** On a FORTNIGHT event page at desktop size and at 320px, scroll to
  the bottom. The footer should be in the viewport, and its bounding box's bottom should equal the
  viewport height.
- **Nothing is hidden.** At 320px, scroll `#submit` into view and click it. The click must not be
  intercepted by the footer; expect the status message about a missing name. Also check that
  `#status`'s box ends above the footer's top.
- **No sideways scroll.** At 320px on the event page, `scrollWidth - clientWidth` should be 0.
  This repeats `mobile.spec.js`'s check with the footer present.
- **Keyboard access.** Focus the link using the keyboard, and check it is the focused element.

### 4. Docs
- README.md "Layout": no new file, so the only change needed is a note in the prose that every
  page carries a fixed footer. Also check the "How it's used" section for anything the footer
  contradicts.
- CLAUDE.md: add a short line under Conventions, saying the footer is static markup repeated in
  all four pages and body padding is what keeps content clear of it. The next person to add a
  page then knows to add both.

### Accepted limitation, written in the CSS comment
When the on-screen keyboard is open on Android Chrome, the footer rides up above the keyboard.
The name and email inputs are at the top of the card, so it won't cover what's being typed, and
fixing it would take JS, against the "CSS alone" rule.

## Files
- `public/index.html`, `public/event.html`, `public/results.html`, `public/admin.html`: footer
  markup and the viewport meta
- `public/styles.css`: the footer section and body padding
- `tests/footer.spec.js`: new
- `README.md`, `CLAUDE.md`: short notes

## Verification
1. `npm test`: the whole suite, including `mobile.spec.js` and `design.spec.js` (no change to
   design.json expected) and the new `footer.spec.js`
2. `npm start`, then open each of the four pages at desktop size and in devtools at 320px, in
   light and dark. Scroll to the end, check the footer stays at the bottom, the submit button
   and status clear it, and the link opens knowledgework.co.uk in a new tab.
3. Tab through a page and check the link gets the focus outline.
4. Commit as `feat: add a fixed footer linking to Knowledge Work`, push, and open a pull request
   with `gh pr create --fill`.
