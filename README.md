# Group Planner

Find the slot that works for everyone. The organiser picks a date range, shares one
link, and each person ticks the mornings, afternoons and evenings they can make.
The results page shows the same calendar with names in each slot, and highlights any
slot where **everyone** is free.

## Running it

```sh
npm install
npm start
```

Then open <http://localhost:3000>.

Needs **Node 20 or newer**. Storage is SQLite through libSQL, which reads a plain local
file by default — `planner.db`, created in the project root on first run — and can also
talk to a hosted database over the network without any change to the schema.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `PLANNER_DB` | `./planner.db` | Where the local SQLite file lives |
| `TURSO_DATABASE_URL` | — | A hosted libSQL database. Overrides `PLANNER_DB` when set |
| `TURSO_AUTH_TOKEN` | — | Token for that database |
| `ADMIN_PASSWORD` | — | Unlocks `/admin.html`. Unset means the admin console is **off**, not open |

## Tests

```sh
npx playwright install chromium   # once, on a fresh checkout
npm test
```

The Playwright suite covers the API contract and every page. It runs against its own
server on port 3210 with a throwaway database, so your real `planner.db` is never
touched. One block in `tests/admin.spec.js` starts a second server on 3211 with no
`ADMIN_PASSWORD`, to check that an unconfigured admin console is closed rather than open.

## Contributing

Commits follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
enforced by a `commit-msg` hook that `npm install` activates:

```
feat(results): highlight the slot everyone can make
fix(dates): stop a UK summer date shifting a day backwards
```

## How it's used

1. **Create** — on the home page, name the activity and choose the first and last day
   (up to 92 days). You get a shareable link.
2. **Share** — send that link to the group. Everyone enters their name and taps the slots
   they're free. Click and drag to select a run of slots quickly.
3. **Decide** — the results page lists who is available in each slot. The more of the
   group that can make a slot, the brighter it burns; a slot everyone can make is fully
   lit, ringed, and marked ✓.

Each part of the day carries its own colour throughout — teal for morning, gold for
afternoon, violet for evening — so hue tells you *when* a slot is and brightness tells
you *how many* people are free. The count is printed in every cell too, so nothing
depends on colour alone.

## List view and month view

Both the availability page and the results page can be shown two ways, switched with the
**List / Month** toggle:

- **List** — a row per day, columns for morning / afternoon / evening. Best for a week.
- **Month** — a proper calendar grid, one block per month stacked vertically with no
  paging. Days outside the event's range are greyed out. Each day holds three strips
  (M / A / E).

On the results page a slot shows only its count (`3/4`), in both views, and gives up the
names in a tooltip on hover. The grid is there to be scanned for the slots that work — a
name under every cell buried that — so who is free is a follow-up question, asked one slot
at a time. Hovering needs a mouse: on a phone, read the counts and use the "who replied"
list at the top of the page.

A page opens in whichever view suits the length — list for **7 days or fewer**, month
beyond that — and once you use the toggle your choice is remembered for next time.

On a phone both views rearrange themselves to fit the screen rather than scrolling
sideways: the list stops being a table and gives each day its own block with the three
slots in a row underneath, and the month shrinks its days so all seven columns fit. Either
way the page only ever scrolls downwards. The month is an overview at that size — for
anything fiddly, and to read the names, switch to list view.

Anyone with the link can both submit and view results. Submitting again with the same
**email** updates that person's answer rather than adding them twice; addresses are matched
case-insensitively, so `Andy@…` and `andy@…` are the same person.

The email is there because names are not unique — plenty of groups have three people called
Andy, and keying on the name meant each one quietly overwrote the last. Nothing is sent to
the address; it identifies a person and nothing more. It is shown beside their name on the
results page, and in a slot's tooltip only when someone else there shares that name.

## Sharing beyond your own machine

`localhost` links only work on your own computer. On a home or office network, find your
machine's IP (`ipconfig` on Windows) and share `http://<your-ip>:3000/event.html?id=…`;
you may need to allow Node through the Windows firewall.

## Deploying to Vercel

A local file cannot back the app on Vercel: the filesystem is read-only, the writable
`/tmp` belongs to one microVM out of many, and it is wiped when a function is archived.
Replies would go missing between instances. So production needs a hosted database.

