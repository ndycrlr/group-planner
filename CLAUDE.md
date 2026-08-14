# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Branching

**Never commit code changes to `main` directly.** Every change starts with a new branch off
`main` — `git checkout -b <type>/<short-name>`, matching the commit types below
(`feat/…`, `fix/…`, `test/…`, `docs/…`, `chore/…`). This applies to any change to the
repository, not only large ones.

If work has already begun in the working tree on `main`, `git checkout -b` carries the
uncommitted changes onto the new branch — move them there before committing rather than
committing to `main` and fixing it afterwards.

Merge back with `--ff-only` where history is linear, which keeps every commit on `main`
conventional and avoids a non-conventional merge commit.

**Delete the branch once it is merged — local and remote both.** A branch is a piece of
work in flight; leaving merged ones lying about turns `git branch -a` into a list that no
longer tells you what is actually outstanding, which is the one question it exists to
answer.

```sh
git checkout main
git merge --ff-only <type>/<short-name>
git push                                        # main, with the merged work on it
git branch -d <type>/<short-name>               # local
git push origin --delete <type>/<short-name>    # remote
```

Use `-d`, never `-D`. `-d` refuses to delete a branch whose commits are not reachable from
where you are, so it is the check that the merge really landed — reach for `-D` and you can
throw the work away silently. If it refuses, the merge is what needs looking at, not the
flag. Where the merge happened through a GitHub PR, deleting on the remote may already have
been done for you; `git fetch --prune` then clears the stale remote-tracking refs, and the
local branch is still yours to delete.

If deleting fails because the branch is checked out in a worktree, remove the worktree
first (`git worktree remove <path>`) — a branch checked out anywhere cannot be deleted.

## Commands

```sh
npm install     # Express is the only dependency
npm start       # node start.js -> http://localhost:3000
```

```sh
npm test                 # the whole Playwright suite (~7s)
npx playwright test tests/results.spec.js          # one file
npx playwright test -g "marks the slot everyone"   # one test by name
npm run test:headed      # watch it drive a real browser
npm run test:report      # open the HTML report after a failure
```

Requires **Node 20+**. There is no build step, no bundler and no linter — the browser loads `public/*.js` directly as ES modules. Playwright is the only dev dependency; `npx playwright install chromium` is needed once on a fresh checkout.

Env vars: `PORT` (default 3000), `PLANNER_DB` (default `./planner.db`, gitignored, created on first run), and `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` which override `PLANNER_DB` with a hosted database. Point `PLANNER_DB` at a scratch file when experimenting so you don't disturb existing data.

## Tests

`playwright.config.js` starts its own server on port **3210** against a throwaway database in `.test-tmp/`, wiped at the start of every run. It never reuses a server you already have running, so a dev server on 3000 and its real `planner.db` are never touched. The wipe is guarded to the main process — Playwright re-evaluates the config inside each worker, and by then the server holds the file open.

Tests import from `public/dates.js` directly (`tests/helpers.js`), addressing slots by the label the app really renders. A change to the date helpers therefore shows up as a test failure rather than as silent drift. Every test creates its own event, so they run fully parallel without interfering.

`tests/api.spec.js` runs without a browser page — a failure there points at `app.js` or `db.js`, not the front end.

`tests/mobile.spec.js` is the only file that overrides the viewport (`test.use`), pinning it to 320px. The layout bugs it covers were all invisible at the default desktop size, so a change to `styles.css` that looks fine in the other specs can still fail here.

**The suite runs automatically.** `.claude/settings.json` wires two hooks to `scripts/run-tests-hook.sh`: a `PostToolUse` hook runs it after any edit to a file the tests cover (`public/**`, `app.js`, `start.js`, `db.js`, `tests/**`, `playwright.config.js`), and a `Stop` hook re-runs it at the end of a turn if any edit since the last green run has gone unchecked — tracked by the `.test-pending` marker file. A failure exits 2, which feeds the output back rather than failing quietly.

## Architecture

Three-layer, no framework beyond Express:

