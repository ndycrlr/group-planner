// Picking your slots: the screen everyone in the group actually touches.

import { test, expect } from '@playwright/test';
import { createEvent, pickButton, dragAcross, monthDayCell, namesOf } from './helpers.js';

test('shows the event and how many days are on offer', async ({ page, request }) => {
  const { id } = await createEvent(request, { title: 'Five-a-side' });
  await page.goto(`/event.html?id=${id}`);

  await expect(page.getByRole('heading', { name: 'Five-a-side' })).toBeVisible();
  await expect(page.locator('#range')).toHaveText('7 days to choose from');
  await expect(page).toHaveTitle(/Five-a-side/);
});

test('a slot toggles on and off', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  const slot = pickButton(page, '2026-08-18', 'evening');
  await expect(slot).toHaveAttribute('aria-pressed', 'false');

  await slot.click();
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await expect(slot).toHaveText('✓ Available');

  await slot.click();
  await expect(slot).toHaveAttribute('aria-pressed', 'false');
  await expect(slot).toHaveText('Evening');
});

test('dragging paints a run of slots in one go', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  const run = [
    pickButton(page, '2026-08-17', 'evening'),
    pickButton(page, '2026-08-18', 'evening'),
    pickButton(page, '2026-08-19', 'evening'),
  ];
  await dragAcross(page, run);

  for (const slot of run) {
    await expect(slot).toHaveAttribute('aria-pressed', 'true');
  }
  // The drag must not leak into the slot below the one it stopped on.
  await expect(pickButton(page, '2026-08-20', 'evening')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('dragging from a selected slot clears the run instead', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  const run = [
    pickButton(page, '2026-08-17', 'morning'),
    pickButton(page, '2026-08-18', 'morning'),
  ];
  await dragAcross(page, run);
  await expect(run[0]).toHaveAttribute('aria-pressed', 'true');

  await dragAcross(page, run);
  for (const slot of run) {
    await expect(slot).toHaveAttribute('aria-pressed', 'false');
  }
});

test('the keyboard can toggle a slot', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  const slot = pickButton(page, '2026-08-19', 'afternoon');
  await slot.focus();
  await page.keyboard.press('Space');
  await expect(slot).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Enter');
  await expect(slot).toHaveAttribute('aria-pressed', 'false');
});

test('submits and confirms what was saved', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  await page.fill('#name', 'Andy');
  await page.fill('#email', 'andy@example.test');
  await pickButton(page, '2026-08-18', 'evening').click();
  await pickButton(page, '2026-08-19', 'evening').click();
  await page.getByRole('button', { name: 'Submit availability' }).click();

  await expect(page.locator('#status')).toHaveText(/thanks, Andy!.*2 slots/i);

  const { participants, grid } = await (await request.get(`/api/events/${id}/results`)).json();
  expect(participants).toEqual([{ name: 'Andy', email: 'andy@example.test' }]);
  expect(namesOf(grid['2026-08-18'].evening)).toEqual(['Andy']);
});

test('submitting nothing is a valid answer', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  await page.fill('#name', 'Busy Bob');
  await page.fill('#email', 'bob@example.test');
  await page.getByRole('button', { name: 'Submit availability' }).click();

  await expect(page.locator('#status')).toHaveText(/can't make any of these/i);
  const { participants } = await (await request.get(`/api/events/${id}/results`)).json();
  expect(namesOf(participants)).toEqual(['Busy Bob']);
});

test('asks for a name before submitting', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  await pickButton(page, '2026-08-18', 'evening').click();
  await page.getByRole('button', { name: 'Submit availability' }).click();

  await expect(page.locator('#status')).toHaveText(/please add your name/i);
  await expect(page.locator('#name')).toBeFocused();

  const { participants } = await (await request.get(`/api/events/${id}/results`)).json();
  expect(participants).toEqual([]);
});

test('asks for an email before submitting', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  await page.fill('#name', 'Andy');
  await pickButton(page, '2026-08-18', 'evening').click();
  await page.getByRole('button', { name: 'Submit availability' }).click();

  await expect(page.locator('#status')).toHaveText(/please add your email/i);
  await expect(page.locator('#email')).toBeFocused();

  const { participants } = await (await request.get(`/api/events/${id}/results`)).json();
  expect(participants).toEqual([]);
});

