import { PARENT_TOPIC_WEIGHT, UNCLASSIFIED_TOPIC_ID } from '#config/constants/index.js';

/**
 * §7's propagation rule, as one pure function. MVP.md §7, §9.3, PR 8.1.
 *
 * A rating lands on the question's subtopic at full weight and on its parent topic at
 * `PARENT_TOPIC_WEIGHT`, and this file is the only place in `server/` that knows it.
 * It sits beside `commission.js` and `standing.js` for their reason: these are the
 * product's arithmetic rules, they are the things somebody will want to change, and a
 * rule that needs a database to test is a rule nobody re-tests.
 *
 * **The discount is applied here and nowhere else.** `matching.scoring.js` reads the
 * parent row back and deliberately does not import `PARENT_TOPIC_WEIGHT` — by the time
 * it looks, the weight is already in the numbers. Applying it a second time would be
 * invisible: every ranking would still come out in a plausible order, and be wrong.
 * The seed has its own copy in `deriveTopicStats`, because `prisma/seed/*` cannot reach
 * `#config`; that is two, it is written down in both places, and a third is what E7's
 * 7.9 was — §5.3 read from three different dates at three call sites.
 *
 * **No arithmetic on the way out beyond the weight.** The columns are `NUMERIC(8,2)`
 * and Postgres rounds on the way in, so `0.3 × 3` arriving as `0.8999999999999999` is
 * the column's problem and the column solves it. Rounding here would be a second
 * rounding of the same number — the shape of the bug E7 refused for wallet minutes.
 */

/**
 * Whether an id names a real topic.
 *
 * `UNCLASSIFIED_TOPIC_ID` is `0`, which is falsy, and `topicId` is nullable on
 * `questions` — so both the sentinel and the absence have to be excluded explicitly and
 * neither may be excluded by truthiness, because a real topic id could never be `0` but
 * a reader of `if (topicId)` cannot tell that from the code.
 */
const isClassified = (id) => typeof id === 'number' && id !== UNCLASSIFIED_TOPIC_ID;

/**
 * The two `teacher_topic_stats` rows one review moves. §7, §9.3.
 *
 * Pure. No Prisma, no clock, no request. Takes the same four numbers
 * `applyReviewAggregates` already receives, so the topic-level and the profile-level
 * counters cannot be computed from different rules — `ratingCount` in particular is the
 * service's `stars == null ? 0 : 1` and is never recomputed here. At profile level
 * getting that wrong drags an average down; here it also divides `topicFit`, which
 * carries 0.35 of the match score and is smoothed by exactly that count.
 *
 * Returns `[]` when there is no leaf — the sentinel path (`topic_id = 0`, §8.1's
 * fallback) carries no topical evidence, and a stats row on "unclassified" would give
 * every teacher who ever took an unclassified question history in a topic that means
 * *we do not know*. §9.1 lets `topic_id == 0` past the topic filter, so that row would
 * then score in every match that teacher is ever a candidate for.
 *
 * Returns one row, not two, when the leaf and the parent are the same id: a classifier
 * that answered the same id twice must not be counted 1.3 times. One row too when the
 * leaf has no parent — `topics.parent_id` is nullable and a leaf is not guaranteed to
 * arrive with one.
 *
 * @param {object} params
 * @param {number|null} params.subtopicId  the question's leaf
 * @param {number|null} params.topicId     the question's parent
 * @param {number} params.sessionsCount    always 1 — a session is one session however long it ran
 * @param {number} params.resolvedCount    1 or 0
 * @param {number} params.ratingSum        the stars, or 0
 * @param {number} params.ratingCount      1 when stars were given, 0 when they were not
 * @returns {Array<{topicId: number, sessionsCount: number, resolvedCount: number,
 *                  ratingSum: number, ratingCount: number}>}
 */
export function topicStatDeltas({
  subtopicId,
  topicId,
  sessionsCount,
  resolvedCount,
  ratingSum,
  ratingCount,
}) {
  // The leaf is the subtopic when there is one and the topic otherwise — a question
  // classified only to its parent still carries evidence about that parent, and it is
  // the row the teacher earned. What it is not is a *second* row: the parent below is
  // skipped when it is the same id.
  const leaf = isClassified(subtopicId) ? subtopicId : isClassified(topicId) ? topicId : null;

  if (leaf === null) {
    return [];
  }

  const rows = [weighted(leaf, 1, { sessionsCount, resolvedCount, ratingSum, ratingCount })];

  if (isClassified(topicId) && topicId !== leaf) {
    rows.push(
      weighted(topicId, PARENT_TOPIC_WEIGHT, {
        sessionsCount,
        resolvedCount,
        ratingSum,
        ratingCount,
      }),
    );
  }

  return rows;
}

/**
 * One row, every column scaled by the same weight.
 *
 * **The leaf's multiplier is the absence of one.** `1` is passed rather than written
 * into a branch so that there is a single expression per column and no path where the
 * leaf and the parent are built by different code.
 *
 * `ratingCount` is scaled like everything else, and that is deliberate: `0 × 0.3` is
 * still `0` for an unrated review, and for a rated one the parent must carry a fraction
 * of the count as well as a fraction of the sum, or the smoothing in
 * `matching.scoring.js` reads the parent as a full-confidence row.
 */
function weighted(topicId, weight, { sessionsCount, resolvedCount, ratingSum, ratingCount }) {
  return {
    topicId,
    sessionsCount: sessionsCount * weight,
    resolvedCount: resolvedCount * weight,
    ratingSum: ratingSum * weight,
    ratingCount: ratingCount * weight,
  };
}
