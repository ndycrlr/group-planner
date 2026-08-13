// Shared browser helpers: API calls and the day x part-of-day grid that both
// the selection page and the results page are built from.

import {
  PARTS,
  PART_LABELS,
  WEEKDAY_LABELS,
  LIST_VIEW_MAX_DAYS,
  formatDay,
  weekdayOf,
  isWeekend,
  datesInRange,
  dayCount,
  monthsInRange,
  monthLabel,
  monthGrid,
} from './dates.js';

/** Create an element: el('p', { className: 'hint', textContent: 'Hi' }, [child]). */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) {
    if (child != null) node.append(child);
  }
  return node;
}

/** Read a query-string value, e.g. qs('id') from ?id=K3nQ7wUa. */
export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

/**
 * fetch wrapper that parses JSON and throws with the server's own error
 * message, so pages can just show `error.message`.
 */
export async function api(path, options = {}) {
  const init = { ...options };
  if (init.body) {
    init.headers = { 'Content-Type': 'application/json', ...init.headers };
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error('Could not reach the server. Is it still running?');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

/** Show a message in a `.notice` element, or hide it when message is falsy. */
export function showNotice(node, message) {
  node.textContent = message ?? '';
  node.hidden = !message;
}

/**
 * List view: one row per day, one column per part of the day.
 * `renderCell(cell, date, part, options)` fills in each cell, which is the only
 * thing that differs between picking availability and viewing results.
 */
function renderListView(container, dates, renderCell) {
  const header = el('tr', {}, [
    el('th', { scope: 'col', textContent: 'Day' }),
    ...PARTS.map((part) => {
      const cell = el('th', { scope: 'col', textContent: PART_LABELS[part] });
      cell.dataset.part = part;
      return cell;
    }),
  ]);

  const rows = dates.map((date) => {
    const row = el('tr', { className: isWeekend(date) ? 'weekend' : '' });
    row.append(
      el('th', { scope: 'row', className: 'day' }, [
        el('span', { className: 'dow', textContent: weekdayOf(date) }),
        // formatDay gives 'Thu 20 Aug'; the weekday is already its own span.
        el('span', { className: 'dom', textContent: formatDay(date).slice(4) }),
      ]),
    );

    for (const part of PARTS) {
      const cell = el('td', { className: 'slot' });
      // data-part is what tells the stylesheet which time-of-day colour this
      // slot wears; every part-hued rule hangs off it.
      cell.dataset.part = part;
      renderCell(cell, date, part, { compact: false });
      row.append(cell);
    }
    return row;
  });

  const table = el('table', { className: 'grid' }, [
    el('thead', {}, [header]),
    el('tbody', {}, rows),
  ]);

  // Wide ranges scroll sideways inside the card rather than squashing the page.
  container.replaceChildren(el('div', { className: 'grid-scroll' }, [table]));
}

/**
 * Month view: every month the range touches, stacked vertically — no paging.
 * Days that fall inside a month but outside the event's own range are greyed
 * out and get no slots. Each in-range day stacks three full-width strips, one
 * per part of the day, which is where the room for names comes from.
 */
function renderMonthView(container, event, renderCell) {
  const months = monthsInRange(event.startDate, event.endDate).map((month) => {
    const weeks = monthGrid(month);

    const cells = weeks.flat().map((date) => {
      if (date === null) return el('div', { className: 'day-cell empty' });

      const inRange = date >= event.startDate && date <= event.endDate;
      const cell = el('div', {
        className: `day-cell${inRange ? '' : ' out'}${isWeekend(date) ? ' weekend' : ''}`,
      });
      cell.append(el('span', { className: 'day-num', textContent: String(Number(date.slice(8))) }));

      if (inRange) {
        for (const part of PARTS) {
          const strip = el('div', { className: 'strip-wrap' });
          strip.dataset.part = part;
          renderCell(strip, date, part, { compact: true });
          cell.append(strip);
        }
      }
      return cell;
    });

    const headings = WEEKDAY_LABELS.map((label) =>
      el('div', { className: 'dow-head', textContent: label }),
    );

    return el('section', { className: 'month' }, [
      el('h2', { textContent: monthLabel(month) }),
      el('div', { className: 'month-grid' }, [...headings, ...cells]),
    ]);
  });

  container.replaceChildren(el('div', { className: 'grid-scroll' }, months));
}

/** Render whichever view is active. Both drive the same `renderCell`. */
export function renderCalendar(container, view, event, renderCell) {
  if (view === 'month') {
    renderMonthView(container, event, renderCell);
  } else {
    renderListView(container, datesInRange(event.startDate, event.endDate), renderCell);
  }
}

const VIEW_KEY = 'planner:view';

/**
 * Which view to open in: whatever was chosen last, otherwise by length —
 * a list reads better for a week or less, a calendar for anything longer.
 */
export function preferredView(event) {
  let stored = null;
  try {
    stored = localStorage.getItem(VIEW_KEY);
  } catch {
    // Private browsing can refuse storage; fall through to the default.
  }
  if (stored === 'list' || stored === 'month') return stored;
  return dayCount(event.startDate, event.endDate) > LIST_VIEW_MAX_DAYS ? 'month' : 'list';
}

/** Segmented List / Month control. Remembers the choice for next time. */
export function createViewToggle(container, view, onChange) {
  const buttons = new Map();

  function select(next) {
    for (const [name, button] of buttons) {
      button.setAttribute('aria-pressed', String(name === next));
    }
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Preference is a nicety, not required.
    }
    onChange(next);
  }

  for (const [name, label] of [['list', 'List'], ['month', 'Month']]) {
    const button = el('button', { type: 'button', className: 'view-button', textContent: label });
    button.setAttribute('aria-pressed', String(name === view));
    button.addEventListener('click', () => select(name));
    buttons.set(name, button);
    container.append(button);
  }
}
