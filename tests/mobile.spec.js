// The narrow-screen layout.
//
// The bug these guard against was invisible from a desktop viewport: both grids
// carried a min-width wider than a phone, so they scrolled sideways inside their
// card and the Evening column was simply never on screen — with nothing to say
// it was there. Every check below is about the page fitting the width it is
// given, so they are written against widths rather than devices.

import { test, expect } from '@playwright/test';
import { PARTS } from '../public/dates.js';
import { createEvent, submitResponse, pickButton, monthDayCell, FORTNIGHT } from './helpers.js';

/** The narrowest we support: an iPhone SE, or any iPhone with Display Zoom on. */
const PORTRAIT = { width: 320, height: 800 };

test.use({ viewport: PORTRAIT, isMobile: true, hasTouch: true });

/** How far the widest thing on the page overflows the viewport, in px. */
function overflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const sideways = [...document.querySelectorAll('.grid-scroll')].map(
      (node) => node.scrollWidth - node.clientWidth,
    );
    return Math.max(root.scrollWidth - root.clientWidth, 0, ...sideways);
  });
}

test('every slot of the day is on screen at 320px', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  // Evening is the one that used to fall off the right-hand edge.
  for (const part of PARTS) {
    await expect(pickButton(page, '2026-08-18', part)).toBeInViewport();
  }
});

test('the availability page does not scroll sideways', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);
  await expect(pickButton(page, '2026-08-17', 'morning')).toBeVisible();

  expect(await overflow(page)).toBe(0);
});

test('the results page does not scroll sideways', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await submitResponse(request, id, 'Marguerite', [['2026-08-19', 'evening']]);
  await page.goto(`/results.html?id=${id}`);
  await expect(page.locator('.cell').first()).toBeVisible();

  expect(await overflow(page)).toBe(0);
});

test('the month view fits its seven columns in', async ({ page, request }) => {
  const { id } = await createEvent(request, FORTNIGHT);
  await page.goto(`/event.html?id=${id}`);
  await page.getByRole('button', { name: 'Month' }).click();

  // Monday is never the problem; Sunday is the far edge of the week.
  await expect(monthDayCell(page, '2026-08-23')).toBeInViewport();
  expect(await overflow(page)).toBe(0);
});

test('a results slot still says which part of the day it is', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);
  await page.goto(`/results.html?id=${id}`);

  // The column headings are gone at this width, so the label that replaces them
  // is the only thing besides hue naming the part — and hue must never be alone.
  const label = await page
    .locator('td.slot[data-part="evening"]')
    .first()
    .evaluate((node) => getComputedStyle(node, '::before').content);
  expect(label).toContain('evening');
});

test('the grid does not trap the page scroll', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  // touch-action must leave the vertical pan alone: the grid covers most of the
  // screen, so `none` here left a thumb nowhere to scroll from.
  const touchAction = await pickButton(page, '2026-08-17', 'morning')
    .evaluate((node) => getComputedStyle(node).touchAction);
  expect(touchAction).toBe('pan-y');
});
