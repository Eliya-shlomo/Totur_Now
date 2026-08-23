import { FIRST_PAGE } from '#config/constants/index.js';
import { findTeacherReviewPage } from '#repositories/review.repository.js';
import { findTeacherById, findTeacherPage } from '#repositories/teacher.repository.js';
import { AppError } from '#utils/AppError.js';
import { bandCeiling } from '#utils/pricing.js';
import { toTeacherCard, toTeacherReview } from '#utils/teacherView.js';

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

/** 8.3's two collaborators. See the note on the function below. */
const reviewDeps = {
  loadTeacher: findTeacherById,
  loadReviews: findTeacherReviewPage,
};

/**
 * A page of what students wrote about one teacher — `GET /teachers/:id/reviews`, PR 8.3.
 *
 * **The teacher is checked before the reviews are read, and a missing one is
 * `NOT_FOUND` rather than an empty list.** A student's user id has no
 * `teacher_profiles` row, and `findTeacherReviewPage` would answer `{reviews: [], total:
 * 0}` for it perfectly happily — which tells a caller that this person is a teacher with
 * nothing written about them. They are not a teacher. `getTeacherCard` above makes the
 * same distinction for the same reason, and the message says nothing about whether the
 * id belongs to a student, an admin or nobody at all, because this endpoint is
 * unauthenticated and a caller who could tell those apart could enumerate the user table
 * one uuid at a time.
 *
 * It costs one extra read on a public route. The alternative is a second implementation
 * of "is this id a teacher" inside a review query, which is the shape that eventually
 * disagrees with the first.
 *
 * `total` is the unpaged count — the number beside the stars in the heading — and the
 * repository computes it in the same snapshot as the page.
 *
 * **The two reads arrive through the second argument** — 3.3's idiom, which the two
 * functions above predate. It is what lets the test assert the thing that matters most
 * here and has no return value: that a request for a student's id never reaches the
 * review query at all, and that the page offset handed to the repository is
 * `(page - 1) × pageSize` rather than `page × pageSize`, which is invisible on a seeded
 * database where every review list fits on one page.
 *
 * @param {object} query
 * @param {string} query.id a user id, already shape-checked by `teacherReviewsSchema`
 * @param {number} query.page      1-based
 * @param {number} query.pageSize  already capped at `MAX_PAGE_SIZE`
 * @param {typeof reviewDeps} [deps]
 * @returns {Promise<import('@tutor/shared').TeacherReviewsResponse>}
 */
export async function listTeacherReviews({ id, page, pageSize }, deps = reviewDeps) {
  const { loadTeacher, loadReviews } = { ...reviewDeps, ...deps };

  const teacher = await loadTeacher(id);

  if (!teacher) throw AppError.notFound('Teacher');

  const { reviews, total } = await loadReviews({
    teacherId: id,
    skip: (page - FIRST_PAGE) * pageSize,
    take: pageSize,
  });

  return { reviews: reviews.map(toTeacherReview), total };
}
