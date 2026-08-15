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

**Never merge into `main` locally either.** Work reaches `main` through a pull request and
nothing else — no `git merge` into `main`, no `git push` to `main`. That is what gives the
review something to run on: `.github/workflows/claude-review.yml` fires when a PR is opened
(also on reopen and on a draft marked ready), and a direct push arrives after the only
moment anything would have looked at it.

The review reads the diff **as it was when the PR opened**. Pushing fixes afterwards does not
re-run it — `synchronize` is deliberately not in the trigger list, since a review per push is
mostly a review of the same code again. `gh pr close <n> && gh pr reopen <n>` re-runs it when
the fixes are worth a second look.

`.githooks/pre-push` refuses a push to `main` so the rule does not depend on remembering it.
It is a guardrail rather than a lock — this repository is private on a free plan, where
branch protection and rulesets are unavailable, so the check has to live on this side of the
wire and `ALLOW_PUSH_MAIN=1 git push` goes through it. Reach for that only when the alternative
is worse.

**Delete the branch once it is merged — local and remote both.** A branch is a piece of
work in flight; leaving merged ones lying about turns `git branch -a` into a list that no
longer tells you what is actually outstanding, which is the one question it exists to
answer.

```sh
git push -u origin <type>/<short-name>
gh pr create --fill                     # opening it starts the review
# ... read the review, push fixes to the same branch ...
gh pr merge --squash --delete-branch    # deletes the remote branch with it
git checkout main
git pull
git fetch --prune                       # clears the stale remote-tracking ref
git branch -D <type>/<short-name>       # local; -D, and see below for why
```

**Squashing makes the PR title the commit subject**, so the title has to be a Conventional
Commit in its own right. GitHub squashes server-side, where `.githooks/commit-msg` cannot
run: this is the one place in the repository where nothing checks the wording for you.
`--fill` takes the title from the single commit on a one-commit branch, which is usually the
right answer; pass `--title` when the branch has several.

The review needs a `CLAUDE_CODE_OAUTH_TOKEN` repository secret — `claude setup-token`, then
`gh secret set CLAUDE_CODE_OAUTH_TOKEN`, and set it from a real terminal so the paste is
masked and the token stays out of the shell history. It bills to the Claude subscription;
an `ANTHROPIC_API_KEY` works just as well in its place, against prepaid API credits, and
the workflow names the one line that changes. Without a credential the run fails on the PR's
checks rather than skipping silently, which is the intended way round — a review that
quietly did not happen is worse than a red tick.

`--delete-branch` handles the remote, and `git fetch --prune` clears the stale
remote-tracking ref it leaves behind. The local branch is still yours to delete, and which
flag deletes it depends on how the PR was merged:

```sh
gh pr view <type>/<short-name> --json state,mergedAt   # expect "MERGED"
git branch -d <type>/<short-name>                      # try this first
git branch -D <type>/<short-name>                      # only after the check above
```

Try `-d` first, always: it refuses to delete a branch whose commits are not reachable from
where you are, which is the check that the work really landed. A **merge commit** keeps the
branch's commits in `main`'s history, so `-d` is satisfied and no more is needed. **Squash**
and **rebase** do not — both write new commits, so the branch's own commits are reachable
from nothing and `-d` reports landed work as unmerged. That refusal is the only case where
`-D` is right, and it is right only because something else has already confirmed the merge:
`gh pr view` saying `MERGED`. Ask GitHub, because once the merge has rewritten the commits —
squash or rebase alike — it is the one that still knows. Never reach for `-D` on a refusal you have not explained — that is how work
disappears without a word.

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

```sh
npm run design:extract   # re-read design/design.json from the running app
npm run design:push      # print the payload that applies it to Penpot
npm run design:diff      # compare the last Penpot pull against it
```

Requires **Node 20+**. There is no build step, no bundler and no linter — the browser loads `public/*.js` directly as ES modules. Playwright is the only dev dependency; `npx playwright install chromium` is needed once on a fresh checkout.

