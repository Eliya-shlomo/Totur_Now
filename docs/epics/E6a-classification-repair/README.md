# E6a — Classification Repair & the Teacher Brief

| | |
|---|---|
| **Depends on** | E6 (merged through 6.9) |
| **Blocks** | E7 |
| **Definition of done** | A photographed Hebrew Bagrut question submitted through `/app/ask` comes back filed under a real subtopic, and the teacher who receives the offer reads a 3–5 line brief in Hebrew before the 60 seconds run out. |

## The problem this epic has to solve

**Classification has never worked.** Not since E5, not intermittently, not for photographs
only. Every question this application has ever classified was filed under
`topic_id = 0` — the seeded "General / Unclassified" sentinel — and every one of them
returned `201`.

The cause is one line, `classification.service.js:80`:

```js
createMessage: (params, options) => geminiClient.interactions.create(params, options),
```

`GoogleGenAI` has no `interactions` namespace. The installed SDK — `@google/genai@2.17.1`,
the one in `package-lock.json` — exposes `models`, `live`, `batches`, `chats`, `caches`,
`files`, `operations`, `authTokens` and `tunings`. Reading `.create` off `undefined`
throws a `TypeError` before a socket is opened, the single `catch` at the bottom of
`classifyQuestion` turns it into `fallback(error.message)`, and `fallbackClassification`
returns the sentinel with the student's own words in both brief fields.

Every property that file promises held. It never threw. It never returned null. It never
logged the student's text. It never blocked matching. It also never classified anything,
and nothing anywhere said so — which is the same failure `llm.prompt.js` warned about one
layer up: *"valid JSON, plausible fields, nonsense answers, and nothing red anywhere."*
`isPromptReady` was built to fail closed against exactly that, at the prose layer. There
is no equivalent at the transport layer. E6a builds one.

### It is not an E5 regression

`git log` on the four files involved:

```
dc17a59  2026-08-16  feat(questions)!: classify with Gemini instead of Anthropic (PR 3.3)
273cabb  2026-08-16  feat(questions): classify questions with Anthropic, schema and fallback (PR 3.3)
f339616  2026-08-16  feat(questions): freeze the question router, repository and classification seam (PR 3.1)
```

Nothing has touched `classification.service.js`, `llm.prompt.js`, `config/gemini.js` or
`constants/llm.js` since 16 August. The vendor swap is where it broke and where it stayed
broken. Working classification observed during E5 was PR 5.1's **seeded** questions —
`prisma/seed/questions.js` writes one row at `llmConfidence: 0.92` by hand.

## What is actually wrong

The entry point is the smallest of it. The request is written against a different API
entirely — the shape reads like the REST or Python surface, not this SDK.

| Written | `@google/genai` 2.17.1 |
|---|---|
| `interactions.create(params, options)` | `models.generateContent({ model, contents, config })` |
| `system_instruction` | `config.systemInstruction` |
| `input: [...]` | `contents: [{ role: 'user', parts: [...] }]` |
| `response_format.{mime_type, schema}` | `config.responseMimeType` + `config.responseJsonSchema` |
| `generation_config.max_output_tokens` | `config.maxOutputTokens` |
| `thinking_level: 'low'` | `config.thinkingConfig.thinkingLevel: 'LOW'` — the enum is uppercase |
| 2nd argument `{ timeout, maxRetries, fetchOptions.signal }` | `config.abortSignal`, `config.httpOptions.{timeout, retryOptions}` |
| `response.output_text` | `response.text` — a getter, `string \| undefined` |
| `LLM_MODEL = 'gemini-3.5-flash-lite'` | ~~no such model~~ — **this row was wrong.** Both names are real; see "What 6a.1 found" |

And one break that survives the repair. `llm.prompt.js` states:

> `imageUrls` are Cloudinary URLs from `POST /questions/attachments` (3.2), sent as URLs
> rather than base64 — Gemini fetches public HTTPS URLs itself, so the bytes never come
> back through this server

It does not. An image part carries `inlineData` (base64 bytes) or `fileData` (a Files API
URI, which is Gemini's own storage, not anyone's CDN). `{ type: 'image', uri: url }`
reaches nothing. **The photograph is the primary path** — §4.1's student says "I don't
know how to start" and the exercise is the picture — so fixing the call alone leaves the
product's main flow classifying nothing. That is 6a.2, and it is not optional.

