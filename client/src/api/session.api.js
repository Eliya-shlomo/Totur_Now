import { api } from '@/api/client';

/**
 * The student's half of the session surface — `POST /sessions/:id/offer` and
 * `GET /sessions/:id` (PR 5.8, MVP.md §12). Read by the selection screen and by the
 * awaiting screen, and by nothing else.
 *
 * A module of its own rather than functions in `offer.api.js`: that file is the
 * teacher answering an offer on the `/offers` mount, this one is the student creating
 * one and reading the session it belongs to. Two mounts, two audiences, and the server
 * makes the same split with two routers.
 *
 * Neither function names a user. The student comes from the token, and a caller that
 * could name one is a caller that could send an offer as somebody else.
 *
 * No `try` blocks: the interceptor in `client.js` unwraps `{ success, data }` and
 * rejects with an `ApiError`, and the screens decide what a failure looks like. No
 * timeout override either — both are ordinary database work, and the 15-second
 * instance default has been right since E1.
 */

/**
 * Send the offer. **The whole of E5's risk in one request** — the transaction behind
 * it takes an atomic lock on the teacher, so two students pressing at the same moment
 * produce one offer and one `TEACHER_UNAVAILABLE`.
 *
 * **201, and the body identifies the row it created.** `expiresAt` on it is absolute
 * and server-issued, which is what lets the countdown recompute rather than count.
 *
 * The price is deliberately not a parameter: the server reads it off the teacher's own
 * row and snapshots it onto the session, so there is no way for a client to name what
 * it is about to be charged.
 *
 * Four rejections the caller has to tell apart, all `ApiError` with `.is(code)`:
 *
 * - `TEACHER_UNAVAILABLE` (409) — somebody else got there first. Not an error state
 * - `INSUFFICIENT_CREDIT` (402) — the balance moved since the list was built
 * - `SESSION_NOT_ACTIVE` (409) — an offer is already out on this session
 * - `NOT_FOUND` (404) — no such session, or not this student's. Never `FORBIDDEN`
 *
 * @param {string} sessionId  the `PENDING` session's uuid, from `QuestionResponse`
 * @param {{teacherId: string}} choice  4.7's frozen callback payload, minus the price
 * @returns {Promise<import('@tutor/shared').OfferResponse>}
 */
export function sendOffer(sessionId, { teacherId }) {
  return api.post(`/sessions/${sessionId}/offer`, { teacherId });
}

/**
 * The session, shaped for whoever is asking — the student gets `OfferResponse`.
 *
 * **This is the awaiting screen's source of truth, and the socket is the accelerator.**
 * A screen built the other way round works on a desk and breaks on a train: the state
 * would live in whatever frames happened to arrive, and a reload would show nothing.
 *
 * Two properties of the answer the screen depends on:
 *
 * **`status` is the offer's, not the session's**, and a `PENDING` offer past its
 * instant is reported `EXPIRED` — the server evaluates `expires_at` on every read
 * because the cron is allowed to be asleep. So a student who reloads after the offer
 * died sees the resolution rather than a countdown that starts again.
 *
 * **Every offer-derived field is `null` on a session that has never had one**, rather
 * than a 404. That is the deviation 5.4 recorded: a session with no offer is what
 * every question looks like before the selection screen is used, and it belongs to
 * its student like any other.
 *
 * `questionId` is 5.8's addition to the same payload — the recovery link needs it and
 * nothing else survives a reload. Both deviations are in this PR's description.
 *
 * Rejects `NOT_FOUND` for a stranger's session, which is the same answer a session
 * that does not exist gets.
 *
 * @param {string} sessionId
 * @returns {Promise<import('@tutor/shared').OfferResponse & {questionId: string}>}
 */
export function getSession(sessionId) {
  return api.get(`/sessions/${sessionId}`);
}

/**
 * The room and a token for it — **the only way a client learns either value.** PR 6.4.
 *
 * The session's own payload carries `hasVideo` and nothing more: a room URL is a join
 * capability, so it leaves the server here, once, beside a token minted for one caller.
 *
 * **Called again on every join and on every reload, never cached.** The token names one
 * user and one room and expires in an hour; two people in a session hold two different
 * tokens. A module that stored one and handed it out again would be the
 * `POST /video/access` endpoint 6.1 deleted, wearing a different name — and the caller
 * that would have benefited is the one who should not have it.
 *
 * No room name and no display name are sent. The server reads both off the session row,
 * which is what stops a caller choosing the name on their own tile.
 *
 * Two rejections the caller has to tell apart, both `ApiError` with `.is(code)`:
 *
 * - `NOT_FOUND` (404) — no such session, not this caller's, or no longer `ACTIVE`. One
 *   answer for all three, deliberately: `FORBIDDEN` would confirm the id is real
 * - `EXTERNAL_SERVICE_ERROR` (502) — the provider is down. The session is still running
 *   and 6.7's screen renders everything except the call
 *
 * @param {string} sessionId
 * @returns {Promise<import('@tutor/shared').SessionVideoResponse>}
 */
export function getSessionVideo(sessionId) {
  return api.get(`/sessions/${sessionId}/video`);
}
