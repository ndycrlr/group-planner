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
    -- COLLATE NOCASE makes the UNIQUE constraint case-insensitive, so "andy"
    -- updates "Andy" rather than creating a second participant.
    name       TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE(event_id, name)
  );

  CREATE TABLE IF NOT EXISTS slots (
    response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    part        TEXT NOT NULL,
    PRIMARY KEY (response_id, date, part)
  );

  CREATE INDEX IF NOT EXISTS idx_responses_event ON responses(event_id);
`;

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

    async getEvent(id) {
      const client = await connect();
      const { rows } = await client.execute({
        sql: 'SELECT id, title, start_date AS startDate, end_date AS endDate FROM events WHERE id = ?',
        args: [id],
      });
      return toPlain(rows[0]);
    },

    /**
     * Save one person's availability. Submitting the same name again replaces
     * their previous answer instead of adding a duplicate.
     *
     * The slots are deleted explicitly rather than left to ON DELETE CASCADE:
     * the cascade is still in the schema, but whether foreign keys are enforced
     * is a per-connection property, and this way the old rows go regardless.
     */
    async saveResponse(eventId, name, slots) {
      const client = await connect();
      const transaction = await client.transaction('write');

      try {
        await transaction.execute({
          sql: `DELETE FROM slots WHERE response_id IN (
                  SELECT id FROM responses WHERE event_id = ? AND name = ?
                )`,
          args: [eventId, name],
        });
        await transaction.execute({
          sql: 'DELETE FROM responses WHERE event_id = ? AND name = ?',
          args: [eventId, name],
        });

        const inserted = await transaction.execute({
          sql: 'INSERT INTO responses (event_id, name, created_at) VALUES (?, ?, ?)',
          args: [eventId, name, new Date().toISOString()],
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

    /** Participant names plus one row per (name, date, part) they picked. */
    async getResponses(eventId) {
      const client = await connect();
      const [participants, slots] = await Promise.all([
        client.execute({
          sql: 'SELECT name FROM responses WHERE event_id = ? ORDER BY name COLLATE NOCASE',
          args: [eventId],
        }),
        client.execute({
          sql: `SELECT r.name AS name, s.date AS date, s.part AS part
                  FROM slots s
                  JOIN responses r ON r.id = s.response_id
                 WHERE r.event_id = ?
                 ORDER BY r.name COLLATE NOCASE, s.date, s.part`,
          args: [eventId],
        }),
      ]);

      return {
        participants: participants.rows.map((row) => row.name),
        slots: slots.rows.map(toPlain),
      };
    },

    async close() {
      if (opening) (await opening).close();
    },
  };
}
