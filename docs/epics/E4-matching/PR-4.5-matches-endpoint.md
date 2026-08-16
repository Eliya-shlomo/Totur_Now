# PR 4.5 — `GET /questions/:id/matches`

| | |
|---|---|
| **Epic** | E4 — Matching Engine |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 4.2 (merged). **Not 4.6** — see "The scorer is a stub and that is correct". |
| **Blocks** | 4.7 |
| **Branch** | `dev-a/E4.5-matches-endpoint` |

## Contract implemented

`GET /questions/:id/matches?priceBand=A|B|C` (`MVP.md` §12), answering `MatchesResponse` from
the epic's contract freeze. Fills in the controller, the validator and
`matching.service.js`; the route itself has been wired and frozen since 4.1.

## Scope

The orchestration, and it is deliberately thin — every rule it applies belongs to a file that
already exists.

**Six steps, in this order:**

1. `findQuestionForMatching(id)`. Missing, or a question belonging to another student →
   `NOT_FOUND`, never `FORBIDDEN`. Same rule as 3.5, and for the same reason: `FORBIDDEN`
   confirms the id exists.
2. Session not `PENDING` → `SESSION_NOT_ACTIVE` (409). Once an offer is out, a fresh match
   list is a way to double-book a student, and 3.5 already refuses re-classification on the
   same test.
3. `findWalletBalance`, then `matching.candidates.service.js` (4.2) for the ceilings and the
   pool. Short-circuit on `INSUFFICIENT_CREDIT` before any candidate query runs.
