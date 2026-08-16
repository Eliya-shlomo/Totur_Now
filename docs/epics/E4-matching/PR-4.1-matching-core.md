# PR 4.1 — Matching core: frozen router, repository, scoring seam

| | |
|---|---|
| **Epic** | E4 — Matching Engine |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | **Human — no agent.** Same reason 2.1 and 3.1 were: every later PR in the epic is shaped by this one, and a splice here is a splice in both tracks. It also carries the seven contract-freeze rulings, which are judgement calls about a spec that disagrees with the schema. |
| **Depends on** | E3 (3.1–3.7 merged). Not 3.8, not F1, not F3 — see the epic README, "What E4 does not wait for". |
| **Blocks** | 4.2, 4.3, 4.4 |
| **Branch** | `dev-a/E4.1-matching-core` |

## Contract implemented

The whole `E4` block of the epic's contract freeze, appended to `shared/api.d.ts`, plus the
internal `rankCandidates` / `bayesian` seam. **No behaviour ships in this PR** — the one
route answers `NOT_IMPLEMENTED` until 4.5 lands.

## Scope

The skeleton both tracks build on, merged before either starts. Six things.

**1. `matching.routes.js`, new and frozen.** One route, in its final shape, against a stub
controller that throws `new AppError(ERROR_CODES.NOT_IMPLEMENTED, ...)`:

| Method | Path | Middleware | Lands in |
|---|---|---|---|
| GET | `/questions/:id/matches` | `authenticate`, `authorize('student')`, `validate(matchesSchema)` | 4.5 |

`validate` is on it from the start: `questions.id` is `@db.Uuid` and Postgres raises `22P02`
on a malformed one rather than returning no rows, so an uncaught typo in the URL is a 500 for
what is plainly a bad request. `GET /questions/:id` (3.1) and `GET /teachers/:id` (2.1) both
carry the same schema for the same reason.

**No rate limiter.** `strictLimiter` is on `POST /questions` because that route spends money
on a Vision call. This one runs two indexed queries and some arithmetic; `globalLimiter` in
`app.js` already covers it. Adding a strict limit here would throttle the price control,
which is *designed* to be pressed repeatedly.

**Why a new router rather than a line in `question.routes.js`.** That file is frozen after
3.1 and E4 does not unfreeze it. Two routers mount on `/questions`:

```js
apiRoutes.use('/questions', questionRoutes);
apiRoutes.use('/questions', matchingRoutes);   // one appended line, directly below
```

`GET /:id` in the first router matches one segment, so `/questions/<uuid>/matches` falls
through it into the second. Put a comment on the appended line saying so — a reader who does
not know Express's mount semantics will otherwise assume one of the two is dead. This is the
same posture E4 takes everywhere: it reads E2's and E3's tables through E4's own files.

**2. `matching.repository.js`, new and frozen.** Every query either track needs, written
once, finished:

- `findQuestionForMatching(id)` — the question's `studentId`, `topicId`, `subtopicId`,
  `estimatedLevel`, `declaredLevel`, `rejectedBy`, and its session's `id` and `status`.
  **This is not `QUESTION_VIEW`, deliberately.** 3.1 refuses to select `rejectedBy` into a
  student-facing payload and that refusal is correct; E4 needs a different shape for a
  different consumer, so it gets its own read rather than unfreezing a file. Say that in the
  function's header.
- `findWalletBalance(userId)` — one integer, or `null` if the row is missing.
- `findCandidates({ requiredLevel, topicId, subtopicId, maxPrice, excludeTeacherIds })` —
  §9.1's pool. Selects `...TEACHER_VIEW` plus `offersReceived`, `offersAccepted`, and the
  `teacherTopicStats` rows for the question's subtopic and parent only. Filters are 4.2's
  business to *decide*; the function signature and the select list are this PR's to freeze.
