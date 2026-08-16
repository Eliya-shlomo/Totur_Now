import {
  createAndClassifyQuestion,
  createQuestionAttachment,
} from '#services/question.intake.service.js';

/**
 * Capture — the student's words and pixels reaching the database. DEV-A's half of
 * E3 (docs/epics/E3-question-intake/README.md → "The split").
 *
 * **`uploadAttachment` landed in 3.2 and `createQuestion` in 3.4.** The routes, their
 * middleware chains and their validators were wired in the frozen
 * `question.routes.js`, so each of those PRs replaced one function body and opened
 * nothing shared. Neither touched the router.
 *
 * `NOT_IMPLEMENTED` (501) rather than a missing route: a 404 says the endpoint does
 * not exist, and both tracks need the difference between "not built yet" and "you
 * called the wrong URL" while both are true at once.
 *
 * The classification half of the surface lives in `question.classify.controller.js`
 * and belongs to DEV-B. Never one `question.controller.js` — that file would be
 * edited by both developers in the same week, which is exactly the shape E1's
 * `user.repository.js` merge failure had.
 *
 * Neither handler imports the database client. A controller calls one service
 * function and writes the envelope (CONVENTIONS.md → Server layering); the reads and
 * writes are in `question.repository.js`, frozen since 3.1.
 */

/**
 * `POST /questions/attachments` — 201 `Attachment`. One image, before the question
 * it belongs to exists.
 *
 * `req.file` is Multer's, and `middlewares/upload.js` has already proved it is an
 * allowed image within the size cap and rewritten its `mimetype` to what the bytes
 * actually are. Nothing is re-checked here: a controller that validated its own input
 * would be a second copy of the allowlist.
 *
 * The row lands with `question_id = NULL`; `POST /questions` binds it later, scoped to
 * the same `uploaded_by` this request writes.
 *
 * Upload is the hard failure of the two external services in this epic: Cloudinary
 * either stored the image or it did not, and the student is told immediately —
 * `EXTERNAL_SERVICE_ERROR`, from `media.service`. That is the opposite of the
 * classifier, whose failure §8.1 forbids surfacing.
 */
export async function uploadAttachment(req, res) {
  const attachment = await createQuestionAttachment({
    studentId: req.user.id,
    file: req.file,
  });

  res.status(201).json({ success: true, data: attachment });
}

/**
 * `POST /questions` — 201 `QuestionResponse`. The endpoint the form posts to.
 *
 * 3.4 runs three steps in this order, and the order is the epic's contract rather
 * than an implementation detail:
 *
 *   1. `createQuestionWithSession(...)` — the question, its `PENDING` session and
 *      the attachments it claims, committed in one transaction
 *   2. `classifyQuestion({ rawText, imageUrls, declaredLevel })` — awaited outside
 *      that transaction, never inside it
 *   3. `updateQuestionClassification(id, ...)` with whatever came back
 *
 * Committed first, the student's typing survives an 8-second timeout on a cold
 * instance and the row is findable by `GET /questions/:id` whatever happens next.
 *
 * **A failed classification is still a 201.** `classificationOk: false` is a value in
 * the payload, not an error response — §8.1 is explicit that classification must not
 * block the flow, and `LLM_FAILED` exists in `shared/errorCodes.js` for a caller this
 * epic does not have.
 *
 * `attachmentIds` are checked with `findBindableAttachmentIds` before step 1, and
 * anything missing from that answer is one `VALIDATION_ERROR` — an id that does not
 * exist, one belonging to another student and one already bound to another question
 * are deliberately indistinguishable.
 *
 * The body arrives parsed and bounded by `createQuestionSchema`; `req.user.id` is the
 * owner and comes from the token, never from the payload. Spreading the validated body
 * rather than naming its three fields twice is safe precisely because the schema is
 * `.strict()` — an unknown key never reaches here.
 */
export async function createQuestion(req, res) {
  const question = await createAndClassifyQuestion({
    studentId: req.user.id,
    ...req.body,
  });

  res.status(201).json({ success: true, data: question });
}