## Why this is an epic and not a hotfix

Three reasons the one-line fix is not the work.

1. **Nothing here has ever been observed working.** The model id was never resolved
   against a live account, the request shape was never accepted by a server, the image
   path was never exercised. A repair that is not measured against real material is
   another set of plausible-looking code. Hence 6a.3, and hence the epic's threshold is
   set from a recorded run rather than picked in advance.
2. **The test suite is not the safety net here.** `classification.test.js` is 548 lines
   and covers every fallback mode, and it passed throughout. It injects `createMessage`,
   so what it asserts is that the code builds the object the code intends to build. It
   cannot tell that no SDK accepts that object. The bench is the missing layer, and it
   lives outside `npm test` on purpose — see "Test strategy".
3. **The teacher brief was going to land on this code anyway.** Adding `how_to_start` to
   a call that never runs would have shipped a second unverifiable field. Doing the
   repair and the feature in one epic means the feature's acceptance criteria are the
   first honest measurement either has had.

## The shared files, named up front

| File | Rule | Set by |
|---|---|---|
| `server/src/services/classification.service.js` | 6a.1, 6a.2 and 6a.4 all edit it. **Sequential, one lineage.** Do not run 6a.2 and 6a.4 in parallel branches. | 6a.1 |
| `server/src/services/llm.prompt.js` | 6a.1 takes the return shape. 6a.2 takes the image parts. **6a.4 takes the prose and nothing else** — §17.5 | 6a.1 |
| `server/src/config/constants/llm.js` | 6a.1 only. Model id, thinking level, token ceiling all move together | 6a.1 |
| `server/src/validators/classification.schema.js` | 6a.4 only. The contract was never wrong — only its transport was | 6a.4 |
| `shared/api.d.ts` | Append-only, 6a.4 only: `Classification` gains one field | 6a.4 |
| `package.json` → `"test"` | **Frozen.** `npm test` stays hermetic. The bench gets its own script entry | — |

## Before anything starts

1. A real `GEMINI_API_KEY` in `server/.env`, on an account with quota. Everything in this
   epic that matters is unverifiable without one, and the last time this code was
   "verified" the account had run out of credit — which is how the vendor swap happened
   in the first place (E3 README, deviations table).
2. `npm run db:up && npm run db:migrate && npm run db:seed`. The taxonomy is production
   data (`prisma/seed/topics.js`), and `isKnownPair` validates against it on every call.
3. Cloudinary configured. 6a.2 and 6a.3 both go through the real attachment path.
4. Read `docs/epics/E3-question-intake/RETRO.md` before 6a.1. It records the fallback
   firing twice in development and reading as noise. That is the observability gap this
   epic hands to E7.

## Order

| # | PR | Size | Depends on | Status |
|---|---|---|---|---|
| 6a.1 | [Repair the Gemini request, the response read, and the model id](PR-6a.1-gemini-request-repair.md) | M | E6 | ☑ |
| 6a.2 | [Images: fetch the bytes, send `inlineData`](PR-6a.2-image-bytes.md) | M | 6a.1 | ☑ |
| 6a.3 | [The 50-question bench: fixture, harness, scored report](PR-6a.3-bagrut-bench.md) | M | 6a.2 | ☑ |
| 6a.4 | [**The brief the teacher reads: `how_to_start`**](PR-6a.4-teacher-brief.md) | **human** · M | 6a.1 | ☑ |
| 6a.5 | [Surfacing the brief, and the RTL the client never got](PR-6a.5-brief-ui-rtl.md) | M | 6a.4 | ☐ |
| 6a.6 | [E6a close: bench re-run, verification, retro](PR-6a.6-e6a-close.md) | S | 6a.3, 6a.5 | ☐ |

Status: ☐ not started · ◐ partial · ☑ done. Size: S (<2h) · M (2–4h) · L (half day+).
Bold + **human** marks a PR written without an agent, per `MVP.md` §17.5.

## Parallelism map

```
  6a.1  repair the call
    │
    ├──────────────┐
    │              │
  6a.2           6a.4  how_to_start   ← both edit classification.service.js
  images         (human)                 rebase, do not fork
    │              │
  6a.3           6a.5  the teacher's screen
  bench            │
    │              │
    └──────┬───────┘
           │
         6a.6  close
```

