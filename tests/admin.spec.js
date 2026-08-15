// The admin console: the one part of the app that can see past the links.
//
// Every event is readable by anyone holding its id, so a route that *lists* the
// ids is a different kind of thing entirely — most of what follows is about the
// password rather than about the editing.
//
// The list is global, so these tests never assert on how many events exist:
// other workers are creating and deleting their own at the same time. Each one
// finds its own event by id.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD } from '../playwright.config.js';
import { WEEK, createEvent, submitResponse, namesOf } from './helpers.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const auth = { 'x-admin-password': ADMIN_PASSWORD };

/** The listed entry for one event, or undefined if it is not there. */
async function findEvent(request, id) {
  const response = await request.get('/api/admin/events', { headers: auth });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { events } = await response.json();
  return events.find((event) => event.id === id);
}

test.describe('the password', () => {
  const routes = [
    ['GET', '/api/admin/events'],
    ['POST', '/api/admin/session'],
    ['PATCH', '/api/admin/events/anything'],
    ['DELETE', '/api/admin/events/anything'],
  ];

  for (const [method, path] of routes) {
    test(`${method} ${path} refuses a request with no password`, async ({ request }) => {
      const response = await request.fetch(path, { method });
      expect(response.status()).toBe(401);
      expect((await response.json()).error).toMatch(/admin password is not right/i);
    });

    test(`${method} ${path} refuses the wrong password`, async ({ request }) => {
      const response = await request.fetch(path, {
        method,
        headers: { 'x-admin-password': 'not-the-password' },
      });
      expect(response.status()).toBe(401);
    });
  }

  // Surrounding whitespace is deliberately not among these: HTTP trims header
  // values in transit, so " password " arrives as "password" and could never be
  // told apart. That is also why an ADMIN_PASSWORD should not start or end with
  // a space — it would be untypable rather than merely awkward.
  test('a near miss is still a miss', async ({ request }) => {
    const wrongOnes = [
      ADMIN_PASSWORD.slice(0, -1),
      `${ADMIN_PASSWORD}x`,
      ADMIN_PASSWORD.toUpperCase(),
      '',
    ];
    for (const wrong of wrongOnes) {
      const response = await request.get('/api/admin/events', {
        headers: { 'x-admin-password': wrong },
      });
      expect(response.status(), `should have rejected "${wrong}"`).toBe(401);
    }
  });

  test('the right password opens a session', async ({ request }) => {
    const response = await request.post('/api/admin/session', { headers: auth, data: {} });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test('a refused request never says what it was refused', async ({ request }) => {
    const { id } = await createEvent(request, { title: 'Should stay hidden' });
    const response = await request.get('/api/admin/events');

    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain(id);
  });
});

test.describe('listing events', () => {
  test('includes an event that was just created', async ({ request }) => {
    const { id } = await createEvent(request, { title: 'Listed event' });

    const listed = await findEvent(request, id);
    expect(listed).toMatchObject({ id, title: 'Listed event', ...WEEK, responses: 0, slots: 0 });
    expect(listed.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('counts the people who answered and the slots they picked', async ({ request }) => {
    const { id } = await createEvent(request);
    await submitResponse(request, id, 'Andy', [
      ['2026-08-18', 'evening'],
      ['2026-08-19', 'morning'],
    ]);
    await submitResponse(request, id, 'Mia', [['2026-08-18', 'evening']]);

    expect(await findEvent(request, id)).toMatchObject({ responses: 2, slots: 3 });
  });

  test('counts a second answer from one person once', async ({ request }) => {
    const { id } = await createEvent(request);
    await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);
    await submitResponse(request, id, 'Andy', [['2026-08-19', 'morning']]);

    expect(await findEvent(request, id)).toMatchObject({ responses: 1, slots: 1 });
  });
});

test.describe('editing an event', () => {
  test('changes the title', async ({ request }) => {
    const { id } = await createEvent(request, { title: 'Before' });

    const response = await request.patch(`/api/admin/events/${id}`, {
      headers: auth,
      data: { title: 'After' },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).event).toEqual({ id, title: 'After', ...WEEK });

    const event = await (await request.get(`/api/events/${id}`)).json();
    expect(event.title).toBe('After');
  });

  test('leaves the dates alone when only the title is sent', async ({ request }) => {
    const { id } = await createEvent(request, { title: 'Dates untouched' });
    await request.patch(`/api/admin/events/${id}`, { headers: auth, data: { title: 'Renamed' } });

    const event = await (await request.get(`/api/events/${id}`)).json();
    expect(event).toMatchObject(WEEK);
  });

  test('moves the dates, and the results grid follows', async ({ request }) => {
    const { id } = await createEvent(request);

    await request.patch(`/api/admin/events/${id}`, {
      headers: auth,
      data: { title: 'Moved', startDate: '2026-09-01', endDate: '2026-09-03' },
    });

    const { grid } = await (await request.get(`/api/events/${id}/results`)).json();
    expect(Object.keys(grid)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  test('drops availability that falls outside a shrunken range', async ({ request }) => {
    const { id } = await createEvent(request);
    await submitResponse(request, id, 'Andy', [
      ['2026-08-17', 'morning'], // before the new range
      ['2026-08-19', 'evening'], // inside it
      ['2026-08-23', 'morning'], // after it
    ]);

    const response = await request.patch(`/api/admin/events/${id}`, {
      headers: auth,
      data: { title: 'Shorter', startDate: '2026-08-18', endDate: '2026-08-20' },
    });
    // Availability the grid can no longer show must not linger in the database,
    // or widening the range again would resurrect answers nobody re-gave.
    expect((await response.json()).droppedSlots).toBe(2);

    const { participants, grid } = await (
      await request.get(`/api/events/${id}/results`)
    ).json();
    expect(namesOf(participants)).toEqual(['Andy']);
    expect(namesOf(grid['2026-08-19'].evening)).toEqual(['Andy']);
    expect(await findEvent(request, id)).toMatchObject({ responses: 1, slots: 1 });
  });

  test.describe('rejects bad input', () => {
    const cases = [
      ['a missing title', { title: '   ' }, /title is required/i],
      ['an over-long title', { title: 'x'.repeat(101) }, /100 characters or fewer/i],
      [
        'an end date before the start',
        { title: 'Backwards', startDate: '2026-08-20', endDate: '2026-08-19' },
        /cannot be before the start date/i,
      ],
      [
        'a range past the maximum',
        { title: 'Forever', startDate: '2026-01-01', endDate: '2026-12-31' },
        /days or fewer/i,
      ],
      [
        'a date that is not a real day',
        { title: 'Impossible', startDate: '2026-02-30', endDate: '2026-03-01' },
        /must be a real date/i,
      ],
    ];

    for (const [name, data, message] of cases) {
      test(name, async ({ request }) => {
        const { id } = await createEvent(request, { title: 'Unchanged' });
        const response = await request.patch(`/api/admin/events/${id}`, { headers: auth, data });

        expect(response.status()).toBe(400);
        expect((await response.json()).error).toMatch(message);

        const event = await (await request.get(`/api/events/${id}`)).json();
        expect(event).toMatchObject({ title: 'Unchanged', ...WEEK });
      });
    }
  });

  test('an event that does not exist is a 404', async ({ request }) => {
    const response = await request.patch('/api/admin/events/no-such-event', {
      headers: auth,
      data: { title: 'Ghost' },
    });
    expect(response.status()).toBe(404);
  });
});

test.describe('deleting an event', () => {
  test('takes the event and every answer with it', async ({ request }) => {
    const { id } = await createEvent(request);
    await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);

    const response = await request.delete(`/api/admin/events/${id}`, { headers: auth });
    expect(response.status()).toBe(200);

    expect((await request.get(`/api/events/${id}`)).status()).toBe(404);
    expect((await request.get(`/api/events/${id}/results`)).status()).toBe(404);
    expect(await findEvent(request, id)).toBeUndefined();
  });

  test('leaves other events alone', async ({ request }) => {
    const doomed = await createEvent(request, { title: 'Doomed' });
    const keeper = await createEvent(request, { title: 'Keeper' });
    await submitResponse(request, keeper.id, 'Andy', [['2026-08-18', 'evening']]);

    await request.delete(`/api/admin/events/${doomed.id}`, { headers: auth });

    const { participants } = await (
      await request.get(`/api/events/${keeper.id}/results`)
    ).json();
    expect(namesOf(participants)).toEqual(['Andy']);
    expect(await findEvent(request, keeper.id)).toMatchObject({ responses: 1, slots: 1 });
  });

  test('an event that does not exist is a 404', async ({ request }) => {
    const response = await request.delete('/api/admin/events/no-such-event', { headers: auth });
    expect(response.status()).toBe(404);
  });
});

test.describe('the console page', () => {
  /** The row for one event, found by the title it is showing. */
  function rowFor(page, title) {
    return page.locator('.event-row').filter({ has: page.getByText(title, { exact: true }) });
  }

  async function unlock(page, password = ADMIN_PASSWORD) {
    await page.goto('/admin.html');
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  }

  test('shows nothing until the password is right', async ({ page }) => {
    await unlock(page, 'wrong-password');

    await expect(page.locator('#lockStatus')).toHaveText(/not right/i);
    await expect(page.locator('#eventsCard')).toBeHidden();
    await expect(page.locator('.event-row')).toHaveCount(0);
  });

  test('lists an event once unlocked', async ({ page, request }) => {
    const title = `Console listing ${Date.now()}`;
    const { id } = await createEvent(request, { title });
    await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);

    await unlock(page);

    const row = rowFor(page, title);
    await expect(row).toBeVisible();
    await expect(row).toContainText('1 person');
    await expect(row).toContainText(id);
    await expect(row.getByRole('link', { name: /results/i })).toHaveAttribute(
      'href',
      `./results.html?id=${id}`,
    );
  });

  test('renames an event', async ({ page, request }) => {
    const title = `Console rename ${Date.now()}`;
    const { id } = await createEvent(request, { title });

    await unlock(page);
    const row = rowFor(page, title);
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await row.getByLabel('Title').fill('Renamed in the console');
    await row.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(rowFor(page, 'Renamed in the console')).toBeVisible();
    const event = await (await request.get(`/api/events/${id}`)).json();
    expect(event.title).toBe('Renamed in the console');
  });

  test('will not save an impossible range', async ({ page, request }) => {
    const title = `Console bad range ${Date.now()}`;
    const { id } = await createEvent(request, { title });

    await unlock(page);
    const row = rowFor(page, title);
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await row.getByLabel('Last day').fill('2026-08-01');
    await row.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(row.locator('.status')).toHaveText(/cannot be before the start date/i);
    const event = await (await request.get(`/api/events/${id}`)).json();
    expect(event).toMatchObject(WEEK);
  });

  test('deletes an event, but only after a confirmation', async ({ page, request }) => {
    const title = `Console delete ${Date.now()}`;
    const { id } = await createEvent(request, { title });
    await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);

    await unlock(page);
    const row = rowFor(page, title);
    await row.getByRole('button', { name: 'Delete', exact: true }).click();

    // The first click only asks — the event is still there, and the warning has
    // to say what the second click would cost.
    await expect(row).toContainText(/1 person answered/i);
    expect((await request.get(`/api/events/${id}`)).status()).toBe(200);

    await row.getByRole('button', { name: 'Keep it', exact: true }).click();
    await expect(row).not.toContainText(/permanent/i);
    expect((await request.get(`/api/events/${id}`)).status()).toBe(200);

    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await row.getByRole('button', { name: 'Yes, delete it', exact: true }).click();

    await expect(rowFor(page, title)).toHaveCount(0);
    expect((await request.get(`/api/events/${id}`)).status()).toBe(404);
  });

  test('stays unlocked across a reload, and locks on request', async ({ page, request }) => {
    const title = `Console reload ${Date.now()}`;
    await createEvent(request, { title });

    await unlock(page);
    await expect(rowFor(page, title)).toBeVisible();

    await page.reload();
    await expect(rowFor(page, title)).toBeVisible();

    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.locator('#eventsCard')).toBeHidden();

    // Locking clears the remembered password, so a reload asks again.
    await page.reload();
    await expect(page.locator('#lockCard')).toBeVisible();
    await expect(page.locator('.event-row')).toHaveCount(0);
  });
});

// The shared test server always has a password, so the unconfigured case needs a
// server of its own. It is the property most worth pinning down: a deployment
// that forgot to set ADMIN_PASSWORD must have *no* admin console rather than an
// open one, and the difference between those two is one `if` in requireAdmin.
test.describe('with no password configured', () => {
  // Serial, so both tests share one worker and so one server: the suite is
  // otherwise fully parallel, beforeAll runs once per worker, and two workers
  // would race for the same port and leave one of them talking to a dead one.
  test.describe.configure({ mode: 'serial' });

  const PORT = Number(process.env.TEST_PORT || 3210) + 1;
  let server;

  test.beforeAll(async () => {
    const env = {
      ...process.env,
      PORT: String(PORT),
      PLANNER_DB: path.join(root, '.test-tmp', 'admin-off.db'),
    };
    delete env.ADMIN_PASSWORD;

    server = spawn(process.execPath, [path.join(root, 'start.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the server did not start')), 15_000);
      const settle = (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      server.stdout.on('data', (chunk) => {
        if (String(chunk).includes('running at')) settle();
      });
      server.on('error', settle);
      // A port already taken kills the process instead of raising here, and
      // waiting fifteen seconds to say so helps nobody.
      server.on('exit', (code) => settle(new Error(`the server exited with code ${code}`)));
    });
  });

  test.afterAll(() => {
    server?.kill();
  });

  test('every admin route is off, whatever password is offered', async () => {
    for (const password of [undefined, '', 'anything', ADMIN_PASSWORD]) {
      const response = await fetch(`http://localhost:${PORT}/api/admin/events`, {
        headers: password === undefined ? {} : { 'x-admin-password': password },
      });
      expect(response.status, `offered "${password}"`).toBe(503);
      expect((await response.json()).error).toMatch(/not configured/i);
    }
  });

  test('the rest of the app is unaffected', async () => {
    const response = await fetch(`http://localhost:${PORT}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No admin here', ...WEEK }),
    });
    expect(response.status).toBe(201);
  });
});
