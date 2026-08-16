# E3 — Question Intake & LLM Classification

| | |
|---|---|
| **Depends on** | E1 (1.1–1.7), E2 (2.1–2.6 merged). Not on E2's four outstanding items — those block E4, not this epic. |
| **Blocks** | E4 (matching ranks on `subtopic_id` and `estimated_level`, and nothing writes them until this epic ships) |
| **Definition of done** | A logged-in student types a sentence, attaches a photo of an exercise, submits, and within a few seconds sees a topic and level they can correct. The question row, its attachment rows and a `PENDING` session exist in the database carrying the values the student confirmed. |

## The problem this epic has to solve

E2's cut was by **audience** — the teacher's own record versus what a stranger sees. E3 has one
audience and one screen flow, so that cut does not exist here and copying it would produce a
made-up boundary.

What E3 actually has is two **external services with two different failure modes**, joined by one
endpoint. Cloudinary either stores an image or it doesn't, and the student must be told immediately.
Anthropic either classifies the question or it doesn't, and per `MVP.md` §8.1 the student must
**not** be told, because the flow continues on `topic_id = 0` regardless. One of those is a hard
error, the other is a soft one, and `POST /questions` is where they meet.

The naive split — "B does the LLM, A does the form", which is what `MVP.md` §18 says — makes DEV-B's
work entirely backend and DEV-A's entirely frontend for four days. That is the split the epic
template tells us to reject, and it also puts both developers in `question.service.js`, because the
LLM call and the create-question endpoint are the same request.

**The cut is by seam.** DEV-A owns **capture**: everything that gets the student's words and pixels
into the database — upload, `POST /questions`, the form screen. DEV-B owns **classification**:
everything that decides what the question is about and lets the student disagree — the prompt, the
validated output, the fallback, the override endpoint, the confirmation screen.

They meet at exactly one function, and it is a pure one:

```js
// server/src/services/classification.service.js — DEV-B from 3.3 on
classifyQuestion({ rawText, imageUrls, declaredLevel }) -> Classification
```

No `prisma` import in that file, ever. It does not know the `questions` table exists. DEV-A calls it
and persists whatever comes back. This is the same shape as the video seam in `docs/OWNERSHIP.md`
§2.1 — one owner's code called by another owner's code, with the return value written down before
either side is built — and it is why DEV-A is never blocked on the LLM and DEV-B never has to think
about transactions.

## The shared files, named up front

E2's retro asked for one thing here: the list covers `package.json`, `package-lock.json` and the
Prisma schema, not only application source. It does.

| File | Rule | Set by |
|---|---|---|
| `server/src/routes/question.routes.js` | **Frozen** after 3.1. Every route wired against a `NOT_IMPLEMENTED` stub, rate limiter included. | 3.1 |
| `server/src/repositories/question.repository.js` | **Frozen** after 3.1. Every query both tracks need is written there first. | 3.1 |
| `server/src/services/classification.service.js` | Created in 3.1 with the fallback-only body. **Ownership transfers to DEV-B at 3.3.** DEV-A does not open it again. | 3.1 → 3.3 |
| `server/src/utils/questionView.js` | **Frozen** after 3.1. `toQuestionResponse` is what `POST /questions` (3.4, DEV-A) and `GET /questions/:id` (3.5, DEV-B) both answer with — moved out of 3.4 while writing 3.1, because a promise that two payloads are identical cannot depend on a file one track writes mid-epic. | 3.1 |
| `server/src/middlewares/upload.js` | Created in 3.1 as a pass-through with the interface it keeps. 3.2 replaces the body with Multer; `upload.single(...)` on the frozen route does not move. | 3.1 → 3.2 |
| `server/src/routes/index.js` | Append-only, one line, alphabetical | 3.1 |
| `server/src/config/constants/index.js` | Append-only, one line (`question.js`) | 3.1 |
| `server/src/config/constants/llm.js` | Append-only. DEV-B appends the model id and prompt bounds; the two existing values are not edited. | 3.3 |
| `shared/api.d.ts` | Append-only, one `// ── E3` block, written once in 3.1 | 3.1 |
| `client/src/router/routes.student.jsx` | One line per PR: replace a `Placeholder`, never reorder | 3.6, 3.7 |
| `client/src/components/question/` | Shared directory, disjoint files. DEV-A: `ImagePicker.jsx`, `QuestionTextField.jsx`. DEV-B: `ClassificationCard.jsx`, `TopicOverride.jsx`. | 3.6, 3.7 |
| `package.json` (root + `server/`) | **One dependency change in this epic, and it is 3.2's.** Announce in chat, land it inside 3.2, and let DEV-B rebase before continuing. Anything else is its own one-line PR. | 3.2 |
| `package-lock.json` | Never hand-merge. `git checkout --theirs package-lock.json && npm install` (`OWNERSHIP.md` §4). | 3.2 |
| `prisma/schema/*.prisma` | **Corrected in 3.1: the feature needed three migrations, not none.** The tables were all in the 0.2 schema and `question_id` on an attachment is nullable, which is what 3.2 depends on — but `questions.declared_level`, `questions.student_confirmation` and `question_attachments.uploaded_by` are all in the contract freeze below and none of them had a column. All three are additive and nullable, and they landed in 3.1 one at a time. After 3.1 nothing in E3 opens `prisma/` except the two filler items, both DEV-B's, also one at a time. | 3.1, filler |
| `.env.example` | Untouched. `CLOUDINARY_*` and `ANTHROPIC_API_KEY` were added in 0.7 and are already `requiredInProduction` in `config/env.js`. | — |