- `app.js` — Express 5 API + static host for `public/`, exported **without a listener**. All validation lives here (`requireString`, `requireEvent`, `cleanSlots`) and throws `HttpError`, which the single error middleware turns into `{"error": "..."}` at the right status. Pages display that message verbatim, so error strings are user-facing copy.
- `start.js` — imports `app.js` and calls `listen`. The only file that binds a port, and the one `npm start` runs. **Do not rename it to `server.js`**: Vercel treats a root `app.js`, `index.js` or `server.js` as a candidate Express entry point, and having two leaves the choice to chance.
- `db.js` — `createStore({ url, authToken })` returns the whole storage API over libSQL. Every method is **async**. The connection and the schema are created lazily and memoised, so importing the module is free and the schema statements run once per process rather than once per request.
- `public/` — three plain HTML pages (`index` create, `event` pick, `results` view), each with an inline `<script type="module">`, sharing `common.js` and `dates.js`.

### The invariants worth knowing

**`public/dates.js` is imported by both the browser and `app.js`.** That is deliberate: server and grid can never disagree about which days an event covers, or about `PARTS` / `MAX_RANGE_DAYS` / `validateRange`. Keep it free of DOM and Node APIs. All date maths is on `'YYYY-MM-DD'` strings through `Date.UTC`/`getUTC*` — never `new Date('2026-08-20')` read back in local time, which shifts a day in a UK summer.

**List view and month view both drive one `renderCell(cell, date, part, { compact })` callback.** `renderCalendar` in `common.js` picks the layout; each page supplies the callback (`makeCell` in `event.html` / `results.html`). Adding behaviour to a slot means editing that one callback, not two renderers. `compact: true` means the month view's narrow strip, which now only governs cosmetics — the part initial, and `✓` in place of `✓ all`.

**A results slot shows its count and nothing else.** The names live in a `title` tooltip on every cell, in both views. That is a deliberate reversal: names printed under every count turned the grid into something you read line by line, when the whole point of `--lit` is that you scan it and the bright slots come to you. Adding names back into the cell would undo the light meter. Note the cost — a tooltip needs a mouse, so on a phone the names are currently unreachable and only the counts are.

**The grid's two visual channels are a contract between JS and CSS.** `common.js` stamps
`data-part` on every list cell, month strip and column heading; the stylesheet maps that
to `--hue` (teal / gold / violet for morning / afternoon / evening) and every part-coloured
rule reads `var(--hue)`. On the results page `makeCell` additionally sets `--lit` to the
share of the group free in that slot, and the fill is `color-mix(… var(--hue) calc(var(--lit)
* var(--lit-max)) …)` — so brightness *is* the availability count. If you add a renderer or
a cell type, set both custom properties or it will render uncoloured. Brightness is never
the only signal: the count text and the `✓ all` ring carry it too, and `--lit-max` is capped
per theme so text stays readable on the brightest cell.

**Neither grid may scroll sideways.** A phone in portrait is 320–390 CSS px — 320 on an
iPhone SE or with Display Zoom on — and both grids used to carry a `min-width` far past
that, so they scrolled horizontally inside their card and the Evening column was never on
screen with nothing to say it existed. Two `@media` blocks at the end of `styles.css` fix
that in CSS alone, each set at the width its own grid stops fitting: **44rem**, where the
list table reflows to `display: block` and each `tr` becomes a grid of day-header-plus-three-
slots; and **48rem**, where the month drops its `min-width` and sizes its days in `vw` so
all seven columns fit. Same DOM and same `renderCell` either way — resist solving a
narrow-screen problem in JS, because a second render path is how the two would drift.
Two consequences worth keeping: the `thead` is hidden below 44rem, so `td.slot::before`
prints the part name on results cells (hue must never be the only signal), and slot buttons
use `touch-action: pan-y` rather than `none` — `none` cost the page its scroll on a phone
without buying anything, since a touch pointer never fires `pointerenter` on a neighbour.
`tests/mobile.spec.js` holds this line at 320px.

### Storage and deployment

libSQL is SQLite that can also be reached over a network, which is what makes Vercel possible: its filesystem is read-only, its writable `/tmp` is per-microVM, and it is wiped when a function is archived, so a local file cannot hold shared state. A `file:` URL keeps the old local behaviour for development and tests; `TURSO_DATABASE_URL` switches to a hosted database with no schema change.

