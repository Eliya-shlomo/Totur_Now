# PR 3.3 — `classification.service` — prompt, schema, timeout, fallback

| | |
|---|---|
| **Epic** | E3 — Question Intake & LLM Classification |
| **Owner** | DEV-B (rotem) |
| **Size** | L |
| **Written by** | Agent for the service and the schema. **The prompt file is human-written — `MVP.md` §17.5 names LLM prompts explicitly.** |
| **Depends on** | 3.1 (merged) |
| **Blocks** | nothing structurally — 3.4 is built against 3.1's stub and does not change when this lands |
| **Branch** | `dev-b/E3.3-llm-classification` |

## Contract implemented

The seam frozen in the epic README:
`classifyQuestion({ rawText, imageUrls, declaredLevel }) -> Promise<Classification>`.
`MVP.md` §8.1 (the only LLM call in MVP), §7 (the taxonomy it classifies into).

## Scope

Replace 3.1's fallback-only body with a real classification call, keeping the fallback as the `catch`.

**The call.** One Anthropic Messages request per question: the student's text, up to N images as
content blocks, the declared level, and the topic taxonomy — read from `topic.service.js`'s
`getTopicTree()`, which E1 built for three consumers and named this one in its own header comment.
Never hardcode topic names or ids into the prompt; the taxonomy is a database table and the prompt
renders it.

**Structured output, not prose parsing.** Ask for a JSON object against a schema and validate what
comes back with Zod server-side. `MVP.md` §8.1 writes `response_format: json_object` — that is not a
parameter the Anthropic API has, so implement the guardrail §8.1 is asking for rather than the
literal line: Anthropic structured outputs (`output_config.format`) with the schema, plus the same
schema in Zod on our side. Two layers, because a model that satisfies a JSON schema can still return
a `subtopic_id` that does not exist in our `topics` table.

**Validate the ids against the taxonomy, not only against the schema.** After Zod: `subtopic_id`
must be a leaf that exists, `topic_id` must be its parent, `difficulty` in 1–5,
`estimated_level` in 3/4/5. An id the taxonomy does not have is a failed classification, not a
foreign-key error 40 milliseconds later in DEV-A's transaction. E2 shipped three contracts that
disagreed with each other and found all three during verification; this is the same class of defect,
caught at the boundary that owns it.

**The fallback, which is the point of the whole file (§8.1).** Any of — a thrown error, a timeout past
`LLM_TIMEOUT_MS`, a parse failure, a schema failure, an id that is not in the taxonomy, or
`confidence < MIN_CONFIDENCE` — produces the same answer:

```
topicId: UNCLASSIFIED_TOPIC_ID, subtopicId: null, title: null,
difficulty: null, estimatedLevel: null, teacherBrief: <the student's raw text>,
studentConfirmation: <a plain "we could not read this — which topic is it?" line>,
confidence: 0, classificationOk: false
```

`classifyQuestion` **never rejects**. That is an acceptance criterion, not a style preference: the
caller commits the student's question before calling it, and an exception here would strand a row.

**Timeout.** `LLM_TIMEOUT_MS` already exists in `constants/llm.js` at 8000. Enforce it on the request
itself (the SDK takes a per-request timeout in **milliseconds**) *and* race it, so an SDK that
retries internally cannot spend three timeouts in a row. Log a warning with the elapsed time and the
question's word count when it fires — 3.8 will want to know how often it does.

**Model.** `claude-haiku-4-5`, appended to `constants/llm.js` as `LLM_MODEL`. This is a latency
decision and it is the human's to change: §8.1 sets a hard 8-second budget and §4.1 promises the
student "2–4 seconds", which rules out a reasoning-heavy configuration on this path. Haiku 4.5
supports vision and is the fastest current model. If classification accuracy turns out to be the
problem rather than latency, `claude-sonnet-5` is the next step — one constant, no other change.

**Tests.** `node --test` is already wired (2.3 added the script). Unit-test the pure parts with no
network: schema rejection, out-of-taxonomy ids, low confidence, timeout, thrown error — each
producing the exact fallback shape. The prompt itself is not unit-testable and should not be
pretended otherwise; it is reviewed by a human and exercised in 3.8.

## Files you may touch

