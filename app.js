// The Express app, with no listener attached.
//
// This file is also the Vercel entry point: Vercel looks for an app.js at the
// root exporting an Express app and turns it into a single function. That is
// why the listener lives in start.js — and why start.js is named so that it
// stays off Vercel's list of candidate entry points.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStore } from './db.js';
// Shared with the browser pages so the server and the grid always agree on
// which days an event covers. See the note at the top of public/dates.js.
import { PARTS, datesInRange, validateRange } from './public/dates.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const MAX_TITLE_LENGTH = 100;
const MAX_NAME_LENGTH = 50;

/**
 * Turso in production; a local SQLite file otherwise. The path is resolved
 * because libSQL wants an absolute one in the `file:` URL, which matters on
 * Windows where a bare relative path is not a valid URL body.
 */
function databaseUrl() {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  const file = process.env.PLANNER_DB
    ? path.resolve(process.env.PLANNER_DB)
    : path.join(here, 'planner.db');
  return `file:${file}`;
}

export const store = createStore({
  url: databaseUrl(),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const app = express();

app.use(express.json({ limit: '100kb' }));
// Vercel serves public/ straight from its CDN, so this only does anything
// locally. It is harmless there and saves a separate dev-only server.
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

async function requireEvent(id) {
  const event = await store.getEvent(id);
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

// Express 5 forwards a rejected promise from a handler to the error middleware
// below, so these need no try/catch of their own.
app.post('/api/events', async (req, res) => {
  const title = requireString(req.body?.title, 'Title', MAX_TITLE_LENGTH);
  const startDate = req.body?.startDate;
  const endDate = req.body?.endDate;

  const rangeError = validateRange(startDate, endDate);
  if (rangeError) throw new HttpError(400, rangeError);

  const id = await store.createEvent({ title, startDate, endDate });
  res.status(201).json({ id });
});

app.get('/api/events/:id', async (req, res) => {
  res.json(await requireEvent(req.params.id));
});

app.post('/api/events/:id/responses', async (req, res) => {
  const event = await requireEvent(req.params.id);
  const name = requireString(req.body?.name, 'Your name', MAX_NAME_LENGTH);
  const slots = cleanSlots(event, req.body?.slots);

  await store.saveResponse(event.id, name, slots);
  res.json({ ok: true, name, saved: slots.length });
});

app.get('/api/events/:id/results', async (req, res) => {
  const event = await requireEvent(req.params.id);
  const { participants, slots } = await store.getResponses(event.id);

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

export default app;