Everything else is suffixed by track: `question.intake.{controller,service,schema}.js` and
`question.classify.{controller,service,schema}.js`. Never one `question.controller.js`.

**No `questionStore`.** The question id lives in the URL (`/app/ask/:id/matching`). A store here would
be a second copy of server state owned by whoever created it first, and both screens would edit it.
If a screen needs the question, it reads `GET /questions/:id`.

## Before anything starts: local databases stop pointing at production

E2's incident — QA typing in a form at `localhost:5173` mutated the live demo teacher — is a
prerequisite, not a nicety, because **this epic's verification writes rows on every run**. Before 3.2
merges, both developers:

1. `npm run db:up` (Postgres 16 on host port **5433**, `docker-compose.yml`)
2. point `DATABASE_URL` in the repo-root `.env` at that container
3. `npm run db:migrate && npm run db:seed`
4. supply the Neon URL inline per command when they genuinely mean production

3.1 adds the warning to `docs/DEPLOYMENT.md` §4 so the next person does not have to remember it.

## The split

| | DEV-A (eliya) | DEV-B (rotem) |
|---|---|---|
| **Slice** | Capture — the student's words and pixels reaching the database | Classification — what the question is about, and the student's right to disagree |
| **Server** | Cloudinary + `POST /questions/attachments`, `POST /questions` (create → classify → `PENDING` session), the frozen router and repository | `classification.service.js` (prompt, schema, timeout, fallback), `GET /questions/:id`, `PATCH /questions/:id/classification` |
| **Client** | `/app/ask` — the question form, image picker, in-place "Analyzing…" state | `/app/ask/:id/matching` — the classification result and the override control |
| **Filler** | F2: publish the teacher constants through `/public` | F1, F3, F4: the three schema/serializer debts E2's retro left, all in DEV-B's files |

Both developers ship server and client. DEV-A owns the endpoint the form posts to; DEV-B owns the
endpoint the confirmation screen patches. Neither opens the other's controller.

## Order

| # | PR | Owner | Size | Depends on | Status |
|---|---|---|---|---|---|
| 3.1 | [Question core: frozen router, repository, classification seam](PR-3.1-question-core.md) | DEV-A · **human** | M | E2 | ☑ |
| 3.2 | [Cloudinary + image upload endpoint](PR-3.2-image-upload.md) | DEV-A | M | 3.1 | ☑ |
| 3.3 | [`classification.service` — prompt, schema, timeout, fallback](PR-3.3-llm-classification.md) | DEV-B · **human prompt** | L | 3.1 | ☐ |
| 3.4 | [`POST /questions` — create, classify, session in `PENDING`](PR-3.4-create-question.md) | DEV-A | M | 3.1 (3.3 for the real classifier) | ☐ |
| 3.5 | [`GET /questions/:id` + `PATCH /questions/:id/classification`](PR-3.5-classification-override.md) | DEV-B | S | 3.4 | ☐ |
| 3.6 | [Question form screen — text + image, camera-first](PR-3.6-question-form-screen.md) | DEV-A | M | 3.2, 3.4 | ☐ |
| 3.7 | [Classification confirmation screen](PR-3.7-classification-screen.md) | DEV-B | M | 3.5, 3.6 | ☐ |
| 3.8 | [E3 close: verification + retro](PR-3.8-e3-close.md) | DEV-B | S | 3.2–3.7 | ☐ |