The fork after 6a.1 is a scheduling convenience, not an isolation claim. 6a.2 and 6a.4
touch the same two files; whichever lands second rebases.

## Contract freeze

Appended to `shared/api.d.ts` in 6a.4, and nothing else in the epic changes the
contract:

```ts
export interface Classification {
  // ... every existing field is unchanged ...

  /**
   * The opening move, for the teacher who is about to teach it. 1–3 lines, in the
   * student's language. Null when the fallback ran — `teacherBrief` echoes the
   * student's own words because there are words to echo, and there is no fallback
   * opening move to invent.
   */
  howToStart: string | null;
}
```

`IncomingOffer` gains the same field, and for a reason worth writing down: 6a.5 renders
the opening move in the teacher's modal and in the offer email, and 6a.5 may touch
neither `shared/**` nor `server/src/**`. A field on `Classification` alone would have
reached `GET /questions/:id` and stopped one layer short of the screen it was written
for. Two interfaces, one field, one PR — carried here rather than left for a PR whose
own scoping forbids it:

```ts
export interface IncomingOffer {
  // ... every existing field is unchanged ...

  /** The opening move, beside the brief. Null when the classifier fell back. */
  howToStart: string | null;
}
```

The teacher-facing brief is three parts across two fields, totalling 3–5 lines:

| Lines | Field | What it answers |
|---|---|---|
| 1–2 | `teacherBrief`, first sentences | What the question asks |
| 1–2 | `teacherBrief`, closing sentences | What the student is likely stuck on |
| 1–3 | `howToStart` | How to begin |

`teacherBrief` carries two of the three because it already exists, is already on the row,
and is already what E5's offer email renders. Splitting it into a third column would be a
migration and a serializer change to move prose between two fields the same model writes
in the same call.

**Column:** `questions.how_to_start`, nullable text, beside `teacher_brief` — same
producer, same failure mode, the argument `questions.prisma` already makes for
`student_confirmation`.

## What 6a.1 found

Recorded here because two of them contradict this README as it was written, and the next
reader deserves the corrected version rather than the prediction.

**The model id was never wrong.** `models.list()` on the project's key returns
`models/gemini-3.5-flash-lite` (version `3.5-flash-lite-07-2026`) and
`models/gemini-3.7-flash` (`3.7-flash-08-2026`). Both names this epic called imaginary
are real models on this account. `LLM_MODEL` is unchanged; `gemini-3.7-flash` remains the
accuracy step up, and the comment above the constant now records the full candidate list
and why each of the others lost. The defect was never the value — it was that no request
had ever been made, so nothing distinguished a good guess from a bad one. That is the
finding, and it is the same one the epic was written around.

**Gemini will not accept §8.1's timeout.** `httpOptions.timeout` under ten seconds is
rejected outright — `400 INVALID_ARGUMENT: Manually set deadline 8s is too short. Minimum
allowed deadline is 10s` — and `LLM_TIMEOUT_MS` is 8000. Passing the budget through as
written would have failed every classification in a new way, and the request-shape table
above could not have predicted it: it is a value constraint, not a field name. The repair
clamps the vendor-facing deadline to a `GEMINI_MIN_DEADLINE_MS` floor and leaves the
`Promise.race` to enforce the eight seconds the student actually waits. The race fires
first by two seconds, every time.

**The measurement, which is the only part of this that was ever the point.** A real
`POST /api/v1/questions` with `rawText: 'לא מבין איך מציבים גבולות באינטגרל'`:

| `classificationOk` | `true` — the first time in this project's history |
| Parent / leaf | `41 calculus-integrals` / `43 definite-integrals`, both live rows |
| Confidence | 0.95 |
| Wall time, end to end | **1.63 s** — §4.1 promises 2–4, §8.1 allows 8 |
| Brief and confirmation | Hebrew, and about what the student is stuck on |

With `GEMINI_API_KEY` unset the same request answers 201 with `topic_id: 0`,
`confidence: 0`, the student's own words in both brief fields, and
`classification: 'DISABLED — GEMINI_API_KEY missing'` at boot. Neither log carries a word
of the student's text.

