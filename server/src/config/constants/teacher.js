/**
 * Teacher standing. MVP.md §6.2.
 *
 * The badge a student sees is earned on this platform and nowhere else — it is a
 * function of sessions completed and the ratings those sessions received. There is
 * no badge column: storing it would be a second copy of numbers we already keep on
 * teacher_profiles, free to drift from the first.
 */

/**
 * Ordered high to low — the first band whose thresholds are met wins.
 *
 * `TOP` needs volume **and** satisfaction, deliberately. A teacher with 300
 * sessions at 4.1 stays `EXPERIENCED`, because a badge that rewarded volume alone
 * would point students at the busiest teacher rather than the best one.
 */
export const STANDING_BANDS = [
  { badge: 'TOP', minSessions: 100, minRating: 4.5 },
  { badge: 'EXPERIENCED', minSessions: 25, minRating: 0 },
  { badge: 'ACTIVE', minSessions: 5, minRating: 0 },
  { badge: 'NEW', minSessions: 0, minRating: 0 },
];

/** Every badge value, for validators and for the client's badge colour map. */
export const TEACHER_BADGES = STANDING_BANDS.map((band) => band.badge);

/**
 * What a teacher declares about themselves at signup (§6.1). Nobody checks it —
 * an inflated level shows up in ratings, which is the platform's actual filter.
 */
export const TEACHING_LEVELS = [3, 4, 5];
export const DEFAULT_LEVEL_MAX = 3;
