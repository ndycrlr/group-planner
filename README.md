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

Needs **Node 22.5 or newer** — storage uses the built-in `node:sqlite`, so Express is
the only dependency and there is nothing to compile. Data lives in `planner.db`, created
next to `server.js` on first run.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `PLANNER_DB` | `./planner.db` | Where the SQLite file lives |

## Tests

```sh
npx playwright install chromium   # once, on a fresh checkout
npm test
```

74 Playwright tests cover the API contract and all three pages. They run against
their own server on port 3210 with a throwaway database, so your real `planner.db`
is never touched.

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
  (M / A / E); on the results page each strip shows just a count (`3/4`) and reveals the
  names in a tooltip on hover. Hover needs a mouse, so on a phone use list view to read
  the names.

A page opens in whichever view suits the length — list for **7 days or fewer**, month
beyond that — and once you use the toggle your choice is remembered for next time.

Anyone with the link can both submit and view results. Submitting again with the same
name **updates** that person's answer rather than adding them twice — names are matched
case-insensitively, so `andy` and `Andy` are the same person.

## Sharing beyond your own machine

`localhost` links only work on your own computer. On a home or office network, find your
machine's IP (`ipconfig` on Windows) and share `http://<your-ip>:3000/event.html?id=…`;
you may need to allow Node through the Windows firewall. For anyone outside your network,
deploy it to a host that keeps `planner.db` on a persistent disk.

There are no accounts and no passwords: anyone who has an event link can see and change
that event's responses, so treat the link as semi-private.

## Layout

```
server.js          Express API + serves public/
db.js              SQLite schema and queries (node:sqlite)
public/
  index.html       create an event
  event.html       pick your availability
  results.html     who is free when
  dates.js         date helpers shared by the browser AND the server
  common.js        API wrapper + the list and month renderers, view toggle
  styles.css       styling, light and dark
```

`public/dates.js` is deliberately imported by both `server.js` and the browser pages, so
the two can never disagree about which days an event covers. All date maths runs in UTC
on `YYYY-MM-DD` strings, which avoids `new Date('2026-08-20')` silently shifting a day
backwards in a UK summer.

Both views in `common.js` drive the same `renderCell(cell, date, part, { compact })`
callback, so the availability logic on each page is written once and rendered two ways.

## API

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/events` | `{title, startDate, endDate}` → `{id}` |
| `GET` | `/api/events/:id` | Event title and date range |
| `POST` | `/api/events/:id/responses` | `{name, slots:[{date, part}]}` — upserts by name |
| `GET` | `/api/events/:id/results` | Participants plus a name list per slot |

`part` is one of `morning`, `afternoon`, `evening`. Invalid input returns a `4xx` with an
`{"error": "..."}` message that the pages display as-is.

### Example

```sh
ID=$(curl -s -X POST localhost:3000/api/events -H 'Content-Type: application/json' \
  -d '{"title":"Summer BBQ","startDate":"2026-08-20","endDate":"2026-08-23"}' | jq -r .id)

curl -s -X POST localhost:3000/api/events/$ID/responses -H 'Content-Type: application/json' \
  -d '{"name":"Andy","slots":[{"date":"2026-08-21","part":"evening"}]}'

curl -s localhost:3000/api/events/$ID/results
```
