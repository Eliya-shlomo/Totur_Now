import { DEFAULT_DECLARED_LEVEL } from '#config/constants/index.js';
import {
  createAttachment,
  createQuestionWithSession,
  findBindableAttachmentIds,
  updateQuestionClassification,
} from '#repositories/question.repository.js';
import { classifyQuestion } from '#services/classification.service.js';
import { uploadQuestionImage } from '#services/media.service.js';
import { AppError } from '#utils/AppError.js';
import { toQuestionResponse } from '#utils/questionView.js';

/**
 * Capture — the student's words and pixels reaching the database. DEV-A's half of E3.
 *
 * PR 3.2 filled in the attachment half; PR 3.4 adds the create flow below and
 * orchestrates commit → classify → update. The two share this file because they share
 * the repository calls and neither of them is DEV-B's.
 *
 * No request or response object reaches this layer, and no controller below it
 * touches the database (CONVENTIONS.md → Server layering).
 */

/**
 * Store one image and record the row that will later be bound to a question.
 *
 * Two steps in one direction, and the order is the safe one: the bytes reach
 * Cloudinary first, and only a stored URL becomes a row. The reverse — a row written
 * optimistically and updated after the upload — leaves an attachment id a student can
 * send to `POST /questions` while it points at nothing.
 *
 * The row lands with `question_id = NULL` and `uploaded_by` set to the caller, which
 * is the pair `POST /questions` later reads as "mine, and not yet used". A failed
 * upload writes nothing at all.
 *
 * **An orphan row is the accepted failure mode.** A student who uploads a photo and
 * then abandons the form leaves a Cloudinary asset and an unbound row behind. Neither
 * is reachable — `findBindableAttachmentIds` scopes to the uploader, so nobody else
 * can claim it — and a sweep of `question_id IS NULL` older than a day is a job for
 * whoever owns cleanup, not a reason to make the upload transactional against a
 * question that does not exist yet.
 *
 * The repository already selects exactly the contract's `Attachment` — id, fileUrl,
 * mimeType — so there is no serializer here. `questionView.js` owns the shape of a
 * *question*, and an attachment inside one goes through it there.
 *
 * @param {object} input
 * @param {string} input.studentId  the caller, from `req.user.id`
 * @param {{buffer: Buffer, mimetype: string}} input.file  Multer's file, already
 *   proved to be an allowed image by `middlewares/upload.js`
 * @returns {Promise<import('@tutor/shared').Attachment>}
 */
export async function createQuestionAttachment({ studentId, file }) {
  const { fileUrl, mimeType } = await uploadQuestionImage({
    buffer: file.buffer,
    // The detected type, which the upload middleware wrote back over the declared
    // one. Storing what the uploader claimed would put a lie in a column that 3.3's
    // Vision call reads.
    mimeType: file.mimetype,
  });

  return createAttachment({ uploadedBy: studentId, fileUrl, mimeType });
}

/**
 * The real collaborators, replaced wholesale in tests.
 *
 * The same idiom `classification.service.js` uses, for the same reason: the ordering
 * this PR's review checklist cares about — committed *before* the classifier runs —
 * is a property of the call sequence, and a unit test cannot observe a sequence it
 * cannot intercept. `node --test`'s module mocking would need a flag on the root
 * `npm test` script that this PR is not allowed to touch.
 *
 * `classify` is DEV-B's seam, injected rather than imported at the call site so a test
 * can hold it open and prove the transaction already closed. It is never *wrapped*:
 * §8.1's fallback lives inside it and belongs to 3.3 alone.
 */
const defaultDeps = {
  findBindable: findBindableAttachmentIds,
  createWithSession: createQuestionWithSession,
  classify: classifyQuestion,
  updateClassification: updateQuestionClassification,
};

