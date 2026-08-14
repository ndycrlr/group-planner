// The payoff screen, including the light-meter grid: hue is the part of the day,
// brightness is how much of the group is free.

import { test, expect } from '@playwright/test';
import {
  FORTNIGHT,
  createEvent,
  submitResponse,
  resultCell,
  monthDayCell,
  litValue,
} from './helpers.js';

/** An event with a clear winner: everyone can do Wednesday evening. */
async function eventWithReplies(request) {
  const { id } = await createEvent(request, { title: 'Five-a-side' });
  await submitResponse(request, id, 'Andy', [
    ['2026-08-18', 'evening'],
    ['2026-08-19', 'evening'],
  ]);
  await submitResponse(request, id, 'Priya', [
    ['2026-08-19', 'evening'],
    ['2026-08-20', 'evening'],
  ]);
  await submitResponse(request, id, 'Tom', [['2026-08-19', 'evening']]);
  return id;
}

test('says so when nobody has replied', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/results.html?id=${id}`);

  await expect(page.locator('#empty')).toHaveText(/nobody has replied yet/i);
  await expect(page.locator('#peopleCount')).toHaveText('0 people have replied');
  await expect(page.locator('#best')).toBeEmpty();
  // With no replies, nothing may be highlighted as unanimous.
  await expect(page.locator('.cell.all-available')).toHaveCount(0);
});

test('counts one reply in the singular', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);
  await page.goto(`/results.html?id=${id}`);

  await expect(page.locator('#peopleCount')).toHaveText('1 person has replied');
});

test('lists everyone who replied', async ({ page, request }) => {
  const id = await eventWithReplies(request);
  await page.goto(`/results.html?id=${id}`);

  await expect(page.locator('#peopleCount')).toHaveText('3 people have replied');
  await expect(page.locator('#people .person-name')).toHaveText(['Andy', 'Priya', 'Tom']);
  // The address is shown beside the name — it is what separates two Andys.
  await expect(page.locator('#people .person-email')).toHaveText([
    'andy@example.test',
    'priya@example.test',
    'tom@example.test',
  ]);
});

test('shows the count in each slot, and the names on hover', async ({ page, request }) => {
  const id = await eventWithReplies(request);
  await page.goto(`/results.html?id=${id}`);

  // The cell itself carries only the count — the grid is scanned, not read.
  const busy = resultCell(page, '2026-08-19', 'evening');
  await expect(busy.locator('.count')).toContainText('3/3');
  await expect(busy).toHaveAttribute('title', /Wed 19 Aug evening — Andy, Priya, Tom/);

  const quiet = resultCell(page, '2026-08-18', 'evening');
  await expect(quiet.locator('.count')).toContainText('1/3');
  await expect(quiet).toHaveAttribute('title', /Tue 18 Aug evening — Andy/);

  const empty = resultCell(page, '2026-08-17', 'morning');
  await expect(empty.locator('.none')).toHaveText('—');
  // Nothing to reveal, so no tooltip and no hover affordance.
  await expect(empty).not.toHaveAttribute('title', /./);
  await expect(empty).not.toHaveClass(/has-names/);
});

test('no slot spells its names out in the grid', async ({ page, request }) => {
  const id = await eventWithReplies(request);
  await page.goto(`/results.html?id=${id}`);

  // Names in every cell buried the thing the grid is for: spotting the bright
  // slots. They belong to one slot at a time, on demand.
  await expect(page.locator('.cell ul.names')).toHaveCount(0);
  await expect(page.locator('#grid')).not.toContainText('Priya');
});

test('marks the slot everyone can make', async ({ page, request }) => {
  const id = await eventWithReplies(request);
  await page.goto(`/results.html?id=${id}`);

  const winner = resultCell(page, '2026-08-19', 'evening');
  await expect(winner).toHaveClass(/all-available/);
  // Brightness is not the only signal — the count carries a ✓ too.
  await expect(winner.locator('.count')).toContainText('✓ all');

  await expect(page.locator('#best')).toHaveText(/everyone is free: Wed 19 Aug evening/i);
  await expect(page.locator('.cell.all-available')).toHaveCount(1);
});

test('says when no slot works for everyone', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);
  await submitResponse(request, id, 'Priya', [['2026-08-20', 'morning']]);
  await page.goto(`/results.html?id=${id}`);

  await expect(page.locator('#best')).toHaveText(/no slot works for everyone yet/i);
  await expect(page.locator('.cell.all-available')).toHaveCount(0);
});

test.describe('the light meter', () => {
  test('a slot is lit in proportion to how many are free', async ({ page, request }) => {
    const id = await eventWithReplies(request);
    await page.goto(`/results.html?id=${id}`);

    expect(await litValue(resultCell(page, '2026-08-19', 'evening'))).toBe(1);
    expect(await litValue(resultCell(page, '2026-08-20', 'evening'))).toBeCloseTo(1 / 3, 5);
    expect(await litValue(resultCell(page, '2026-08-17', 'morning'))).toBe(0);
  });

  test('nothing is lit before anyone replies', async ({ page, request }) => {
    const { id } = await createEvent(request);
    await page.goto(`/results.html?id=${id}`);

    expect(await litValue(resultCell(page, '2026-08-19', 'evening'))).toBe(0);
  });

  test('each part of the day carries its own colour', async ({ page, request }) => {
    const { id } = await createEvent(request);
    await page.goto(`/results.html?id=${id}`);

    const hues = await Promise.all(
      ['morning', 'afternoon', 'evening'].map((part) =>
        page
          .locator(`td.slot[data-part="${part}"]`)
          .first()
          .evaluate((node) => getComputedStyle(node).getPropertyValue('--hue').trim()),
      ),
    );

    expect(new Set(hues).size, `expected three distinct hues, got ${hues}`).toBe(3);
    expect(hues.every(Boolean)).toBe(true);
  });
});

test.describe('list and month views', () => {
  test('a week opens as a list', async ({ page, request }) => {
    const { id } = await createEvent(request);
    await page.goto(`/results.html?id=${id}`);

    await expect(page.locator('table.grid')).toBeVisible();
    await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('a longer range opens as a month', async ({ page, request }) => {
    const { id } = await createEvent(request, FORTNIGHT);
    await page.goto(`/results.html?id=${id}`);

    await expect(page.locator('.month-grid')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Month' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('the toggle switches views and is remembered', async ({ page, request }) => {
    const { id } = await createEvent(request);
    await page.goto(`/results.html?id=${id}`);

    await page.getByRole('button', { name: 'Month' }).click();
    await expect(page.locator('.month-grid')).toBeVisible();
    await expect(page.locator('table.grid')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.month-grid')).toBeVisible();
  });

  test('month view keeps the counts and greys days outside the range', async ({
    page,
    request,
  }) => {
    const id = await eventWithReplies(request);
    await page.goto(`/results.html?id=${id}`);
    await page.getByRole('button', { name: 'Month' }).click();

    const winner = monthDayCell(page, '2026-08-19').locator('.cell').nth(2);
    await expect(winner).toHaveClass(/all-available/);
    await expect(winner.locator('.count')).toContainText('3/3');

    // 10 August is in the same month but outside the event's own week.
    const outside = monthDayCell(page, '2026-08-10');
    await expect(outside).toHaveClass(/out/);
    await expect(outside.locator('.cell')).toHaveCount(0);
  });

  test('month strips put the names in a tooltip too', async ({ page, request }) => {
    const id = await eventWithReplies(request);
    await page.goto(`/results.html?id=${id}`);
    await page.getByRole('button', { name: 'Month' }).click();

    const strip = monthDayCell(page, '2026-08-19').locator('.cell').nth(2);
    await expect(strip).toHaveAttribute('title', /Andy, Priya, Tom/);
  });
});

test('refresh picks up a reply that arrived since loading', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/results.html?id=${id}`);
  await expect(page.locator('#peopleCount')).toHaveText('0 people have replied');

  await submitResponse(request, id, 'Latecomer', [['2026-08-18', 'evening']]);
  await page.getByRole('button', { name: 'Refresh' }).click();

  await expect(page.locator('#peopleCount')).toHaveText('1 person has replied');
  await expect(resultCell(page, '2026-08-18', 'evening')).toHaveAttribute(
    'title',
    /Tue 18 Aug evening — Latecomer/,
  );
});

test('links back to the availability page for the same event', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/results.html?id=${id}`);

  await page.getByRole('link', { name: /add or change your availability/i }).click();
  await expect(page).toHaveURL(new RegExp(`event\\.html\\?id=${id}`));
});

test.describe('broken links', () => {
  test('a link with no id explains itself', async ({ page }) => {
    await page.goto('/results.html');

    await expect(page.getByRole('heading', { name: 'Event not found' })).toBeVisible();
    await expect(page.locator('#error')).toHaveText(/missing an event id/i);
  });

  test('an unknown id shows the server message', async ({ page }) => {
    await page.goto('/results.html?id=definitely-not-real');

    await expect(page.locator('#error')).toHaveText(/does not exist/i);
  });
});
