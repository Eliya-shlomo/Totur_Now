import { NEW_TEACHER_FEE_DAYS, PLATFORM_FEE_PCT } from '#config/constants/index.js';
import { isLowDemandHour } from '#utils/time.js';

/**
 * MVP.md §5.3's commission rule, as one pure function.
 *
 * The platform takes 15%, except in two cases where it takes nothing: a teacher in
 * their first month, and any session in the low-demand window. Both are supply
 * incentives — §5.3 buys availability rather than paying for standby.
 *
 * **Written in E5 and reused by E7 rather than restated there.** `IncomingOffer`
 * carries `expectedEarning`, so the teacher's modal (5.7) and the offer email (5.6)
 * both need this number before any money moves; E7's real charge then splits an
 * amount with the same rule. Two implementations of §5.3 is two answers to "what did
 * I earn", and the one the teacher was shown at accept time is the one that has to
 * hold.
 *
 * It is not `wallet.service.js` and it moves nothing: no repository import, no
 * database, no rounding into credits. It answers a rate, and the caller that owns a
 * balance decides what to do with it. MVP.md §17.5's human-written rule is about the
 * code that writes money, and this is deliberately not that code.
 */

/** Milliseconds in a day, for the one comparison below. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The platform's cut of one session, as a fraction of the gross.
 *
 * `0` in both free cases and `PLATFORM_FEE_PCT` otherwise. The new-teacher window is
 * checked first because it is the stronger claim — a teacher in their first month
 * pays nothing at any hour, and evaluating the clock as well would only be a chance
 * to get it wrong.
 *
 * **`at` is an instant, never an hour.** `isLowDemandHour` resolves it through
 * `TIMEZONE`, because `new Date().getHours()` answers in the host's timezone, which
 * is Israel on a laptop and UTC on Render — a rule written against it passes locally
 * and is two or three hours wrong in production.
 *
 * `teacherCreatedAt` is the teacher's own start date, and callers pass
 * `teacher_profiles.created_at` — when they became a teacher, not when the account
 * was registered. A student who onboards as a teacher a year later gets their free
 * month from the day they onboarded, which is what the incentive is for.
 *
 * @param {object} params
 * @param {Date|string} params.teacherCreatedAt `teacher_profiles.created_at`
 * @param {Date} [params.at] when the session happens; defaults to now
 * @returns {number} `0` or `PLATFORM_FEE_PCT`
 */
export function platformFeeRate({ teacherCreatedAt, at = new Date() }) {
  const createdAt =
    teacherCreatedAt instanceof Date ? teacherCreatedAt : new Date(teacherCreatedAt);
  const daysActive = (at.getTime() - createdAt.getTime()) / MS_PER_DAY;

  // Strictly less than, so day 30 exactly is the first charged day rather than a
  // free one that depends on the millisecond. `NEW_TEACHER_FEE_DAYS` is "free for
  // this long", and 30 days after joining is when that long is over.
  if (daysActive < NEW_TEACHER_FEE_DAYS) {
    return 0;
  }

  if (isLowDemandHour(at)) {
    return 0;
  }

  return PLATFORM_FEE_PCT;
}
