import { FIRST_PAGE } from '#config/constants/index.js';
import { findTeacherById, findTeacherPage } from '#repositories/teacher.repository.js';
import { AppError } from '#utils/AppError.js';
import { bandCeiling } from '#utils/pricing.js';
import { toTeacherCard } from '#utils/teacherView.js';

/**
 * What a student sees about a teacher. MVP.md §5.2, §6.2, §12 "Teachers".
 *
 * The read half of E2 (docs/epics/E2-teacher-onboarding/README.md). Nothing here
 * authenticates, because nothing here needs to: a stranger compares teachers before
 * deciding whether to register, and that surface is the one that convinces them.
 * Every row leaves through `toTeacherCard`, which is where the absence of `email`
 * and `status` is enforced by construction rather than by a filter someone has to
 * remember.
 *
 * This layer translates a query string into repository arguments and nothing else.
 * It does not re-sort — the repository orders the page — and it does not re-fetch
 * topics, which come back with the teachers. Both would undo the epic's one N+1
 * defence, which is why they are called out here rather than only in the brief.
 */

/**
 * A page of teachers matching the filters, plus how many match before paging.
 *
 * **`band` is a ceiling.** §5.2: picking B means bands A and B. Resolved through
 * `bandCeiling()`, the same helper the matching hard filter uses in §9.1, so the
 * browse filter and the match filter can never disagree about what a band means.
 * There is deliberately no floor — a band that excluded cheaper teachers would hide
 * a ₪6 teacher from a student who said they could pay ₪14.
 *
 * `total` is the unpaged count, so a client that hit the `pageSize` cap can tell.
 *
 * @param {object} query already coerced and defaulted by `teacherListSchema`
 * @param {number} [query.topicId]
 * @param {number} [query.level]
 * @param {'A'|'B'|'C'} [query.band]
 * @param {boolean} query.onlineOnly
 * @param {number} query.page      1-based
 * @param {number} query.pageSize  already capped at `MAX_PAGE_SIZE`
 * @returns {Promise<import('@tutor/shared').TeacherListResponse>}
 */
export async function getTeacherList({ topicId, level, band, onlineOnly, page, pageSize }) {
  const { teachers, total } = await findTeacherPage({
    topicId,
    level,
    maxPrice: band === undefined ? undefined : bandCeiling(band),
    onlineOnly,
    skip: (page - FIRST_PAGE) * pageSize,
    take: pageSize,
  });

  return { teachers: teachers.map(toTeacherCard), total };
}

/**
 * One teacher's public card.
 *
 * A user id that exists but belongs to a student has no `teacher_profiles` row, so
 * the repository answers `null` and that becomes `NOT_FOUND`. Not a 500, and not an
 * empty card: "this person is not a teacher" and "this teacher has an empty profile"
 * are different answers and the client renders them differently.
 *
 * The message says nothing about whether the id belongs to a student, an admin, or
 * nobody at all. This endpoint is unauthenticated, and a caller who could tell those
 * apart could enumerate the user table one uuid at a time.
 *
 * @param {string} id a user id
 * @returns {Promise<import('@tutor/shared').TeacherCard>}
 */
export async function getTeacherCard(id) {
  const teacher = await findTeacherById(id);

  if (!teacher) throw AppError.notFound('Teacher');

  return toTeacherCard(teacher);
}
