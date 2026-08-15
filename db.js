// Storage on libSQL — SQLite that can also be reached over the network.
//
// The schema below is the same SQLite it always was, but the connection is no
// longer a file handle: Vercel's filesystem is read-only, and its writable
// /tmp is per-microVM and wiped when a function is archived, so a local file
// cannot hold shared state there. A `file:` URL still gives the old behaviour
// for local development and the test suite.

import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date   TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS responses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   TEXT NOT NULL REFERENCES events(id),
    name       TEXT NOT NULL,
    -- Email is what identifies a person, not their name: a social group can
    -- easily hold three people called Andy, and keying on the name made the
    -- second one overwrite the first. COLLATE NOCASE so "Andy@x.com" and
    -- "andy@x.com" are recognised as the same person coming back.
    --
    -- Nullable only for rows written before this column existed; every new row
    -- is required to carry one. SQLite treats NULLs as distinct in a UNIQUE
    -- index, so any number of those legacy rows can coexist per event.
    email      TEXT COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE(event_id, email)
  );

  CREATE TABLE IF NOT EXISTS slots (
    response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    part        TEXT NOT NULL,
    PRIMARY KEY (response_id, date, part)
  );

  CREATE INDEX IF NOT EXISTS idx_responses_event ON responses(event_id);
