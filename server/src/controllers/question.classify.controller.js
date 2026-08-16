import {
  getStudentQuestion,
  overrideQuestionClassification,
} from '#services/question.classify.service.js';

/**
 * Classification — what the question is about, and the student's right to disagree.
 * DEV-B's half of E3 (docs/epics/E3-question-intake/README.md → "The split").
 *
 * **Both handlers landed in PR 3.5.** They were written as `NOT_IMPLEMENTED` stubs in
 * 3.1, DEV-A's blocking PR, so that 3.5 replaced two function bodies and a schema and
 * never opened the frozen router. The capture half is
 * `question.intake.controller.js` and belongs to DEV-A; the two files exist
 * separately for that reason and are never merged into one.
 *
 * Both handlers go through `question.classify.service.js`, which reads
 * `question.repository.js` (frozen since 3.1) and serializes through
 * `toQuestionResponse` in `#utils/questionView.js` — the same serializer
 * `POST /questions` uses, because the confirmation screen renders 3.4's response on
 * arrival and this one on reload, and two serializers is how those stop matching.
 *
 * **Ownership is `NOT_FOUND`, not `FORBIDDEN`**, and the check is in the service, not
 * in an `if` here: a controller calls one service function and writes the envelope
 * (CONVENTIONS.md → Server layering). Neither handler imports the database client.
 *
 * `req.user.id` is the owner in both, and it comes from the token — never from the
 * body, which is `.strict()` and could not carry it anyway.
 */

/**
 * `GET /questions/:id` — 200 `QuestionResponse`.
 *
 * Not in MVP.md §12, added by this epic for two callers: the confirmation screen on
 * reload, and the client whose `POST /questions` timed out while the server's work
 * carried on. That second one is why the question row is committed before the
 * classifier runs — there is always something here to come back to.
 *
 * The service calls `findQuestionById(id)`, compares `studentId` with the caller, and
 * answers `toQuestionResponse(row)`.
 */
export async function getQuestion(req, res) {
  const question = await getStudentQuestion({
    questionId: req.params.id,
    studentId: req.user.id,
  });

  res.json({ success: true, data: question });
}

/**
 * `PATCH /questions/:id/classification` — 200, the question in the shape `GET`
 * returns. The student correcting the model (§8.1).
 *
 * The service writes `topicId`, `subtopicId` and optionally `estimatedLevel` through
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
 *
 * Spreading the validated body rather than naming its three fields twice is safe
 * because `classificationOverrideSchema` is `.strict()` — an unknown key never
 * reaches here, and `subtopicId: 0` has already been normalised to `null`.
 */
export async function patchQuestionClassification(req, res) {
  const question = await overrideQuestionClassification({
    questionId: req.params.id,
    studentId: req.user.id,
    ...req.body,
  });

  res.json({ success: true, data: question });
}