/**
 * `POST /questions` — the endpoint the whole product funnels through. MVP.md §12.
 *
 * Four steps, and the order is the epic's contract rather than an implementation
 * detail:
 *
 *   1. check the claimed attachments are the caller's and unbound
 *   2. commit the question, its `PENDING` session and those attachments — one
 *      transaction, closed before anything slow starts
 *   3. classify, awaited **outside** that transaction
 *   4. write what came back, and answer with the whole question
 *
 * **Step 2 commits before step 3 begins**, which is the property this PR exists to
 * get right. An implementation that opened a transaction, awaited an 8-second Vision
 * call inside it and committed at the end would hold one Neon connection per question
 * — on a free instance that is the entire pool under any load — and it would throw
 * away the recovery `GET /questions/:id` depends on. Committed first, a student whose
 * request times out on a cold instance still has a durable row to come back to, and
 * `classification_ok` stays `false` until step 4 says otherwise.
 *
 * **A failed classification is still a `201`.** `classifyQuestion` cannot throw —
 * that is 3.3's acceptance criterion — so there is no `try` here and no error branch
 * to design. `classificationOk: false` is a value in the payload, not a status code,
 * and `LLM_FAILED` in `shared/errorCodes.js` is for a caller this epic does not have.
 *
 * @param {object} input
 * @param {string} input.studentId  the caller, from `req.user.id`
 * @param {string} input.rawText    trimmed and bounded by `createQuestionSchema`
 * @param {number} [input.declaredLevel]  3 | 4 | 5, or absent
 * @param {string[]} [input.attachmentIds]  shape-checked by the schema, ownership here
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<import('@tutor/shared').QuestionResponse>}
 */
export async function createAndClassifyQuestion(
  { studentId, rawText, declaredLevel = DEFAULT_DECLARED_LEVEL, attachmentIds = [] },
  deps = defaultDeps,
) {
  const { findBindable, createWithSession, classify, updateClassification } = {
    ...defaultDeps,
    ...deps,
  };

  await assertAttachmentsAreBindable({ attachmentIds, studentId, findBindable });

  const committed = await createWithSession({ studentId, rawText, declaredLevel, attachmentIds });

  const classification = await classify({
    rawText,
    // Read from the rows just bound rather than from the request. An id the caller
    // sent but the transaction did not bind is an image the model must not be shown,
    // and this is the only reading of "the attachments" that cannot disagree with the
    // database.
    imageUrls: committed.attachments.map((attachment) => attachment.fileUrl),
    declaredLevel,
  });

  const classified = await updateClassification(
    committed.id,
    toClassificationColumns(classification),
  );

  return toQuestionResponse(classified);
}

/**
 * "These attachments are mine, and none of them is spoken for."
 *
 * The one way this endpoint could leak a stranger's photograph into a stranger's
 * question, so `attachmentIds` is checked rather than trusted. `findBindableAttachmentIds`
 * answers with the subset that is both the caller's and still unbound, and anything
 * missing from that answer is a single `VALIDATION_ERROR`: an id that does not exist,
 * one belonging to another student and one already bound to another question are
 * deliberately indistinguishable, because distinguishing them would turn this endpoint
 * into a way to learn that somebody else's attachment id is real.
 *
 * **It runs before the insert**, so a rejected request leaves no question row behind —
 * one of this PR's acceptance criteria, and the reason this is not folded into the
 * transaction's `where` clause. The `where` clause is still there and still narrower;
 * it is what makes this check race-proof rather than advisory when two requests claim
 * the same attachment at once.
 *
 * A repeated id fails here too, and that is the intended answer: the same image twice
 * comes back from the repository once, so the counts disagree. `MAX_ATTACHMENTS` is 3
 * and the form sends what it uploaded — a duplicate is a client bug, and silently
 * binding it once would hide that.
 */
async function assertAttachmentsAreBindable({ attachmentIds, studentId, findBindable }) {
  if (attachmentIds.length === 0) return;

  const bindable = await findBindable(attachmentIds, studentId);

  if (bindable.length !== attachmentIds.length) {
    throw AppError.validation('Some of those images cannot be attached.', {
      attachmentIds: 'Upload the images with this account, and attach each one once.',
    });
  }
}

/**
 * `Classification` → the columns `updateQuestionClassification` writes.
 *
 * One rename, and it is the reason this function exists rather than the object being
 * passed straight through: the contract calls it `confidence` and the column is
 * `llm_confidence`, because `questions` will carry a second confidence the day E4
 * scores a match. Spelling the mapping out here keeps the repository's `data` argument
 * something a reader can check against the schema, and keeps 3.5 — which writes the
 * same columns from the student's override, minus this one — reading the same names.
 */
function toClassificationColumns(classification) {
  return {
    title: classification.title,
    topicId: classification.topicId,
    subtopicId: classification.subtopicId,
    difficulty: classification.difficulty,
    estimatedLevel: classification.estimatedLevel,
    teacherBrief: classification.teacherBrief,
    howToStart: classification.howToStart,
    studentConfirmation: classification.studentConfirmation,
    llmConfidence: classification.confidence,
    classificationOk: classification.classificationOk,
  };
}
