import { DEFAULT_PAGE_SIZE } from '#config/constants/index.js';
import { prisma } from '#config/db.js';

/**
 * The rating — one insert and the two sets of columns it moves. PR 6.6 and PR 8.1,
 * MVP.md §6.2, §7, §9.3 and §11.2.
 *
 * **A file of its own, and the alternative was worse.** The aggregates belong to
 * `teacher_profiles`, but the only repository that writes that table today is
 * `teacher.presence.repository.js` — E5's, and it is about `status` and `last_seen_at`,
 * two columns whose whole purpose is that they change every few seconds. Putting a
 * rating's counters there would mean one file where a heartbeat and a permanent
 * reputation write live side by side. `session.repository.js` was the other candidate and
 * it already carries the epic's whole read/write set.
 *
 * So: reviews and the columns a review moves, in one place, written by one service.
 *
 * **8.1 added the second set of columns rather than a second file.** `teacher_topic_stats`
 * is moved by the same review, by the same rule and inside the same transaction, and §18's
 * "8.2 `rating.service`" would have been a second service with a second transaction — a
 * `reviews` row committed without its topic stats. This file's remit was already stated as
 * "the columns a review moves", and these are the other ones.
 *
 * **Every writer here takes a `tx` and none opens one.** The insert, the profile
 * counters and the topic rows are one transaction with the session's own `RATED` write —
 * a review that exists while `resolved_count` does not is a KPI that under-reports for
 * ever, and there is no reconciliation query that would find it.
 *
 * **8.3 added the one read, and it is the exception on purpose.** `findTeacherReviewPage`
 * takes no `tx` and holds its own client: a public GET is one snapshot with no write to
 * be consistent with. It is also the only function in this file whose output leaves the
 * server, which is why the paragraph about `student_id` sits on it rather than here.
 *
 * **Everything that *reads* these columns is E8's.** The badge, the history screen, the
 * public profile. 6.6 wrote that line when this file had no reader at all; 8.3 added the
 * profile's, and 8.4's history screen reads `reviews` through the sessions repository
 * because its row is a session that happens to carry one.
 */

/**
 * One row in `reviews`. **The database is what enforces one review per session** —
 * `session_id` is `UNIQUE` — and this insert is deliberately unguarded so that the
 * constraint is the thing that refuses a double submit rather than a `SELECT` that could
 * race it.
 *
 * A `P2002` from here is the second click, not a bug. The service catches it by code and
 * answers `409`; unmapped it would reach `errorHandler` as a 500 for a double-tapped
 * button.
 *
 * `stars` and `comment` are both optional in §11.2 and both arrive as `null` rather than
 * `undefined` when the student volunteered neither — the column is what says "no stars",
 * and a missing key and an explicit null must not be different rows.
 *
 * `CHECK (stars BETWEEN 1 AND 5)` sits under this and is the last line; `reviewSchema` is
 * the first.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.studentId
 * @param {string} params.teacherId
 * @param {boolean} params.isResolved §6.2's core KPI, and the one required field
 * @param {number|null} [params.stars] 1–5, or null
 * @param {string|null} [params.comment]
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<object>} the created row
 */
export async function createReview(
  { sessionId, studentId, teacherId, isResolved, stars = null, comment = null },
  tx,
) {
  return tx.review.create({
    data: { sessionId, studentId, teacherId, isResolved, stars, comment },
  });
}

