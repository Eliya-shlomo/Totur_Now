import { api } from '@/api/client';

/**
 * Classification — reading one question back, and correcting it. PR 3.7, MVP.md §12.
 *
 * The mirror of `question.api.js`: that module is DEV-A's capture half, this one is
 * DEV-B's. Both hit `/questions`, and the epic keeps them in separate files because
 * they are separate owners with separate screens
 * (docs/epics/E3-question-intake/README.md → "The split").
 *
 * One module per server domain, and screens call these rather than `api` directly
 * (CONVENTIONS.md → Client). The interceptor in `client.js` already unwraps
 * `{ success, data }`, so both functions resolve to the payload itself and reject
 * with an `ApiError`. No `try` blocks here: the screen decides what a failure looks
 * like, and swallowing it would take that decision away.
 *
 * **Neither call overrides the instance timeout.** The 15-second default in
 * `client.js` is right for both: this is the half of the surface that does not call a
 * model. `POST /questions` needs a longer budget because the classifier runs inside
 * it, and 3.6 sets that per request — a read of three columns and a write of two do
 * not.
 */

/**
 * One question, with its classification, attachments and session id.
 *
 * The screen calls this on mount rather than trusting router state, which is the
 * whole reason 3.5 added the endpoint: a reload must work, and a student whose
 * `POST /questions` timed out while the server carried on finds their question here.
 *
 * Another student's id answers `NOT_FOUND`, never `FORBIDDEN` — the server does not
 * confirm which ids exist, and neither does this screen.
 *
 * @param {string} id
 * @returns {Promise<import('@tutor/shared').QuestionResponse>}
 */
export function getQuestion(id) {
  return api.get(`/questions/${id}`);
}

/**
 * The student's correction (§8.1). Answers the whole question in the shape
 * {@link getQuestion} returns, so the screen re-renders from the response rather than
 * re-fetching.
 *
 * **Both ids go together.** §9.2 scores the leaf at 1.0 and the parent at 0.3, so a
 * subtopic without its parent hands the matching engine half a row; the server
 * enforces the pair and this signature makes sending half of it awkward on purpose.
 *
 * `estimatedLevel` is optional and omitted rather than nulled when the student did
 * not touch it — an absent key leaves the model's estimate in place.
 *
 * `SESSION_NOT_ACTIVE` (409) means an offer is already out and the classification is
 * what teachers were matched on. That is a branch on the screen, not a retry.
 *
 * @param {string} id
 * @param {import('@tutor/shared').ClassificationOverrideRequest} override
 * @returns {Promise<import('@tutor/shared').QuestionResponse>}
 */
export function patchClassification(id, override) {
  return api.patch(`/questions/${id}/classification`, override);
}
