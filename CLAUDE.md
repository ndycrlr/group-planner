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

## Commands

```sh
npm install     # Express is the only dependency
npm start       # node server.js -> http://localhost:3000
```

```sh
npm test                 # the whole Playwright suite (~7s)
npx playwright test tests/results.spec.js          # one file
npx playwright test -g "marks the slot everyone"   # one test by name
npm run test:headed      # watch it drive a real browser
npm run test:report      # open the HTML report after a failure
```

Requires **Node 22.5+** (`node:sqlite`). There is no build step, no bundler and no linter — the browser loads `public/*.js` directly as ES modules. Playwright is the only dev dependency; `npx playwright install chromium` is needed once on a fresh checkout.

Env vars: `PORT` (default 3000), `PLANNER_DB` (default `./planner.db`, gitignored, created on first run). Point `PLANNER_DB` at a scratch file when experimenting so you don't disturb existing data.

## Tests

`playwright.config.js` starts its own server on port **3210** against a throwaway database in `.test-tmp/`, wiped at the start of every run. It never reuses a server you already have running, so a dev server on 3000 and its real `planner.db` are never touched. The wipe is guarded to the main process — Playwright re-evaluates the config inside each worker, and by then the server holds the file open.

Tests import from `public/dates.js` directly (`tests/helpers.js`), addressing slots by the label the app really renders. A change to the date helpers therefore shows up as a test failure rather than as silent drift. Every test creates its own event, so they run fully parallel without interfering.

`tests/api.spec.js` runs without a browser page — a failure there points at `server.js` or `db.js`, not the front end.

**The suite runs automatically.** `.claude/settings.json` wires two hooks to `scripts/run-tests-hook.sh`: a `PostToolUse` hook runs it after any edit to a file the tests cover (`public/**`, `server.js`, `db.js`, `tests/**`, `playwright.config.js`), and a `Stop` hook re-runs it at the end of a turn if any edit since the last green run has gone unchecked — tracked by the `.test-pending` marker file. A failure exits 2, which feeds the output back rather than failing quietly.

## Architecture

Three-layer, no framework beyond Express:

- `server.js` — Express 5 API + static host for `public/`. All validation lives here (`requireString`, `requireEvent`, `cleanSlots`) and throws `HttpError`, which the single error middleware turns into `{"error": "..."}` at the right status. Pages display that message verbatim, so error strings are user-facing copy.
- `db.js` — `createStore(file)` returns the whole storage API over `node:sqlite`. Schema is applied idempotently at startup; all statements are prepared once.
- `public/` — three plain HTML pages (`index` create, `event` pick, `results` view), each with an inline `<script type="module">`, sharing `common.js` and `dates.js`.

### The two invariants worth knowing

**`public/dates.js` is imported by both the browser and `server.js`.** That is deliberate: server and grid can never disagree about which days an event covers, or about `PARTS` / `MAX_RANGE_DAYS` / `validateRange`. Keep it free of DOM and Node APIs. All date maths is on `'YYYY-MM-DD'` strings through `Date.UTC`/`getUTC*` — never `new Date('2026-08-20')` read back in local time, which shifts a day in a UK summer.

**List view and month view both drive one `renderCell(cell, date, part, { compact })` callback.** `renderCalendar` in `common.js` picks the layout; each page supplies the callback (`makeCell` in `event.html` / `results.html`). Adding behaviour to a slot means editing that one callback, not two renderers. `compact: true` means the month view's narrow strip — room for an initial and a count only, so names go in a `title` tooltip there.

**The grid's two visual channels are a contract between JS and CSS.** `common.js` stamps
`data-part` on every list cell, month strip and column heading; the stylesheet maps that
to `--hue` (teal / gold / violet for morning / afternoon / evening) and every part-coloured
rule reads `var(--hue)`. On the results page `makeCell` additionally sets `--lit` to the
share of the group free in that slot, and the fill is `color-mix(… var(--hue) calc(var(--lit)
* var(--lit-max)) …)` — so brightness *is* the availability count. If you add a renderer or
a cell type, set both custom properties or it will render uncoloured. Brightness is never
the only signal: the count text and the `✓ all` ring carry it too, and `--lit-max` is capped
per theme so text stays readable on the brightest cell.

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

## Conventions

- ESM throughout (`"type": "module"`), 2-space indent, single quotes, semicolons.
- No client-side framework and no dependencies in `public/` — DOM built with the `el()` helper in `common.js`.
- Comments explain *why* (timezone traps, the `total > 0` guard on the unanimous highlight, the id-collision retry), not what.
- British English in user-facing copy ("organiser", "Colour" spellings in prose).
- `README.md` documents the API table, the view behaviour, and the layout — keep it in step when routes, views, or files change.
