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
| GET | `/questions/:id` | `authenticate`, `authorize('student')` | 3.5 |
| PATCH | `/questions/:id/classification` | `authenticate`, `authorize('student')`, `validate(...)` | 3.5 |

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
```

## Files you must NOT touch

```
server/src/app.js                                   frozen since 0.4 — routes go through the registry
server/src/middlewares/rateLimit.js                 use strictLimiter, do not edit it
prisma/schema/*.prisma                              E3 needs no migration; see the epic README
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
- [ ] The find-by-id query returns a question with its attachments in **one** round trip (`DEBUG=prisma:query`)
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

**Why no migration.** `questions`, `question_attachments` and `sessions` were all created by 0.2's
init migration, and `question_attachments.question_id` is `String?` in `prisma/schema/questions.prisma`
— nullable, which is what 3.2's upload-before-create flow needs. Check this before writing anything;
if it turns out otherwise, stop and say so in chat rather than adding a migration inside the epic's
blocking PR.

**The `PENDING` session is created here in the repository, not by a `session.service`.** There is no
session service yet — E6 owns that file. E3 writes exactly three columns (`question_id`,
`student_id`, `status`) and nothing else, so that when E6 lands, moving this creation behind
`session.service` is a one-function change. Say so in a comment on the function.
