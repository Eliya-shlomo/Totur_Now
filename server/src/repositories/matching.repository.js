import { HISTORY_MIN_STARS } from '#config/constants/index.js';
import { prisma } from '#config/db.js';
import { TEACHER_VIEW } from '#repositories/teacher.repository.js';

/**
 * Every query the matching engine needs, from either track. `questions`, `wallets`,
 * `teacher_profiles`, `teacher_topic_stats` and `reviews` — MVP.md §9.
 *
 * **This file is frozen after PR 4.1**, with one deliberate gap: `findCandidates`
 * has no `where` clause and 4.2 adds it. Nothing else here is unfinished, and
 * nothing else in the epic may open this file.
 *
 * The rule is E1's and it has been re-proved three times since. `auth.routes.js`
 * was frozen in 1.1 and never conflicted across two parallel PRs;
 * `user.repository.js` was not frozen, both PRs wrote to it, and the merge produced
 * a file that would not parse — `main` did not boot until somebody noticed
 * (`3e05e3c`, and docs/epics/E1-auth/RETRO.md). E2 and E3 both froze the router and
 * the repository and neither track opened them once.
 *
 * A query missing here is not a small omission — it is an unfrozen file, and one of
 * the five below (`aggregatePlatformAverages`) has **no caller in DEV-A's track at
 * all**, which is exactly why it is written here rather than where it is used. If a
 * later PR needs something that is not below, that is a chat message and a small PR
 * from DEV-A, never an edit in passing.
 *
 * Three rules everything here follows:
 *
 * **One shared `select`, imported rather than copied.** `findCandidates` spreads
 * `TEACHER_VIEW` from `teacher.repository.js` (frozen since 2.1, which is why the
 * export is the only line E4 changes in it), so a match card and a browse card are
 * structurally unable to disagree about what a teacher looks like. A private copy of
 * that column list would be a second source of truth for the shape E2's retro spent
 * a section on.
 *
 * **Relations come back with the row, never per row.** E2's `GET /teachers` N+1
 * lesson: the nested selects below cost the same number of statements for 3
 * candidates and for 30. Anything that maps over the result and fetches stats per
 * teacher undoes it. 4.2 measures that with `DEBUG=prisma:query` once its filters
 * give the count something to vary.
 *
 * **No `Prisma.Decimal` leaves this file.** `teacher_topic_stats` has four
 * `Decimal @db.Decimal(8, 2)` columns — NUMERIC so the 0.3 parent propagation does
 * not truncate — and `Decimal * 0.35` produces neither a number nor an error. The
 * seam in the epic README says `number` for every field of `MatchCandidate`, and
 * `toStats` below is where that becomes true.
 */

/**
 * The question, as the matching engine needs to read it.
 *
 * **This is not `QUESTION_VIEW`, deliberately.** 3.1 refuses to select `rejectedBy`
 * into a student-facing payload — its comment says the column "is matching-engine
 * state and has no business in a student-facing payload" — and that refusal is
 * correct. E4 is a different consumer wanting a different shape, so it gets its own
 * read rather than unfreezing `question.repository.js` to widen a serializer's
 * select. The two shapes are allowed to diverge; that is the point of having two.
 *
 * `session` carries `status` because 4.5 refuses a fresh match list once the session
 * has left `PENDING` (`SESSION_NOT_ACTIVE`) — the same rule 3.5 applies to
 * re-classification, and for the same reason: once an offer is out, a second list is
 * a way to double-book a student.
 */
const MATCHING_QUESTION_VIEW = {
  id: true,
  studentId: true,
  topicId: true,
  subtopicId: true,
  estimatedLevel: true,
  declaredLevel: true,
  rejectedBy: true,
  session: { select: { id: true, status: true } },
};

/**
 * One `teacher_topic_stats` row as the scorer must see it: four `number`s, or `null`
 * when this teacher has no history in that topic.
 *
 * `null` rather than a zeroed object, because "never taught it" and "taught it and
 * resolved nothing" are different claims and §9.2 smooths them differently. The
 * seam types both `subtopicStats` and `topicStats` as `TopicStats|null` for exactly
 * this reason.
 *
 * @param {object} [row] a `teacher_topic_stats` row with Decimal columns
 * @returns {{ratingSum: number, ratingCount: number, resolvedCount: number, sessionsCount: number}|null}
 */