~~**Still failing after 6a.1, exactly as scoped:** a photographed question.~~ **Closed by
6a.2** — see below.

## What 6a.2 measured

The photograph path, run end to end against the real key and real Cloudinary on
2026-08-20. A rendered Hebrew Bagrut exercise — a definite integral of
`f(x) = 3x^2 - 12x + 5` on `[1, 4]` and the area between the graph and the x-axis —
uploaded through `POST /questions/attachments`, then submitted with **no useful text**.

| One image, end to end | **3.50 s** first call, `classificationOk: true` |
| Three images, end to end | **2.61 s** — §8.1 allows 8, §4.1 promises 2–4 |
| One unreachable URL of three | **2.63 s**, classified from the surviving two |
| Parent / leaf | `41 calculus-integrals` / `44 areas`, both live rows |
| Confidence | 0.95 with three images, 1.0 with two |
| Brief | Hebrew, and about the exercise **in the photograph** |

The latency risk below is answered for now: three images cost roughly what one does,
because they are fetched concurrently and Cloudinary resizes at the edge. 6a.3's p95 is
still where it is proven across 50 real pages rather than one.

**The drop is counted and not named.** With one attachment row hand-edited to an
unreachable HTTPS URL, the whole log line is
`Classification images dropped { dropped: 1, requested: 3, budgetMs: 3200 }` — no URL,
no student text, and a classification that still happened.

**`rawText: ''` is not reachable through the endpoint, and the criterion was written as
if it were.** `RAW_TEXT_MIN_LENGTH` is 2 and `POST /questions` validates it, so the run
above used `"??"` — two characters carrying no topic, no subject and no Hebrew. The
proof is unchanged in substance: nothing in the text could have produced
`calculus-integrals / areas` or a Hebrew brief describing a parabola and the area under
it. The validator was not touched; it is 3.1's and correct.

## What 6a.3 measured

`npm run bench:classify` — 50 real Bagrut pages, rendered to PNG, uploaded through
`POST /questions/attachments` and classified by `gemini-3.5-flash-lite`, scored against
expectations a human reviewed and corrected page by page. Both runs on 2026-08-20, four
minutes apart, against the same fixture and the same key.

| | run 2 | run 3 |
|---|---|---|
| parent-topic accuracy | 74.0% | 76.0% |
| leaf accuracy | 70.0% | 70.0% |
| **fallback rate** | **8.0%** (4 pages) | **4.0%** (2 pages) |
| p50 latency | 3091 ms | 3032 ms |
| p95 latency | 3990 ms | 4056 ms |
| misses | 15 | 15 |

Run 1 is not in the table because run 1 is never scored: it wrote
`bagrut-50.expected.json` from the model's own answers with `reviewed: false` throughout
and exited. The corrections that turned that file into ground truth moved **13 of the 50
pages**, which is the number that says why the gate exists: a bench scored against run 1
would have reported all 13 as correct forever, and 6a.3 would have shipped a 100% score
over a classifier that reads a triangle proof as trigonometry.

Those 13 are also, page for page, 13 of the 14 stable misses below. That is not a
coincidence — a correction is by definition a page where the human and the model
disagree, and the model has not changed its mind since. It is worth stating plainly
because it is the whole mechanism: the review is what converts an agreement into a
finding.

## What 6a.4 measured

Same fixture, same key, same machine, 2026-08-20. Two runs an hour after 6a.3's, with a
**control**: the branch stashed, so the control is this repository one commit earlier
answering eight fields instead of nine.

| | 6a.3 run 3 | control (8 fields, today) | 6a.4 (9 fields) |
|---|---|---|---|
| parent-topic accuracy | 76.0% | 68.0% | 70.0% |
| leaf accuracy | 70.0% | 64.0% | 64.0% |
| **fallback rate** | 4.0% (2 pages) | 6.0% (3 pages) | 4.0% (2 pages) |
| p50 latency | 3032 ms | 2981 ms | 3453 ms |
| p95 latency | 4056 ms | 3703 ms | 5109 ms |

