# PR 6a.4 — The brief the teacher reads: `how_to_start`

| | |
|---|---|
| **Epic** | E6a — Classification Repair & the Teacher Brief |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | **Human — no agent** |
| **Depends on** | 6a.1 (merged) |
| **Blocks** | 6a.5 |
| **Branch** | `dev-b/E6a.4-teacher-brief` |

**Human-written, per `MVP.md` §17.5.** The substance of this PR is prompt prose. The
wiring below is mechanical and could be delegated; the prose cannot, because there is no
test that can tell a good pedagogical instruction from a plausible one, and the wiring
exists only to carry it.

## Contract implemented

`Classification` gains one field, frozen in this epic's README under "Contract freeze":

```ts
/** The opening move, for the teacher who is about to teach it. 1–3 lines, in the
 *  student's language. Null when the fallback ran. */
howToStart: string | null;
```

New column `questions.how_to_start`. `MVP.md` §8.1, extended — recorded in the epic's
deviations table, because §8.1 fixes the output at eight fields and this makes nine.

## Scope

**One new field on the existing call. Not a second call.**

The 8-second budget already holds one request, and `teacher_brief` already exists on the
row, in the response, and in E5's offer email. A second call would buy separation and pay
for it in a second timeout, a second failure mode, a second thing that can be missing
when the teacher opens the modal, and another 2–4 seconds inside a 60-second offer
window. Adding a field costs output tokens. `LLM_MAX_OUTPUT_TOKENS` was raised to 2048 in
6a.1 for this.

### The brief, in three parts across two fields

Total 3–5 lines:

| Lines | Field | Answers |
|---|---|---|
| 1–2 | `teacher_brief`, opening | What the question asks |
| 1–2 | `teacher_brief`, closing | What the student is likely stuck on |
| 1–3 | `how_to_start` | How to begin |

Two fields rather than three because `teacher_brief` already exists everywhere and moving
prose between two columns the same model writes in the same call would be a migration and
a serializer change that buys nothing a paragraph break does not.

### The prose — this is the PR

`SYSTEM_INSTRUCTIONS` in `llm.prompt.js`. Rule 3 currently reads:

> **Teacher Brief (teacher_brief):**
> - Write a concise, actionable summary specifically highlighting the student's core
>   difficulty or conceptual obstacle.
> - Focus on what the student is stuck on rather than merely repeating or transcribing
>   the problem statement.

That is one of the three parts, written as though it were the whole thing. Split it:

- **Rule 3 becomes the question.** What is being asked — the mathematical object and the
  demand on it. The current rule explicitly forbids this ("rather than merely repeating
  or transcribing the problem statement") because it was the only brief field; now it is
  the first of three and the teacher needs to know what they are walking into.
- **A rule for the sticking point.** The current rule 3's actual content, promoted. Where
  a student at the estimated level typically stalls on this exercise. A guess, and it
  should read as one — a teacher who is told the wrong obstacle confidently is worse off
  than one who is told nothing.
- **A rule for `how_to_start`.** The opening move. The first thing you would say. **Not a
  worked solution** — the teacher is about to teach this, and a solved exercise in the
  offer modal invites reading it out. Name the approach, the substitution, the theorem,
  the construction. Stop there.

Extend **rule 7** (language detection) to list `how_to_start` among the fields written in
the student's language. It already gives "match the question's language" for free; it
just needs the new field's name.

Rule 1's closed-taxonomy instruction, rule 2's title rule, rules 5 and 6 on difficulty and
level: unchanged.

`isPromptReady` guards on a `TODO(human)` marker. If the prose is drafted across sittings,
leave the marker in until it is finished — that is what it is for, and a half-written
instruction that classifies confidently is the failure it was built to prevent.

### The wiring, all mechanical

- `CLASSIFICATION_PROPERTIES` gains `how_to_start: { type: 'string' }`. `required` derives
  from the keys, so it comes along. **Nothing on the wire is nullable** — that rule holds:
  a model that cannot write an opening move answers with low `confidence` and the service
  turns it into the fallback. One way to say "I could not", not two.
- `classificationSchema` gains `how_to_start: z.string().trim().min(1).max(...)` with a
  length bound. The two layers exist precisely because the wire schema cannot express a
  maximum — the same reason `title` has one.
- Migration: `how_to_start`, nullable text, beside `teacher_brief` in
  `prisma/schema/questions.prisma`. Same producer, same failure mode — the argument that
  file already makes for `student_confirmation`. **Never edit an existing migration**
  (`CONVENTIONS.md`).
- `shared/api.d.ts`: `Classification` gains `howToStart: string | null`.
- `toClassificationColumns` in `question.intake.service.js` maps it. It is the second
  rename in that function after `confidence → llmConfidence`.
- `QUESTION_VIEW` in `question.repository.js` selects it.
- **`fallbackClassification` returns `howToStart: null`.** Not the student's raw text.
  `teacherBrief` echoes the text because there are words to echo; there is no fallback
  opening move, and writing one server-side would be product copy in a service file — the
  argument that function's comment already makes.
- `overrideQuestionClassification` still never writes it. The student corrects the topic,
  not the model's brief.

## Files you may touch

```
server/src/services/llm.prompt.js                 SYSTEM_INSTRUCTIONS — the substance of this PR
server/src/validators/classification.schema.js    both layers gain the field
server/src/services/classification.service.js     map it through; fallback returns null
server/src/services/question.intake.service.js    toClassificationColumns
server/src/repositories/question.repository.js    QUESTION_VIEW
prisma/schema/questions.prisma                    the column
prisma/migrations/<new>/migration.sql             a NEW migration
shared/api.d.ts                                   Classification gains one field
server/tests/classification.test.js               schema parity, the fallback's null
server/tests/question.intake.test.js              the column mapping
docs/epics/E6a-classification-repair/README.md    tick the status box
```

## Files you must NOT touch

```
prisma/migrations/<existing>/**       never edit a migration that has run
server/src/routes/**                  frozen at 3.1
server/src/services/question.classify.service.js   the override does not write model prose
client/**                             6a.5 renders it
scripts/classify-bench.mjs            6a.3's; re-run it, do not edit it
```

## Acceptance criteria

- [ ] A real Hebrew question returns a Hebrew `howToStart`; an English one returns English
- [ ] `howToStart` is an opening move, not a worked solution — judged by reading 10 bench pages
- [ ] Reading `teacherBrief` then `howToStart` gives the question, the likely obstacle, and where to begin, in 3–5 lines total
- [ ] The fallback path returns `howToStart: null`, and still never throws
- [ ] A response missing `how_to_start` fails the schema and falls back — the field is required on the wire
- [ ] Latency is still inside §4.1's 2–4 seconds, measured on the bench, not guessed
- [ ] No response truncates mid-JSON at 2048 tokens across a full bench run
- [ ] Migration applies clean on a fresh database and on a seeded one
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` pass

## Manual test

1. `npm run db:migrate`
2. `POST /questions` with `rawText: 'לא מבין איך מציבים גבולות באינטגרל'` — expect a
   Hebrew `howToStart` naming the opening move, not solving the integral
3. The same question in English — expect English
4. Unset `GEMINI_API_KEY`, repeat: 201, `howToStart: null`, `classificationOk: false`
5. `npm run bench:classify`. Read ten `howToStart` values. Any that solve the exercise
   instead of opening it means rule 3's replacement is not strict enough — the prose is
   the fix, not a post-processing step
6. Compare p95 against 6a.3's recorded run

## Review checklist additions

- The prose is the diff. If `SYSTEM_INSTRUCTIONS` is a small part of this PR by line
  count, something mechanical grew past its brief.
- No topic name and no topic id appears in `llm.prompt.js`. The taxonomy is rendered,
  never pasted — that promise predates this PR.
- The fallback returns `null`, not `''` and not the raw text.
- One new migration. Zero edited ones.

## Notes

**Why not a separate `sticking_point` column.** Three fields would let the client style
each one and would let a future screen show one without the others. It would also mean a
third string the model must fill on every call, a third length bound, a third fallback
value, and a migration to move prose that always travels with its neighbour. Two fields,
one paragraph break. If a screen later needs them apart, splitting a column is a smaller
job than un-splitting one.

**Why the teacher gets a guess about the student's difficulty.** The model sees a
photograph of an exercise and nothing about the person. What it can offer is where
students at that level typically stall, and the prose should be honest that this is what
it is. E5 gives the teacher 60 seconds; a hedge they can discard costs less than a
confident wrong claim they act on.

**Why raise the token ceiling in 6a.1 rather than here.** So this PR is prose and wiring,
and so the ceiling is already proven under a full bench run before the field that needs
it exists. A parse failure from a truncated response falls back silently, which is the
epic's entire subject.