4. `getPlatformAverages()` (4.3, DEV-B's) and `findPositiveHistoryTeacherIds(studentId)` —
   the two inputs the scorer needs that the pool does not carry. Mark each candidate's
   `hasPositiveHistory` from that id set.
5. `rankCandidates(candidates, averages)` (DEV-B's seam), then take the first `MATCH_COUNT`.
6. Serialize: join the ordered `{teacherId, score}` list back onto the candidate rows this
   service already holds, and emit `TeacherMatch[]`. **`score` is dropped here and reaches no
   payload.**

**The serializer.** `teacher` is `toTeacherCard(row)` — E2's function, imported not
reimplemented, which is why 4.1 exported `TEACHER_VIEW` and why `findCandidates` selects
through it. The three extra fields come off the candidate:

- `subtopicSessions` — `subtopicStats?.sessionsCount ?? 0`, rounded for display. The column is
  `NUMERIC(8,2)` because of the 0.3 parent propagation; a card saying "solved 12.6 questions"
  is not a card.
- `subtopicResolveRate` — `resolvedCount / sessionsCount` in the subtopic, or **`null`** when
  `sessionsCount` is 0. Null, never 0: the same distinction `TeacherCard.rating` makes, and
  the client renders them differently.
- `studiedWith` — the boolean the scorer used, carried through rather than recomputed.

Plus `priceCeiling` and `walletBalance`, both already in hand from step 3, and `reason`.

**Where the serializer lives.** `server/src/utils/matchView.js`, new, alongside
`teacherView.js` and `questionView.js`. Not in the service: the epic has one payload shape and
it is written out field by field, never a spread of a Prisma row — the rule `teacherView.js`
states and the reason it gives (a column added later is invisible until a human adds it here)
applies exactly as much to a row that carries `offersReceived` and `ratingSum`.

**The two empty answers, both 200.** `{ teachers: [], reason: 'INSUFFICIENT_CREDIT' | 'NO_AVAILABLE_TEACHERS', priceCeiling, walletBalance }`.
`NO_AVAILABLE_TEACHERS` exists in `shared/errorCodes.js` and **this endpoint never throws it**,
exactly as E3 never threw `LLM_FAILED`. §9.4's own pseudocode returns a reason rather than
raising, an empty list is a state every list in this codebase already renders, and a 409 would
make the screen show an error for the product working as designed. Put that sentence in the
service's header so nobody "fixes" it.

`priceCeiling` is populated in the `INSUFFICIENT_CREDIT` case too — the student's affordable
ceiling, which is what makes the empty state able to say *how short* they are.

**The validator (`matching.schema.js`, filled in from 4.1's stub).** `.strict()` on all three
parts, the posture `teacher.public.schema.js` takes and for the reason it gives: a client that
invents `?sort=price` should get a `VALIDATION_ERROR` naming the parameter rather than a
silently ignored filter and a bug report about a list "not sorting".

- `params.id` — `z.string().uuid()`
- `query.priceBand` — `z.enum(PRICE_BAND_KEYS)`, **optional**, no default. Absent means no
  ceiling, and `bandCeiling(undefined)` already answers `MAX_PRICE_PER_BLOCK` for exactly this
  reason. Do not default it to `'C'`: today those are the same number, and the day somebody
  edits `money.js` they are not.
- `body` and the rest of `query` — empty and strict

**No pagination, no offset, no `limit`.** `MATCH_COUNT` is the contract. §12's "re-callable =
show me more teachers" means re-running the query — teachers go online and offline, and from
E5 on the pool shrinks as offers are rejected. Widening the pool is the price control.

### The scorer is a stub and that is correct

4.1 shipped `rankCandidates` returning `score: 0` for everyone in `teacherId` order, and 4.6
replaces the body. **This PR is written and merged against the stub, and its diff must not
change when 4.6 lands.** Between the two merges the endpoint returns the right teachers in an
arbitrary but stable order.

Two things follow, and both are review items. **Do not stub the scorer a second time here** —
one stub, in the file that will hold the real thing, is the whole point of the seam and it is
E3's fourth carried lesson verbatim. And **do not sort in this service**: if the order looks
wrong, that is 4.6's file, not this one. The only ordering operation permitted here is
`.slice(0, MATCH_COUNT)` on a list the scorer already ordered.

## Files you may touch

```
server/src/services/matching.service.js             new
server/src/utils/matchView.js                       new
server/src/controllers/matching.controller.js       fill in 4.1's stub
server/src/validators/matching.schema.js            fill in 4.1's stub
server/tests/matching.service.test.js               new
docs/epics/E4-matching/README.md                    tick the status box
```

## Files you must NOT touch

```
server/src/routes/matching.routes.js                frozen since 4.1 — the route is final
server/src/repositories/matching.repository.js      frozen since 4.1 — all five queries exist
server/src/services/matching.candidates.service.js  4.2's; call it, do not inline it
server/src/services/matching.scoring.js             DEV-B's since 4.3. Call rankCandidates; do not
                                                    read it, do not sort around it, do not stub it
server/src/services/matching.averages.service.js    DEV-B's, 4.3
server/src/utils/teacherView.js                     E2's — toTeacherCard is imported, not forked
server/src/repositories/teacher.repository.js       frozen since 2.1
server/src/repositories/question.repository.js      frozen since 3.1
shared/api.d.ts                                     4.1 wrote the E4 block. Match it; do not edit it
shared/errorCodes.js                                every code this endpoint uses already exists
client/**                                           4.7's
```

## Acceptance criteria

- [ ] `avi.student` + an `integration-by-parts` level-5 question, no `priceBand` → 200, three teachers, `reason: null`, `priceCeiling: 20`, `walletBalance: 120`
- [ ] `?priceBand=A` on the same question → 200, `teachers: []`, `reason: 'NO_AVAILABLE_TEACHERS'`, `priceCeiling: 9`
- [ ] `noya.student` (24 credits) → `priceCeiling: 12`, and no returned teacher costs more
- [ ] `ido.student` (0 credits) → 200, `reason: 'INSUFFICIENT_CREDIT'`, `teachers: []`, and `DEBUG=prisma:query` shows **no candidate query**
- [ ] Every `teacher` object is field-for-field a `TeacherCard`: same ten keys, same order-independent equality with what `GET /teachers/:id` returns for the same teacher
- [ ] No response anywhere contains `score`, `rank`, `ratingSum`, `offersReceived`, `email`, or `status`
- [ ] A teacher with no history in the subtopic has `subtopicSessions: 0` and `subtopicResolveRate: null` — not `0`
- [ ] `studiedWith` is `false` for every seeded pair; inserting a `reviews` row with `stars = 4` for that student and teacher flips exactly one to `true` (**delete the row afterwards**)
- [ ] Another student's question id → `NOT_FOUND`. A teacher's token → `FORBIDDEN`. No token → `UNAUTHORIZED`
- [ ] `update sessions set status='OFFER_SENT'` for that question → `SESSION_NOT_ACTIVE`, 409 (**set it back**)
- [ ] `?priceBand=D`, `?priceBand=`, `?page=2` and a malformed uuid each → `VALIDATION_ERROR` naming the parameter
- [ ] A question with `topic_id = 0`, `subtopic_id` and `estimated_level` both null → 200 with online affordable teachers, `reason: null`
- [ ] Never more than `MATCH_COUNT` teachers, however many candidates the pool holds
- [ ] Two identical calls return the same teachers in the same order (the stub is deterministic, and so must the service be)
- [ ] The response is a constant number of SQL statements whatever the candidate count, and the platform-average query does not repeat within the cache window
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` pass

## Manual test

1. `npm run db:up && npm run db:seed && npm run dev`
2. Log in as `avi.student`, create a question through `/app/ask` about integration by parts, confirm the classification, note the id
3. `curl` the endpoint with no band, then `?priceBand=A`, `?priceBand=B`, `?priceBand=C`, and read `priceCeiling` off each response
4. Repeat as `noya.student` and `ido.student` with their own questions — the wallet ceiling is per caller
5. Compare one returned `teacher` object against `GET /api/v1/teachers/<same id>` — they must be identical
6. `psql`: `insert into reviews (session_id, student_id, teacher_id, is_resolved, stars) values (null, '<avi>', '<dana>', true, 5);` → `studiedWith` is true for Dana. **`delete from reviews where session_id is null;`**
7. `psql`: `update questions set rejected_by = array['<dana>']::uuid[] where id='<q>';` → Dana disappears. **Reset to `'{}'`**
8. `update sessions set status='OFFER_SENT' where question_id='<q>';` → 409. **Set it back to `PENDING`**
9. Break the classifier (`GEMINI_API_KEY` unset, restart) and submit a new question → a sentinel question. Call matches on it: everyone online and affordable comes back
10. `DEBUG=prisma:query` and count statements for a 1-candidate and a 3-candidate question

## Review checklist additions

- Confirm the service contains no `.sort(`, no comparison of scores, and no `Math.max`. Ordering is `matching.scoring.js`'s only job.
- Confirm `toTeacherCard` is imported from `#utils/teacherView.js`. A hand-built card here is the second definition of a teacher, which is the defect class E2 shipped three of.
- Confirm `score` is destructured away at the boundary and cannot reach `matchView.js`. §14.2: "No algorithm scores on screen" — the cheapest way to keep that promise is for the number never to leave the service.
- Confirm the `INSUFFICIENT_CREDIT` branch returns before `findCandidates` and before `getPlatformAverages`. Both are wasted work for a student who cannot afford anybody.
- Confirm the controller touches no database and the service takes no `req`/`res` (`CONVENTIONS.md` → Server layering).
- Confirm every row written during verification is named in the PR description with the statement that deleted it.

## Notes

**Why `SESSION_NOT_ACTIVE` and not just an empty list.** A question whose session has left
`PENDING` already has an offer out or a teacher attached. Returning a fresh list would let a
student send a second offer, which is precisely the invariant §9.5's "one offer at a time"
exists to protect and which E5's 5.3 enforces atomically. Refusing here is cheap and it makes
5.3's job smaller.

**Why `walletBalance` is in the response at all.** The server has already read it to compute
`priceCeiling`, `GET /wallet` is E7 and does not exist, and `GET /auth/me`'s copy is as old as
the last login. One authoritative number, free.

**Why `subtopicResolveRate` is null rather than 0 for an unknown teacher.** `teacherView.js`
argues this at length for `rating` and the argument is identical: "rated badly" and "not rated
yet" are different claims, and a new teacher has not failed to resolve anything. 4.7 renders
the two differently and cannot do so if the server has already flattened them.

**What is not verifiable yet, and must not be implied.** `studiedWith` is false for every real
pair because nothing writes `reviews` until E8, `subtopicSessions` comes entirely from the
seed, and `rejected_by` is empty until E5. Every one of those is exercised above by writing a
row by hand and deleting it. A test that passes because the column is empty is not a test.
