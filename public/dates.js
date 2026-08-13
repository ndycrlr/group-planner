// Pure date helpers with no DOM or Node dependencies.
//
// This file is imported by BOTH the browser pages and server.js, so the two can
// never disagree about which days an event covers.
//
// Every date is a plain 'YYYY-MM-DD' string. All arithmetic goes through UTC
// (Date.UTC / getUTC*) on purpose: `new Date('2026-08-20')` is parsed as UTC
// midnight but read back in local time, which in a UK summer shows the 19th.
// Staying in UTC end to end sidesteps that entirely.

export const PARTS = ['morning', 'afternoon', 'evening'];

export const PART_LABELS = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

export const MAX_RANGE_DAYS = 92;

/** Ranges longer than this default to the month view instead of the list. */
export const LIST_VIEW_MAX_DAYS = 7;

/** Monday-first, matching the month grid layout. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86400000;

/** True if `value` is a 'YYYY-MM-DD' string naming a real calendar day. */
export function isDateString(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  // Round-trip to reject things like 2026-02-30 that match the pattern.
  return toDate(value) !== null;
}

/** 'YYYY-MM-DD' -> Date at UTC midnight, or null if the day does not exist. */
function toDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Date at UTC midnight -> 'YYYY-MM-DD'. */
function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/** Inclusive count of days from `start` to `end`. 1 when they are the same day. */
export function dayCount(start, end) {
  return (toDate(end) - toDate(start)) / MS_PER_DAY + 1;
}

/** Every day from `start` to `end` inclusive, as 'YYYY-MM-DD' strings. */
export function datesInRange(start, end) {
  const last = toDate(end);
  const dates = [];
  for (let day = toDate(start); day <= last; day = new Date(+day + MS_PER_DAY)) {
    dates.push(toDateString(day));
  }
  return dates;
}

/**
 * Validate a start/end pair the way both the API and the create form need it.
 * Returns an error message, or null when the range is usable.
 */
export function validateRange(start, end) {
  if (!isDateString(start)) return 'Start date must be a real date.';
  if (!isDateString(end)) return 'End date must be a real date.';
  if (end < start) return 'The end date cannot be before the start date.';
  if (dayCount(start, end) > MAX_RANGE_DAYS) {
    return `Please keep the range to ${MAX_RANGE_DAYS} days or fewer.`;
  }
  return null;
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** '2026-08-20' -> 'Thu 20 Aug'. */
export function formatDay(value) {
  return DAY_FORMAT.format(toDate(value));
}

/** '2026-08-20' -> 'Thu'. */
export function weekdayOf(value) {
  return formatDay(value).split(' ')[0];
}

/** True for Saturday and Sunday, used to shade weekends in the grid. */
export function isWeekend(value) {
  const day = toDate(value).getUTCDay();
  return day === 0 || day === 6;
}

// --- Month view ----------------------------------------------------------
// A "month" here is a 'YYYY-MM' string.

/** Every month touched by the range: monthsInRange('2026-08-20','2026-10-10'). */
export function monthsInRange(start, end) {
  const last = end.slice(0, 7);
  const months = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));

  for (let current = start.slice(0, 7); current <= last; ) {
    months.push(current);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    current = `${year}-${String(month).padStart(2, '0')}`;
  }
  return months;
}

const MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** '2026-08' -> 'August 2026'. */
export function monthLabel(month) {
  return MONTH_FORMAT.format(toDate(`${month}-01`));
}

/**
 * Lay '2026-08' out as calendar weeks, Monday first. Each week always has
 * exactly 7 entries: a 'YYYY-MM-DD' string, or null for the padding before the
 * 1st and after the last day of the month.
 */
export function monthGrid(month) {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  // getUTCDay() is Sunday-first; shift so Monday is 0.
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;

  const cells = Array(firstWeekday).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${month}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}
