// Upgrading a database written before responses.email existed.
//
// This is the one part of the email change that cannot be exercised through the
// API: by the time the server is up, its database is already on the current
// schema. So these build the *old* schema by hand in a scratch file, run the
// store against it, and check what came through. `createStore` is imported
// directly — no server, no HTTP.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { createStore } from '../db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = path.join(here, '..', '.test-tmp', 'migration');

/** The schema exactly as it stood before emails: no column, unique on name. */
const OLD_SCHEMA = `
  CREATE TABLE events (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, start_date TEXT NOT NULL,
    end_date TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL REFERENCES events(id),
    name TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE(event_id, name)
  );
  CREATE TABLE slots (
    response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
    date TEXT NOT NULL, part TEXT NOT NULL,
    PRIMARY KEY (response_id, date, part)
  );
`;

/** A pre-email database holding one event and one person with two slots. */
async function legacyDatabase(label) {
  fs.mkdirSync(scratch, { recursive: true });
  const file = path.join(scratch, `${label}-${Date.now()}.db`);
  fs.rmSync(file, { force: true });

  const client = createClient({ url: `file:${file}` });
  await client.executeMultiple(OLD_SCHEMA);
  const now = new Date().toISOString();
  await client.execute({
    sql: 'INSERT INTO events VALUES (?, ?, ?, ?, ?)',
    args: ['evt', 'Legacy event', '2026-08-17', '2026-08-23', now],
  });
  await client.execute({
    sql: 'INSERT INTO responses (id, event_id, name, created_at) VALUES (?, ?, ?, ?)',
    args: [1, 'evt', 'Andy', now],
  });
  await client.execute({
    sql: "INSERT INTO slots VALUES (1, '2026-08-18', 'evening'), (1, '2026-08-19', 'morning')",
  });
  await client.close();
  return file;
}

test('an older database keeps its answers, with no email against them', async () => {
  const store = createStore({ url: `file:${await legacyDatabase('keeps')}` });

  const { participants, slots } = await store.getResponses('evt');
  expect(participants).toEqual([{ name: 'Andy', email: null }]);
  // The slots are still attached, which is what preserving the row ids buys.
  expect(slots.map((slot) => `${slot.date} ${slot.part}`)).toEqual([
    '2026-08-18 evening',
    '2026-08-19 morning',
  ]);

  await store.close();
});

test('the name that was unique before no longer has to be', async () => {
  const store = createStore({ url: `file:${await legacyDatabase('duplicates')}` });

  // The old schema's UNIQUE(event_id, name) would have rejected the second of
  // these outright. Rebuilding the table is what lifts it.
  await store.saveResponse('evt', 'Sam', 'sam.a@example.test', [
    { date: '2026-08-20', part: 'morning' },
  ]);
  await store.saveResponse('evt', 'Sam', 'sam.b@example.test', [
    { date: '2026-08-21', part: 'morning' },
  ]);

  const { participants } = await store.getResponses('evt');
  expect(participants.filter((person) => person.name === 'Sam')).toHaveLength(2);

  await store.close();
});

test('someone who answered before an email was asked for is adopted, not duplicated', async () => {
  const store = createStore({ url: `file:${await legacyDatabase('adopts')}` });

  // Andy already has a legacy row carrying no email. Coming back with one must
  // replace that row rather than leaving him listed twice.
  await store.saveResponse('evt', 'Andy', 'andy@example.test', [
    { date: '2026-08-22', part: 'evening' },
  ]);

  const { participants, slots } = await store.getResponses('evt');
  expect(participants).toEqual([{ name: 'Andy', email: 'andy@example.test' }]);
  expect(slots.map((slot) => `${slot.date} ${slot.part}`)).toEqual(['2026-08-22 evening']);

  await store.close();
});

test('migrating twice is harmless', async () => {
  const file = await legacyDatabase('twice');

  for (let run = 0; run < 2; run++) {
    const store = createStore({ url: `file:${file}` });
    const { participants } = await store.getResponses('evt');
    expect(participants).toHaveLength(1);
    await store.close();
  }
});
