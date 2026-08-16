/**
 * Matching algorithm parameters. MVP.md §9, appendix.
 *
 * These are the numbers that decide which teachers a student sees, so they are the
 * numbers most likely to be tuned. Keeping them here means tuning is a one-file
 * change rather than a hunt through matching.service.js.
 */

/** How many teachers the selection screen shows. */
export const MATCH_COUNT = 5;

/**
 * Score weights. Must sum to 1.0 — asserted below. MVP.md §9.2.
 *
 * No `priceFit`. Price is a hard filter through the student's chosen band (§5.2),
 * never a ranking component: the student already expressed their budget by picking
 * the band, and scoring it again would charge them for that preference twice. Its
 * old 0.05 sits on `resolveRate`, the component that measures whether the student
 * actually got unstuck.
 */
export const MATCH_WEIGHTS = {
  topicFit: 0.35,
  globalRating: 0.2,
  resolveRate: 0.2,
  acceptanceRate: 0.1,
  history: 0.1,
  newTeacherBoost: 0.05,
};

/**
 * Bayesian smoothing constant. MVP.md §9.3 — without this, one 5.0 rating outranks
 * 4.6 across forty sessions and the algorithm is noise.
 */
export const BAYES_C = 5;

/** A rating updates its subtopic at 1.0 and the parent topic at this weight (§7). */
export const PARENT_TOPIC_WEIGHT = 0.3;

/** Teachers below this session count get the cold-start boost (§6.2). */
export const NEW_TEACHER_SESSIONS = 5;

/** How long `getPlatformAverages()` stays cached (§9.4). */
export const PLATFORM_AVERAGES_CACHE_MS = 5 * 60 * 1000;

/** Fallback topic when the LLM cannot classify. MVP.md §7. */
export const UNCLASSIFIED_TOPIC_ID = 0;

/**
 * The top of the rating scale. §9.2's `global_rating` is `average stars / MAX_STARS`,
 * and `reviews.stars` carries `CHECK (stars BETWEEN 1 AND 5)` in the init migration —
 * change one and you must change the other, in a migration.
 *
 * There is no `constants/rating.js` yet. When E8 creates one this is a one-line move
 * and nothing that imports it through the barrel changes, which is the same
 * arrangement `UNCLASSIFIED_TOPIC_ID` above already documents.
 */
export const MAX_STARS = 5;

/**
 * §9.2's `history_bonus`: "1.0 if this student rated them ≥4 before". Read by
 * `findPositiveHistoryTeacherIds` in the matching repository and surfaced to the
 * student as `TeacherMatch.studiedWith` — one threshold, two consumers, so the badge
 * and the score can never disagree about what "studied with" means.
 */
export const HISTORY_MIN_STARS = 4;

/**
 * The prior when the platform itself has no history and every denominator is zero.
 *
 * Reachable only on an empty database, where it is constant across candidates and
 * therefore cannot change anyone's order — which is the argument for naming neutral
 * values rather than scattering `?? 0`. A zero prior would push every rated teacher
 * above every unrated one and look like the algorithm working.
 *
 * `rating` is on the 1–`MAX_STARS` scale, the two rates are 0–1. 4.3 divides the sums
 * `aggregatePlatformAverages()` returns and falls back to these three.
 */
export const NEUTRAL_PLATFORM_AVERAGES = { rating: 3, resolveRate: 0.5, acceptRate: 0.5 };

// Guard the invariant at boot rather than discovering a 0.97 total via a subtly
// wrong ranking three epics from now.
const weightSum = Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(weightSum - 1) > 1e-9) {
  throw new Error(`MATCH_WEIGHTS must sum to 1.0, got ${weightSum}`);
}
