import { UNCLASSIFIED_TOPIC_ID } from '#config/constants/index.js';

/**
 * Question row → `QuestionResponse`, the one shape both E3 endpoints answer with.
 *
 * Written in PR 3.1 and shared on purpose: `POST /questions` (3.4, DEV-A) and
 * `GET /questions/:id` (3.5, DEV-B) must be byte-for-byte identical for the same
 * question, because the confirmation screen renders one on arrival and the other on
 * reload. Two serializers is how those two stop matching — E2 solved the same
 * problem the same way with `teacherView.js`, and its retro's best outcome was a
 * view written once and read by three screens.
 *
 * The contract lives in `shared/api.d.ts` under `// ── E3`.
 */

/**
 * Columns that never leave the server.
 *
 * `studentId` is the ownership check and stays behind it. `rejectedBy` is E4's
 * state and is not even selected by the repository. Nothing here is a filter a
 * caller has to remember: the row arrives shaped by `QUESTION_VIEW`, and this
 * function names every field it emits.
 */
export function toQuestionResponse(row) {
  return {
    id: row.id,
    rawText: row.rawText,
    declaredLevel: row.declaredLevel ?? null,
    classification: toClassification(row),
    attachments: row.attachments.map(toAttachment),
    sessionId: row.session?.id ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * The classification columns, as the client reads them.
 *
 * `topicId` falls back to the sentinel rather than to `null`. A question always has
 * a topic — "General / Unclassified" is an answer, and §8.1's whole point is that
 * the flow continues with it. A null here would make every consumer invent its own
 * default, which is how two screens end up disagreeing about what "unclassified"
 * looks like.
 *
 * `teacherBrief` and `studentConfirmation` both fall back to the student's own
 * text, which is also what `classification.service.js` writes on the fallback path.
 * The contract types both as `string`, never null, and a row read between its insert
 * and its classification update has neither column filled yet — `GET /questions/:id`
 * can legally see that window, so the two defaults live here rather than in a
 * consumer that would have to invent them.
 *
 * `howToStart` does **not** fall back to the raw text, and it is the one field here
 * that may legitimately be null: the student's words are their question, never their
 * opening move. The same argument `classification.service.js`'s fallback makes.
 *
 * `confidence` is a `Decimal`, which serializes to a **string** through
 * `JSON.stringify` and would reach the client as `"0.91"`. The contract says
 * number; `Number()` is that conversion, in the one place that owns the payload.
 */
function toClassification(row) {
  return {
    title: row.title ?? null,
    topicId: row.topicId ?? UNCLASSIFIED_TOPIC_ID,
    subtopicId: row.subtopicId ?? null,
    difficulty: row.difficulty ?? null,
    estimatedLevel: row.estimatedLevel ?? null,
    teacherBrief: row.teacherBrief ?? row.rawText,
    howToStart: row.howToStart ?? null,
    studentConfirmation: row.studentConfirmation ?? row.rawText,
    confidence: row.llmConfidence === null ? 0 : Number(row.llmConfidence),
    classificationOk: row.classificationOk,
  };
}

/** One stored image. The uploader is not part of the payload — the reader is always its owner. */
function toAttachment(row) {
  return {
    id: row.id,
    fileUrl: row.fileUrl,
    mimeType: row.mimeType,
  };
}
