import { DEFAULT_PAGE_SIZE } from '#config/constants/index.js';
import { prisma } from '#config/db.js';

/**
 * Every teacher query either audience needs. `teacher_profiles`, `teacher_topics`
 * and the topics behind them — MVP.md §11.2.
 *
 * **This file is frozen after PR 2.1.** Not a style rule: in E1 the router was
 * frozen and never conflicted once, while `user.repository.js` was not, was written
 * by two parallel PRs, and the merge produced a file that would not parse —
 * `main` did not boot until someone noticed (`3e05e3c`, and
 * docs/epics/E1-auth/RETRO.md). E2 runs the same two tracks over one table: DEV-B
 * writes the teacher's own record in 2.2/2.4, DEV-A reads a stranger's card in
 * 2.3/2.5. Both call this file and neither edits it.
 *
 * So it is written finished, before either track starts, and it is reviewed as if
 * it were finished — because it is. A query missing here is not a small omission;
 * it is an unfrozen file, which is the bug this PR exists to prevent. If a later PR
 * needs something that is not below, that is a chat message before any code.
 *
 * Two rules everything here follows:
 *
 * **One shared `select`.** `TEACHER_VIEW` is spread into every read, so the list,
 * the single card and the teacher's own record are structurally unable to disagree
 * about which columns exist — and a column added to `teacher_profiles` later is
 * invisible to all three until a human adds it here.
 *
 * **Topics come back with the teacher, never per teacher.** The nested `select`
 * below is the only defence against the epic's one N+1 (README → Risks). Prisma
 * loads each relation with its own statement rather than one join, so a page costs
 * five statements — profiles, users, teacher_topics, topics, count — and costs the
 * same five whether it returns 5 teachers or 50. Measured against the seeded
 * database with `prisma:query` logging, at both sizes. Anything that maps over the
 * result and fetches topics per teacher undoes it.
 */

/**
 * The columns and relations every teacher read returns — enough for both
 * `toTeacherCard` and `toTeacherMe` in `#utils/teacherView.js` and nothing more.
 *
 * An explicit `select`, never `omit`: `offersReceived`, `offersAccepted`,
 * `noShowCount`, `lastSeenAt` and `zoomPersonalLink` are all on the row and none of
 * them is here, by construction rather than by a filter someone has to remember.
 *
 * `user` is selected down to `fullName` alone. The address is not in either
 * contract shape — a teacher's own record does not carry it either, because the
 * client already holds it from `GET /auth/me` — so `email` is never read out of the
 * database on this path at all.
 *
 * Topics are ordered by `topicId`, which is seed order, which is the taxonomy's own
 * pedagogical order (`prisma/seed/topics.js`, and the same reasoning as
 * `topic.repository.js`). The serializer does not re-sort them.
 */
export const TEACHER_VIEW = {
  userId: true,
  bio: true,
  pricePerBlock: true,
  levelMax: true,
  status: true,
  sessionsCount: true,
  resolvedCount: true,
  ratingSum: true,
  ratingCount: true,
  user: { select: { fullName: true } },
  topics: {
    select: { topic: { select: { id: true, slug: true, nameHe: true, nameEn: true } } },
    orderBy: { topicId: 'asc' },
  },
};

/**
 * How the public list is ordered when the caller does not say otherwise.
 *
 * `badge` and `rating` are computed rather than stored (§6.2), so neither can be an
 * `ORDER BY`. This is the closest ordering SQL can express: standing rises with
 * `sessionsCount` at every band boundary, so sessions first reproduces badge rank,
 * and the rating pair after it puts a rated teacher above an unrated one with the
 * same volume — a `null` rating must not read as a perfect score.
 *
 * Exported so 2.3 can pass a variation without opening this file, and so that a
 * variation is written next to the default it departs from.
 */
export const TEACHER_LIST_DEFAULT_ORDER = [
  { sessionsCount: 'desc' },
  { ratingCount: 'desc' },
  { ratingSum: 'desc' },
];

/**
 * One teacher, with their user and topics — `GET /teachers/:id` (2.3) and
 * `GET /teachers/me` (2.2).
 *
 * `findUnique` on the primary key. A user id that exists but belongs to a student
 * has no `teacher_profiles` row and comes back `null`, which is the caller's cue
 * for `NOT_FOUND` — not a 500, and not an empty card.
 *
 * @param {string} userId
 * @returns {Promise<object|null>} the row shaped by `TEACHER_VIEW`
 */