`db.js` picks its client from the URL — the default build for `file:` (it can open a local file but carries native bindings) and `@libsql/client/web` otherwise (pure JS over HTTP, so no native code lands in a serverless bundle). Paths are resolved to absolute before going into the `file:` URL; on Windows a relative path is not a valid URL body.

Two things to preserve when touching `db.js`: `lastInsertRowid` comes back as a **bigint**, so it needs `Number()`; and libSQL rows are array-like with column names attached, so they must be spread into plain objects (`toPlain`) or `res.json()` emits arrays instead of objects. `saveResponse` deletes a person's slots explicitly rather than trusting `ON DELETE CASCADE` — the cascade is still declared, but foreign-key enforcement is a per-connection property and the explicit delete does not depend on it.

`connect()` memoises the connection promise but **must not memoise a failure**. Serverless instances are long lived, so caching a rejected promise would fail every later request on that instance; the `.catch` that clears the memo is what lets the next request retry.

Vercel deploys this with zero configuration — `vercel.json` only names the framework. It detects the root `app.js`, makes the whole Express app one function, and serves `public/**` from the CDN. Two consequences: `express.static` is **ignored** on Vercel (it stays for local use only), and static files win over the function because the filesystem is checked first, so no rewrite rules are needed. Production needs `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` set, or the app falls back to a `file:` URL and dies on the read-only filesystem.

### Data model

`events` → `responses` (one per person per event) → `slots` (one row per date+part). `responses.name` is `COLLATE NOCASE` with `UNIQUE(event_id, name)`, so re-submitting as "andy" replaces "Andy". `saveResponse` implements that upsert as delete-then-insert inside a transaction; the old slots go with it via `ON DELETE CASCADE`.

`GET /results` returns a **dense** grid: every date in range × every part, empty slots as empty arrays. Pages can index `grid[date][part]` without gap-filling — preserve that if you touch the endpoint.

Event ids are 6 random bytes as base64url. There are no accounts: anyone with the link can read and write that event. Treat the link as the only access control.

### Client-side state

`event.html` keeps selections in a `Set` of `'YYYY-MM-DD|part'` keys; the buttons are a rendering of that Set and the `buttons` Map is rebuilt per render, which is what makes switching views cheap. Drafts persist to `localStorage` under `planner:selection:<id>`, the name under `planner:name`, the view choice under `planner:view`. Every `localStorage` access is wrapped in try/catch — private browsing refuses it and the feature is a nicety, not a requirement.

## Commits

Every commit follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):
`<type>[(scope)][!]: <description>`, a blank line, then the body. Types are `feat` and
`fix` plus `build`, `chore`, `ci`, `docs`, `style`, `refactor`, `perf`, `test`. Breaking
changes take a `!` before the colon or a `BREAKING CHANGE:` footer (uppercase).

`.githooks/commit-msg` enforces it and `core.hooksPath` activates it — `npm install` sets
that via the `prepare` script, or run `npm run hooks:install` directly. A rejected commit
means the subject needs rewriting; do not reach for `--no-verify`.

**Every commit is followed by a grilling session.** A `PostToolUse` hook on
`Bash`/`PowerShell` in `.claude/settings.json` runs `scripts/grill-hook.sh`, which invokes
the `grilling` skill (`.agents/skills/grilling/`, installed from `mattpocock/skills` and
pinned in `skills-lock.json`) against the commit that just landed. The interview is the
point: it stress-tests the decisions the diff makes before they set.

The hook fires only when the command mentions `git commit` *and* `HEAD` actually moved —
tracked by the gitignored `.grill-last-commit` marker — so a checkout, a `--dry-run`, or a
commit the `commit-msg` hook rejected never opens an interview about a commit that does not
exist. `grill-me` is installed alongside it as the `/grill-me` trigger phrase; it is a
one-line alias that delegates to `grilling`, so both have to be present.

## Conventions

- ESM throughout (`"type": "module"`), 2-space indent, single quotes, semicolons.
- No client-side framework and no dependencies in `public/` — DOM built with the `el()` helper in `common.js`.
- Comments explain *why* (timezone traps, the `total > 0` guard on the unanimous highlight, the id-collision retry), not what.
- British English in user-facing copy ("organiser", "Colour" spellings in prose).
- `README.md` documents the API table, the view behaviour, and the layout — keep it in step when routes, views, or files change.
