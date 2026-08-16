# PR 3.1 — Question core: frozen router, repository, classification seam

| | |
|---|---|
| **Epic** | E3 — Question Intake & LLM Classification |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | **Human — no agent.** Same reason 2.1 was: every later PR in the epic is shaped by this one, and a splice here is a splice in both tracks. |
| **Depends on** | E2 (2.1–2.6 merged) |
| **Blocks** | 3.2, 3.3, 3.4 |
| **Branch** | `dev-a/E3.1-question-core` |

## Contract implemented

The whole `E3` block of the epic's contract freeze, appended to `shared/api.d.ts`. No behaviour ships
in this PR — every route answers `NOT_IMPLEMENTED` until its own PR lands.

## Scope

The skeleton both tracks build on, merged before either starts. Four things:

**1. `question.routes.js`, frozen.** Every E3 route wired, in its final shape, against stub
controllers that throw `new AppError(ERROR_CODES.NOT_IMPLEMENTED, ...)`:

| Method | Path | Middleware | Lands in |
|---|---|---|---|
| POST | `/questions/attachments` | `authenticate`, `authorize('student')`, `upload.single(...)` | 3.2 |
| POST | `/questions` | `authenticate`, `authorize('student')`, `strictLimiter`, `validate(...)` | 3.4 |
| GET | `/questions/:id` | `authenticate`, `authorize('student')`, `validate(...)` | 3.5 |
| PATCH | `/questions/:id/classification` | `authenticate`, `authorize('student')`, `validate(...)` | 3.5 |

`validate(...)` on `GET /questions/:id` is added to that table by this PR. `questions.id`
is `@db.Uuid`, and Postgres raises `22P02` on a malformed one rather than returning no
rows — uncaught, a typo in the URL is a 500 for what is plainly a bad request.
`GET /teachers/:id` carries the same schema for the same reason (2.1). The route is
frozen after this PR, so the alternative was 3.5 adding it to a frozen file.

`POST /questions/attachments` deliberately carries no validator, and that is the one row
in the table without one: its body is a multipart file, and the size cap, MIME allowlist
and field name are enforced by 3.2's Multer configuration reading the same three
constants a schema here would have read.

`strictLimiter` goes on `POST /questions` and nowhere else. It has been exported and deliberately
unwired since 0.4 — its own header comment names question creation as the route it is waiting for.
One appended line in `routes/index.js`: `apiRoutes.use('/questions', questionRoutes);`, alphabetical,
between `/public` and `/teachers`.

**2. `question.repository.js`, frozen.** Every query either track needs, written once:

- create a question row (no classification columns — they are filled by the update below)
- update a question's classification columns by id
- create a `PENDING` session for a question in the same transaction as the question row
- find a question by id **with its attachments**, one query, no N+1 — E2's `GET /teachers` lesson
- create an unbound attachment row (`question_id = NULL`)
- bind a set of attachment ids to a question id, scoped to the owner
- find attachments by id for an ownership check

If a later PR needs a query that is not here, that is a chat message and a small PR from DEV-A — not
an edit to a frozen file, and not a `prisma` import in a service.

**3. `classification.service.js` with the fallback body.** The seam, exactly as frozen in the epic
README: `classifyQuestion({ rawText, imageUrls, declaredLevel })` returning a `Classification`. In
this PR it always returns the fallback — `topicId: UNCLASSIFIED_TOPIC_ID`, `subtopicId: null`,
`teacherBrief: rawText`, `confidence: 0`, `classificationOk: false` — with no Anthropic import
anywhere. This is not throwaway code: it is the §8.1 fallback path, and 3.3 keeps it as the `catch`
branch. **Ownership of this file transfers to DEV-B when 3.3 opens.** After this PR, DEV-A does not
edit it.

**4. `constants/question.js`.** New domain file, one line appended to `constants/index.js`.
`UNCLASSIFIED_TOPIC_ID = 0` (the seeded sentinel, `CONVENTIONS.md`'s single carve-out to
database-assigned ids), the raw-text bounds, the attachment count cap, the image size cap and the
MIME allowlist. The size and MIME values live here rather than in 3.2's Multer config so the client
can be told the same numbers later without a second source.

