# PR 3.4 — `POST /questions` — create, classify, session in `PENDING`

| | |
|---|---|
| **Epic** | E3 — Question Intake & LLM Classification |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 3.1 (merged). **Not** 3.3 — build against 3.1's fallback stub. |
| **Blocks** | 3.5, 3.6 |
| **Branch** | `dev-a/E3.4-create-question` |

## Contract implemented

`POST /api/v1/questions`: `CreateQuestionRequest` → `QuestionResponse`.
`MVP.md` §12 ("**The core.** Create + LLM classify + create session in PENDING"), §10 (the session
state machine starts at `PENDING`).

## Scope

The endpoint the whole product funnels through. Four steps, in this order, and the order is the
contract:

1. **Commit the question and its session first.** One transaction: insert the question row with
   `raw_text` and `declared_level` and no classification columns, insert a `sessions` row with
   `question_id`, `student_id`, `status = 'PENDING'`, and bind the supplied `attachmentIds`. The
   student's typing is now durable.
2. **Classify.** `await classifyQuestion({ rawText, imageUrls, declaredLevel })` — the frozen seam,
   with the attachment URLs read from the rows just bound. It cannot throw (3.3's acceptance
   criteria), so there is no `try` around it and no error branch to design.
3. **Update the question** with the returned `Classification`, through the frozen repository.
4. **Answer `201`** with the full `QuestionResponse`, classification and attachments included.

**Ownership is checked on the attachments, not assumed.** `attachmentIds` come from the client. Bind
only rows that are unbound *and* were uploaded by the caller; anything else is `VALIDATION_ERROR`. An
attachment id belonging to another student is the one way this endpoint could leak a stranger's
photograph into a stranger's question.

**Validation** (Zod, through the existing `validate` middleware): `rawText` required and within the
bounds in `constants/question.js`, `declaredLevel` optional and one of 3/4/5, `attachmentIds` an
optional array of uuids capped at `MAX_ATTACHMENTS`. Unknown keys rejected — the same `strict()`
posture E1's validators set and E2's query schemas kept.

**`classificationOk: false` is still a `201`.** §8.1 is unambiguous: classification never blocks the
flow. This endpoint has no `LLM_FAILED` branch, and the code's presence in `shared/errorCodes.js` is
not an invitation to use it here.

**The `PENDING` session is created through 3.1's repository function, not through a session service** —
there is no session service until E6. Three columns, no state transitions, no money. The comment 3.1
left on that function explains where it moves later; do not expand its scope now.

## Files you may touch

```
server/src/controllers/question.intake.controller.js   the create handler — stub from 3.1
server/src/services/question.intake.service.js         orchestration: commit → classify → update
server/src/validators/question.intake.schema.js        createQuestionSchema — stub from 3.1
server/tests/question.intake.test.js                   new — the create flow and the ownership rule
docs/epics/E3-question-intake/README.md                tick the status box
```

## Files you must NOT touch

```
server/src/routes/question.routes.js                frozen by 3.1 — the route, the limiter and validate() are wired
server/src/repositories/question.repository.js      frozen by 3.1 — if a query is missing, say so in chat
server/src/services/classification.service.js       DEV-B's — call it, never edit it, never wrap it in a second stub
server/src/services/llm.prompt.js                   DEV-B's
server/src/controllers/question.classify.controller.js   3.5, DEV-B's
server/src/utils/questionView.js                    frozen by 3.1 — 3.5 answers with it too; import, do not fork
prisma/schema/*.prisma                              3.1's three migrations are the epic's only ones
shared/api.d.ts                                     the E3 block is closed
client/**                                           3.6's job
```

## Acceptance criteria

- [ ] A student posting `{ rawText }` alone gets `201` and a `QuestionResponse` carrying a `sessionId`
- [ ] The created session row has `status = 'PENDING'`, the right `student_id`, and no price or timing columns set
- [ ] Posting with two `attachmentIds` from 3.2 returns both in `attachments`, and their rows now carry `question_id`
- [ ] An `attachmentId` belonging to another student returns `VALIDATION_ERROR`, and **no** question row is created
- [ ] An `attachmentId` already bound to another question returns `VALIDATION_ERROR`
- [ ] With `classification.service.js` still on 3.1's stub, the response is `201` with `topicId: 0` and `classificationOk: false` — and the question row exists with `raw_text` intact
- [ ] `rawText: ''`, a 50k-character `rawText`, `declaredLevel: 2`, and `{ nonsense: 1 }` are each `VALIDATION_ERROR`
- [ ] A teacher's token returns `FORBIDDEN`
- [ ] Killing the process between the insert and the classify leaves a question row with `classification_ok = true` and null classification columns — recoverable, not lost. (Read the code for this one; do not stage a crash against a shared database.)
- [ ] The controller imports no `prisma` and the service takes no `req`/`res` (`CONVENTIONS.md`, the iron rules)
- [ ] No literal `'PENDING'`, `0`, or length bound in the diff outside the constants

## Manual test

1. `curl -X POST -H "Authorization: Bearer <student>" -d '{"rawText":"נתקעתי באינטגרל של x·ln(x)","declaredLevel":5}'`
2. Upload an image via 3.2, then post again with its id in `attachmentIds`; confirm the response carries it and `psql` shows `question_id` set
3. Post the same `attachmentIds` a second time → `VALIDATION_ERROR`
4. Log in as a second student, try to bind the first student's attachment → `VALIDATION_ERROR`, and `select count(*) from questions` is unchanged
5. `select q.id, q.topic_id, q.classification_ok, s.status from questions q join sessions s on s.question_id = q.id order by q.created_at desc limit 3;`

## Review checklist additions

- Confirm step 1 commits **before** step 2 starts. An implementation that opens a transaction, awaits the LLM inside it, and commits at the end holds a Postgres connection for eight seconds per question — on a free Neon instance that is the whole pool under any load, and it also throws away the recovery property `GET /questions/:id` depends on.
- Confirm there is no second fallback here. If the diff contains `try { classify } catch { topicId: 0 }`, the seam has been duplicated — delete it, 3.3 owns that branch.
- Grep the diff for `LLM_FAILED`. It must not appear.

## Notes

**Why this PR does not wait for 3.3.** The seam's signature and return type were frozen in 3.1 and
implemented there as the fallback. This endpoint is finished, reviewable and mergeable against that;
when 3.3 lands, the same function starts returning real topics and this file does not change. That
property is the reason the epic is cut this way, and it only holds if nobody stubs the classifier a
second time to "get ahead".

**Why the response is the full question rather than an id.** The form screen (3.6) posts and then
navigates to the confirmation screen (3.7), and the classification is already in hand — a second
round trip to fetch what we just computed would add a request on the slowest path in the product.
`GET /questions/:id` exists for reload and recovery (3.5), not for the happy path.

**The client's timeout is shorter than this endpoint's worst legal case.** A cold Render instance plus
eight seconds of LLM exceeds the axios instance's 15 seconds. 3.6 raises it per request. Nothing to
do here — but do not "fix" it by making classification asynchronous, which would turn one endpoint
into a state machine and a poll loop for a step §4.1 budgets at 2–4 seconds.