export async function findTeacherById(userId) {
  return prisma.teacherProfile.findUnique({
    where: { userId },
    select: TEACHER_VIEW,
  });
}

/**
 * A filtered, ordered page of teachers, plus the count the filters match before
 * paging — `GET /teachers` (2.3).
 *
 * **Two statements, whatever `take` is.** The rows and the count go out in one
 * `$transaction` so they describe the same snapshot: counted separately, a teacher
 * going online between the two queries produces a `total` that disagrees with the
 * page the client is holding.
 *
 * Every filter is optional and they compose — Prisma drops a `where` key whose
 * value is `undefined`, so an absent filter is absent from the SQL rather than
 * widened to a tautology. The price ceiling arrives as a resolved range: bands are
 * `utils/pricing.js`'s business (§5.2), and a repository that knew what `'B'` means
 * would be a second copy of the band table.
 *
 * Inactive users are excluded here rather than by each caller. A blocked account
 * (E9) must not be reachable through a public list, and "every read of this table
 * remembers to say so" is exactly the kind of rule that holds until the day it
 * does not.
 *
 * @param {object} [filters]
 * @param {number} [filters.topicId]     leaf topic; a teacher matches if they teach it
 * @param {number} [filters.level]       matches `levelMax >= level`
 * @param {number} [filters.minPrice]    inclusive, already resolved from a band
 * @param {number} [filters.maxPrice]    inclusive, already resolved from a band
 * @param {boolean} [filters.onlineOnly] default false — the list is not online-only
 * @param {number} [filters.skip]        rows to skip; the caller derives it from `page`
 * @param {number} [filters.take]        rows to return; the caller applies the cap
 * @param {object[]} [filters.orderBy]   defaults to `TEACHER_LIST_DEFAULT_ORDER`
 * @returns {Promise<{teachers: object[], total: number}>}
 */
export async function findTeacherPage({
  topicId,
  level,
  minPrice,
  maxPrice,
  onlineOnly = false,
  skip = 0,
  take = DEFAULT_PAGE_SIZE,
  orderBy = TEACHER_LIST_DEFAULT_ORDER,
} = {}) {
  const where = {
    user: { isActive: true },
    status: onlineOnly ? 'ONLINE' : undefined,
    levelMax: level === undefined ? undefined : { gte: level },
    pricePerBlock:
      minPrice === undefined && maxPrice === undefined
        ? undefined
        : { gte: minPrice, lte: maxPrice },
    topics: topicId === undefined ? undefined : { some: { topicId } },
  };

  const [teachers, total] = await prisma.$transaction([
    prisma.teacherProfile.findMany({ where, select: TEACHER_VIEW, orderBy, skip, take }),
    prisma.teacherProfile.count({ where }),
  ]);

  return { teachers, total };
}

/**
 * The write behind `PATCH /teachers/me` (2.2): the profile columns, the topic set,
 * or both, and then the updated row in the shape every read returns.
 *
 * **One transaction, on purpose.** The stepper can send a step that is scalar, a
 * step that is topics, and an edit screen that saves both at once; a topic delete
 * that succeeds followed by an insert that fails would leave a teacher with no
 * topics and no way to notice. `topicIds` replaces the whole set — delete then
 * insert, never a merge — because a merge makes removing a topic impossible through
 * this endpoint.
 *
 * `topicIds` is only touched when the caller passes it. `undefined` means "this
 * request said nothing about topics" and leaves the rows alone; an empty array
 * would mean "remove them all", which is why 2.2's validator rejects it rather
 * than this function guessing.
 *
 * The re-read at the end is what makes the response identical to `GET /teachers/me`
 * — the update's own return value cannot carry the topic rows written beside it.
 *
 * @param {string} userId
 * @param {object} [changes]
 * @param {object} [changes.data]       scalar columns: bio, pricePerBlock, levelMax, status
 * @param {number[]} [changes.topicIds] leaf topic ids, validated by the caller
 * @returns {Promise<object>} the row shaped by `TEACHER_VIEW`
 */
export async function updateTeacherProfile(userId, { data = {}, topicIds } = {}) {
  return prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.teacherProfile.update({ where: { userId }, data });
    }

    if (topicIds !== undefined) {
      await tx.teacherTopic.deleteMany({ where: { teacherId: userId } });
      await tx.teacherTopic.createMany({
        data: topicIds.map((topicId) => ({ teacherId: userId, topicId })),
      });
    }

    return tx.teacherProfile.findUnique({ where: { userId }, select: TEACHER_VIEW });
  });
}

