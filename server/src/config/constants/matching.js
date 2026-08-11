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

// Guard the invariant at boot rather than discovering a 0.97 total via a subtly
// wrong ranking three epics from now.
const weightSum = Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(weightSum - 1) > 1e-9) {
  throw new Error(`MATCH_WEIGHTS must sum to 1.0, got ${weightSum}`);
}
