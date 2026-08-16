import { prisma } from '#config/db.js';

/**
 * Every question query either track needs. `questions`, `question_attachments` and
 * the `PENDING` session created beside them — MVP.md §11.2, §12.
 *
 * **This file is frozen after PR 3.1.** The same rule as `teacher.repository.js`,
 * for the same reason: in E1 the router was frozen and never conflicted, while
 * `user.repository.js` was written by two parallel PRs and the merge produced a
 * file that would not parse. E2 ran two tracks over one table with both files
 * frozen and neither track opened them once (docs/epics/E2-teacher-onboarding/RETRO.md).
 * E3 runs two tracks over `questions`: DEV-A captures (3.2, 3.4), DEV-B classifies
 * (3.3, 3.5). Both call this file; neither edits it.
 *
 * A query missing here is not a small omission — it is an unfrozen file. If a later
 * PR needs something that is not below, that is a chat message before any code.
 *
 * Three rules everything here follows:
 *
 * **One shared `select`.** `QUESTION_VIEW` is spread into every read, so
 * `POST /questions` and `GET /questions/:id` are structurally unable to disagree
 * about which columns exist.
 *
 * **Attachments and the session come back with the question, never after it.** The
 * nested selects below are one round trip whatever the attachment count — E2's
 * `GET /teachers` N+1 lesson, applied before anyone can get it wrong.
 *
 * **This file writes `sessions.status` exactly once, to `PENDING`, and never reads
 * it back to change it.** Every later state change goes through `session.service`
 * (CONVENTIONS.md), which E6 owns and which does not exist yet. See
 * `createQuestionWithSession` for what moves when it does.
 */

/**
 * The columns and relations every question read returns — enough for
 * `toQuestionResponse` in `#utils/questionView.js` and nothing more.
 *
 * An explicit `select`, never the whole row: `rejectedBy` is matching-engine state
 * (E4) and has no business in a student-facing payload, and a column added to
 * `questions` later is invisible to both endpoints until a human adds it here.
 *
 * `session` is selected down to `id` and `status`. 3.5 needs the status to refuse a
 * re-classification once an offer is out (§10), and the client needs the id to walk
 * on to matching. Nothing else about a session belongs to this epic.
 *
 * `studentId` is selected but never serialized — it is the ownership check, and
 * `NOT_FOUND` for someone else's question depends on having it in hand.
 */
const QUESTION_VIEW = {
  id: true,
  studentId: true,
  rawText: true,
  declaredLevel: true,
  title: true,
  topicId: true,
  subtopicId: true,
  difficulty: true,
  estimatedLevel: true,
  teacherBrief: true,
  studentConfirmation: true,
  llmConfidence: true,
  classificationOk: true,
  createdAt: true,
  attachments: {
    select: { id: true, fileUrl: true, mimeType: true },
    orderBy: { id: 'asc' },
  },
  session: { select: { id: true, status: true } },
};

/**
 * The write behind `POST /questions` (3.4): the question, its `PENDING` session and
 * the attachments it claims, in one transaction.
 *
 * **Committed before the classifier runs.** The caller inserts here, awaits
 * `classifyQuestion`, then calls `updateQuestionClassification` below. That order is
 * the epic's contract, not an implementation detail: an 8-second Vision call inside
 * this transaction would hold a Neon connection per question, and a student whose
 * request timed out would have nothing to come back to. Committed first, the row is
 * findable by `GET /questions/:id` whatever happens next.
 *
 * **Attachment binding is scoped twice.** `uploadedBy` must be the caller and
 * `questionId` must still be null — mine, and not yet used. The caller has already
 * checked the same pair through `findBindableAttachmentIds` and answered
 * `VALIDATION_ERROR`; the `where` here is what makes that check race-proof rather
 * than advisory, because two requests claiming the same attachment cannot both
 * match it.
 *
 * **The session insert moves to `session.service` in E6.** Three columns are written
 * — `questionId`, `studentId`, `status` — and nothing else: no price, no timing, no
 * money. When E6 lands, that is one call to relocate.
 *
 * @param {object} input
 * @param {string} input.studentId
 * @param {string} input.rawText
 * @param {number|null} [input.declaredLevel]  3 | 4 | 5; the caller resolves the default
 * @param {string[]} [input.attachmentIds]     already validated as bindable by the caller
 * @returns {Promise<object>} the row shaped by `QUESTION_VIEW`
 */
