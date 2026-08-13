// The organiser's first screen: name the thing, pick a range, get a link.

import { test, expect } from '@playwright/test';
import { MAX_RANGE_DAYS } from '../public/dates.js';
import { WEEK } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

test('opens on the create form', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'When is everyone free?' })).toBeVisible();
  await expect(page.locator('#createCard')).toBeVisible();
  await expect(page.locator('#shareCard')).toBeHidden();
});

test('shows the three parts of the day', async ({ page }) => {
  const band = page.locator('.daylight-band');
  await expect(band).toBeVisible();
  await expect(band.locator('.daylight-part')).toHaveText([
    'Morning',
    'Afternoon',
    'Evening',
  ]);
});

test('defaults to a week starting today', async ({ page }) => {
  const start = await page.locator('#startDate').inputValue();
  const end = await page.locator('#endDate').inputValue();

  expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(new Date(end) - new Date(start)).toBe(6 * 86400000);
});

test('creates an event and hands over a shareable link', async ({ page }) => {
  await page.fill('#title', 'Summer BBQ');
  await page.fill('#startDate', WEEK.startDate);
  await page.fill('#endDate', WEEK.endDate);
  await page.getByRole('button', { name: 'Create event' }).click();

  await expect(page.locator('#shareCard')).toBeVisible();
  await expect(page.locator('#createCard')).toBeHidden();
  await expect(page.getByRole('heading', { name: '"Summer BBQ" is ready' })).toBeVisible();

  const link = await page.locator('#shareLink').inputValue();
  expect(link).toContain('/event.html?id=');

  // The link has to actually lead somewhere.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Summer BBQ' })).toBeVisible();
});

test('the results link points at the same event', async ({ page }) => {
  await page.fill('#title', 'Cinema trip');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.locator('#shareCard')).toBeVisible();

  const eventUrl = new URL(await page.locator('#shareLink').inputValue());
  const resultsUrl = new URL(await page.locator('#openResults').getAttribute('href'), page.url());

  expect(resultsUrl.pathname).toContain('results.html');
  expect(resultsUrl.searchParams.get('id')).toBe(eventUrl.searchParams.get('id'));
});

test('the copy button confirms it copied', async ({ page }) => {
  await page.fill('#title', 'Pub quiz');
  await page.getByRole('button', { name: 'Create event' }).click();

  const copy = page.getByRole('button', { name: 'Copy link' });
  await copy.click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
});

test('will not create an event without a name', async ({ page }) => {
  await page.getByRole('button', { name: 'Create event' }).click();

  await expect(page.locator('#status')).toHaveText(/give your event a name/i);
  await expect(page.locator('#shareCard')).toBeHidden();
});

test('refuses a range longer than the maximum, without asking the server', async ({ page }) => {
  let apiCalls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/events')) apiCalls += 1;
  });

  await page.fill('#title', 'Whole year');
  await page.fill('#startDate', '2026-01-01');
  await page.fill('#endDate', '2026-12-31');
  await page.getByRole('button', { name: 'Create event' }).click();

  await expect(page.locator('#status')).toHaveText(
    new RegExp(`${MAX_RANGE_DAYS} days or fewer`, 'i'),
  );
  expect(apiCalls, 'the shared validator should catch this in the browser').toBe(0);
});

test('drags the end date along when the start passes it', async ({ page }) => {
  await page.fill('#endDate', '2026-08-20');
  await page.fill('#startDate', '2026-08-25');
  await page.locator('#startDate').blur();

  await expect(page.locator('#endDate')).toHaveValue('2026-08-25');
});