- `findPositiveHistoryTeacherIds(studentId)` — `reviews` where `student_id = :studentId` and
  `stars >= HISTORY_MIN_STARS`, distinct teacher ids. One query for the whole set, not one
  per candidate.
- `aggregatePlatformAverages()` — the three sums §9.3 smooths against, over
  `teacher_profiles`: `ratingSum`/`ratingCount`, `resolvedCount`/`sessionsCount`,
  `offersAccepted`/`offersReceived`. Returns the raw pairs, not the ratios; dividing (and
  deciding what to do when a denominator is zero) is 4.3's, in a service.

The last one is DEV-B's caller and DEV-A's file, which is the entire point of a blocking PR:
a query missing here is not a small omission, it is an unfrozen file. If a later PR needs
something that is not in the list, that is a chat message and a small PR from DEV-A.

**Two rules, copied from the two repositories that have already proved them.** One shared
select spread into every read, and relations fetched *with* the row rather than per row —
E2's `GET /teachers` N+1 lesson. `findCandidates` must cost the same number of statements
for 3 candidates and for 30. Check it with `DEBUG=prisma:query` in this PR, not in 4.2.

**3. `TEACHER_VIEW` becomes an export.** One line in `server/src/repositories/teacher.repository.js`
— `const TEACHER_VIEW` → `export const TEACHER_VIEW` — announced in chat before the commit
even though DEV-A owns the file, because it is frozen and the announcement is what keeps it
frozen. `findCandidates` spreads it, so a match card and a browse card are structurally
unable to disagree about what a teacher looks like. A private copy of that select list would
be a second source of truth for the shape E2's retro spent a section on. **Nothing else in
E4 opens that file.**

**4. `matching.scoring.js`, the seam, with a deterministic stub.** Both signatures from the
contract freeze, real JSDoc, real return types:

- `bayesian({ sum, count }, prior, c)` — **left unimplemented in this PR** beyond a `throw`?
  No: give it the trivial correct body, `(sum + prior * c) / (count + c)`. It is five lines,
  it is §9.3 verbatim, and 4.3's job is the tests and the platform averages around it. A stub
  here would be a stub of something already written in the spec.
- `rankCandidates(candidates, averages)` — returns every candidate with `score: 0`, sorted by
  `teacherId` ascending. Real signature, real shape, deterministic order, no scoring.

4.5 is built and merged against that stub, exactly as 3.4 was built against the fallback
classifier, and when 4.6 fills it in, **4.5's diff does not change**. Say so in the file's
header, and say the corollary too: between 4.5 and 4.6 the endpoint returns the right
teachers in an arbitrary but stable order, and that is correct for that week. **Do not stub
the scorer a second time inside 4.5.**

**Ownership of this file transfers to DEV-B at 4.3.** After this PR, DEV-A does not edit it.

**5. `constants/matching.js`, three appended values.** The file already has the seven numbers
E4 needs most and a boot-time assertion that the weights sum to 1.0. Append, do not edit:

| Constant | Value | Why here |
|---|---|---|
| `MAX_STARS` | `5` | §9.2's `global_rating` is `average stars / 5`, and `reviews.stars` has a `CHECK (stars BETWEEN 1 AND 5)` in the init migration. There is no `constants/rating.js` yet; when E8 creates one this is a one-line move and nothing that imports it from the barrel changes — the same arrangement `UNCLASSIFIED_TOPIC_ID` already documents. |
| `HISTORY_MIN_STARS` | `4` | §9.2's `history_bonus`: "1.0 if this student rated them ≥4 before". Read by the repository query and by the `studiedWith` field. |
| `NEUTRAL_PLATFORM_AVERAGES` | `{ rating: 3, resolveRate: 0.5, acceptRate: 0.5 }` | The prior when the platform itself has no history and every denominator is zero. Reachable only on an empty database, where it is constant across candidates and therefore cannot change the order — which is the argument for picking neutral values and naming them, rather than scattering `?? 0`. |

