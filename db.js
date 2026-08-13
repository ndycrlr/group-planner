// SQLite storage, using Node's built-in `node:sqlite` (Node 22.5+).
// Built in means no native module to compile, so `npm install` only pulls Express.

import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

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

export function createStore(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  const statements = {
    insertEvent: db.prepare(
      'INSERT INTO events (id, title, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?)',
    ),
    selectEvent: db.prepare(
      'SELECT id, title, start_date AS startDate, end_date AS endDate FROM events WHERE id = ?',
    ),
    deleteResponse: db.prepare('DELETE FROM responses WHERE event_id = ? AND name = ?'),
    insertResponse: db.prepare(
      'INSERT INTO responses (event_id, name, created_at) VALUES (?, ?, ?)',
    ),
    insertSlot: db.prepare(
      'INSERT INTO slots (response_id, date, part) VALUES (?, ?, ?)',
    ),
    selectParticipants: db.prepare(
      'SELECT name FROM responses WHERE event_id = ? ORDER BY name COLLATE NOCASE',
    ),
    selectSlots: db.prepare(`
      SELECT r.name AS name, s.date AS date, s.part AS part
        FROM slots s
        JOIN responses r ON r.id = s.response_id
       WHERE r.event_id = ?
       ORDER BY r.name COLLATE NOCASE, s.date, s.part
    `),
  };

  /** Run `work` in a transaction, rolling back if it throws. */
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    createEvent({ title, startDate, endDate }) {
      // Retry on the vanishingly unlikely id collision rather than 500ing.
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = newEventId();
        try {
          statements.insertEvent.run(id, title, startDate, endDate, new Date().toISOString());
          return id;
        } catch (error) {
          if (!String(error.message).includes('UNIQUE')) throw error;
        }
      }
      throw new Error('Could not allocate an event id.');
    },

    getEvent(id) {
      return statements.selectEvent.get(id);
    },

    /**
     * Save one person's availability. Submitting the same name again replaces
     * their previous answer instead of adding a duplicate: the old row is
     * deleted and its slots go with it via ON DELETE CASCADE.
     */
    saveResponse(eventId, name, slots) {
      transaction(() => {
        statements.deleteResponse.run(eventId, name);
        const { lastInsertRowid } = statements.insertResponse.run(
          eventId,
          name,
          new Date().toISOString(),
        );
        const responseId = Number(lastInsertRowid);
        for (const { date, part } of slots) {
          statements.insertSlot.run(responseId, date, part);
        }
      });
    },

    /** Participant names plus one row per (name, date, part) they picked. */
    getResponses(eventId) {
      return {
        participants: statements.selectParticipants.all(eventId).map((row) => row.name),
        slots: statements.selectSlots.all(eventId),
      };
    },

    close() {
      db.close();
    },
  };
}