Env vars: `PORT` (default 3000), `PLANNER_DB` (default `./planner.db`, gitignored, created on first run), `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` which override `PLANNER_DB` with a hosted database, and `ADMIN_PASSWORD`, which switches on the admin console at `/admin.html`. Point `PLANNER_DB` at a scratch file when experimenting so you don't disturb existing data.

## Tests

`playwright.config.js` starts its own server on port **3210** against a throwaway database in `.test-tmp/`, wiped at the start of every run. It never reuses a server you already have running, so a dev server on 3000 and its real `planner.db` are never touched. The wipe is guarded to the main process — Playwright re-evaluates the config inside each worker, and by then the server holds the file open.

Tests import from `public/dates.js` directly (`tests/helpers.js`), addressing slots by the label the app really renders. A change to the date helpers therefore shows up as a test failure rather than as silent drift. Every test creates its own event, so they run fully parallel without interfering.

`tests/api.spec.js` runs without a browser page — a failure there points at `app.js` or `db.js`, not the front end.

`tests/mobile.spec.js` is the only file that overrides the viewport (`test.use`), pinning it to 320px. The layout bugs it covers were all invisible at the default desktop size, so a change to `styles.css` that looks fine in the other specs can still fail here.

`tests/admin.spec.js` needs a password to test at all, so `playwright.config.js` exports
`ADMIN_PASSWORD` and passes it to the test server; the spec imports that same constant.
Its last block is the exception to everything above: it spawns a **second** server on port
3211 with `ADMIN_PASSWORD` deleted, to prove the console is closed rather than open when
nobody configured one. That block is `mode: 'serial'` — the suite is otherwise fully
parallel, `beforeAll` runs once per worker, and two workers would race for the port. The
rest of the file never asserts on how many events exist, since the list is global and
other workers are creating and deleting their own throughout.

`tests/migration.spec.js` is the only file that talks to `db.js` directly, with no server and no page. It has to: it builds a pre-email database by hand to check the upgrade path, and by the time the test server is up its own database is already current.

`tests/design.spec.js` asserts nothing about behaviour. It re-reads the design contract from
the running app and fails when it no longer matches `design/design.json`, which is how a
change to the design system announces itself as something the Penpot file has not been told.
A failure there is answered with `npm run design:extract`, not with a fix — see
`design/README.md`.

**The suite runs automatically.** `.claude/settings.json` wires two hooks to `scripts/run-tests-hook.sh`: a `PostToolUse` hook runs it after any edit to a file the tests cover (`public/**`, `app.js`, `start.js`, `db.js`, `tests/**`, `playwright.config.js`, `design/**`), and a `Stop` hook re-runs it at the end of a turn if any edit since the last green run has gone unchecked — tracked by the `.test-pending` marker file. A failure exits 2, which feeds the output back rather than failing quietly.

## Architecture

Three-layer, no framework beyond Express:

- `app.js` — Express 5 API + static host for `public/`, exported **without a listener**. All validation lives here (`requireString`, `requireEvent`, `cleanSlots`) and throws `HttpError`, which the single error middleware turns into `{"error": "..."}` at the right status. Pages display that message verbatim, so error strings are user-facing copy. The middleware replaces a 5xx message with a generic one **unless it is an `HttpError`** — an unexpected failure's message is an internal detail, but a deliberate 503 like "admin access is not configured" exists to be read.
- `start.js` — imports `app.js` and calls `listen`. The only file that binds a port, and the one `npm start` runs. **Do not rename it to `server.js`**: Vercel treats a root `app.js`, `index.js` or `server.js` as a candidate Express entry point, and having two leaves the choice to chance.
- `db.js` — `createStore({ url, authToken })` returns the whole storage API over libSQL. Every method is **async**. The connection and the schema are created lazily and memoised, so importing the module is free and the schema statements run once per process rather than once per request.
- `public/` — four plain HTML pages (`index` create, `event` pick, `results` view, `admin` manage), each with an inline `<script type="module">`, sharing `common.js` and `dates.js`.

### The invariants worth knowing