test('two people called Andy both keep their answer', async ({ page, request }) => {
  const { id } = await createEvent(request);

  for (const [email, date] of [
    ['andy.b@example.test', '2026-08-18'],
    ['andy.c@example.test', '2026-08-19'],
  ]) {
    await page.goto(`/event.html?id=${id}`);
    // The draft is saved per event, per browser — so the second Andy, sharing
    // this device, starts from the first one's ticks and has to clear them.
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.fill('#name', 'Andy');
    await page.fill('#email', email);
    await pickButton(page, date, 'evening').click();
    await page.getByRole('button', { name: 'Submit availability' }).click();
    await expect(page.locator('#status')).toHaveText(/thanks, Andy!/i);
  }

  const { participants, grid } = await (await request.get(`/api/events/${id}/results`)).json();
  expect(namesOf(participants)).toEqual(['Andy', 'Andy']);
  expect(namesOf(grid['2026-08-18'].evening)).toEqual(['Andy']);
  expect(namesOf(grid['2026-08-19'].evening)).toEqual(['Andy']);
});

test('keeps your ticks through a reload', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  await pickButton(page, '2026-08-20', 'morning').click();
  await page.reload();

  await expect(pickButton(page, '2026-08-20', 'morning')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('a whole dragged run survives a reload', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  // The draft write is coalesced to idle time, so a drag followed straight away
  // by a reload is the case that would lose ticks if the flush ever regressed.
  const dates = ['2026-08-17', '2026-08-18', '2026-08-19'];
  await dragAcross(page, dates.map((date) => pickButton(page, date, 'afternoon')));
  await page.reload();

  for (const date of dates) {
    await expect(pickButton(page, date, 'afternoon')).toHaveAttribute('aria-pressed', 'true');
  }
});

test('remembers your name and email for next time', async ({ page, request }) => {
  const first = await createEvent(request, { title: 'One' });
  await page.goto(`/event.html?id=${first.id}`);
  await page.fill('#name', 'Priya');
  await page.fill('#email', 'priya@example.test');
  await page.getByRole('button', { name: 'Submit availability' }).click();
  await expect(page.locator('#status')).toHaveText(/saved/i);

  const second = await createEvent(request, { title: 'Two' });
  await page.goto(`/event.html?id=${second.id}`);
  await expect(page.locator('#name')).toHaveValue('Priya');
  await expect(page.locator('#email')).toHaveValue('priya@example.test');
});

test('one draft does not bleed into another event', async ({ page, request }) => {
  const first = await createEvent(request, { title: 'One' });
  await page.goto(`/event.html?id=${first.id}`);
  await pickButton(page, '2026-08-18', 'evening').click();

  const second = await createEvent(request, { title: 'Two' });
  await page.goto(`/event.html?id=${second.id}`);
  await expect(pickButton(page, '2026-08-18', 'evening')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('clear all empties the grid', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  await pickButton(page, '2026-08-18', 'evening').click();
  await pickButton(page, '2026-08-19', 'morning').click();
  await page.getByRole('button', { name: 'Clear all' }).click();

  await expect(page.locator('button.pick[aria-pressed="true"]')).toHaveCount(0);
});

test('a second submission replaces the first', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  await page.fill('#name', 'Andy');
  await page.fill('#email', 'andy@example.test');
  await pickButton(page, '2026-08-18', 'evening').click();
  await page.getByRole('button', { name: 'Submit availability' }).click();
  await expect(page.locator('#status')).toHaveText(/thanks/i);

  await page.getByRole('button', { name: 'Clear all' }).click();
  await pickButton(page, '2026-08-21', 'morning').click();
  await page.getByRole('button', { name: 'Submit availability' }).click();
  await expect(page.locator('#status')).toHaveText(/1 slot\b/i);

  const { participants, grid } = await (await request.get(`/api/events/${id}/results`)).json();
  expect(namesOf(participants)).toEqual(['Andy']);
  expect(grid['2026-08-18'].evening).toEqual([]);
  expect(namesOf(grid['2026-08-21'].morning)).toEqual(['Andy']);
});

test('selections survive switching between list and month view', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  await pickButton(page, '2026-08-19', 'evening').click();
  await page.getByRole('button', { name: 'Month' }).click();

  const inMonth = monthDayCell(page, '2026-08-19').locator('button.pick').nth(2);
  await expect(inMonth).toHaveAttribute('aria-pressed', 'true');
  await expect(inMonth).toHaveText('E ✓');

  await page.getByRole('button', { name: 'List' }).click();
  await expect(pickButton(page, '2026-08-19', 'evening')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test.describe('broken links', () => {
  test('a link with no id explains itself', async ({ page }) => {
    await page.goto('/event.html');

    await expect(page.getByRole('heading', { name: 'Event not found' })).toBeVisible();
    await expect(page.locator('#error')).toHaveText(/missing an event id/i);
    await expect(page.locator('#form')).toBeHidden();
  });

  test('an unknown id shows the server message', async ({ page }) => {
    await page.goto('/event.html?id=definitely-not-real');

    await expect(page.getByRole('heading', { name: 'Event not found' })).toBeVisible();
    await expect(page.locator('#error')).toHaveText(/does not exist/i);
  });
});
