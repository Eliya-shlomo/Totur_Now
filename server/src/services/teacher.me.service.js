import {
  findLeafTopicIds,
  findTeacherById,
  findTeacherTopicStats,
  updateTeacherProfile,
} from '#repositories/teacher.repository.js';
import { assertStatusChangeAllowed } from '#services/teacher.status.rules.js';
import { AppError } from '#utils/AppError.js';
import { toTeacherMe, toTopicStatRecord } from '#utils/teacherView.js';

/**
 * The teacher's own record — what `GET` and `PATCH /teachers/me` actually do, and
 * since 8.5 their own per-topic reputation.
 *
 * It knows nothing about `req` or `res` (CONVENTIONS.md → Server layering), and every
 * query it runs belongs to the repository 2.1 froze. The record pair returns through
 * `toTeacherMe`, so a successful `PATCH` and a `GET` are the same shape by
 * construction rather than by two people remembering — which is what lets 2.4's
 * stepper re-render from the `PATCH` response instead of re-fetching. 8.5's stats read
 * is a third endpoint on the same `/me` mount and a different table, and it returns
 * through a serializer of its own.
 *
 * There is no ownership parameter anywhere below. The caller passes `req.user.id` and
 * nothing else identifies a row; `authorize('teacher')` in the frozen router is what
 * makes that safe.
 */

/**
 * The scalar columns `PATCH` may write, as an allowlist rather than as whatever the
 * body happened to carry.
 *
 * The schema is already `.strict()`, so this is the second lock on the same door —
 * and it is the one that still holds the day someone adds a field to the schema
 * without meaning it to reach `teacher_profiles`. `topicIds` is absent on purpose: it
 * is a join table, not a column, and the repository takes it separately.
 */
const PROFILE_COLUMNS = ['bio', 'pricePerBlock', 'levelMax', 'status'];

/**
 * The validated body → the `data` object the repository writes.
 *
 * `undefined` means the request said nothing about the field and it is left out, so a
 * one-step save touches one column. `null` is not `undefined`: `bio: null` is a
 * teacher clearing their bio, and it is written.
 */
function toProfileData(payload) {
  const data = {};

  for (const column of PROFILE_COLUMNS) {
    if (payload[column] !== undefined) data[column] = payload[column];
  }

  return data;
}

/**
 * Rejects any topic id that does not exist or is not a leaf, before anything is
 * written.
 *
 * One query for the whole array (`findLeafTopicIds`), then a set difference — an id
 * that does not exist and an id that is a parent topic come back the same way and are
 * the same answer to the client. A parent topic is not a teachable claim: a teacher
 * who declares "Algebra" and nothing under it cannot be ranked by the matching
 * engine, which scores on the subtopic (§9.3).
 *
 * Runs before `updateTeacherProfile` rather than inside it, so a request already known
 * to be bad never opens a transaction.
 *
 * @throws {AppError} VALIDATION_ERROR, with the offending ids under `topicIds`
 */
async function assertLeafTopics(topicIds) {
  const leafIds = new Set(await findLeafTopicIds(topicIds));
  const rejected = topicIds.filter((id) => !leafIds.has(id));

  if (rejected.length > 0) {
    throw AppError.validation('Some fields need fixing.', {
      topicIds: `Pick subtopics rather than whole subjects — these are not: ${rejected.join(', ')}.`,
    });
  }
}

/**
 * `GET /teachers/me` — the authenticated teacher's own record.
 *
 * The stepper's source of truth for which steps are done, so it has to be right on a
 * brand-new teacher whose row is registration defaults and nothing else. It is:
 * `pricePerBlock` and `levelMax` are `NOT NULL` with defaults, `topics` comes back
 * empty, and `onboardingComplete` is `false` because 2.1's serializer computes it
 * from the topic rows.
 *
 * A missing profile row is `NOT_FOUND`, not `UNAUTHORIZED`. The token verified and the
 * role gate passed, so the caller is a teacher — the row was deleted underneath a live
 * token, or registration wrote a user without a profile, and neither is an auth
 * failure worth disguising as one.
 *
 * @param {string} userId  from `req.user.id`, so already authenticated
 * @returns {Promise<import('@tutor/shared').TeacherMeResponse>}
 * @throws {AppError} NOT_FOUND
 */