**`public/dates.js` is imported by both the browser and `app.js`.** That is deliberate: server and grid can never disagree about which days an event covers, or about `PARTS` / `MAX_RANGE_DAYS` / `validateRange`. Keep it free of DOM and Node APIs. All date maths is on `'YYYY-MM-DD'` strings through `Date.UTC`/`getUTC*` — never `new Date('2026-08-20')` read back in local time, which shifts a day in a UK summer.

**List view and month view both drive one `renderCell(cell, date, part, { compact })` callback.** `renderCalendar` in `common.js` picks the layout; each page supplies the callback (`makeCell` in `event.html` / `results.html`). Adding behaviour to a slot means editing that one callback, not two renderers. `compact: true` means the month view's narrow strip, which now only governs cosmetics — the part initial, and `✓` in place of `✓ all`.

**A results slot shows its count and nothing else.** The names live in a `title` tooltip on every cell, in both views. That is a deliberate reversal: names printed under every count turned the grid into something you read line by line, when the whole point of `--lit` is that you scan it and the bright slots come to you. Adding names back into the cell would undo the light meter. Note the cost — a tooltip needs a mouse, so on a phone the names are currently unreachable and only the counts are.

**The admin console is the only thing that may enumerate events, and it is off by
default.** Everywhere else an unguessable id *is* the access control, so a route that
lists every id is a different kind of route: `app.use('/api/admin', requireAdmin)` is
registered before the admin handlers precisely so a new one cannot be added outside the
gate by accident, and `requireAdmin` throws **503 when `ADMIN_PASSWORD` is unset** rather
than waving the request through — an unconfigured deployment must have no console, not an
open one. The comparison is `timingSafeEqual` over SHA-256 digests, and a missing password
and a wrong one get the same message on purpose. If you add an admin route, add it above
that middleware's handlers and give it a test in `tests/admin.spec.js`.

**Shrinking an event's range deletes the availability outside it.** `updateEvent` does
that in the same transaction as the update and returns the count, because `GET /results`
only builds a grid over the current range: slots outside it are invisible, and leaving
them means widening the range later resurrects answers nobody re-gave.

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

`events` → `responses` (one per person per event) → `slots` (one row per date+part).

**A person is their email, not their name.** `responses.email` is `COLLATE NOCASE` with `UNIQUE(event_id, email)`, so re-submitting from the same address replaces that answer while three people called Andy stay three people — which is the whole reason the column exists. Do not put a uniqueness constraint back on `name`. `saveResponse` implements the upsert as delete-then-insert inside a transaction; the old slots go with it via `ON DELETE CASCADE`.

`email` is nullable **only** for rows written before the column existed. Every route requires one, and SQLite counts NULLs as distinct in a UNIQUE index, so those legacy rows coexist happily; `saveResponse` matches `email = ? OR (email IS NULL AND name = ?)` so such a person is adopted rather than duplicated the first time they answer again.

`migrate()` in `db.js` rebuilds the table for databases that predate the column, because `CREATE TABLE IF NOT EXISTS` leaves the old `UNIQUE(event_id, name)` in place and SQLite cannot drop an inline constraint. Two things there are load-bearing: row ids are carried across, since `slots.response_id` points at them; and foreign keys are switched **off** around the rebuild, because `DROP TABLE` does an implicit `DELETE FROM` first and `slots` cascades — with them on, the migration deletes every answer it is supposed to be preserving. `tests/migration.spec.js` builds the old schema by hand and covers exactly this.

`GET /results` returns a **dense** grid: every date in range × every part, empty slots as empty arrays. Each entry is a `{ name, email }` object rather than a bare name, for the same reason — preserve both if you touch the endpoint. Pages can index `grid[date][part]` without gap-filling.

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
- Pages hide things by setting the `hidden` property, so `styles.css` carries a global `[hidden] { display: none !important }`. The attribute is only a UA-sheet `display: none`, and any class with its own `display` — `.field`, `.actions` — would otherwise outrank it and leave a "hidden" element on screen.
- Icons are inline SVG, for the same reason there are no dependencies in `public/`: no icon font, no sprite file, no request.
- Comments explain *why* (timezone traps, the `total > 0` guard on the unanimous highlight, the id-collision retry), not what.
- British English in user-facing copy ("organiser", "Colour" spellings in prose).
- `README.md` documents the API table, the view behaviour, and the layout — keep it in step when routes, views, or files change.

