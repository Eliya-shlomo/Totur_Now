import { api } from '@/api/client';

/**
 * The teacher's own record — `GET` and `PATCH /teachers/me` (PR 2.2), and since 8.5
 * their per-topic reputation at `GET /teachers/me/stats`.
 *
 * The write half of the teacher surface, and the mirror of `teacher.public.api.js`:
 * that module is what a stranger reads about a teacher, this one is what a teacher
 * does to themselves. Both hit `/teachers`, and the epic keeps them in separate files
 * because they are separate audiences with separate owners
 * (docs/epics/E2-teacher-onboarding/README.md).
 *
 * Every call here is authenticated. The access token is attached by the interceptor
 * in `client.js` and never handled at this layer — there is no token parameter below
 * and there must not be one. The server identifies the row from the token alone;
 * `PATCH /teachers/:id` does not exist and no function here takes an id.
 *
 * One module per server domain, and screens call these rather than `api` directly
 * (CONVENTIONS.md → Client). The interceptor already unwraps `{ success, data }`, so
 * both functions resolve to the payload itself and reject with an `ApiError`. No
 * `try` blocks: the screen decides what a failure looks like, and swallowing it here
 * would take that decision away.
 */

/**
 * The authenticated teacher's own record, including the four fields a stranger never
 * sees — `status`, the two counters, and `onboardingComplete`.
 *
 * `onboardingComplete` is computed server-side in `utils/teacherView.js` and read
 * here, never re-derived: two definitions of "done" is a teacher who is finished on
 * one screen and unfinished on another (the epic README → Risks).
 *
 * @returns {Promise<import('@tutor/shared').TeacherMeResponse>}
 */
export function getTeacherMe() {
  return api.get('/teachers/me');
}

/**
 * Update part of the record. Always a partial — the stepper sends one step at a time.
 *
 * `topicIds` replaces the whole set rather than merging, so a teacher can remove a
 * topic; that is the contract's decision, not this function's. An empty object is a
 * `VALIDATION_ERROR` from the server rather than a no-op success, which is why no
 * caller should send one "just to refresh" — use {@link getTeacherMe} for that.
 *
 * Going online is this same call with `{ status: 'ONLINE' }` rather than an endpoint
 * of its own, because the server has one endpoint. Only `OFFLINE` and `ONLINE` are
 * accepted; `OFFER_LOCKED` and `IN_SESSION` belong to the matching engine (E4).
 *
 * @param {import('@tutor/shared').TeacherUpdateRequest} patch
 * @returns {Promise<import('@tutor/shared').TeacherMeResponse>} the record as it now is
 */
export function updateTeacherMe(patch) {
  return api.patch('/teachers/me', patch);
}

/**
 * The teacher's own reputation, one row per topic — `GET /teachers/me/stats` (PR 8.5).
 *
 * **The only place in the product where §9.3's parent propagation is visible.** A
 * session on a subtopic counts fully toward that subtopic and at 0.3 toward its parent,
 * which is why a row can honestly read `12.6` sessions. The server sends the stored
 * value and never rounds it — the teacher's figures have to match the ones the matching
 * engine ranks them on — so any rounding is the screen's decision and is made in
 * `TopicStatsCard.jsx`.
 *
 * Unpaged, unlike the reviews list in `teacher.public.api.js`: a teacher has at most one
 * row per topic in a fifteen-topic taxonomy, and the endpoint rejects a query string
 * rather than ignoring one.
 *
 * No id parameter, like everything else in this file. The row set is the token's.
 *
 * @returns {Promise<import('@tutor/shared').TeacherStatsResponse>}
 */
export function getMyTopicStats() {
  return api.get('/teachers/me/stats');
}