/**
 * The four columns a rating moves, in one statement — 6.6, and **the first writer any of
 * them has ever had.**
 *
 * **Every increment arrives as a number and none is computed here.** `resolvedCount` is
 * `1` or `0`, `ratingSum` is the stars or `0`, and `ratingCount` is `1` only when stars
 * were given. The service decides all three, because the rule that decides them is §6.2's
 * and lives with the other product rules — and because `rating_sum += stars ?? 0` beside
 * an unconditional `rating_count += 1` is the defect this arrangement exists to make
 * visible: it turns every unrated review into a zero-star one and drags a teacher's
 * average down for the life of the account.
 *
 * `update` rather than `updateMany`: `userId` is the primary key and a teacher whose
 * profile has vanished mid-transaction is `P2025` — an error, not a silent zero. Every
 * other write in this epic is conditional because it is racing something; this one races
 * nothing, because the session's `ENDED → RATED` edge has already been won under a lock
 * by the time it runs.
 *
 * @param {object} params
 * @param {string} params.teacherId
 * @param {number} params.resolvedCount `1` when the student said it was solved
 * @param {number} params.ratingSum     the stars given, or `0`
 * @param {number} params.ratingCount   `1` when stars were given, **`0` when they were not**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<object>} the updated profile
 */
export async function applyReviewAggregates(
  { teacherId, resolvedCount, ratingSum, ratingCount },
  tx,
) {
  return tx.teacherProfile.update({
    where: { userId: teacherId },
    data: {
      resolvedCount: { increment: resolvedCount },
      ratingSum: { increment: ratingSum },
      ratingCount: { increment: ratingCount },
    },
  });
}

/**
 * The question's two topic ids, for the session being rated — PR 8.1.
 *
 * **A second read rather than a wider first one.** The topics are not on anything the
 * review service holds: `findSessionForMeter` selects the session's money and clock
 * state and does not join `questions`. Widening *that* function was the alternative and
 * it is refused — it is a `$queryRaw … FOR UPDATE OF s` that the meter and the
 * settlement also call, so every tick of every session would pay for two columns
 * neither of them reads, and the lock's `OF s` argument would have a third table to
 * explain.
 *
 * **Nothing here is racing anything, which is why a plain read is enough.** The
 * classification override (3.5) is a pre-session edit, and the `ENDED → RATED` edge has
 * already been won under the lock by the time this runs. It takes the `tx` anyway,
 * because a read outside the transaction that its own write depends on is the seam
 * where a rollback stops meaning anything.
 *
 * Answers `{topicId: null, subtopicId: null}` rather than `null` for a session whose
 * question has vanished, so the caller feeds `topicStatDeltas` the same shape either
 * way and gets `[]` — a rating whose question was deleted is a rating with no topical
 * evidence, which is the sentinel case by another route.
 *
 * @param {string} sessionId
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{topicId: number|null, subtopicId: number|null}>}
 */
export async function findReviewTopicIds(sessionId, tx) {
  const session = await tx.session.findUnique({
    where: { id: sessionId },
    select: { question: { select: { topicId: true, subtopicId: true } } },
  });

  return {
    topicId: session?.question?.topicId ?? null,
    subtopicId: session?.question?.subtopicId ?? null,
  };
}

/**
 * The `teacher_topic_stats` rows one review moves — PR 8.1, and **the first writer this
 * table has ever had outside the seed.**
 *
 * **An upsert per row, never a read-then-write.** The primary key is composite —
 * `(teacher_id, topic_id)` — and the row may not exist: a teacher's first session in a
 * topic has to create it at the values an increment from zero would have produced. A
 * `findUnique` followed by a `create` or an `update` is two statements with a gap, and
 * the gap is where two of that teacher's reviews landing together lose one of the two.
 * Prisma's `upsert` is one statement per row and the `increment` in its update branch is
 * `column = column + $n`, evaluated by Postgres rather than by this process.
 *
 * **Two round trips at most, both inside the caller's transaction.** `rows` is what
 * `topicStatDeltas` returned: zero, one or two. `tx` is not optional and this file opens
 * nothing — a `prisma.$transaction` here would be a second transaction, and a `reviews`
 * row that commits while its topic stats do not is a KPI that under-reports for ever
 * with no reconciliation query that would ever find it.
 *
 * **The weight is already in the numbers.** This function multiplies nothing and knows
 * nothing about §7; `topicStats.js` applied the discount and is the only place that
 * does. `Decimal(8,2)` is what rounds `0.3 × 3`, on the way in.
 *
 * `teacherId` arrives here rather than on each row because it is not the pure
 * function's to know: `topicStatDeltas` answers what a review does to a topic, and whose
 * topic it is comes off the locked session.
 *
 * @param {object} params
 * @param {string} params.teacherId
 * @param {Array<{topicId: number, sessionsCount: number, resolvedCount: number,
 *                ratingSum: number, ratingCount: number}>} params.rows `topicStatDeltas`'s answer
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<number>} how many rows were written — `rows.length`
 */