### Designs come from Penpot

Design work happens in Penpot, in the file **Group Booking**, and moves in both directions.
The connection is the Penpot connector plus the **Penpot MCP Plugin**, which runs inside the
Penpot tab and hands the connector a live handle on the open file. Nothing about it lands in
the repository: there is no server to add to `.mcp.json`, no token to keep out of git, and
the plugin is opened from within Penpot rather than configured here.

**Both directions go through one contract**, `design/design.json` — the design system as
values rather than as a picture. `design/README.md` is the full account; the four commands
are `design:extract` (re-read it from the running app), `design:push` (apply it to Penpot),
`design:diff` (compare a Penpot pull against it), and `npm test`, which **fails when the app
drifts from the committed contract**. That failure is how a change made in code announces
itself as something Penpot has not been told; there is no step to remember.

Because the connector is a handle on a browser tab, none of this is a background sync. The
pull is something a person or an agent runs — `design/penpot/pull.js` through `execute_code`,
saved to `design/penpot/pulled.json` — and `design:diff` always exits 0, because a
disagreement between the design and the code is a decision, not a broken build.

That handle is the fragile part. It belongs to an open browser tab, so closing the tab, or
letting the session idle long enough, drops it — the next call fails with *"No Penpot
instance connected for user token"* rather than doing nothing. Reopening the plugin restores
it. **Long-running `execute_code` calls are what tend to break it**, so build a design in
several modest calls rather than one that constructs a whole page; each call is a round trip,
and the partial work already committed to the file survives a drop, while a single giant call
loses everything it had not yet flushed.

Reading a design means executing JavaScript against the Penpot plugin API — `execute_code`
with `penpotUtils.shapeStructure` for the shape tree, `export_shape` to actually look at it.
There is no frame link to paste: the file is whatever the plugin is currently attached to, so
identify a design by board name, or ask for it to be selected and read `penpot.selection`.

Four of the invariants above are the ones a Penpot board is most likely to contradict,
because each is a decision the picture cannot show:

- **A slot's design lives in one callback.** `renderCalendar` picks list or month; `makeCell`
  supplies the cell to both. Two boards — a list design and a month design — still implement
  as one `renderCell`, never as a second render path.
- **`--hue` and `--lit` are not optional.** Penpot will hand over a flat fill; the cell needs
  both custom properties or it renders uncoloured. Going the other way, a slot's fill is the
  hue at `lit x --lit-max` opacity — that is the whole rule, and it reproduces exactly.
- **Neither grid may scroll sideways.** A board drawn at desktop width says nothing about
  320px. The 44rem and 48rem `@media` blocks are the answer, in CSS alone.
- **Brightness is never the only signal.** A design that drops the count text or the `✓ all`
  ring has removed the fallback, not tidied it.

Where a board conflicts with one of these, say so and offer the nearest design that does
not. Implementing it as drawn and letting `tests/mobile.spec.js` fail is the slower route
to the same conversation.

Five things about the Penpot API cost time if you meet them by surprise:

- **`lineHeight` is a ratio, not pixels.** Passing the CSS `52.08px` sets a line box 52 times
  the font size. Divide by the font size first.
- **`letterSpacing` is in pixels but may not be negative.** The display face is tracked in
  (`-1.24px` on `h1`), and Penpot rejects the value outright rather than clamping it, so the
  tightening cannot be represented — record the intended value on the layer name instead of
  dropping it silently.
- **Token set names may not contain spaces around a `/`.** `Daylight/Light` is accepted,
  `Daylight / Light` is not, and the error names a field index rather than the problem.
- **`width`/`height` are read-only, and `resize()` sets a text's `growType` to `fixed`.** Set
  `growType` back to `auto-width`/`auto-height` afterwards, or the text stops sizing itself.
- **A `fontFamilies` token is parsed into a list, and a family may not start with a hyphen.**
  So a CSS stack containing `-apple-system` is rejected whole. Store the leading family only:
  which typeface to use is a design decision, whereas what to fall back to before it has
  downloaded is a code one.