**Read the control column first.** Both accuracy figures sit below this epic's own floors
(72% / 67%) *without this PR's changes in the tree*. Whatever moved them moved before
6a.4 — same fixture, same expectations file, same model id, six to eight points down on
a run four hours later. The floors were set from two runs taken minutes apart, which is
the narrowest sample that can be called a range, and this is what the third scored day
looks like. That is a finding for 6a.6's re-run and not a licence to lower the bar here.

**Against the control, the ninth field costs latency and nothing else.** Accuracy is
level or two points up, the fallback rate is a page lower, and p95 is **1.4 seconds
slower** — 5109 ms against a budget of 8000, and against §4.1's promise of 2–4 seconds
to the student. The p50 moved half as much. These pages are the worst case the product
has: full photographed Bagrut sheets with no typed text. Two typed Hebrew and English
questions through `POST /questions` on the same build answered in 1504 ms and 2832 ms.

**The prose was rewritten twice against this bench, and the first draft is why the
column exists.** A first version — the same rules, ~15 lines longer, with the language
instruction restated inside rules 3 and 4 — scored 62% parent and 58% leaf, ten points
under the control. Trimming it to the wording in `llm.prompt.js` today recovered all of
it. An instruction that is *correct* and *long* is not free: it competes with rule 1 for
the same attention, and rule 1 is the one that picks the subtopic id.

**Neither fallback was a truncated response.** Both pages (14 and 36) fell back with
`the ids are not in the taxonomy` — the model answered valid JSON, in full, naming a
pair the tree does not have. Nothing in either run failed to parse, which is what the
2048-token ceiling raised in 6a.1 was for.

### The tolerance

**±3 percentage points on either accuracy figure.** Observed across the two scored runs:
parent moved 2 points, leaf moved 0. Fourteen of the fifteen misses are the same pages
in both runs; exactly one page flapped in each direction (24 missed only in run 2, 23
only in run 3). A third run inside ±3 is the same classifier; outside it is a change.

**The fallback rate has no tolerance.** It moved from 4 pages to 2 between two runs of
the same input, which is variance in a number that is supposed to be zero.

### The threshold

- parent-topic accuracy **≥ 72%**
- leaf accuracy **≥ 67%**
- **fallback rate = 0**
- p95 inside `LLM_TIMEOUT_MS` — 4056 ms against a budget of 8000

The two accuracy floors are today's worst scored run minus the tolerance. They are
regression alarms and not goals: 70% leaf accuracy is not a good number, and writing it
down as the bar is how it stops getting worse while somebody works on making it better.

**The bench fails its own fallback criterion, and that is the finding.** 6a.3 measures;
the fix is a follow-up PR and not a widening of this one.

### What the misses are made of

Not noise. Fourteen stable misses fall into four groups, and each names a kind of
mathematics the classifier cannot currently see:

- **Euclidean geometry read as something else** — pages 2, 8, 9, 13. A circle theorem
  becomes `analytic-geometry / analytic-circle`; a triangle proof becomes
  `trigonometry / plane-trigonometry`. The model is reading the shapes and not the task.
- **Word problems read as their algebra** — pages 5, 15, 32. A mixture problem is
  `algebra / systems-of-equations`, a motion problem is `algebra / inequalities`. Both
  answers describe the technique the student would use; `word-problems` describes what
  they are looking at, and §9.1 matches teachers on the second one.
- **Sequences read as functions** — pages 37, 38. A geometric sequence becomes
  `calculus-functions / exponential-functions`, which is defensible mathematics and the
  wrong taxonomy.
- **Pages 14 and 36 fall back in every run.** 14 is a linear-function finance question
  with a graph and returns a topic/subtopic pair that does not exist together — the
  taxonomy check catches it. 36 comes back under the confidence floor.

Page 3 is worth its own line: a tiling question mixing area, percentage and cost, which
the taxonomy has no leaf for. It fell back in run 2 and landed on
`word-problems / buy-sell-problems` in run 3. That one is a gap in §7's taxonomy rather
than a defect in the classifier, and the follow-up should say which of the two it is
fixing before it edits a prompt.

## Deliberate deviations from `MVP.md` §18