export async function getTeacherMe(userId) {
  const teacher = await findTeacherById(userId);

  if (!teacher) {
    throw AppError.notFound('Teacher profile');
  }

  return toTeacherMe(teacher);
}

/**
 * `PATCH /teachers/me` — bio, price, level, topics, status. Always a partial.
 *
 * Three steps, in this order and for a reason each:
 *
 * 1. **Read the row.** Without it, a `PATCH` from a teacher whose profile is missing
 *    reaches `tx.teacherProfile.update`, raises Prisma's `P2025` and surfaces as a
 *    500 — where `GET` on the same account answers a clean `NOT_FOUND`. One extra
 *    read buys the two endpoints the same answer.
 * 2. **Validate the topic ids**, if any arrived. The database check the Zod schema
 *    cannot run.
 * 3. **One call to `updateTeacherProfile`**, which is where the transaction lives.
 *    Columns and topics go in together; `topicIds` replaces the whole set inside it,
 *    delete then insert. Nothing here opens a second write, so a failed insert cannot
 *    leave a teacher with no topics.
 *
 * The response is the repository's re-read, not the request echoed back: the caller
 * gets the row as it now is, including the topic objects the update itself cannot
 * return.
 *
 * @param {string} userId  from `req.user.id`
 * @param {import('@tutor/shared').TeacherUpdateRequest} payload  validated, non-empty
 * @returns {Promise<import('@tutor/shared').TeacherMeResponse>}
 * @throws {AppError} NOT_FOUND, VALIDATION_ERROR, TEACHER_UNAVAILABLE
 */
export async function updateTeacherMe(userId, payload = {}) {
  const existing = await findTeacherById(userId);

  if (!existing) {
    throw AppError.notFound('Teacher profile');
  }

  assertStatusChangeAllowed(existing.status, payload.status);

  const { topicIds } = payload;

  if (topicIds !== undefined) {
    await assertLeafTopics(topicIds);
  }

  const teacher = await updateTeacherProfile(userId, {
    data: toProfileData(payload),
    topicIds,
  });

  return toTeacherMe(teacher);
}

/** 8.5's one read. See the note on the function below. */
const statsDeps = { loadStats: findTeacherTopicStats };

/**
 * `GET /teachers/me/stats` — every `teacher_topic_stats` row this teacher owns.
 *
 * **The first surface in the product that shows this table to a human.** Until 8.1 it
 * had one writer and it was `prisma/seed/teachers.js`, so a screen would have rendered
 * fifteen fixtures and no evidence that anything worked. After 8.1 it is the teacher's
 * own reputation per topic, and it is the only place §9.3's parent propagation is
 * legible without a `psql` prompt — 8.6's pass reads "slightly raises it for other
 * calculus questions" off this response.
 *
 * **One read, and deliberately not two.** `getTeacherMe` above starts with
 * `findTeacherById` so a `PATCH` and a `GET` answer the same `NOT_FOUND`; there is
 * nothing to write here and nothing to refuse, so a profile read would buy one extra
 * statement and one extra failure mode. A teacher with no rows is not an error — it is a
 * teacher who has not been rated yet, which is most of them on the day they join, and
 * `{ topics: [] }` is the honest answer that the screen renders as an empty state.
 *
 * **There is no id parameter and there will not be one.** `teacherId` is `req.user.id`,
 * a `where` on the only query, so another teacher's breakdown is never selected rather
 * than refused. `authorize('teacher')` on the route is what keeps a student's token off
 * it; a student who reached it would get an empty list, which looks like a working
 * screen and is worse than a `403`.
 *
 * Ordering, the `Decimal` conversion and `isLeaf` all belong to the two layers either
 * side of this one — the repository orders and converts, `toTopicStatRecord` shapes —
 * and nothing is re-derived here. This function is the seam, and the seam is the point:
 * it is where the test hands the read in through the second argument (3.3's idiom), so
 * every property below is asserted with no database.
 *
 * @param {string} teacherId  from `req.user.id`, so already authenticated
 * @param {typeof statsDeps} [deps]
 * @returns {Promise<import('@tutor/shared').TeacherStatsResponse>}
 */
export async function getMyTopicStats(teacherId, deps = statsDeps) {
  const { loadStats } = { ...statsDeps, ...deps };

  const rows = await loadStats(teacherId);

  return { topics: rows.map(toTopicStatRecord) };
}