1. Create a database at [Turso](https://turso.tech) and note its URL and auth token.
2. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in the Vercel project's environment
   variables. The schema creates itself on first request.
3. Deploy — connect the repository at [vercel.com/new](https://vercel.com/new), or run
   `npx vercel deploy`.

Set `ADMIN_PASSWORD` there too if you want the admin console; leaving it unset is the
deliberate way to have no admin console in production at all.

There is nothing else to configure. Vercel detects Express, turns the app exported from
`app.js` into a single function, and serves `public/` from its CDN. `start.js` exists only
to bind a port locally; it is named so that it stays off Vercel's list of candidate entry
points, which includes `server.js`.

There are no accounts: anyone who has an event link can see and change that event's
responses, so treat the link as semi-private.

## The admin console

`/admin.html` is the one page that can see past the links. It lists every event with how
many people have answered, and can rename one, move its dates, or delete it outright. The
gear in the top-right corner of the home page is the way in.

Set `ADMIN_PASSWORD` to switch it on:

```sh
ADMIN_PASSWORD='something long' npm start   # then open /admin.html
```

With no `ADMIN_PASSWORD` set, the console is **off** — every `/api/admin/*` route answers
`503`, and the page says so on arrival rather than offering a password box that could never
work. That way a deployment that forgot to configure one has no admin console at all,
rather than an unlocked one. The password is compared in constant time, is sent on each
request as an `x-admin-password` header, and is kept in `sessionStorage` so it does not
outlive the tab. It travels in the clear, so serve the app over HTTPS anywhere that
matters, and avoid leading or trailing spaces in the value — HTTP trims them in transit.

Deleting an event takes two clicks and says what goes with it: the responses and their
slots are removed in the same transaction. Shrinking an event's date range drops any
availability that now falls outside it, and the console reports how many slots that cost —
the alternative is answers sitting in the database that no page can show.

## Layout

```
app.js             Express API + serves public/, with no listener attached
start.js           binds app.js to a port for local use
db.js              SQLite schema and queries, over libSQL
public/
  index.html       create an event
  event.html       pick your availability
  results.html     who is free when
  admin.html       every event, behind ADMIN_PASSWORD
  dates.js         date helpers shared by the browser AND the server
  common.js        API wrapper + the list and month renderers, view toggle
  styles.css       styling, light and dark, and the narrow-screen layouts
```

`public/dates.js` is deliberately imported by both `app.js` and the browser pages, so
the two can never disagree about which days an event covers. All date maths runs in UTC
on `YYYY-MM-DD` strings, which avoids `new Date('2026-08-20')` silently shifting a day
backwards in a UK summer.

Both views in `common.js` drive the same `renderCell(cell, date, part, { compact })`
callback, so the availability logic on each page is written once and rendered two ways.
The narrow-screen layouts are CSS alone — same markup, same callback — so a phone and a
desktop can never drift apart in what they show.

## API

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/events` | `{title, startDate, endDate}` → `{id}` |
| `GET` | `/api/events/:id` | Event title and date range |
| `POST` | `/api/events/:id/responses` | `{name, email, slots:[{date, part}]}` — upserts by email |
| `GET` | `/api/events/:id/results` | Participants plus a `{name, email}` list per slot |
| `POST` | `/api/admin/session` | Checks the admin password and nothing else |
| `GET` | `/api/admin/events` | Every event, with response and slot counts |
| `PATCH` | `/api/admin/events/:id` | `{title, startDate?, endDate?}` → the event and `droppedSlots` |
| `DELETE` | `/api/admin/events/:id` | Removes the event, its responses and their slots |

`part` is one of `morning`, `afternoon`, `evening`. Invalid input returns a `4xx` with an
`{"error": "..."}` message that the pages display as-is.

The four `/api/admin/*` routes need an `x-admin-password` header matching `ADMIN_PASSWORD`
— `401` without it, `503` if the server has no password configured. The other routes need
nothing but the event id.

### Example

```sh
ID=$(curl -s -X POST localhost:3000/api/events -H 'Content-Type: application/json' \
  -d '{"title":"Summer BBQ","startDate":"2026-08-20","endDate":"2026-08-23"}' | jq -r .id)

curl -s -X POST localhost:3000/api/events/$ID/responses -H 'Content-Type: application/json' \
  -d '{"name":"Andy","email":"andy@example.com","slots":[{"date":"2026-08-21","part":"evening"}]}'

curl -s localhost:3000/api/events/$ID/results
```
