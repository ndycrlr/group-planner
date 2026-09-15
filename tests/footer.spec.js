// The fixed footer: a permanent link to Knowledge Work on every page, pinned to
// the bottom of the viewport without ever hiding what's above it.

import { test, expect } from '@playwright/test';
import { createEvent, submitResponse, pickButton, FORTNIGHT } from './helpers.js';

const KNOWLEDGE_WORK_URL = 'https://www.knowledgework.co.uk';

/** The one footer link, wherever the page happens to be. */
function footerLink(page) {
  return page.getByRole('contentinfo').getByRole('link', { name: 'Knowledge Work' });
}

test.describe('on every page', () => {
  const pages = ['index.html', 'event.html', 'results.html', 'admin.html'];

  for (const path of pages) {
    test(`${path} links to Knowledge Work safely`, async ({ page, request }) => {
      // event.html and results.html render nothing useful without a real event
      // id, but the footer is static markup — it doesn't depend on one.
      const { id } = await createEvent(request);
      const url = path === 'index.html' || path === 'admin.html' ? `/${path}` : `/${path}?id=${id}`;
      await page.goto(url);

      const link = footerLink(page);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', KNOWLEDGE_WORK_URL);
      await expect(link).toHaveAttribute('target', '_blank');
      // noopener is what matters for safety; the exact rel string may carry more.
      await expect(link).toHaveAttribute('rel', /noopener/);
    });
  }
});

test('the footer stays pinned to the bottom after scrolling', async ({ page, request }) => {
  const { id } = await createEvent(request, FORTNIGHT);
  await page.goto(`/event.html?id=${id}`);
  await expect(footerLink(page)).toBeVisible();

  await page.mouse.wheel(0, 10000);

  const footerBox = await page.locator('.site-footer').boundingBox();
  const viewportHeight = page.viewportSize().height;
  expect(footerBox.y + footerBox.height).toBeCloseTo(viewportHeight, 0);
});

test('the footer does not cover the last thing on the page', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);

  // A filled-in submission that succeeds, rather than a validation error — an
  // empty name refocuses the name field and scrolls back to the top of the
  // page, which would test that focus behaviour rather than the footer.
  await page.fill('#name', 'Andy');
  await page.fill('#email', 'andy@example.test');
  await pickButton(page, '2026-08-17', 'morning').click();

  const submit = page.locator('#submit');
  await submit.scrollIntoViewIfNeeded();
  await submit.click();

  // A click that landed on the footer instead would never reach the button, and
  // the saved confirmation would never appear.
  await expect(page.locator('#status')).toContainText(/saved/i);

  const statusBox = await page.locator('#status').boundingBox();
  const footerBox = await page.locator('.site-footer').boundingBox();
  expect(statusBox.y + statusBox.height).toBeLessThanOrEqual(footerBox.y);
});

test('adds no sideways scroll at 320px', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const { id } = await createEvent(request);
  await page.goto(`/event.html?id=${id}`);
  await expect(footerLink(page)).toBeVisible();

  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBe(0);
});

test('the link is reachable and visible by keyboard', async ({ page, request }) => {
  const { id } = await createEvent(request);
  await submitResponse(request, id, 'Andy', [['2026-08-18', 'evening']]);
  await page.goto(`/results.html?id=${id}`);

  const link = footerLink(page);
  await link.focus();
  await expect(link).toBeFocused();
});
