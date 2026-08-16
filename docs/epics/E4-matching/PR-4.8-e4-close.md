# PR 4.8 — E4 close: verification + retro

| | |
|---|---|
| **Epic** | E4 — Matching Engine |
| **Owner** | DEV-A (eliya), with DEV-B for the two-machine item |
| **Size** | S |
| **Written by** | Agent for the write-up. **The pass itself is run by a human**, on two machines. |
| **Depends on** | 4.2–4.7 merged |
| **Blocks** | E5 |
| **Branch** | `dev-a/E4.8-e4-close` |

## Contract implemented

None. This PR verifies the epic's definition of done end to end and writes `RETRO.md`.

## Scope

Run the checklist below **against a local database** (`npm run db:up`, root `.env` on port
5433, seeded), then the read-only half against the deployed Vercel + Render pair. Ownership
alternates — DEV-B closed E3, DEV-A closes E4 — so neither developer is the only person who
has ever run the whole thing.

Three things make this pass different from E3's, and all three are setup rather than
checklist items:

1. **The pass writes rows.** Flipping a teacher `ONLINE`, inserting a `reviews` row to make
   `studiedWith` true, and hand-writing a `rejected_by` array are writes. Every one of them
   is local, and every one of them is undone in the same sitting. Nothing on this list is
   run against Neon.
2. **The seed's `ONLINE` set hides §18's own acceptance criterion.** Gil V. and Shira G. are
   `OFFLINE`, so an integrals question surfaces three teachers and the Bayesian pair never
   meets. The checklist flips them `ONLINE` locally, runs the criterion, and reverts.
3. **The platform-average cache is five minutes of module-level state.** A value changed in
   `psql` does not appear until it expires. Restart the server after any write that feeds
   `getPlatformAverages()`; do not wait it out and do not conclude the query is wrong.

**F4 should land before this pass runs.** A header pill that lies about `ONLINE` during a
demo reads as a matching bug, and `status` is E4's first hard filter. If F4 has not merged,
say so in the retro next to any item it touched.

### The checklist

**Flow — the definition of done**
- [ ] `/health` green before starting
- [ ] Student registers → asks a question → confirms the classification → **presses one button** and lands on `/app/ask/:id/teachers`
- [ ] The list is ordered, at most `MATCH_COUNT` (5) long, and every teacher on it is `ONLINE`
- [ ] Every card shows a price **and** the minutes that price buys this student
- [ ] No card shows a score, a rank number, or a "responds in ~20s"
- [ ] Reload the screen → same teachers, same order
- [ ] Press the refresh / "show me more teachers" control with nothing else changed → same teachers, same order
- [ ] **Send request** confirms the choice and stops. No offer route, no navigation into E5

**The pool — §9.1's filters, one at a time**
- [ ] Take a teacher off the list by flipping them `OFFLINE` → they disappear on the next call; flip back → they return
- [ ] A teacher whose `level_max` is below the question's `estimated_level` never appears
- [ ] A teacher who declares no leaf under the question's parent never appears on a classified question
- [ ] Move the price ceiling down → the list shrinks and the expensive teachers are the ones that go
- [ ] Add the top-ranked teacher's id to the question's `rejected_by` by hand → they vanish; delete the row's array back to `[]` → they return
- [ ] `?priceBand=A|B|C` changes the ceiling; an unknown band → `VALIDATION_ERROR`

**The sentinel question — the widest pool, and the one a Gemini quota error produces**
- [ ] A question with `topic_id = 0`, `subtopic_id` null, `estimated_level` null returns teachers — the topic filter is skipped, not failed
- [ ] Its pool is filtered by price and availability **and nothing else**, including teachers who declare no topics
- [ ] `requiredLevel` falls back `estimated_level ?? declared_level ?? 3` — verify with a question carrying a `declared_level` and no `estimated_level`

**Two empty pools, two sentences, one 200**
- [ ] Every teacher `OFFLINE` → `200`, `teachers: []`, `reason: 'NO_AVAILABLE_TEACHERS'`, and the screen says nobody who teaches this is online
- [ ] The seeded 0-credit student (`ido.student`) → `200`, `reason: 'INSUFFICIENT_CREDIT'`, a different sentence, and no teachers listed
- [ ] Neither case is a 4xx, and neither logs an error
- [ ] `NO_AVAILABLE_TEACHERS` is thrown nowhere — `grep` the server for it and confirm every hit is a string value

**The ranking — §18's acceptance criterion, end to end**
- [ ] Flip Gil V. and Shira G. `ONLINE` locally
- [ ] Ask an integrals question at level 5 → **Dana K. (4.60 across 40) ranks above Gil V. (one 5-star)**. Record the actual order returned
- [ ] The integrals specialist ranks above the generalist who also passes the filter
- [ ] Revert Gil and Shira to `OFFLINE`, and confirm the list returns to three
- [ ] Insert a `reviews` row pairing this student with a listed teacher → `studiedWith` becomes true and the badge renders; delete the row and confirm it goes

**Data the product does not write — state it, do not imply it**
- [ ] Complete nothing and change nothing, re-run matching → identical order (the point of the deterministic tie-break)
- [ ] Confirm in the retro, in words: `teacher_topic_stats` has one writer (the seed) until E8, `reviews` is empty until E8, `offers_received`/`offers_accepted` stop moving until E5

