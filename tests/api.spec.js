// The API contract the pages depend on. These run without a browser page, so a
// failure here points at server.js or db.js rather than at the front end.

import { test, expect } from '@playwright/test';
import { PARTS, datesInRange, MAX_RANGE_DAYS } from '../public/dates.js';
import { WEEK, createEvent, submitResponse } from './helpers.js';

test.describe('creating an event', () => {
  test('returns an id', async ({ request }) => {
    const response = await request.post('/api/events', {
      data: { title: 'Summer BBQ', ...WEEK },
    });

    expect(response.status()).toBe(201);
    const { id } = await response.json();
    expect(id).toMatch(/^[\w-]+$/);
  });

  test('reads back the title and range it was given', async ({ request }) => {
    const { id } = await createEvent(request, { title: 'Band practice' });

    const event = await (await request.get(`/api/events/${id}`)).json();
    expect(event).toEqual({ id, title: 'Band practice', ...WEEK });
  });

  test('trims the title', async ({ request }) => {
    const { id } = await createEvent(request, { title: '  Padded  ' });
    const event = await (await request.get(`/api/events/${id}`)).json();
    expect(event.title).toBe('Padded');
  });

  test.describe('rejects bad input', () => {
    const cases = [
      ['a missing title', { title: '', ...WEEK }, /title is required/i],
      ['a whitespace-only title', { title: '   ', ...WEEK }, /title is required/i],
      [
        'an over-long title',
        { title: 'x'.repeat(101), ...WEEK },
        /100 characters or fewer/i,
      ],
      [
        'an end date before the start',
        { title: 'Backwards', startDate: '2026-08-20', endDate: '2026-08-19' },
        /cannot be before the start date/i,
      ],
      [
        'a date that is not a real day',
        { title: 'Impossible', startDate: '2026-02-30', endDate: '2026-03-01' },
        /must be a real date/i,
      ],
      [
        'a malformed date',
        { title: 'Malformed', startDate: 'tomorrow', endDate: '2026-08-20' },
        /must be a real date/i,
      ],
      [
        'a range longer than the maximum',
        { title: 'Forever', startDate: '2026-01-01', endDate: '2026-12-31' },
        new RegExp(`${MAX_RANGE_DAYS} days or fewer`, 'i'),
      ],
    ];

    for (const [name, data, message] of cases) {
      test(name, async ({ request }) => {
        const response = await request.post('/api/events', { data });
        expect(response.status()).toBe(400);
        expect((await response.json()).error).toMatch(message);
      });
    }
  });

  test('accepts a single-day event', async ({ request }) => {
    const { id } = await createEvent(request, {
      startDate: '2026-08-17',
      endDate: '2026-08-17',
    });
    const { grid } = await (await request.get(`/api/events/${id}/results`)).json();
    expect(Object.keys(grid)).toEqual(['2026-08-17']);
  });

  test('accepts a range of exactly the maximum length', async ({ request }) => {
    const response = await request.post('/api/events', {
      // 2026-01-01 plus 91 days is the 92nd day inclusive.
      data: { title: 'Long haul', startDate: '2026-01-01', endDate: '2026-04-02' },
    });
    expect(response.status()).toBe(201);
  });
});