```
server/src/services/classification.service.js       ownership transfers to you here
server/src/services/llm.prompt.js                   new — HUMAN-WRITTEN, prompt text only
server/src/config/anthropic.js                      new — the configured SDK client, and the only file importing it
server/src/validators/classification.schema.js      new — the Zod shape of the model's JSON
server/src/config/constants/llm.js                  append only: LLM_MODEL, MAX_IMAGES, prompt bounds
server/tests/classification.test.js                 new
server/package.json                                 only if the pinned @anthropic-ai/sdk is too old — see Notes
docs/epics/E3-question-intake/README.md             tick the status box
```

## Files you must NOT touch

```
server/src/repositories/question.repository.js      frozen by 3.1 — this service reads no table
server/src/services/question.intake.service.js      DEV-A's, 3.2/3.4
server/src/controllers/**                           this service has no controller
server/src/routes/question.routes.js                frozen by 3.1
server/src/services/topic.service.js                E1's — call getTopicTree(), do not edit it
prisma/schema/*.prisma                              nothing here writes to a table
shared/api.d.ts                                     the E3 block is closed
.env.example                                        ANTHROPIC_API_KEY landed in 0.7
```

## Acceptance criteria

- [ ] A text-only integrals question classifies to the integrals subtopic with `classificationOk: true` and a `teacher_brief` a teacher could actually use
- [ ] A photographed exercise with no text classifies correctly — the image is genuinely reaching the model
- [ ] Gibberish (`"asdfgh"`) returns the fallback: `topicId === 0`, `classificationOk === false`, and `teacherBrief` equal to the input text
- [ ] With `ANTHROPIC_API_KEY` unset, `classifyQuestion` **resolves** to the fallback — it does not reject and does not throw
- [ ] With `LLM_TIMEOUT_MS` temporarily set to `1`, every call returns the fallback within roughly a second
- [ ] A stubbed response carrying `subtopic_id: 9999` returns the fallback, not a database error
- [ ] A stubbed response with `confidence: 0.4` returns the fallback (`MIN_CONFIDENCE` is 0.5 and already exists)
- [ ] `grep -c "prisma" server/src/services/classification.service.js` is `0`
- [ ] `grep -rn "@anthropic-ai/sdk" server/src` matches only `config/anthropic.js`
- [ ] No topic name, topic id, model id, timeout or confidence threshold is a literal in the diff
- [ ] `npm test` passes and the new tests need no network
- [ ] Server logs never contain the API key; on a fallback they contain the reason and the elapsed time

## Manual test

1. `npm run dev`, then a small script that calls `classifyQuestion` directly with: an integrals question in Hebrew, the same in English, a photo of a handwritten exercise, and `"asdfgh"`
2. Read the four `teacher_brief` values out loud — a brief that restates the question without saying what the student got stuck on has failed §8.1's intent even if every field validates
3. Unset `ANTHROPIC_API_KEY`, restart, repeat call 1
4. Set `LLM_TIMEOUT_MS` to `1`, restart, repeat call 1
5. `npm test`

## Review checklist additions

- **The prompt is reviewed as prose, by a human, out loud.** It is the one artifact in this epic no test covers. Check that it states the taxonomy is closed, that it must answer with the ids given and not invent them, and that `student_confirmation` is a sentence a 12th-grader would recognise as describing their own question.
- Confirm the taxonomy is rendered from `getTopicTree()` at call time. A prompt with the topic list pasted in is a fourth copy of a table that already has one source, and F1's leaf-topic cleanup would not reach it.
- Confirm no student text is logged at info level. The raw text is a person's homework, and it goes into the log by accident the first time somebody debugs a fallback.

## Notes

**Why the fallback and the call are one PR.** `MVP.md` §18 splits them (3.2 and 3.3). The fallback is
this function's `catch` branch — splitting it across two PRs produces two definitions of "failed",
one in the service and one in whatever wraps it, and they drift. E2's retro named this exact pattern:
a contract two subsystems disagree about is a defect when the second one is written, not when a user
hits it.

**`@anthropic-ai/sdk` may need a version bump.** `server/package.json` pins `^0.32.0` from E0.
Structured outputs (`output_config.format`) and the current model ids need a newer SDK. Check first;
if a bump is required it is a version change to one existing line — still announce it in chat, since
3.2 already spent this epic's one planned dependency change. If the bump turns out to be disruptive,
the fallback implementation is a tool-use call with a schema, which the pinned version supports; say
so in the PR rather than silently choosing it.

**One call, not two.** The exam-generation call that used to live alongside this one is out of MVP
(§6.1), and `constants/llm.js` already says so in a comment. There is one prompt, one timeout and one
failure mode in this whole project — keep it that way.
