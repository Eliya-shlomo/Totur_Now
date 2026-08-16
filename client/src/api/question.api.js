import { api } from '@/api/client';
import { ApiError } from '@/api/ApiError';

/**
 * Capture — the two endpoints the question form posts to. PR 3.6, MVP.md §12.
 *
 * One module per server domain, and screens call these rather than `api` directly
 * (CONVENTIONS.md → Client). The interceptor in `client.js` already unwraps
 * `{ success, data }`, so both functions resolve to the payload itself and reject
 * with an `ApiError`.
 *
 * **Both calls override the instance's 15-second timeout, per request.**
 * `client/src/api/client.js` is a single-owner file and stays frozen at 15s for
 * everything else in the app — which is right for a `PATCH` that writes three columns
 * and wrong for the two requests in this codebase that wait on a third party. The
 * override is an axios per-request option here and never an edit there.
 *
 * The classification half of the surface is `question.classification.api.js` and
 * belongs to DEV-B (3.7). Never one `question.api.js` holding both.
 */

/**
 * The multipart field name — `ATTACHMENT_FIELD_NAME` in
 * `server/src/config/constants/question.js`.
 *
 * Three files have to agree on this string: the frozen router's `upload.single(...)`,
 * the Multer configuration behind it, and the `FormData.append` below. A mismatch is
 * not a validation error — Multer simply reports no file, and the endpoint fails as
 * if nothing was sent. `@tutor/shared` carries types and `ERROR_CODES` only, so this
 * is a mirror with the server file named beside it, the same arrangement
 * `components/auth/authRules.js` documents for the auth bounds.
 */
const ATTACHMENT_FIELD_NAME = 'image';

/**
 * How long one image may take, end to end.
 *
 * `CLOUDINARY_UPLOAD_TIMEOUT_MS` is 20 seconds server-side, and on a free Render
 * instance the request may also have woken the process up first (docs/DEPLOYMENT.md
 * §7). 45 seconds is that pair with room to spare: this timeout exists to stop a
 * spinner running forever, not to bound the upload — the server already does that,
 * and it answers `EXTERNAL_SERVICE_ERROR` when it fires.
 */
const UPLOAD_TIMEOUT_MS = 45_000;

/**
 * How long `POST /questions` may take.
 *
 * `LLM_TIMEOUT_MS` is 8 seconds and the classifier is awaited inside the request, so
 * the server's own worst legal answer is roughly 8 seconds plus two database round
 * trips. The 15-second instance default is *shorter than that* once a cold start is
 * added, which is the risk the epic README names: the request "fails" client-side
 * while the server carries on and commits a question row. 75 seconds covers a 60
 * second cold start plus the whole classification budget.
 */
const CREATE_TIMEOUT_MS = 75_000;

/**
 * Below this much of the budget, a response-less failure is a dead network rather
 * than our own timeout firing. Anything at or above it waited out the clock.
 */
const TIMEOUT_ATTRIBUTION_RATIO = 0.9;

/**
 * One image, uploaded the moment it is picked — before the question exists.
 *
 * `POST /questions/:id/attachments` does not exist and cannot: classification is a
 * Vision call *inside* `POST /questions`, so an image bound afterwards is one the
 * model never saw. The row comes back with `questionId: null` and is claimed later by
 * {@link createQuestion} through `attachmentIds`.
 *
 * **The instance's `Content-Type` is deleted rather than replaced.** `client.js` sets
 * `application/json` for every request; a `FormData` sent under that header reaches
 * Multer as a body it cannot parse, and the resulting error reads like a Cloudinary
 * problem. Setting the boundary by hand is not the fix either — only the browser
 * knows the boundary it generated. `null` removes the header, and axios then fills in
 * `multipart/form-data; boundary=…` itself.
 *
 * No `try` here: the screen decides what a failed thumbnail looks like, and the
 * server's `VALIDATION_ERROR` for an oversized or non-image file arrives with
 * `details.image` already written for a person to read.
 *
 * @param {File} file  straight from the file input
 * @returns {Promise<import('@tutor/shared').Attachment>}
 */
export function uploadAttachment(file) {
  const body = new FormData();

  body.append(ATTACHMENT_FIELD_NAME, file);

  return api.post('/questions/attachments', body, {
    timeout: UPLOAD_TIMEOUT_MS,
    headers: { 'Content-Type': null },
  });
}

/**
 * The question itself — text, the declared level, and the ids of whatever was
 * uploaded while the student was typing.
 *
 * Answers a `QuestionResponse` whose `id` is the `:id` in `/app/ask/:id/matching`.
 * The classification rides along in that payload and this module does not read it:
 * this screen owns the request, 3.7's screen owns the result.
 *
 * A timed-out request is re-thrown with a message that does not claim a failure this
 * client cannot verify — see {@link toUnverifiedError}.
 *
 * @param {{rawText: string, declaredLevel?: number, attachmentIds?: string[]}} payload
 * @returns {Promise<import('@tutor/shared').QuestionResponse>}
 */
export async function createQuestion(payload) {
  const startedAt = Date.now();

  try {
    return await api.post('/questions', payload, { timeout: CREATE_TIMEOUT_MS });
  } catch (error) {
    throw toUnverifiedError(error, Date.now() - startedAt);
  }
}

/**
 * "We stopped waiting" is not "it did not happen."
 *
 * The question row is committed *before* the classifier runs, so a request this
 * client abandoned has very often already written one — that ordering is the epic's
 * contract and `GET /questions/:id` (3.5) is the recovery path it exists for. Telling
 * the student their question failed would be a claim we cannot support, and the
 * student's answer to it is to type the whole thing again.
 *
 * The distinction has to be drawn here because it does not survive `client.js`: a
 * timeout and a dead network both arrive as `ApiError.network()`, with no status and
 * the same message. What separates them is how long we waited, which only the caller
 * knows — hence the elapsed time rather than a look at the axios error, and hence no
 * edit to the frozen file.
 *
 * The code and status are carried through unchanged, so anything switching on
 * `ERROR_CODES` still sees what it saw.
 */
function toUnverifiedError(error, elapsedMs) {
  const isResponseless = error instanceof ApiError && error.status === null;

  if (!isResponseless || elapsedMs < CREATE_TIMEOUT_MS * TIMEOUT_ATTRIBUTION_RATIO) return error;

  return new ApiError(
    error.code,
    'This is taking longer than usual. Your question may already have been saved — wait a moment before sending it again.',
    error.details,
    error.status,
  );
}