### Filler, pre-planned

E2's retro: filler works only when it is *small, owned, and in the blocked developer's own area* —
otherwise the wait moves instead of disappearing. These four are carried over from that retro and
each one is a file its owner already owns.

| # | Filler PR | Owner | Size | Why it matters |
|---|---|---|---|---|
| F1 | Leaf topics: the seed stops writing parent rows, one migration cleans the existing 18 | DEV-B | S | The seed and `assertLeafTopics` disagree today. §9.1 scores on subtopics, so leaves win. **E4 reads this column.** |
| F2 | Publish `TEACHING_LEVELS` and `BIO_MAX_LENGTH` through `GET /public/topics`' neighbour | DEV-A | S | Four copies of one list. The price bounds show the fix working already. |
| F3 | Nullable `onboarded_at`, and `onboardingComplete` reads it | DEV-B | M | Today "has ≥ 1 topic" means a teacher who finished step 1 reads as complete. Schema change, not a serializer change. **E4 uses the flag.** |
| F4 | `TeacherStatusToggle` refreshes on status change, not on navigation | DEV-B | S | The header pill is stale until the teacher navigates. |

F1 and F3 both carry a migration. **Never two in flight** (`OWNERSHIP.md` §2) — F1 first, announced
in chat, then F3.

## Parallelism map

```
                     ┌─ 3.2 ──────────┐                        (A)
3.1 (A, blocking) ───┤                ├─ 3.4 ─── 3.6 ──┐
                     │                │          │     │
                     └─ 3.3 ──────────┘          │     ├─ 3.8 (B)
                        (B)   │                  ▼     │
                              └──────────── 3.5 ─── 3.7 ┘       (B)
                                            (B)   (B)
```

3.1 is the only thing either developer waits on, and it is one sitting.

**3.4 depends on 3.3 for its output, not for its shape.** 3.1 ships `classifyQuestion` with the
fallback body — real signature, real return type, `classificationOk: false` every time. 3.4 is built
and merged against that. When 3.3 lands, 3.4's diff does not change: the same function starts
returning real topics. **Do not stub the classifier a second time inside 3.4** — one stub, in the
file that will hold the real thing, is the whole point of the seam.

**3.7 is the one cross-track wait, and it is real.** It needs 3.5's endpoints (DEV-B's own) and 3.6's
route file convention plus the question a form actually created. DEV-B has 3.3 and 3.5 to do in the
meantime and F1/F3/F4 after that, so the wait is absorbed rather than moved.

## Contract freeze

Agreed before 3.2 and 3.3 start. Appended to `shared/api.d.ts` in 3.1 as one `E3` block. Changing any
of it afterwards is a chat message **before** the code.

