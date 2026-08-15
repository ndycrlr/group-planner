// The Express app, with no listener attached.
//
// This file is also the Vercel entry point: Vercel looks for an app.js at the
// root exporting an Express app and turns it into a single function. That is
// why the listener lives in start.js — and why start.js is named so that it
// stays off Vercel's list of candidate entry points.

import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStore } from './db.js';
// Shared with the browser pages so the server and the grid always agree on
// which days an event covers. See the note at the top of public/dates.js.
import { PARTS, datesInRange, validateRange } from './public/dates.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const MAX_TITLE_LENGTH = 100;
const MAX_NAME_LENGTH = 50;
const MAX_EMAIL_LENGTH = 254; // the longest an address is allowed to be, per RFC 5321

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

/**
 * Deliberately a shape check and nothing more: one @, something either side, a
 * dot in the domain, no spaces. The address is an identifier here, never a
 * destination — nothing is sent to it — so rejecting an unusual but legitimate
 * address would cost a real person their place for no gain.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function requireEmail(value) {
  const email = requireString(value, 'Your email', MAX_EMAIL_LENGTH).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, 'That does not look like an email address.');
  }
  return email;
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
  const email = requireEmail(req.body?.email);
  const slots = cleanSlots(event, req.body?.slots);

  await store.saveResponse(event.id, name, email, slots);
  res.json({ ok: true, name, email, saved: slots.length });
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
  // Each entry is the person, not just their name: with three Andys in a slot
  // the names alone would read as one person listed three times.
  for (const { name, email, date, part } of slots) {
    grid[date]?.[part]?.push({ name, email });
  }

  res.json({ event, participants, grid });
});

// --- The admin console ----------------------------------------------------
//
// Everything else in this app is protected by nothing but an unguessable link:
// no accounts, and an event id you cannot see is an event you cannot reach.
// These routes break that, because listing every event is exactly what they are
// for — so they are the one place that needs a credential, and the credential is
// a single shared password in ADMIN_PASSWORD.
//
// With no password set the console is *off*, not open: an unconfigured
// deployment must not hand out every event to whoever asks first. That is why
// the check is 503-if-unset rather than skipped-if-unset.

const ADMIN_HEADER = 'x-admin-password';

/**
 * Compare against the configured password without leaking its length or its
 * matching prefix through how long the comparison takes. timingSafeEqual needs
 * two buffers of equal length, which the digests always are.
 */
function passwordMatches(supplied) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(supplied), digest(process.env.ADMIN_PASSWORD));
}

function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_PASSWORD) {
    throw new HttpError(503, 'Admin access is not configured on this server.');
  }
  const supplied = req.get(ADMIN_HEADER);
  // A missing password and a wrong one get the same answer: which of the two it
  // was is information the person asking has not earned.
  if (typeof supplied !== 'string' || !passwordMatches(supplied)) {
    throw new HttpError(401, 'That admin password is not right.');
  }
  next();
}

// Registered before the routes below, so every one of them is behind it and a
// new route cannot be added outside the gate by accident.
app.use('/api/admin', requireAdmin);

// Lets the page check a password before showing anything. It carries no data of
// its own on purpose — a wrong password must not be told what it missed.
app.post('/api/admin/session', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/admin/events', async (req, res) => {
  res.json({ events: await store.listEvents() });
});

app.patch('/api/admin/events/:id', async (req, res) => {
  const event = await requireEvent(req.params.id);
  const title = requireString(req.body?.title, 'Title', MAX_TITLE_LENGTH);
  // Absent dates mean "leave them", so the range can be edited independently of
  // the title; whatever the result, it goes through the same validateRange the
  // create form uses, and an event can never end up in a state /api/events
  // could not have produced.
  const startDate = req.body?.startDate ?? event.startDate;
  const endDate = req.body?.endDate ?? event.endDate;

  const rangeError = validateRange(startDate, endDate);
  if (rangeError) throw new HttpError(400, rangeError);

  const { droppedSlots } = await store.updateEvent(event.id, { title, startDate, endDate });
  res.json({ event: { id: event.id, title, startDate, endDate }, droppedSlots });
});

app.delete('/api/admin/events/:id', async (req, res) => {
  const event = await requireEvent(req.params.id);
  await store.deleteEvent(event.id);
  res.json({ ok: true, id: event.id });
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
  // A 5xx we raised on purpose is a message, not a crash: the 503 for a missing
  // ADMIN_PASSWORD would otherwise print a full stack on every admin request,
  // and burying real failures in that noise is how they get missed.
  if (status >= 500) console.error(error instanceof HttpError ? error.message : error);

  // A 5xx message is an internal detail unless it is one we wrote on purpose:
  // the 503 saying the admin console has no password configured exists to be
  // read by whoever has to go and set one, and swallowing it would leave them
  // with a dead page and no reason for it.
  const expose = status < 500 || error instanceof HttpError;
  res.status(status).json({
    error: expose ? error.message : 'Something went wrong on the server.',
  });
});

export default app;
