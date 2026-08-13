# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install     # Express is the only dependency
npm start       # node server.js -> http://localhost:3000
```

Requires **Node 22.5+** (`node:sqlite`). There is no build step, no bundler, no linter, and no test suite — the browser loads `public/*.js` directly as ES modules. Verify changes by running the server and exercising the pages, or by hitting the API with curl (see the examples at the bottom of `README.md`).

Env vars: `PORT` (default 3000), `PLANNER_DB` (default `./planner.db`, gitignored, created on first run). Point `PLANNER_DB` at a scratch file when experimenting so you don't disturb existing data.

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

## Conventions

- ESM throughout (`"type": "module"`), 2-space indent, single quotes, semicolons.
- No client-side framework and no dependencies in `public/` — DOM built with the `el()` helper in `common.js`.
- Comments explain *why* (timezone traps, the `total > 0` guard on the unanimous highlight, the id-collision retry), not what.
- British English in user-facing copy ("organiser", "Colour" spellings in prose).
- `README.md` documents the API table, the view behaviour, and the layout — keep it in step when routes, views, or files change.