```ts
// ── E3 ──────────────────────────────────────────────────────────────────────

/** One uploaded image. `questionId` is null until `POST /questions` binds it. */
export interface Attachment {
  id: string;
  fileUrl: string;
  mimeType: string;
}

/**
 * What the LLM decided, or what the fallback decided for it (MVP.md §8.1).
 * Every field here is also a column on `questions` — this is the write shape.
 */
export interface Classification {
  /** Short human title. Null when the fallback ran. */
  title: string | null;
  /** Parent topic. `0` = General / Unclassified, the seeded sentinel. */
  topicId: number;
  /** Leaf topic. Null on the fallback path, and null is legal on the override too. */
  subtopicId: number | null;
  /** 1–5. Null on the fallback path. */
  difficulty: number | null;
  /** 3 | 4 | 5 — what the LLM thinks the exercise is, not what the student declared. */
  estimatedLevel: number | null;
  /** What the teacher reads before accepting. On the fallback path this is the student's raw text. */
  teacherBrief: string;
  /** One sentence shown to the student on the confirmation screen. */
  studentConfirmation: string;
  /** 0–1. `0` when the fallback ran. */
  confidence: number;
  /** False = the LLM failed, timed out, or came back under MIN_CONFIDENCE. The flow continued anyway. */
  classificationOk: boolean;
}

/** `POST /questions` request. */
export interface CreateQuestionRequest {
  rawText: string;
  /** 3 | 4 | 5, what the student says they study. Optional — the form asks, it does not insist. */
  declaredLevel?: number;
  /** Ids from `POST /questions/attachments`, uploaded before the question existed. */
  attachmentIds?: string[];
}

/** `POST /questions` and `GET /questions/:id` both return this. */
export interface QuestionResponse {
  id: string;
  rawText: string;
  declaredLevel: number | null;
  classification: Classification;
  attachments: Attachment[];
  /** The `PENDING` session created alongside the question. E4 matches against it. */
  sessionId: string;
  createdAt: string;
}

/** `PATCH /questions/:id/classification` — the student's correction (§8.1). */
export interface ClassificationOverrideRequest {
  /** Leaf topic id, or `0` to say "none of these". */
  subtopicId: number | null;
  topicId: number;
  estimatedLevel?: number;
}
```

Five decisions inside that block, so nobody relitigates them mid-epic:

**The question row is committed *before* the LLM call.** Insert, then classify, then update. The
student's typing is never lost to an 8-second timeout on a free Render instance, and a client that
gave up can still find its question with `GET /questions/:id`. It also means `classificationOk` has
one writer and one meaning.

**`classificationOk: false` is not an error response.** `POST /questions` answers `201` on the
fallback path, exactly as on the happy one. `LLM_FAILED` exists in `shared/errorCodes.js` and this
epic never throws it — §8.1 is explicit that classification must not block the flow. The only thing
the student sees differently is the confirmation screen asking rather than telling.

**Attachments are uploaded before the question exists, not after.** `MVP.md` §12 writes
`POST /questions/:id/attachments`, which cannot work: classification is a Vision call and it happens
*inside* `POST /questions`, so an image that arrives afterwards is an image the LLM never saw. The
schema already permits this — `question_id` on `question_attachments` is nullable in
`prisma/schema/questions.prisma`. See the deviations table.

**`topicId` and `subtopicId` are both stored, and the override sets both.** §7's taxonomy is two
levels and §9.2 scores the leaf at 1.0 and the parent at 0.3. A screen that let the student pick a
subtopic without its parent would hand the matching engine half a row.

**`estimatedLevel` is the LLM's judgement; `declaredLevel` is the student's claim.** They are
different columns and different questions. Matching filters on the estimate (§9.1); the declaration
is an input to the prompt. There is no `/students/me` endpoint yet, so the form asks for the
declaration and does not read it from a profile.

### The internal seam — not in `api.d.ts`, but frozen just as hard

```js
/**
 * @param {{ rawText: string, imageUrls: string[], declaredLevel: number|null }} input
 * @returns {Promise<Classification>}   never throws, never returns null
 */
export async function classifyQuestion(input)
```

`classification.service.js` imports no `prisma`, reads no request, and touches no table. It answers a
`Classification` for every input including a catastrophic one — that is what "classification never
blocks matching" means in code. If this signature has to change, it is a chat message before the
commit, same rule as the E1 and E2 contract freezes.

## Deliberate deviations from `MVP.md` §18