function toStats(row) {
  if (!row) return null;

  return {
    ratingSum: Number(row.ratingSum),
    ratingCount: Number(row.ratingCount),
    resolvedCount: Number(row.resolvedCount),
    sessionsCount: Number(row.sessionsCount),
  };
}

/**
 * The question behind a match request — `GET /questions/:id/matches` (4.5).
 *
 * Ownership is not filtered here, the same call 3.1 made: the caller compares
 * `studentId` and answers `NOT_FOUND` for a stranger's question rather than
 * `FORBIDDEN`, because `FORBIDDEN` would confirm the id exists. A `where` on the
 * student would make those two cases indistinguishable from a missing row.
 *
 * @param {string} id
 * @returns {Promise<object|null>} the row shaped by `MATCHING_QUESTION_VIEW`
 */
export async function findQuestionForMatching(id) {
  return prisma.question.findUnique({ where: { id }, select: MATCHING_QUESTION_VIEW });
}

/**
 * A student's credit balance — the input to §9.1's affordability ceiling.
 *
 * `null`, not `0`, when the row is missing. They are different facts: every
 * registered student gets a wallet (`user.repository.js`), so an absent one is a
 * data problem and not a poor student, and a caller that wants to treat it as zero
 * should say so where the product rule lives rather than have this function decide.
 *
 * @param {string} userId
 * @returns {Promise<number|null>} credits, or `null` when there is no wallet row
 */
export async function findWalletBalance(userId) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { balance: true },
  });

  return wallet?.balance ?? null;
}

/**
 * §9.1's candidate pool — every teacher who could take this question.
 *
 * **The `where` clause is 4.2's and is deliberately absent.** Today this returns
 * every teacher in the table; the five parameters are accepted, documented and
 * unused. That is the one unfinished thing in this file, it is written down in
 * 4.1's brief and in 4.2's, and it is the only change 4.2 may make here. The
 * signature, the select list and the `Decimal` conversion are frozen — a predicate
 * belongs in the PR that measures its plan with `EXPLAIN`, and freezing the shape
 * before the filters is what lets 4.2 and 4.3 start on the same day.
 *
 * The select list is `TEACHER_VIEW` plus the three things ranking needs that a card
 * does not carry: the two offer counters (§9.2's `acceptance_rate`) and the topic
 * stats. `topicStats` is narrowed to the question's subtopic and parent — the two
 * rows §9.2 scores, at 1.0 and at `PARENT_TOPIC_WEIGHT` — rather than fetched whole,
 * because a teacher may have a stats row per topic they have ever taught.
 *
 * **`topicStats` is the relation field on `TeacherProfile`**, mapped to the
 * `teacher_topic_stats` table (`prisma/schema/teachers.prisma`). It is an *array* of
 * rows there and a single row in the seam, which is why the mapping below
 * destructures it away: the epic's `MatchCandidate` types `subtopicStats` and
 * `topicStats` as `TopicStats|null` — the question's leaf and its parent — and a
 * scorer handed an array of every topic a teacher has ever taught would have to know
 * which two of them matter. It does not; that is this function's job.
 *
 * `teacherId` is added beside `userId` rather than replacing it. The seam says
 * `teacherId` and `toTeacherCard` (E2's, imported by 4.5) reads `userId`, so the row
 * answers both without either side forking a serializer.
 *
 * The pool does not care how good a teacher is, only whether they are eligible —
 * §9.5 is explicit that availability and price are filters and quality is scoring.
 * The stats ride along because fetching them afterwards would be the N+1 this
 * codebase has now avoided three times, not because this query reads them.
 *
 * @param {object} [filters] every one of these is 4.2's to apply; none is read yet
 * @param {number} [filters.requiredLevel]        `estimatedLevel ?? declaredLevel ?? min(TEACHING_LEVELS)`
 * @param {number} [filters.topicId]              the question's parent topic
 * @param {number|null} [filters.subtopicId]      the question's leaf, or null on the sentinel path
 * @param {number} [filters.maxPrice]             the resolved price ceiling, credits per block
 * @param {string[]} [filters.excludeTeacherIds]  the question's `rejected_by`; `undefined`, never `[]`
 * @returns {Promise<object[]>} rows shaped by `TEACHER_VIEW` plus the ranking inputs
 */