`constants/index.js` is **not** touched: `matching.js` has been in the barrel since 0.5.
**Only this PR opens `constants/matching.js` in the whole epic**, and no PR in E4 writes any
of those ten numbers as a literal anywhere else.

**6. The `E4` block in `shared/api.d.ts`,** verbatim from the epic README's contract freeze.
Appended below the E3 block. **The E3 block is not widened, reordered or edited.**

## Files you may touch

```
server/src/routes/matching.routes.js                new
server/src/repositories/matching.repository.js      new
server/src/services/matching.scoring.js             new  (handed to DEV-B at 4.3)
server/src/config/constants/matching.js             three appended values
server/src/repositories/teacher.repository.js       ONE line: export TEACHER_VIEW
server/src/routes/index.js                          one appended line
shared/api.d.ts                                     one appended `// ── E4` block
docs/epics/E4-matching/README.md                    tick the status box

# added while implementing — a frozen router cannot import files that do not exist
server/src/controllers/matching.controller.js       new  stub, filled by 4.5
server/src/validators/matching.schema.js            new  stub, filled by 4.5
```

**Why the two extra source files.** A frozen router imports a controller and a validator.
Writing it against files that do not exist means either the server does not boot or 4.5
creates them — and a file created by the PR that fills it in is a file the frozen router had
to be edited to reach. 2.1 and 3.1 both made this call; 3.1's stat list shows four such
files, two of them the other developer's.

Both are DEV-A's here, because DEV-B ships no controller in this epic. That is not an
oversight in the split — DEV-B's server work is a pure function and a cached aggregate, both
of which sit below the controller layer.

## Files you must NOT touch

```
server/src/routes/question.routes.js                frozen since 3.1 — E4 mounts its own router
server/src/repositories/question.repository.js      frozen since 3.1 — E4 has its own question read
server/src/utils/questionView.js                    frozen since 3.1 — E4 answers a different shape
server/src/app.js                                   frozen since 0.4 — routes go through the registry
server/src/middlewares/**                           everything this route needs exists
server/src/services/teacher.*.service.js            E2's
server/src/services/classification.service.js       DEV-B's since 3.3
shared/errorCodes.js                                every code E4 needs is already in it
prisma/**                                           this PR needs no migration, and the check is in the notes
client/**                                           nothing client-side in this PR
.env.example, server/src/config/env.js              E4 calls nothing external
```

## Acceptance criteria

- [ ] `GET /api/v1/questions/<any-uuid>/matches` with a student token returns `NOT_IMPLEMENTED` — not a 404, not a 500
- [ ] The same call with no token returns `UNAUTHORIZED`; with a teacher's token, `FORBIDDEN`
- [ ] `GET /api/v1/questions/not-a-uuid/matches` returns `VALIDATION_ERROR` naming the parameter
- [ ] `GET /api/v1/questions/<uuid>` (3.5's route) still answers exactly as it did before this PR — the second router changed nothing about the first
- [ ] `?priceBand=D` returns `VALIDATION_ERROR`; `?priceBand=B` and no query string both reach the stub
- [ ] `bayesian({sum: 184, count: 40}, 4.4, 5) ` is between the platform prior and 4.6, and `bayesian({sum: 0, count: 0}, p, 5) === p` exactly
- [ ] `rankCandidates([], averages)` returns `[]`; the same input twice returns the same order
- [ ] `grep -c prisma server/src/services/matching.scoring.js` is `0`, and the file contains no `req`, no `res` and no import from `#repositories/`
- [ ] `findCandidates` costs the **same** number of statements for 3 and for 30 candidates (`DEBUG=prisma:query`)
- [ ] `routes/index.js` gained exactly one line and nothing was reordered
- [ ] `teacher.repository.js` shows a one-word diff
- [ ] No literal `5`, `4`, `0.35` or `0.3` outside `constants/matching.js`
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass; `npm run build -w client` still builds

## Manual test

1. `npm run db:up && npm run db:migrate && npm run db:seed` against the **local** container, then confirm `psql` on 5433 shows 15 teachers and that Neon is untouched
2. `npm run dev`, log in as `avi.student@demo.tutornow.il`, call the route four ways: valid uuid, malformed uuid, no token, teacher token
3. Create a real question through `/app/ask` and call `/questions/<that id>/matches` — still `NOT_IMPLEMENTED`, and `GET /questions/<that id>` still returns its `QuestionResponse` unchanged
4. `node --input-type=module -e "import('./server/src/services/matching.scoring.js').then(m => console.log(m.bayesian({sum:5,count:1}, 4.4, 5), m.bayesian({sum:184,count:40}, 4.4, 5)))"` — the one-rating teacher must come out lower
5. `DEBUG=prisma:query` on a `findCandidates` call from a node one-liner, at two candidate counts, and count the statements

## Review checklist additions

- The route must be in its **final** shape. A middleware added in 4.5 is an edit to a frozen file, which is the failure this PR exists to prevent.
- Read the repository's function list against the epic README's list of five. A missing one is discovered by a blocked developer three days from now — and one of the five (`aggregatePlatformAverages`) has no caller in DEV-A's track at all, which is exactly why it has to be written here.
- Confirm `matching.scoring.js` imports nothing from `#repositories/`, `#config/db.js` or `express`.
- Confirm the `E4` block in `api.d.ts` is appended and the `E3` block is byte-identical to what was there before.
- Confirm the two-routers-on-one-path line in `routes/index.js` carries the comment explaining why. Without it, the next reader deletes one.

## Notes

**Why no migration, in the PR whose predecessor said the same and was wrong.** 3.1's brief
claimed E3 needed none and found three columns missing. The same check was run here, against
`prisma/schema/*.prisma` and the migration SQL at `e34d03f`, and this time the answer holds —
but only because the epic README's contract freeze *chose* the readings that need no column:

| §9.1 wants | The database has | Resolution |
|---|---|---|
| `student.price_band` | nothing on `student_profiles` | a query parameter, which §12 already writes |
| `student.blocked_teachers` | nothing anywhere | cut, with a note |
| `wallet_balance >= price * 2` | `wallets.balance` | folded into the price ceiling |
| `question.rejected_by` | `questions.rejected_by UUID[]` ✅ | reader written here; E5 writes it |
| `teacher_topic_stats` | all four columns ✅, seeded | read-only until E8 |
| `idx_teacher_available` | already exists, with `price_per_block` | **do not create it again** |
| `estimated_level` may be null | it is nullable, and the fallback writes null | falls back to `declared_level`, then to 3 |

If implementing this PR turns up an eighth gap, the instruction is the same one 3.1 followed:
say so in chat, write it into the README's contract freeze, and land the migration on its own
before continuing.

**Why `idx_teacher_available` is not in `teachers.prisma` and must not be added.** Prisma
cannot express `WHERE status = 'ONLINE'`, so declaring the full index instead makes every
later `migrate dev` emit a `CREATE INDEX` for a name that already exists. The model carries a
comment saying exactly that, and the index was already widened to include `price_per_block` by
`20260811120000_open_marketplace`. 4.2 measures; it does not assume.

**Why `bayesian` ships finished and `rankCandidates` ships stubbed.** They are different
kinds of unwritten. §9.3 gives the formula in one line and there is nothing to decide, so a
stub would only create a second thing to remember. §9.2 has six components, three of which
need smoothing against a platform average that does not exist yet — that is real work, it is
DEV-B's, and it belongs in the file that will hold it and in no other.

**Why the E5 seam is a callback and not a route.** See the epic README. Worth repeating here
only because this PR writes the `api.d.ts` block and someone will be tempted to add an
`offer` shape to it while they are in there. Do not: E5 appends its own block.