export async function createQuestionWithSession({
  studentId,
  rawText,
  declaredLevel = null,
  attachmentIds = [],
}) {
  return prisma.$transaction(async (tx) => {
    const question = await tx.question.create({
      data: { studentId, rawText, declaredLevel },
      select: { id: true },
    });

    await tx.session.create({
      data: { questionId: question.id, studentId, status: 'PENDING' },
      select: { id: true },
    });

    if (attachmentIds.length > 0) {
      await tx.questionAttachment.updateMany({
        where: { id: { in: attachmentIds }, uploadedBy: studentId, questionId: null },
        data: { questionId: question.id },
      });
    }

    return tx.question.findUnique({ where: { id: question.id }, select: QUESTION_VIEW });
  });
}

/**
 * The write behind step 3 of `POST /questions` and behind
 * `PATCH /questions/:id/classification` — the only function that touches the
 * classification columns.
 *
 * One function for both callers on purpose. 3.4 writes what the model said, 3.5
 * writes what the student said instead, and both are the same six columns; two
 * update functions would be two opinions about which columns those are.
 *
 * `classificationOk` is written by 3.4 and deliberately **not** by 3.5: the column
 * records whether the *model* succeeded, and a question the student corrected is
 * still a question the model got wrong. 3.8's retro wants that number honest, so
 * the override simply omits the key and Prisma leaves the column alone.
 *
 * @param {string} questionId
 * @param {object} classification  any subset of the classification columns
 * @returns {Promise<object>} the updated row shaped by `QUESTION_VIEW`
 */
export async function updateQuestionClassification(questionId, classification) {
  return prisma.question.update({
    where: { id: questionId },
    data: classification,
    select: QUESTION_VIEW,
  });
}

/**
 * One question with its attachments and its session — `GET /questions/:id` (3.5),
 * and the read `POST /questions` answers with.
 *
 * Ownership is not filtered here. The caller compares `studentId` and answers
 * `NOT_FOUND` for a stranger's question rather than `FORBIDDEN`, because
 * `FORBIDDEN` would confirm the id exists. A `where` clause on `studentId` would
 * make those two cases indistinguishable from a missing row, which is the same
 * answer today and the wrong one the first time an admin screen calls this.
 *
 * @param {string} id
 * @returns {Promise<object|null>} the row shaped by `QUESTION_VIEW`
 */
export async function findQuestionById(id) {
  return prisma.question.findUnique({ where: { id }, select: QUESTION_VIEW });
}

/**
 * The row behind `POST /questions/attachments` (3.2): an image that exists before
 * the question it belongs to does.
 *
 * `questionId` stays null until `createQuestionWithSession` binds it. `uploadedBy`
 * is what makes that binding checkable at all — it was added to the schema in this
 * PR, because without it "you cannot attach another student's photo" is a rule with
 * nothing behind it. See `prisma/schema/questions.prisma`.
 *
 * @param {object} input
 * @param {string} input.uploadedBy  the caller's user id
 * @param {string} input.fileUrl     the stored URL, from `media.service`
 * @param {string} input.mimeType    the parsed type, already checked against the allowlist
 * @returns {Promise<{id: string, fileUrl: string, mimeType: string|null}>}
 */
export async function createAttachment({ uploadedBy, fileUrl, mimeType }) {
  return prisma.questionAttachment.create({
    data: { uploadedBy, fileUrl, mimeType },
    select: { id: true, fileUrl: true, mimeType: true },
  });
}

/**
 * Which of these attachment ids the caller may actually attach — the check behind
 * `attachmentIds` on `POST /questions` (3.4).
 *
 * One query for the whole array rather than one per id, and one predicate for both
 * failure modes: an id that does not exist, an id belonging to another student and
 * an id already bound to another question all come back the same way — absent. The
 * caller compares what returns against what it sent and answers a single
 * `VALIDATION_ERROR`, which is also the answer that leaks the least: a student
 * cannot use this endpoint to learn that somebody else's attachment id is real.
 *
 * @param {string[]} attachmentIds
 * @param {string} uploadedBy
 * @returns {Promise<string[]>} the bindable subset
 */
export async function findBindableAttachmentIds(attachmentIds, uploadedBy) {
  const rows = await prisma.questionAttachment.findMany({
    where: { id: { in: attachmentIds }, uploadedBy, questionId: null },
    select: { id: true },
  });

  return rows.map((row) => row.id);
}
