import { expect } from '@playwright/test';

// The same module the server and the browser pages use. Importing it here means
// the tests address slots by the label the app actually renders, and a change to
// the date helpers shows up as a test failure rather than as a silent drift.
import { PARTS, PART_LABELS, formatDay } from '../public/dates.js';

/** Mon 17 – Sun 23 August 2026: a full week, and short enough to open in list view. */
export const WEEK = { startDate: '2026-08-17', endDate: '2026-08-23' };

/** Long enough that a page opens in month view instead (> LIST_VIEW_MAX_DAYS). */
export const FORTNIGHT = { startDate: '2026-08-17', endDate: '2026-08-30' };

/** Create an event straight through the API — most tests only need its id. */
export async function createEvent(request, overrides = {}) {
  const body = { title: 'Test event', ...WEEK, ...overrides };
  const response = await request.post('/api/events', { data: body });
  expect(response.status(), await response.text()).toBe(201);
  const { id } = await response.json();
  return { id, ...body };
}

/** Record one person's availability. `slots` is [[date, part], …]. */
export async function submitResponse(request, id, name, slots) {
  const response = await request.post(`/api/events/${id}/responses`, {
    data: { name, slots: slots.map(([date, part]) => ({ date, part })) },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

/** The aria-label event.html gives a slot button, e.g. 'Mon 17 Aug Morning'. */
export function slotLabel(date, part) {
  return `${formatDay(date)} ${PART_LABELS[part]}`;
}

/** A slot toggle on the availability page. */
export function pickButton(page, date, part) {
  return page.getByRole('button', { name: slotLabel(date, part), exact: true });
}

/** The list-view row for one day, found by the date in its row header. */
export function dayRow(page, date) {
  // formatDay gives 'Mon 17 Aug'; the row header shows the '17 Aug' half.
  const dayOfMonth = formatDay(date).slice(4);
  return page.locator('tr').filter({ has: page.locator('th.day', { hasText: dayOfMonth }) });
}

/** The results cell for one slot in list view. */
export function resultCell(page, date, part) {
  return dayRow(page, date).locator('td.slot').nth(PARTS.indexOf(part)).locator('.cell');
}

/** The month-view day block for one date. */
export function monthDayCell(page, date) {
  const dayOfMonth = String(Number(date.slice(8)));
  return page
    .locator('.day-cell')
    .filter({ has: page.locator('.day-num', { hasText: new RegExp(`^${dayOfMonth}$`) }) });
}

/** How brightly a results cell is lit: the --lit custom property, 0 to 1. */
export async function litValue(cell) {
  const raw = await cell.evaluate((node) => node.style.getPropertyValue('--lit'));
  return Number(raw);
}

/** Drag across a run of slots, which is how the page expects to be used. */
export async function dragAcross(page, targets) {
  const boxes = [];
  for (const locator of targets) {
    const box = await locator.boundingBox();
    expect(box, 'slot should be visible before dragging over it').not.toBeNull();
    boxes.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }

  await page.mouse.move(boxes[0].x, boxes[0].y);
  await page.mouse.down();
  for (const point of boxes.slice(1)) {
    await page.mouse.move(point.x, point.y);
  }
  await page.mouse.up();
}