`;

/**
 * Bring a database written before `responses.email` existed up to the schema
 * above.
 *
 * `CREATE TABLE IF NOT EXISTS` leaves an existing table exactly as it was, so
 * an older database still carries the old `UNIQUE(event_id, name)` — the very
 * constraint that stops a group having three people called Andy. SQLite cannot
 * drop a constraint declared inline, so the table has to be rebuilt rather than
 * altered.
 *
 * Row ids are carried across deliberately: `slots.response_id` points at them,
 * so preserving the ids keeps every existing answer attached to its person.
 * Legacy rows get a NULL email — inventing an address for them would put a
 * fabricated one on screen — and `saveResponse` adopts such a row by name the
 * first time that person submits again.
 */
async function migrate(client) {
  const { rows } = await client.execute("SELECT name FROM pragma_table_info('responses')");
  if (rows.some((row) => row.name === 'email')) return;

  // Foreign keys have to come off around the rebuild, and the pragma is a no-op
  // inside a transaction, so it sits outside one — this is the sequence SQLite's
  // own "making other kinds of table schema changes" documents.
  //
  // Without it the rebuild silently destroys the data it is meant to preserve:
  // DROP TABLE performs an implicit DELETE FROM first, and `slots` cascades on
  // delete, so dropping the old responses table takes every saved slot with it.
  await client.execute('PRAGMA foreign_keys=off');
  try {
    await client.executeMultiple(`
      BEGIN;
      CREATE TABLE responses_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id   TEXT NOT NULL REFERENCES events(id),
        name       TEXT NOT NULL,
        email      TEXT COLLATE NOCASE,
        created_at TEXT NOT NULL,
        UNIQUE(event_id, email)
      );

      INSERT INTO responses_new (id, event_id, name, email, created_at)
        SELECT id, event_id, name, NULL, created_at FROM responses;

      DROP TABLE responses;
      ALTER TABLE responses_new RENAME TO responses;
      CREATE INDEX IF NOT EXISTS idx_responses_event ON responses(event_id);
      COMMIT;
    `);
  } finally {
    await client.execute('PRAGMA foreign_keys=on');
  }
}

/** Short, URL-safe, unguessable-enough event id, e.g. 'K3nQ7wUa'. */
function newEventId() {
  return randomBytes(6).toString('base64url');
}

/** libSQL reports a broken UNIQUE constraint as a generic constraint error. */
function isUniqueViolation(error) {
  return error?.code === 'SQLITE_CONSTRAINT' && /UNIQUE/i.test(String(error.message));
}

/**
 * libSQL rows are array-like with the column names attached. Spreading gives a
 * plain object, which is what res.json() needs to emit an object rather than
 * an array.
 */
function toPlain(row) {
  return row === undefined ? undefined : { ...row };
}

/**
 * `url` is either `file:/absolute/path.db` or a libsql:// URL for Turso.
 * Nothing connects until the first query, so importing this module is free.
 */
export function createStore({ url, authToken }) {
  let opening = null;

  async function open() {
    const isFile = url.startsWith('file:');

    // libSQL opens a file but will not create the directory holding it, and
    // reports the miss only as SQLite error 14. Making it here turns
    // PLANNER_DB=data/planner.db into something that just works.
    if (isFile) {
      await mkdir(path.dirname(url.slice('file:'.length)), { recursive: true });
    }

    // The default build can open a local file but carries native bindings; the
    // web build is pure JS over HTTP. Choosing per URL keeps the native code
    // out of a serverless bundle that only ever talks to a remote database.
    const { createClient } = isFile
      ? await import('@libsql/client')
      : await import('@libsql/client/web');

    const client = createClient(authToken ? { url, authToken } : { url });
    await client.executeMultiple(SCHEMA);
    await migrate(client);
    return client;
  }

  function connect() {
    // Memoised, so the schema statements run once per process rather than once
    // per request — including across warm serverless invocations.
    //
    // A failure must not be memoised with it. Serverless instances are long
    // lived: if a cold start briefly cannot reach the database, caching the
    // rejected promise would fail every later request on that instance for as
    // long as it survives. Clearing the memo lets the next request try again.
    opening ??= open().catch((error) => {
      opening = null;
      throw error;
    });
    return opening;
  }

  return {
    async createEvent({ title, startDate, endDate }) {
      const client = await connect();

      // Retry on the vanishingly unlikely id collision rather than 500ing.
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = newEventId();
        try {
          await client.execute({
            sql: 'INSERT INTO events (id, title, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?)',
            args: [id, title, startDate, endDate, new Date().toISOString()],
          });
          return id;
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      }
      throw new Error('Could not allocate an event id.');
    },

    /**
     * Every event, newest first, with the two numbers that say whether it is
     * worth keeping: how many people answered, and how many slots they picked
     * between them. Only the admin console reads this — there is no per-event
     * ownership in this app, so nothing else is allowed to enumerate events.
     */
    async listEvents() {
      const client = await connect();
      const { rows } = await client.execute(`
        SELECT e.id                AS id,
               e.title             AS title,
               e.start_date        AS startDate,
               e.end_date          AS endDate,
               e.created_at        AS createdAt,
               (SELECT COUNT(*) FROM responses r WHERE r.event_id = e.id) AS responses,
               (SELECT COUNT(*) FROM slots s
                  JOIN responses r ON r.id = s.response_id
                 WHERE r.event_id = e.id)                                 AS slots
          FROM events e
         ORDER BY e.created_at DESC, e.id
      `);
      return rows.map((row) => ({
        ...toPlain(row),
        // COUNT comes back as a number today, but the client's integer mode is
        // a setting rather than a promise; Number() costs nothing and means the
        // JSON never carries a bigint that res.json() cannot serialise.
        responses: Number(row.responses),
        slots: Number(row.slots),
      }));
    },

    async getEvent(id) {
      const client = await connect();
      const { rows } = await client.execute({
        sql: 'SELECT id, title, start_date AS startDate, end_date AS endDate FROM events WHERE id = ?',
        args: [id],
      });
      return toPlain(rows[0]);
    },

    /**
     * Save one person's availability. Submitting the same *email* again replaces
     * that person's previous answer; two people sharing a name are two people.
     *
     * The match also picks up a legacy row — one written before emails existed,
     * so carrying a NULL — with the same name, which is how someone who
     * answered before this column existed gets adopted rather than duplicated
     * the first time they come back.
     *
     * The slots are deleted explicitly rather than left to ON DELETE CASCADE:
     * the cascade is still in the schema, but whether foreign keys are enforced
     * is a per-connection property, and this way the old rows go regardless.
     */
    async saveResponse(eventId, name, email, slots) {
      const client = await connect();
      const transaction = await client.transaction('write');

      // Same predicate for both deletes, so the slots that go are exactly the
      // ones whose response goes.
      const mine = '(email = ? OR (email IS NULL AND name = ?))';
      const mineArgs = [eventId, email, name];

      try {
        await transaction.execute({
          sql: `DELETE FROM slots WHERE response_id IN (
                  SELECT id FROM responses WHERE event_id = ? AND ${mine}
                )`,
          args: mineArgs,
        });
        await transaction.execute({
          sql: `DELETE FROM responses WHERE event_id = ? AND ${mine}`,
          args: mineArgs,
        });

        const inserted = await transaction.execute({
          sql: 'INSERT INTO responses (event_id, name, email, created_at) VALUES (?, ?, ?, ?)',
          args: [eventId, name, email, new Date().toISOString()],
        });
        const responseId = Number(inserted.lastInsertRowid);

        // One statement rather than one per slot: over a network connection the
        // round trips are the cost. An event is capped at 92 days x 3 parts, so
        // this stays well inside SQLite's limit on bound variables.
        if (slots.length > 0) {
          await transaction.execute({
            sql: `INSERT INTO slots (response_id, date, part) VALUES ${slots
              .map(() => '(?, ?, ?)')
              .join(', ')}`,
            args: slots.flatMap(({ date, part }) => [responseId, date, part]),
          });
        }

        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    },

    /**
     * Participants plus one row per (person, date, part) they picked. Both
     * carry the email as well as the name, because the name alone no longer
     * identifies anybody — three Andys would otherwise be indistinguishable.
     *
     * Ordering by email after name keeps those three in a stable order between
     * requests rather than leaving it to the query planner.
     */
    async getResponses(eventId) {
      const client = await connect();
      const [participants, slots] = await Promise.all([
        client.execute({
          sql: `SELECT name, email FROM responses
                 WHERE event_id = ?
                 ORDER BY name COLLATE NOCASE, email COLLATE NOCASE`,
          args: [eventId],
        }),
        client.execute({
          sql: `SELECT r.name AS name, r.email AS email, s.date AS date, s.part AS part
                  FROM slots s
                  JOIN responses r ON r.id = s.response_id
                 WHERE r.event_id = ?
                 ORDER BY r.name COLLATE NOCASE, r.email COLLATE NOCASE, s.date, s.part`,
          args: [eventId],
        }),
      ]);

      return {
        participants: participants.rows.map(toPlain),
        slots: slots.rows.map(toPlain),
      };
    },

    /**
     * Change an event's title or dates.
     *
     * Shrinking the range is the interesting case: slots people already picked
     * can fall outside the new dates, and leaving them would put availability in
     * the database that `GET /results` cannot show — its grid only covers days
     * in range — so the same edit would read differently before and after the
     * next widening. They go in the same transaction as the update, and the
     * count comes back so the console can say how many answers it just cost.
     *
     * Dates are 'YYYY-MM-DD', where string order is date order, so a plain
     * comparison is the right one.
     */
    async updateEvent(id, { title, startDate, endDate }) {
      const client = await connect();
      const transaction = await client.transaction('write');
      try {
        await transaction.execute({
          sql: 'UPDATE events SET title = ?, start_date = ?, end_date = ? WHERE id = ?',
          args: [title, startDate, endDate, id],
        });
        const dropped = await transaction.execute({
          sql: `DELETE FROM slots
                 WHERE (date < ? OR date > ?)
                   AND response_id IN (SELECT id FROM responses WHERE event_id = ?)`,
          args: [startDate, endDate, id],
        });
        await transaction.commit();
        return { droppedSlots: Number(dropped.rowsAffected) };
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    },

    /**
     * Delete an event and everything hanging off it. The slots and responses go
     * explicitly, in dependency order, for the same reason saveResponse deletes
     * its own slots: whether foreign keys are enforced is a per-connection
     * property, so ON DELETE CASCADE is not something to rely on for a delete
     * that must not leave orphans behind.
     */
    async deleteEvent(id) {
      const client = await connect();
      const transaction = await client.transaction('write');
      try {
        await transaction.execute({
          sql: `DELETE FROM slots WHERE response_id IN (
                  SELECT id FROM responses WHERE event_id = ?
                )`,
          args: [id],
        });
        await transaction.execute({
          sql: 'DELETE FROM responses WHERE event_id = ?',
          args: [id],
        });
        await transaction.execute({ sql: 'DELETE FROM events WHERE id = ?', args: [id] });
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    },

    async close() {
      if (opening) (await opening).close();
    },
  };
}
