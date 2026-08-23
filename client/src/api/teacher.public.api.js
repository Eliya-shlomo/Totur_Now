import { api } from '@/api/client';

/**
 * The public teacher surface — `GET /teachers` and `GET /teachers/:id` (PR 2.3), and
 * `GET /teachers/:id/reviews` (PR 8.3).
 *
 * No authentication on any of them. A stranger compares teachers before deciding
 * whether to register, so these are the requests the app makes on behalf of somebody
 * who has no session at all.
 *
 * One module per server domain, and screens call these rather than `api` directly
 * (CONVENTIONS.md → Client). The interceptor in `client.js` already unwraps
 * `{ success, data }`, so both functions resolve to the payload itself and reject
 * with an `ApiError`. No `try` blocks here: the screen decides what a failure looks
 * like.
 */

/**
 * A filtered, paged list of teacher cards.
 *
 * Undefined values are dropped by axios rather than sent as `?topicId=undefined`,
 * which matters because the server's query schema is `.strict()` and would reject
 * the string. So an absent filter is simply absent from the request.
 *
 * @param {object} [params]
 * @param {number} [params.topicId]     leaf topic id
 * @param {number} [params.level]       matches `levelMax >= level`
 * @param {'A'|'B'|'C'} [params.band]   a ceiling, not a bracket — MVP.md §5.2
 * @param {boolean} [params.onlineOnly]
 * @param {number} [params.page]        1-based
 * @param {number} [params.pageSize]    capped server-side
 * @returns {Promise<import('@tutor/shared').TeacherListResponse>}
 */
export function getTeachers(params = {}) {
  return api.get('/teachers', { params });
}

/**
 * One teacher's public card.
 *
 * Rejects with `NOT_FOUND` for a user id that is not a teacher — a student's id, or
 * nobody's. The screen renders the 404 page for that rather than an empty profile.
 *
 * @param {string} id a user id
 * @returns {Promise<import('@tutor/shared').TeacherCard>}
 */
export function getTeacher(id) {
  return api.get(`/teachers/${id}`);
}

/**
 * A page of what students wrote about one teacher (PR 8.3).
 *
 * Unauthenticated like the two above — this is a public profile, read by strangers.
 * **No student comes back**, in any form: the payload is the review, its stars, its
 * comment, the topic and the date. That is a server-side decision (`toTeacherReview`)
 * and nothing here needs to filter it.
 *
 * Rejects with `NOT_FOUND` for a user id that is not a teacher's, the same way
 * `getTeacher` does, so a screen holding both can render one 404 for the pair.
 *
 * @param {string} id a user id
 * @param {object} [params]
 * @param {number} [params.page]      1-based
 * @param {number} [params.pageSize]  capped server-side
 * @returns {Promise<import('@tutor/shared').TeacherReviewsResponse>}
 */
export function getTeacherReviews(id, params = {}) {
  return api.get(`/teachers/${id}/reviews`, { params });
}