/**
 * Which of these topic ids exist and are leaves — the check behind `topicIds` in
 * 2.2's validator.
 *
 * One query for the whole array rather than one per id: the alternative is an N+1
 * on the validation path of every stepper save. The caller compares what comes back
 * against what it sent, so "id 9999 does not exist" and "id 1 is a parent topic"
 * are the same answer here and the same `VALIDATION_ERROR` there.
 *
 * A parent topic is not a teachable claim. A teacher who declares "Algebra" and
 * nothing under it cannot be ranked by the matching engine, which scores on the
 * subtopic (§9.3) — `parentId: { not: null }` is that rule, in SQL.
 *
 * @param {number[]} topicIds
 * @returns {Promise<number[]>} the subset that exists and has a parent, ascending
 */
export async function findLeafTopicIds(topicIds) {
  const topics = await prisma.topic.findMany({
    where: { id: { in: topicIds }, parentId: { not: null } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  return topics.map((topic) => topic.id);
}

/**
 * Every `teacher_topic_stats` row this teacher has, with the topic behind it —
 * `GET /teachers/me/stats` (8.5).
 *
 * **The one addition to a file frozen after 2.1, and the freeze is why it is here.**
 * E2's freeze exists so two parallel tracks over `teacher_profiles` never edit one
 * file; the rule it states is that a query the epic needs belongs *in* this file
 * rather than in a private copy somewhere else. This is that query: 8.5 is the
 * teacher reading their own record, which is the audience this file already serves,
 * and the alternative — a `teacher.stats.repository.js` selecting from a table this
 * one already relates to — is the second source of truth the freeze was written
 * against. Nothing above changes.
 *
 * **No `Prisma.Decimal` leaves this function.** The four counters are
 * `Decimal @db.Decimal(8, 2)` so the 0.3 parent propagation does not truncate, and a
 * `Decimal` serialized by `res.json` is `{"s":1,"e":0,"d":[…]}` rather than a number.
 * `matching.repository.js` states this rule for this exact table and converts at its
 * own edge; this is the same rule at the second one, and the conversion happens
 * nowhere downstream — a serializer that converted too would be two places free to
 * disagree about what `12.60` is.
 *
 * **`Number()` and never a rounding.** `12.60` is what a parent topic honestly holds
 * after 42 leaf sessions, and this endpoint carries the stored value: the teacher's
 * own numbers have to agree with the ones `matching.scoring.js` ranks them on, which
 * is the entire reason the screen exists. `matchView.js` rounds because a student's
 * card has to; a card is not this.
 *
 * `parentId` is selected for `isLeaf` alone. A parent row is not a topic the teacher
 * taught — it is the sum of their leaves at `PARENT_TOPIC_WEIGHT` — and a flat list
 * that cannot tell the two apart shows "Calculus: 12.6 sessions" beside "Integration
 * by parts: 42 sessions" as if they were the same kind of claim.
 *
 * Ordered by `sessionsCount` descending, which is "what you teach most" and is the
 * order a teacher would sort it into by hand. `topicId` breaks the tie, so a teacher
 * whose rows are all zero gets taxonomy order rather than whatever the planner
 * returned.
 *
 * One statement. The topic comes back with the row, never per row — E2's N+1 lesson,
 * and the reason this is a nested `select` rather than a map over the ids.
 *
 * @param {string} teacherId
 * @returns {Promise<Array<{topic: {id: number, slug: string, nameHe: string, nameEn: string, parentId: number|null}, ratingSum: number, ratingCount: number, resolvedCount: number, sessionsCount: number}>>}
 */
export async function findTeacherTopicStats(teacherId) {
  const rows = await prisma.teacherTopicStat.findMany({
    where: { teacherId },
    select: {
      ratingSum: true,
      ratingCount: true,
      resolvedCount: true,
      sessionsCount: true,
      topic: { select: { id: true, slug: true, nameHe: true, nameEn: true, parentId: true } },
    },
    orderBy: [{ sessionsCount: 'desc' }, { topicId: 'asc' }],
  });

  return rows.map((row) => ({
    topic: row.topic,
    ratingSum: Number(row.ratingSum),
    ratingCount: Number(row.ratingCount),
    resolvedCount: Number(row.resolvedCount),
    sessionsCount: Number(row.sessionsCount),
  }));
}
