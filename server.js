import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStore } from './db.js';
// Shared with the browser pages so the server and the grid always agree on
// which days an event covers. See the note at the top of public/dates.js.
import { PARTS, datesInRange, validateRange } from './public/dates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.PLANNER_DB || path.join(here, 'planner.db');

const MAX_TITLE_LENGTH = 100;
const MAX_NAME_LENGTH = 50;

const store = createStore(DB_FILE);
const app = express();

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(here, 'public')));

/** Thrown by the validation helpers; turned into a 4xx by the error handler. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireString(value, field, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new HttpError(400, `${field} is required.`);
  if (text.length > maxLength) {
    throw new HttpError(400, `${field} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function requireEvent(id) {
  const event = store.getEvent(id);
  if (!event) throw new HttpError(404, 'That event does not exist. Check the link.');
  return event;
}

/**
 * Check the submitted slots against the event's own date range and the three
 * known parts of the day, dropping duplicates.
 */
function cleanSlots(event, value) {
  if (!Array.isArray(value)) throw new HttpError(400, 'Slots must be a list.');

  const validDates = new Set(datesInRange(event.startDate, event.endDate));
  const seen = new Set();
  const slots = [];

  for (const slot of value) {
    const date = slot?.date;
    const part = slot?.part;
    if (!validDates.has(date)) {
      throw new HttpError(400, `${date} is outside this event's dates.`);
    }
    if (!PARTS.includes(part)) {
      throw new HttpError(400, `"${part}" is not a valid part of the day.`);
    }
    const key = `${date}|${part}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push({ date, part });
  }

  return slots;
}

app.post('/api/events', (req, res) => {
  const title = requireString(req.body?.title, 'Title', MAX_TITLE_LENGTH);
  const startDate = req.body?.startDate;
  const endDate = req.body?.endDate;

  const rangeError = validateRange(startDate, endDate);
  if (rangeError) throw new HttpError(400, rangeError);

  const id = store.createEvent({ title, startDate, endDate });
  res.status(201).json({ id });
});

app.get('/api/events/:id', (req, res) => {
  res.json(requireEvent(req.params.id));
});

app.post('/api/events/:id/responses', (req, res) => {
  const event = requireEvent(req.params.id);
  const name = requireString(req.body?.name, 'Your name', MAX_NAME_LENGTH);
  const slots = cleanSlots(event, req.body?.slots);

  store.saveResponse(event.id, name, slots);
  res.json({ ok: true, name, saved: slots.length });
});

app.get('/api/events/:id/results', (req, res) => {
  const event = requireEvent(req.params.id);
  const { participants, slots } = store.getResponses(event.id);

  // Every day in the range appears in the grid, so the page never has to fill
  // gaps: empty slots are simply empty arrays.
  const grid = {};
  for (const date of datesInRange(event.startDate, event.endDate)) {
    grid[date] = Object.fromEntries(PARTS.map((part) => [part, []]));
  }
  for (const { name, date, part } of slots) {
    grid[date]?.[part]?.push(name);
  }

  res.json({ event, participants, grid });
});

// Anything unknown under /api is a JSON 404, not the static file handler's HTML.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Unknown API route.' });
});

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature.
app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Could not read that request as JSON.' });
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on the server.' : error.message,
  });
});

app.listen(PORT, () => {
  console.log(`Group planner running at http://localhost:${PORT}`);
  console.log(`Storing events in ${DB_FILE}`);
});
