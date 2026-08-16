import { AppError } from '#utils/AppError.js';

/**
 * Classification — what the question is about, and the student's right to disagree.
 * DEV-B's half of E3 (docs/epics/E3-question-intake/README.md → "The split").
 *
 * **Stubs. Filled in by PR 3.5 (DEV-B), which owns this file.** Written here, in
 * DEV-A's blocking PR, so that 3.5 replaces two function bodies and a schema and
 * never opens the frozen router. The capture half is
 * `question.intake.controller.js` and belongs to DEV-A; the two files exist
 * separately for that reason and are never merged into one.
 *
 * Both handlers read through `question.repository.js` (frozen after this PR) and
 * serialize through `toQuestionResponse` in `#utils/questionView.js` — the same
 * serializer `POST /questions` uses, because the confirmation screen renders 3.4's
 * response on arrival and this one on reload, and two serializers is how those stop
 * matching.
 *
 * **Ownership is `NOT_FOUND`, not `FORBIDDEN`.** The repository's find-by-id does not
 * filter on the student; the check belongs here, and another student's question
 * answers `NOT_FOUND` because `FORBIDDEN` would confirm the id exists.
 *
 * Both stubs take no parameters, for the same reason as the intake pair.
 */

/**
 * `GET /questions/:id` — 200 `QuestionResponse`.
 *
 * Not in MVP.md §12, added by this epic for two callers: the confirmation screen on
 * reload, and the client whose `POST /questions` timed out while the server's work
 * carried on. That second one is why the question row is committed before the
 * classifier runs — there is always something here to come back to.
 *
 * 3.5 calls `findQuestionById(id)`, compares `studentId` with the caller, and
 * answers `toQuestionResponse(row)`.
 */
export async function getQuestion() {
  throw AppError.notImplemented('GET /questions/:id');
}

/**
 * `PATCH /questions/:id/classification` — 200, the question in the shape `GET`
 * returns. The student correcting the model (§8.1).
 *
 * 3.5 writes `topicId`, `subtopicId` and optionally `estimatedLevel` through
 * `updateQuestionClassification`, and **omits `classificationOk`**: that column
 * records whether the model succeeded, and a question the student had to correct is
 * still one the model got wrong. 3.8's retro wants that number honest.
 *
 * Both ids are written, never just the leaf. §9.2 scores the leaf at 1.0 and the
 * parent at 0.3, so a subtopic without its parent hands the matching engine half a
 * row.
 *
 * The session's status is the guard here: once an offer is out (§10) the
 * classification is what teachers were matched on, and re-classifying it is refused
 * rather than silently applied. `QUESTION_VIEW` selects that status for this reason.
 */
export async function patchQuestionClassification() {
  throw AppError.notImplemented('PATCH /questions/:id/classification');
}
