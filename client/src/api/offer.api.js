import { api } from '@/api/client';

/**
 * The teacher's two answers to an offer — `POST /offers/:id/accept` and
 * `/reject` (PR 5.4, MVP.md §12). The client half of PR 5.7's modal.
 *
 * A module of its own rather than two functions in `teacher.api.js`: an offer is not
 * the teacher's record, it is a row on a different table with a different lifetime,
 * and both endpoints are on the `/offers` mount rather than `/teachers`. Same split
 * the server makes with a second router.
 *
 * Neither function takes a teacher id. The server identifies the teacher from the
 * token and refuses an offer that is not theirs — a caller that could name a teacher
 * is a caller that could answer somebody else's offer.
 *
 * No `try` blocks: the interceptor unwraps `{ success, data }` and rejects with an
 * `ApiError`, and the modal decides what a failure looks like.
 */

/**
 * Take the question. The session becomes `ACTIVE` and the teacher `IN_SESSION`.
 *
 * **Answers `409 OFFER_EXPIRED` when the sixty seconds are up**, whatever the row
 * still says — the cron is allowed to be asleep, so the transaction re-checks
 * `expires_at` under the row lock. The modal must therefore never call this on
 * expiry: it would trade a clean disappearance for an error toast about the product
 * working correctly.
 *
 * Nothing is charged here and no Zoom link is created; that is E6 and E7. What comes
 * back is the session to navigate to.
 *
 * @param {string} offerId
 * @returns {Promise<{sessionId: string, status: string, startedAt: string, endsAt: string}>}
 */
export function acceptOffer(offerId) {
  return api.post(`/offers/${offerId}/accept`);
}

/**
 * Decline. The lock is released, the session goes back to `PENDING`, and this teacher
 * is appended to the question's `rejected_by` so E4 stops offering them for it.
 *
 * **200 even on an already-expired offer**, by design: dismissing something that has
 * already gone away is what the teacher wanted, and a 409 there would make a closing
 * modal look broken.
 *
 * @param {string} offerId
 * @returns {Promise<{offerId: string, sessionId: string, status: string}>}
 */
export function rejectOffer(offerId) {
  return api.post(`/offers/${offerId}/reject`);
}