| MVP said | We do | Why |
|---|---|---|
| 7 PRs (3.1–3.7) | 8 (3.1–3.8), plus 4 pre-planned filler | The blocking core PR and the closing verification PR are two-for-two in E1 and E2. §18 has neither. |
| Owner: B (LLM) + A (form) | Split by seam, both full-stack | The §18 reading gives DEV-B four days of backend and DEV-A four days of frontend. The epic template rejects that split by name. |
| 3.2 `llm.service` and 3.3 fallback as separate PRs | One PR (3.3) | The fallback is the same function's `catch`. Two PRs means two definitions of "failed" — and E2 shipped three contracts that disagreed with each other for exactly this reason. |
| `POST /questions/:id/attachments` (§12) | `POST /questions/attachments`, then `attachmentIds` on create | Classification is a Vision call inside `POST /questions`. An image bound afterwards is invisible to it. |
| — | `GET /questions/:id` added | Not in §12. The confirmation screen needs it on reload, and it is the recovery path when the client's request times out but the server's work did not. |
| `response_format: json_object` (§8.1) | Anthropic structured outputs + a server-side Zod schema | `response_format` is not a parameter the Anthropic API has — §8.1 was written against a different vendor's shape. The guardrail §8.1 actually asks for (schema-validated JSON) is delivered; see 3.3. |
| Nothing about the model | `claude-haiku-4-5`, in `constants/llm.js` | §8.1 sets an 8-second hard timeout and §4.1 promises "2–4 seconds". That is a latency budget, and it is the reason for the choice — see 3.3's notes, and change it there, not in a service file. |

## Risks

- **The 15-second axios timeout is shorter than the worst legal `POST /questions`.** A cold Render
  instance (30–60s, `docs/DEPLOYMENT.md` §7) plus an 8-second LLM call exceeds it, and the request
  that "failed" has already written a question row. 3.6 raises the timeout **per request** in
  `question.api.js`; `client/src/api/client.js` is DEV-A's single-owner file and stays frozen at 15s
  for everything else. The recovery path is `GET /questions/:id`, which is why 3.5 exists.
- **The upload path is the first multipart request in the project.** The axios instance sets
  `Content-Type: application/json` for every request. Sending a `FormData` with that header produces
  a body Multer cannot parse and an error that reads like a Cloudinary problem. 3.2 and 3.6 both call
  this out; the fix is per request, not in `client.js`.
- **`topic_id = 0` is a seeded sentinel and the only hardcoded id in the codebase.** `CONVENTIONS.md`
  names it as the one carve-out to "the database assigns ids", precisely because this epic's fallback
  has to know it in advance. It is cited as `UNCLASSIFIED_TOPIC_ID` and typed once — but **the
  declaration is in `constants/matching.js`, not `constants/question.js`** (0.5 got there first, and
  E4 owns that file). 3.1 re-exports it from `constants/question.js` rather than declaring a second
  one: `constants/index.js` re-exports both files with `export *`, and one name resolving to two
  bindings is a hard `SyntaxError` on the first import through the barrel, not a lint warning. Import
  it from the barrel and do not add a second `0` anywhere. The same applies to `MATH_LEVELS`, which
  `constants/user.js` already defines.
- **An LLM call costs money and `POST /questions` is unauthenticated-adjacent.** It is behind
  `authenticate` + `authorize('student')`, but a logged-in student can still loop it. `strictLimiter`
  is already exported from `middlewares/rateLimit.js` and left deliberately unwired for exactly this
  route (see its header comment). 3.1 wires it.
- **Prompt output drift is a runtime failure, not a review failure.** The model can return valid JSON
  with a `subtopic_id` that is not in `topics`. The Zod schema cannot catch that — 3.3 validates the
  ids against the taxonomy and falls back rather than writing a foreign key that does not resolve.
  This is the exact class of defect E2 shipped three of.
- **Images are user-uploaded files reaching a third party and then a Vision model.** 3.2 caps size
  and allows an explicit MIME allowlist server-side, not only in the file picker's `accept`
  attribute. The client-side filter is a convenience; the server's is the rule.

---

## Checklist before writing the PR briefs

- [x] Every PR names exactly one owner
- [x] No two in-flight PRs edit the same file
- [x] Any shared file is either frozen, append-only, or split by track — including `package.json`, the lockfile and `prisma/schema/`
- [x] Human-written items from `MVP.md` §17.5 are marked as such — 3.1 and 3.3's prompt
- [x] Each PR has an allowlist and a denylist
- [x] Each PR has acceptance criteria a human can check in under five minutes
- [x] Both developers have server and client work
- [x] There is filler work for whoever finishes first, and it is in that developer's own files