export async function findCandidates(filters = {}) {
  // Only the two the select list needs are destructured. The other three —
  // `requiredLevel`, `maxPrice`, `excludeTeacherIds` — are part of the frozen
  // signature above and are read by 4.2's `where`, not here; naming them now would
  // be three unused bindings and a lint suppression to go with them.
  const { topicId, subtopicId } = filters;
  const statsTopicIds = [topicId, subtopicId].filter((id) => id !== undefined && id !== null);

  const candidates = await prisma.teacherProfile.findMany({
    select: {
      ...TEACHER_VIEW,
      offersReceived: true,
      offersAccepted: true,
      topicStats: {
        where: { topicId: { in: statsTopicIds } },
        select: {
          topicId: true,
          ratingSum: true,
          ratingCount: true,
          resolvedCount: true,
          sessionsCount: true,
        },
      },
    },
  });

  return candidates.map(({ topicStats: statRows, ...candidate }) => ({
    ...candidate,
    teacherId: candidate.userId,
    subtopicStats: toStats(statRows.find((row) => row.topicId === subtopicId)),
    topicStats: toStats(statRows.find((row) => row.topicId === topicId)),
  }));
}

/**
 * The teachers this student has already rated well — §9.2's `history_bonus`, and
 * the 💙 badge `TeacherMatch.studiedWith` carries.
 *
 * **One query for the whole set, never one per candidate.** The caller marks each
 * candidate against this id set; a `some` clause inside the candidate query would
 * put a per-row subquery on the hot path for a fact that is one small array.
 *
 * `teacherId` is nullable on `reviews` (a deleted teacher's rows survive with
 * `onDelete: Restrict`), so nulls are excluded here rather than by every caller.
 *
 * @param {string} studentId
 * @returns {Promise<string[]>} distinct teacher ids rated `HISTORY_MIN_STARS` or better
 */
export async function findPositiveHistoryTeacherIds(studentId) {
  const reviews = await prisma.review.findMany({
    where: {
      studentId,
      teacherId: { not: null },
      stars: { gte: HISTORY_MIN_STARS },
    },
    select: { teacherId: true },
    distinct: ['teacherId'],
  });

  return reviews.map((review) => review.teacherId);
}

/**
 * The six sums §9.3 smooths every candidate against, over the whole of
 * `teacher_profiles`.
 *
 * **The pairs, not the ratios.** Dividing is 4.3's, in
 * `matching.averages.service.js`, because deciding what a zero denominator means is
 * a business rule and not a query: "and when nobody has ever had a session, the
 * platform's resolve rate is 0.5" is a product decision, and hiding it under a
 * function whose name promises an aggregate would leave 4.6's tests no way to
 * exercise the empty-platform branch without an empty database.
 *
 * `_sum` over an empty table is `null` per column, not `0` — coalesced here so the
 * caller's only question is whether a denominator is zero, and never also whether
 * it exists.
 *
 * This function has no caller in DEV-A's track. It is here because the file is
 * frozen before either track opens, and a query DEV-B discovers is missing on day
 * three is a blocked developer, not a small omission.
 *
 * @returns {Promise<{ratingSum: number, ratingCount: number, resolvedCount: number,
 *                    sessionsCount: number, offersAccepted: number, offersReceived: number}>}
 */
export async function aggregatePlatformAverages() {
  const { _sum } = await prisma.teacherProfile.aggregate({
    _sum: {
      ratingSum: true,
      ratingCount: true,
      resolvedCount: true,
      sessionsCount: true,
      offersAccepted: true,
      offersReceived: true,
    },
  });

  return {
    ratingSum: _sum.ratingSum ?? 0,
    ratingCount: _sum.ratingCount ?? 0,
    resolvedCount: _sum.resolvedCount ?? 0,
    sessionsCount: _sum.sessionsCount ?? 0,
    offersAccepted: _sum.offersAccepted ?? 0,
    offersReceived: _sum.offersReceived ?? 0,
  };
}