export async function applyTopicStats({ teacherId, rows }, tx) {
  // Sequential, not `Promise.all`: these run on one transaction's connection, and two
  // upserts issued concurrently against the same interactive transaction is the shape
  // that deadlocks when both rows belong to the same teacher.
  for (const row of rows) {
    await tx.teacherTopicStat.upsert({
      where: { teacherId_topicId: { teacherId, topicId: row.topicId } },
      create: {
        teacherId,
        topicId: row.topicId,
        sessionsCount: row.sessionsCount,
        resolvedCount: row.resolvedCount,
        ratingSum: row.ratingSum,
        ratingCount: row.ratingCount,
      },
      update: {
        sessionsCount: { increment: row.sessionsCount },
        resolvedCount: { increment: row.resolvedCount },
        ratingSum: { increment: row.ratingSum },
        ratingCount: { increment: row.ratingCount },
      },
    });
  }

  return rows.length;
}

/**
 * One page of a teacher's reviews, newest first, plus how many there are — PR 8.3.
 *
 * **The first read this file has ever had, and it is the public one.** Everything above
 * writes inside somebody else's transaction; this takes no `tx` and opens nothing,
 * because a public GET is one snapshot and has no write to be consistent with. It is the
 * one function here that reaches `prisma` directly.
 *
 * **`studentId` is not selected.** Not selected and then dropped by the serializer —
 * never read at all. The endpoint is unauthenticated, and a public URL that maps a person
 * to the maths they could not do is a privacy leak with a very ordinary shape: two
 * teachers' review lists intersected identify a student's whole term. The column exists
 * on the row and stops here.
 *
 * **The topic is a join and there is no `reviews.topic_id`.** `session → question →
 * subtopic`, falling back to the parent topic and then to null on the sentinel path. The
 * subtopic wins because it is the more specific true thing, which is the same order
 * `offerView.js`, `sessionView.js` and 7.6's earnings read all label a session in.
 *
 * `total` is the whole set rather than the page: it is the number beside the stars in the
 * heading, and a heading that changes as you page is a heading nobody trusts. Same call
 * `TeacherListResponse` made in 2.3 and `WalletTransactionsResponse` in 7.2.
 *
 * One `$transaction`, the read-only array form — the page and the count against one
 * snapshot, so a review written between them cannot make the heading disagree with the
 * list.
 *
 * @param {object} params
 * @param {string} params.teacherId a user id, already shape-checked as a uuid
 * @param {number} [params.skip]
 * @param {number} [params.take]
 * @returns {Promise<{reviews: object[], total: number}>}
 */
export async function findTeacherReviewPage({ teacherId, skip = 0, take = DEFAULT_PAGE_SIZE }) {
  const where = { teacherId };

  const [reviews, total] = await prisma.$transaction([
    prisma.review.findMany({
      where,
      select: {
        id: true,
        stars: true,
        isResolved: true,
        comment: true,
        createdAt: true,
        session: {
          select: {
            question: {
              select: {
                // The ids come with the names because the sentinel topic is a real row
                // with a real label — "כללי / לא מסווג" — and the serializer has to be
                // able to tell it apart from a topic worth putting on a chip.
                topic: { select: { id: true, nameEn: true, nameHe: true } },
                subtopic: { select: { id: true, nameEn: true, nameHe: true } },
              },
            },
          },
        },
      },
      // `id` as the second key for the reason every paged read in this repo carries one:
      // two rows written in the same transaction share `created_at` to the microsecond,
      // and a non-total order lets page 2 repeat a row from page 1.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    }),
    prisma.review.count({ where }),
  ]);

  return { reviews, total };
}