| §18 said | We do | Why |
|---|---|---|
| E7 follows E6 | E6a follows E6 | §18 never planned for the classifier being dead. E7's scope assumes questions have topics |
| §8.1 fixes the LLM output at eight fields | Nine — `how_to_start` joins them | §8.1 wrote `teacher_brief` for a teacher with time to read. E5 gave them 60 seconds |
| §8.1: the classifier sends image URLs | The server fetches the bytes and inlines them | The API §8.1 assumed does not exist. Recorded here rather than left as prose in `llm.prompt.js` describing a design that never ran |
| §17.4's review is the quality gate | Plus `bench:classify` on 50 real questions | §17.4 caught none of this in three epics. The gap is not review discipline; it is that no assertion in the repo requires a real request to succeed |
| 6a.3 touches `package.json` for one script entry | Two devDependencies as well — `pdfjs-dist`, `@napi-rs/canvas` | The brief said to check for a bundled `pdftoppm` first. There is none: `pdftotext.exe` is the only Poppler binary on the machine, and no `mutool`, `gs`, `magick` or PyMuPDF either. The rendered PNGs are committed, so the two packages are needed to change the fixture and never to run the bench |

## Risks

- ~~**The model id is unknown.**~~ **Closed by 6a.1, and not the way this predicted.**
  `models.list()` against the real key returns both `gemini-3.5-flash-lite` and
  `gemini-3.7-flash`. The constant was correct all along and stays; what was missing was
  ever having checked. The rejected candidates are recorded in the comment above
  `LLM_MODEL`, which is the part of this risk that was worth keeping.
- **Inlining bytes eats the latency budget.** Three phone photographs fetched
  server-side, base64'd and uploaded sit inside the same 8 seconds §8.1 allows and the
  2–4 seconds §4.1 promises. The Cloudinary transform in 6a.2 is the mitigation; 6a.3's
  p95 is where it is proven or is not.
- **`how_to_start` grows the response.** Hebrew tokenizes worse than English, and a cap
  that truncates mid-JSON turns a good classification into a parse failure and a
  fallback. `LLM_MAX_OUTPUT_TOKENS` moves in 6a.1, before the field that needs it.
- **Model-proposed ground truth bakes in today's mistakes.** The bench's expectations
  start as the model's own answers. The `reviewed: false` gate is the entire defence and
  the scorer must refuse to run without it.
- **The bench costs money and is not deterministic.** 50 vision calls per run. Hence a
  threshold rather than exact match, and hence it never joins `npm test`.
- **Three PRs edit one service.** 6a.1, 6a.2, 6a.4. Sequential lineage, stated again in
  the shared-files table because this is the one thing in the epic that a parallel branch
  makes expensive.

## Test strategy

**Unit (`npm test`, hermetic — no network, no database).** `classification.test.js` keeps
every existing assertion and gains one class it did not have: the request-building tests
at `:306-401` currently assert an object shape, and after 6a.1 they assert the argument
`models.generateContent` receives, by the names that SDK reads. A test written against
the old shape must fail. The suite still runs with no `GEMINI_API_KEY` and no network,
because that property is what makes it runnable at all.

**The bench (`npm run bench:classify`, real key, run by hand).** 50 rendered Bagrut pages
through the real attachment and classification path, scored on parent accuracy, leaf
accuracy, fallback rate and latency percentiles. Precedent is `scripts/lock.mjs` — E5's
teacher-lock race harness, also real, also manual, also outside `npm test`.

This is the layer that was missing. The unit suite proves the code does what the code
means; only the bench proves the vendor agrees. It runs at minimum before any PR that
touches the request shape, the model id, or the prompt — and 6a.6 names the rule.

**Manual.** The end-to-end walk in 6a.6: photograph a real exercise, submit it, watch the
subtopic come back in Hebrew, take the offer as a teacher, read the brief.

---

## Checklist before writing the PR briefs

- [x] Every PR names exactly one owner — DEV-B (rotem) throughout; E6a is single-developer, as E6 was
- [x] No two in-flight PRs edit the same file — the 6a.2 / 6a.4 overlap is named and serialized, not wished away
- [x] Any shared file is either frozen, append-only, or split by domain
- [x] Human-written items from `MVP.md` §17.5 are marked as such — 6a.4 is prompt prose
- [x] Each PR has an allowlist and a denylist
- [x] Each PR has acceptance criteria a human can check in under five minutes
- [x] Both developers have server and client work — n/a, single developer; client work is 6a.5
- [x] There is filler work for whoever finishes first — n/a
