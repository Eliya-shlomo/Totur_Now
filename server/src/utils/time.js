import { TIMEZONE } from '#config/constants/app.js';
import { LOW_DEMAND_HOURS } from '#config/constants/money.js';

/**
 * Wall-clock helpers, resolved in TIMEZONE rather than in the host's timezone.
 *
 * `new Date().getHours()` answers in whatever timezone the process happens to run
 * in. That is Israel on a developer's laptop and UTC on Render, so a rule written
 * against it passes locally and is wrong by two or three hours in production.
 * Every business rule that cares about the hour of the day goes through here.
 */

const hourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hour: 'numeric',
  // h23 rather than hour12:false — the latter renders midnight as 24 on some engines.
  hourCycle: 'h23',
});

/** Hour of the day, 0–23, in TIMEZONE. */
export function currentHour(date = new Date()) {
  return Number(hourFormat.format(date));
}

/**
 * Whether `date` falls inside the commission-free window. MVP.md §5.3.
 *
 * `LOW_DEMAND_HOURS` is `[startHour, endHour)` — start inclusive, end exclusive,
 * so [6, 14] means 06:00:00 through 13:59:59 Israel time.
 */
export function isLowDemandHour(date = new Date()) {
  const [start, end] = LOW_DEMAND_HOURS;
  const hour = currentHour(date);
  // Written to survive a future window that wraps midnight, e.g. [22, 6].
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}
