# PR 3.5 — `GET /questions/:id` + `PATCH /questions/:id/classification`

| | |
|---|---|
| **Epic** | E3 — Question Intake & LLM Classification |
| **Owner** | DEV-B (rotem) |
| **Size** | S |
| **Written by** | Agent |
| **Depends on** | 3.4 (merged) |
| **Blocks** | 3.7 |
| **Branch** | `dev-b/E3.5-classification-override` |

## Contract implemented

`QuestionResponse` and `ClassificationOverrideRequest` from the epic's contract freeze.
`MVP.md` §12 (`PATCH /questions/:id/classification` — "Student's manual correction"), §8.1 (the
manual override is what makes `student_confirmation` worth showing).

## Scope

Two small endpoints, both scoped to the question's owner.

**`GET /questions/:id`** — the same `QuestionResponse` `POST /questions` returned, read through 3.1's
frozen single-query find-with-attachments. Not in `MVP.md` §12; it exists for two reasons the epic
README argues: the confirmation screen must survive a reload, and it is the recovery path when the
client's request timed out but the server's work did not.

**`PATCH /questions/:id/classification`** — the student disagreeing with the machine. Sets
`topic_id`, `subtopic_id` and optionally `estimated_level`, and returns the updated
`QuestionResponse`.

The rules, all of which exist because E4 reads these columns:

- **`subtopicId` must be a leaf that exists**, and `topicId` must be its parent. Validate against the
  taxonomy, not against a hardcoded range — reuse the check 3.3 wrote rather than writing a second
  one. This is the same disagreement E2 shipped between its seed and `assertLeafTopics`; do not
  reintroduce it on the question side.
- **`subtopicId: null` with `topicId: 0` is legal** — "none of these" is an answer, and it is exactly
  what the fallback path already stored.
- **`estimatedLevel`, when present, is 3/4/5.**
- **The override does not touch `classification_ok`.** That column records whether the *LLM*
  succeeded, and 3.8's verification wants that number honest. A question the student corrected is
  still a question the machine got wrong.
- **Ownership**: a question belonging to another student is `NOT_FOUND`, not `FORBIDDEN`. A student
  should not be able to discover which question ids exist.
- **State**: only a question whose session is still `PENDING` may be re-classified. Once E5 sends an
  offer, the teacher has read a brief and re-topicing underneath them is a different feature.
  `SESSION_NOT_ACTIVE` already exists in `shared/errorCodes.js` at 409 and is the right code — the
  request collided with a state, it is not a missing resource.

## Files you may touch

```
server/src/controllers/question.classify.controller.js   new
server/src/services/question.classify.service.js         new
server/src/validators/question.classify.schema.js        new
server/tests/question.classify.test.js                   new
docs/epics/E3-question-intake/README.md                  tick the status box
```

## Files you must NOT touch

```
server/src/routes/question.routes.js                frozen by 3.1 — both routes are wired
server/src/repositories/question.repository.js      frozen by 3.1 — the find and update queries exist
server/src/controllers/question.intake.controller.js     DEV-A's, 3.2/3.4
server/src/services/question.intake.service.js           DEV-A's, 3.4
server/src/utils/questionView.js                    DEV-A's serializer from 3.4 — import it, do not fork it
server/src/services/classification.service.js       yours, but this PR does not call the model
prisma/schema/*.prisma                              no migration in this epic
shared/api.d.ts                                     the E3 block is closed
```

## Acceptance criteria

- [ ] `GET /questions/:id` returns a payload field-for-field identical to what `POST /questions` returned for the same question
- [ ] `GET` and `PATCH` on another student's question both return `NOT_FOUND`
- [ ] `PATCH` with a valid leaf and its parent updates both columns and returns the new `QuestionResponse`
- [ ] `PATCH` with a **parent** id as `subtopicId` returns `VALIDATION_ERROR`
- [ ] `PATCH` with `subtopicId: 9999` returns `VALIDATION_ERROR`, not a foreign-key 500
- [ ] `PATCH` with a leaf whose parent is not the supplied `topicId` returns `VALIDATION_ERROR`
- [ ] `PATCH` with `{ topicId: 0, subtopicId: null }` succeeds
- [ ] `PATCH` with `estimatedLevel: 6`, with `{}`, or with an unknown key returns `VALIDATION_ERROR`
- [ ] `classification_ok` is unchanged by any `PATCH`
- [ ] A question whose session is no longer `PENDING` returns `SESSION_NOT_ACTIVE` on `PATCH` and still returns fine on `GET`
- [ ] Both endpoints issue a constant number of queries (`DEBUG=prisma:query`) — the find brings its attachments in one

## Manual test

1. Create a question through 3.4, note its id
2. `GET` it; diff the JSON against the create response — they must match exactly
3. `PATCH` it to an integrals leaf and its parent; `GET` again and confirm both columns moved and `classification_ok` did not
4. `PATCH` with the parent id in `subtopicId` → `VALIDATION_ERROR` naming the field
5. Log in as another student, `GET` and `PATCH` the same id → `NOT_FOUND` twice
6. `update sessions set status = 'OFFER_SENT' where question_id = ...` on the **local** database, then `PATCH` → `SESSION_NOT_ACTIVE`

## Review checklist additions

- Confirm the leaf/parent check calls the taxonomy helper 3.3 introduced rather than re-implementing it. Two validators disagreeing about what a leaf is is the E2 defect this epic is trying not to repeat.
- Confirm `questionView.js` is imported, not copied. Two serializers for one payload is how `GET` and `POST` stop matching.
- Confirm the ownership check is in the service, not in the controller's `if`. Controllers do not query.

## Notes

**Why `NOT_FOUND` rather than `FORBIDDEN` for someone else's question.** `FORBIDDEN` confirms the id
exists. For a resource keyed by an unguessable uuid that leak is small, but it is free to avoid and
the same rule will apply to sessions in E6.

**Why the state check is here and not left to E5.** E4 and E5 read `subtopic_id` to rank and to brief.
A question that changes topic after an offer went out is a teacher looking at a brief for a different
exercise. The check costs one column on a row this endpoint already loads.

**This PR is deliberately small.** It is the last thing DEV-B can build before 3.7 needs a screen that
3.6's route file makes room for; the epic's parallelism map treats the remainder of that wait as
filler (F1, F3, F4), not as an excuse to grow this PR.