test.describe('unknown routes', () => {
  test('an unknown event is a 404 with an explanation', async ({ request }) => {
    const response = await request.get('/api/events/nope-not-real');
    expect(response.status()).toBe(404);
    expect((await response.json()).error).toMatch(/does not exist/i);
  });

  test('an unknown API path is a JSON 404, not the static handler', async ({ request }) => {
    const response = await request.get('/api/nothing-here');
    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('application/json');
    expect((await response.json()).error).toMatch(/unknown api route/i);
  });

  test('unreadable JSON is a 400, not a 500', async ({ request }) => {
    const response = await request.post('/api/events', {
      headers: { 'Content-Type': 'application/json' },
      data: '{ not json',
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(/could not read that request as json/i);
  });
});

test.describe('recording availability', () => {
  test('saves the slots it was given', async ({ request }) => {
    const { id } = await createEvent(request);
    const body = await submitResponse(request, id, 'Andy', [
      ['2026-08-18', 'evening'],
      ['2026-08-19', 'morning'],
    ]);

    expect(body).toMatchObject({ ok: true, name: 'Andy', saved: 2 });
  });

  test('drops duplicate slots rather than double-counting', async ({ request }) => {
    const { id } = await createEvent(request);
    const body = await submitResponse(request, id, 'Andy', [
      ['2026-08-18', 'evening'],
      ['2026-08-18', 'evening'],
    ]);

    expect(body.saved).toBe(1);
    const { grid } = await (await request.get(`/api/events/${id}/results`)).json();
    expect(grid['2026-08-18'].evening).toEqual(['Andy']);
  });

  test('accepts someone who can make nothing', async ({ request }) => {
    const { id } = await createEvent(request);
    await submitResponse(request, id, 'Busy Bob', []);

    const { participants, grid } = await (
      await request.get(`/api/events/${id}/results`)
    ).json();
    expect(participants).toEqual(['Busy Bob']);
    expect(grid['2026-08-18'].evening).toEqual([]);
  });

  test('replaces an earlier answer from the same person', async ({ request }) => {
    const { id } = await createEvent(request);
    await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);
    await submitResponse(request, id, 'Andy', [['2026-08-20', 'morning']]);

    const { participants, grid } = await (
      await request.get(`/api/events/${id}/results`)
    ).json();
    expect(participants).toEqual(['Andy']);
    expect(grid['2026-08-18'].evening).toEqual([]);
    expect(grid['2026-08-20'].morning).toEqual(['Andy']);
  });

  test('matches names case-insensitively, so "andy" updates "Andy"', async ({ request }) => {
    const { id } = await createEvent(request);
    await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);
    await submitResponse(request, id, 'andy', [['2026-08-19', 'evening']]);

    const { participants } = await (await request.get(`/api/events/${id}/results`)).json();
    expect(participants).toEqual(['andy']);
  });

  test.describe('rejects bad input', () => {
    test('a missing name', async ({ request }) => {
      const { id } = await createEvent(request);
      const response = await request.post(`/api/events/${id}/responses`, {
        data: { name: '  ', slots: [] },
      });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toMatch(/your name is required/i);
    });

    test('an over-long name', async ({ request }) => {
      const { id } = await createEvent(request);
      const response = await request.post(`/api/events/${id}/responses`, {
        data: { name: 'x'.repeat(51), slots: [] },
      });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toMatch(/50 characters or fewer/i);
    });

    test('slots that are not a list', async ({ request }) => {
      const { id } = await createEvent(request);
      const response = await request.post(`/api/events/${id}/responses`, {
        data: { name: 'Andy', slots: 'evening' },
      });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toMatch(/slots must be a list/i);
    });

    test('a date outside the event range', async ({ request }) => {
      const { id } = await createEvent(request);
      const response = await request.post(`/api/events/${id}/responses`, {
        data: { name: 'Andy', slots: [{ date: '2026-09-01', part: 'evening' }] },
      });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toMatch(/outside this event's dates/i);
    });

    test('a part of the day that does not exist', async ({ request }) => {
      const { id } = await createEvent(request);
      const response = await request.post(`/api/events/${id}/responses`, {
        data: { name: 'Andy', slots: [{ date: '2026-08-18', part: 'midnight' }] },
      });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toMatch(/not a valid part of the day/i);
    });

    test('a response to an event that does not exist', async ({ request }) => {
      const response = await request.post('/api/events/no-such-event/responses', {
        data: { name: 'Andy', slots: [] },
      });
      expect(response.status()).toBe(404);
    });
  });

  test('a rejected submission changes nothing', async ({ request }) => {
    const { id } = await createEvent(request);
    await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);

    await request.post(`/api/events/${id}/responses`, {
      data: { name: 'Andy', slots: [{ date: '2026-08-19', part: 'lunchtime' }] },
    });

    // The valid earlier answer must survive the failed one.
    const { grid } = await (await request.get(`/api/events/${id}/results`)).json();
    expect(grid['2026-08-18'].evening).toEqual(['Andy']);
  });
});

test.describe('the results grid', () => {
  test('covers every day and part, with empty slots as empty arrays', async ({ request }) => {
    const { id } = await createEvent(request);
    const { grid } = await (await request.get(`/api/events/${id}/results`)).json();

    const expectedDates = datesInRange(WEEK.startDate, WEEK.endDate);
    expect(Object.keys(grid)).toEqual(expectedDates);
    for (const date of expectedDates) {
      expect(Object.keys(grid[date])).toEqual(PARTS);
      for (const part of PARTS) {
        expect(Array.isArray(grid[date][part])).toBe(true);
      }
    }
  });

  test('lists participants and names alphabetically, ignoring case', async ({ request }) => {
    const { id } = await createEvent(request);
    await submitResponse(request, id, 'zoe', [['2026-08-18', 'evening']]);
    await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);
    await submitResponse(request, id, 'mia', [['2026-08-18', 'evening']]);

    const { participants, grid } = await (
      await request.get(`/api/events/${id}/results`)
    ).json();
    expect(participants).toEqual(['Andy', 'mia', 'zoe']);
    expect(grid['2026-08-18'].evening).toEqual(['Andy', 'mia', 'zoe']);
  });

  test('is empty for an event nobody has answered', async ({ request }) => {
    const { id } = await createEvent(request);
    const { participants, grid } = await (
      await request.get(`/api/events/${id}/results`)
    ).json();

    expect(participants).toEqual([]);
    expect(Object.values(grid).every((day) => PARTS.every((p) => day[p].length === 0))).toBe(
      true,
    );
  });

  test('keeps events apart', async ({ request }) => {
    const first = await createEvent(request, { title: 'First' });
    const second = await createEvent(request, { title: 'Second' });
    await submitResponse(request, first.id, 'Andy', [['2026-08-18', 'evening']]);

    const results = await (await request.get(`/api/events/${second.id}/results`)).json();
    expect(results.participants).toEqual([]);
  });
});