**Boundaries**
- [ ] Another student's question id → `NOT_FOUND`, never `FORBIDDEN`
- [ ] A question whose session is not `PENDING` → `SESSION_NOT_ACTIVE` (409)
- [ ] A teacher's token on the endpoint → `FORBIDDEN`; no token → `UNAUTHORIZED`
- [ ] A non-existent question id → `NOT_FOUND` in the standard error shape

**Performance and logs**
- [ ] `GET /questions/:id/matches` issues a **constant** number of SQL statements regardless of pool size — check with `DEBUG=prisma:query`, not by reading the code
- [ ] `EXPLAIN` on the candidate query matches the plan 4.2 recorded; if 4.2 added an index, confirm it is used, and if it did not, confirm the sequential scan is still what happens
- [ ] Restart the server, first call after a cold cache → timed and recorded; second call → faster, and the difference is the platform averages
- [ ] Server logs carry no student raw text at info level and no wallet balance
- [ ] The selection screen is usable at 375px, `scrollWidth === clientWidth`

**Two machines (needs DEV-B)**
- [ ] Two students, two machines, matching run simultaneously on the same question topic → each sees their own ceiling and their own minutes, no cross-talk
- [ ] The deployed pair runs the read-only half of the flow, with a real cold start timed and recorded

### `RETRO.md`

Same shape as E1's, E2's and E3's. Answer the questions this epic inherits, with what the
repository and the deployed pair actually did:

1. **Did the seam hold?** `rankCandidates(candidates, averages)` was frozen before either
   track opened. Did `matching.scoring.js` ever import `prisma`? Did 4.5's diff really not
   change when 4.6 landed? Did anyone stub the scorer a second time?
2. **Did freezing the router and repository work a fourth time?** E2 and E3 both answered
   yes. If it held again, say so plainly and stop re-litigating it in E5.
3. **Did cutting by seam rather than by layer keep both developers moving?** 4.1 was the only
   blocking wait and 4.7 was the only cross-track one. Was the 4.7 wait absorbed by 4.3/4.6
   and the filler, or did it just move?
4. **Did the one-line export of `TEACHER_VIEW` cost anything?** It was the epic's only edit to
   a frozen E2 file, announced in chat first. Second copy avoided, or trouble bought?

Then the parts only running the thing can tell you: the measured latency of the endpoint warm
and cold, what the ranking actually produced against seeded data, whether the price control
felt like an answer to "show me more teachers", and any contract two subsystems disagree
about.

Close by listing what carries into E5, including the state of the filler list (F1–F5) and any
E3 debt still open. **Say explicitly which E4 behaviour is inert until E5 and E8 write the
rows** — `studiedWith`, the offer counters, and every `teacher_topic_stats` column — so that
the first person who re-runs matching after a demo session does not file the design as a bug.

## Files you may touch

```
docs/epics/E4-matching/RETRO.md              new
docs/epics/E4-matching/README.md             tick the boxes, correct anything the epic disagrees with
docs/DEPLOYMENT.md                           only if the pass found something wrong with it
```

## Files you must NOT touch

```
server/**                                    a defect found here is its own small PR, by its owner
client/**                                    same
prisma/**                                    same — including the seed, however tempting the ONLINE set is
shared/**                                    same
```

The `ONLINE` flips, the `reviews` row and the `rejected_by` array are **database writes made
by hand and undone by hand**. None of them is a seed change. If the seed's `ONLINE` set turns
out to be genuinely wrong for demos, that is a filler PR for DEV-B, filed here and done
separately.

## Acceptance criteria

- [ ] Every box above is either ticked with its recorded output, or marked not-run **with the reason and the plan for running it in the same sentence**
- [ ] `RETRO.md` exists and answers all four questions with evidence, not adjectives
- [ ] `README.md`'s PR table is fully ticked
- [ ] The diff contains no source change

## Manual test

The checklist above **is** the manual test. Record the actual output — the returned order, the
error code, the statement count, the timing — not a tick. E2's retro is readable a month later
because it quotes `{"status":"ok","db":"ok","uptime":491}` and "7 for 1, 5 and 20 rows"
instead of "verified". For this epic the equivalent is the ranked list itself: paste the five
teacher names in the order the endpoint returned them, twice, from two runs.

## Review checklist additions

- An unexplained "not run" is how E2 closed provisionally. It does not happen twice.
- Every hand-written row is shown deleted in the same section that shows it inserted.
- A defect found during the pass is filed and fixed by the file's owner in its own PR. This PR changes no source.
- The retro states the inert-data problem in plain words. A passing check must not be left to imply live data.

## Notes

**Why DEV-A closes this epic.** DEV-B closed E3 and holds the half of E4 — the scoring — whose
failures are invisible to a status code. Alternating means the person writing the retro is not
the person whose arithmetic is being described, and the ranking is the thing most worth a
second pair of eyes reading real output.

**The ranking section is the one that matters.** Everything else in this epic has a test. "The
integrals specialist ranks above the generalist, and 4.6 across 40 beats one 5-star" is a
promise `MVP.md` §18 makes, implemented across a pure function and a repository owned by two
people, and only observable by putting the right teachers online and reading the list.

**Why the seed is on the denylist during a verification pass.** The temptation is to flip Gil
and Shira `ONLINE` in `prisma/seed/teachers.js` and never think about it again. That changes
what every future run of this epic verifies, silently, from the closing PR of the epic being
verified. Flip the rows, run the criterion, revert.
