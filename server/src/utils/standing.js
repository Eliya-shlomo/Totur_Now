import { STANDING_BANDS } from '#config/constants/index.js';

/**
 * Teacher standing, computed. MVP.md §6.2.
 *
 * Called wherever a teacher is serialized for a client — the selection screen, the
 * public teacher list, the teacher's own dashboard. Pure, so it is also the easiest
 * thing in the codebase to unit-test, which is the point: the badge is the platform
 * making a claim about a person, and it should be provably right.
 */

/**
 * @param {{sessionsCount: number, ratingSum: number, ratingCount: number}} teacher
 * @returns {'NEW'|'ACTIVE'|'EXPERIENCED'|'TOP'}
 */
export function standingOf({ sessionsCount = 0, ratingSum = 0, ratingCount = 0 }) {
  // No ratings yet is not the same as a rating of zero. An unrated teacher must not
  // be held below a threshold they have had no opportunity to meet.
  const rating = ratingCount > 0 ? ratingSum / ratingCount : 0;

  const band = STANDING_BANDS.find(
    (b) => sessionsCount >= b.minSessions && (b.minRating === 0 || rating >= b.minRating),
  );

  // The last band is (0, 0), so this only falls through if someone edits the table
  // into something that cannot match. Better a defined badge than undefined.
  return band?.badge ?? 'NEW';
}