**Plus one paragraph in `docs/DEPLOYMENT.md` §4.** E2's incident was local development writing to the
Neon production database through ordinary QA typing. This epic's verification writes rows on every
run, so the warning gets the concrete instruction — `npm run db:up`, point the root `.env` at port
5433, supply the production URL inline when you mean it — rather than the general caution about
`prisma migrate reset` that is there now.

## Files you may touch

```
server/src/routes/question.routes.js                new
server/src/repositories/question.repository.js      new
server/src/services/classification.service.js       new  (handed to DEV-B at 3.3)
server/src/config/constants/question.js             new
server/src/config/constants/index.js                one appended line
server/src/routes/index.js                          one appended line
shared/api.d.ts                                     one appended `// ── E3` block
docs/DEPLOYMENT.md                                  §4 only
docs/epics/E3-question-intake/README.md             tick the status box

# added while implementing — a frozen router cannot import files that do not exist
server/src/controllers/question.intake.controller.js     new  stubs, filled by 3.2 and 3.4
server/src/controllers/question.classify.controller.js   new  stubs, filled by 3.5 (DEV-B)
server/src/validators/question.intake.schema.js          new  stub,  filled by 3.4
server/src/validators/question.classify.schema.js        new  stub,  filled by 3.5 (DEV-B)
server/src/middlewares/upload.js                         new  pass-through, filled by 3.2
server/src/utils/questionView.js                         new  moved here from 3.4 — both tracks read it
prisma/schema/questions.prisma                           three columns, additive
prisma/schema/users.prisma                               one back-relation, appended
prisma/migrations/                                       three additive migrations
docs/epics/E3-question-intake/PR-3.4-create-question.md          allowlist correction
docs/epics/E3-question-intake/PR-3.5-classification-override.md  allowlist correction
```

**Why the six extra source files.** The scope above freezes a router, and a router
imports controllers, validators and an upload middleware. Writing it against files that
do not exist yet means either the server does not boot, or 3.2 and 3.5 create them —
and a file created by the PR that fills it in is a file the frozen router had to be
edited to reach. 2.1 made exactly this call for the same reason and its stat list shows
it: four stub files, two of them DEV-B's, all created by DEV-A's blocking PR.

`middlewares/upload.js` is the same argument in its sharpest form. `upload.single(...)`
is on the route today, as a pass-through; 3.2 replaces what `upload` is and the route
does not move. Adding that middleware in 3.2 instead would be an edit to a frozen file
on the first PR after the freeze.

`utils/questionView.js` moved out of 3.4. It is the serializer `POST /questions` (3.4,
DEV-A) and `GET /questions/:id` (3.5, DEV-B) both answer with, and 3.5's own acceptance
criterion is that the two payloads are field-for-field identical — which is a promise
about a file DEV-B would not have had until DEV-A's PR landed mid-epic. Written here, it
is frozen before either track opens.

**Why three migrations, in the PR whose brief says there are none.** See the epic
README's schema row, corrected in this PR. `declared_level`, `student_confirmation` and
`question_attachments.uploaded_by` are all in the contract freeze and none of them were
in the 0.2 schema. This brief's own instruction was to check first and say so in chat
rather than write one quietly — that check is what found them. All three are additive
(nullable columns, no data movement), they were applied one at a time against the local
container, and nothing after this PR in E3 touches `prisma/`.

## Files you must NOT touch

```
server/src/app.js                                   frozen since 0.4 — routes go through the registry
server/src/middlewares/rateLimit.js                 use strictLimiter, do not edit it
server/src/config/constants/matching.js             E4's — UNCLASSIFIED_TOPIC_ID is declared there
server/src/repositories/teacher.repository.js       E2's, frozen
server/src/services/teacher.*.service.js            E2's
shared/errorCodes.js                                every code this epic needs already exists
.env.example                                        CLOUDINARY_* and ANTHROPIC_API_KEY landed in 0.7
client/**                                           nothing client-side in this PR
```

## Acceptance criteria

- [ ] `GET /api/v1/questions/<any-uuid>` with a student token returns `NOT_IMPLEMENTED`, not a 404 and not a 500
- [ ] The same call with no token returns `UNAUTHORIZED`; with a teacher's token, `FORBIDDEN`
- [ ] `POST /questions` past the strict-limit window returns `RATE_LIMITED` in the standard error shape
- [ ] `classifyQuestion({ rawText: 'x', imageUrls: [], declaredLevel: null })` resolves to a `Classification` with `classificationOk: false` and `topicId === 0`
- [ ] `classifyQuestion` resolves — never rejects — for `rawText: ''`, a 10k-character string, and 20 image URLs
- [ ] `grep -c prisma server/src/services/classification.service.js` is `0`
- [ ] The find-by-id query costs the **same** number of statements at any attachment count — three, not one per attachment (`DEBUG=prisma:query`; see the note below)
- [ ] `routes/index.js` and `constants/index.js` each gained exactly one line and nothing was reordered
- [ ] No literal `0`, size cap, or MIME string outside `constants/question.js`

## Manual test

1. `npm run db:up && npm run db:migrate && npm run db:seed` against the **local** container, then confirm `psql` on 5433 shows the seeded rows and Neon is untouched
2. `npm run dev`, log in as a seeded student, call each of the four routes, read the four error codes
3. Call `POST /questions` in a loop until the limiter answers
4. `node --input-type=module -e "import('./server/src/services/classification.service.js').then(m => m.classifyQuestion({rawText:'x',imageUrls:[],declaredLevel:null}).then(console.log))"`

## Review checklist additions

- The four routes must be in their **final** shape. A middleware added in 3.2 or 3.5 is an edit to a frozen file, which is the failure this PR exists to prevent.
- Read the repository's function list against the epic README's list of seven. A missing one is discovered by a blocked developer three days from now.
- Confirm `classification.service.js` has no `req`, no `res`, and no import from `#repositories/*`.

## Notes

**Why the seam gets a real file now rather than a TODO.** 3.4 is written and merged against this
signature while 3.3 is still being written. If the stub lives inside 3.4's service instead, there are
two implementations of "what happens when classification fails" and they drift — the E2 retro's
fourth carried lesson, verbatim.

**Why three migrations, where this brief said none.** The check this paragraph asked for is what
found them. `questions`, `question_attachments` and `sessions` were indeed all created by 0.2's init
migration, and `question_attachments.question_id` is `String?` — nullable, which is what 3.2's
upload-before-create flow needs, so that half held. Three columns in the contract freeze had no
column behind them:

| Column | Why the contract needs it |
|---|---|
| `questions.declared_level` | `CreateQuestionRequest.declaredLevel` and `QuestionResponse.declaredLevel`. §11.2 assumed it could be read from `student_profiles.math_level` on demand, but that profile is editable and optional, so a classification is only debuggable if the input it disagreed with is still on the row. |
| `questions.student_confirmation` | `Classification.studentConfirmation`. §11.2 lists `teacher_brief` alone, which works only if the sentence is never read twice — and the confirmation screen has to survive a reload. Regenerating it means a second LLM call to re-say something already said. |
| `question_attachments.uploaded_by` | Without it, "you cannot attach another student's photo" is a rule with nothing to check it against, because upload-before-create leaves a window where a row belongs to nobody. Both the ownership check and the race-proof binding `where` in the repository read this column. |

All three are additive and nullable, no data moves, and they were applied one at a time against the
local container. Nothing later in E3 opens `prisma/`.

**One name already existed.** `UNCLASSIFIED_TOPIC_ID` is declared in `constants/matching.js` (0.5),
which the epic README's risk list did not know. `constants/index.js` re-exports both files with
`export *`, and one name from two files with two different bindings is a hard `SyntaxError` on the
first import through the barrel. `constants/question.js` re-exports the existing binding instead of
declaring a second one, so both spellings stay valid and there is still exactly one `0`. The same
trap caught the `MATH_LEVELS` alias, which `constants/user.js` already defines — that alias was
dropped rather than added, with a comment where it would have gone.

**The `PENDING` session is created here in the repository, not by a `session.service`.** There is no
session service yet — E6 owns that file. E3 writes exactly three columns (`question_id`,
`student_id`, `status`) and nothing else, so that when E6 lands, moving this creation behind
`session.service` is a one-function change. Say so in a comment on the function.
