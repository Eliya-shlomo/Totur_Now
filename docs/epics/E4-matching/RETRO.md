# E4 — Retro

| | |
|---|---|
| **Closed** | 2026-08-17 |
| **Verified by** | Rotem (DEV-B), local database, with Eliya (DEV-A) on the two-machine item |
| **Result** | ⚠ **Pending the recorded output.** The repository-evidenced sections below are final; "The checklist, as run" is not yet filled in |

E4 is the fourth epic through this structure and the first whose closing PR had to be
written before the previous epic's had been. E3's `RETRO.md` was written the same day as
this one, three days late, and the cost of that is recorded there rather than here.

## Did the seam hold?

**Yes, and more cleanly than E3's.** `matching.scoring.js` appears in three commits and
every one of them is where the plan said it would be:

```
4.1  7d3ee7c   created — frozen signatures, deterministic stub    DEV-A
4.3  d1cbd0d   bayesian() + getPlatformAverages()                 DEV-B
4.6  2f9fd5a   §9.2 full scoring in rankCandidates                DEV-B
```

Ownership transferred at 4.3 exactly as the shared-file table specified, and **DEV-A never
opened it again**.

**No `prisma` import ever entered the file.** Checked across the whole history of every
branch, not just `main`:

```bash
git log -p --all -- server/src/services/matching.scoring.js | grep "^+.*prisma"
# no output
```

**4.5's diff did not change when 4.6 landed.** This is the question E3 could not answer,
because 3.3 merged before 3.4 and the arrangement was never tested. Here it was:

```
20:41  4.5 merges — GET /questions/:id/matches, built against 4.1's deterministic stub
23:39  4.6 merges — the real scorer
```

4.5 was not reopened. The same function started returning a real order and the endpoint
that consumes it did not move. **Nobody stubbed the scorer a second time** — 4.5's diff is
the endpoint, its service and its tests, and contains no local scoring.

That is E3's 3.4-against-3.3 arrangement working as designed, one epic later, with the
merge order that actually exercises it. Record it as E4's answer to E3's open question.

## Did freezing the router and repository work a fourth time?

**Yes.** Two commits touch either file:

```bash
git log --oneline -- server/src/routes/matching.routes.js \
                     server/src/repositories/matching.repository.js
478db9a  feat(matching): §9.1 hard filters — the candidate pool (PR 4.2)
7d3ee7c  feat(matching): freeze the matching router, repository and scoring seam (PR 4.1)
```

`matching.routes.js` appears only in 4.1. `matching.repository.js` appears in 4.2 as well,
and that is **the one deliberate gap the table permitted** — `findCandidates`' `where`
clause, named in the README as the only thing 4.2 may add to the file. The freeze was
written with a hole in it and nothing else went through the hole.

Four-for-four: E1's `auth.routes.js`, E2's `teacher.routes.js` + `teacher.repository.js`,
E3's `question.routes.js` + `question.repository.js`, E4's pair. E1's
`user.repository.js` splice has not recurred in any form across four epics.

**Stop re-litigating it in E5.** Freeze the domain router and the repository in one
blocking PR, write the gaps down, and move on.

## Did cutting by seam rather than by layer keep both developers moving?

**Yes, and the numbers are unusually clean** — the whole epic ran in about eighteen hours:

```
08-16 16:45  4.1 merges  (A, blocking)
08-16 17:29  4.2 merges  (pool)
08-16 18:27  4.3 merges  (B — bayesian + averages)
08-16 19:11  4.4 merges  (A — credit-to-minutes, price ceiling)
08-16 20:41  4.5 merges  (A — the endpoint)
08-16 23:39  4.6 merges  (B — full scoring)
08-17 10:58  4.7 merges  (B — the selection screen)
```

4.1 was the only blocking wait and it was one sitting — 16:44 to 16:45.

**The 4.7 wait was absorbed, not moved.** 4.7 needed 4.4 (19:11), 4.5 (20:41) and 4.6
(23:39). DEV-B spent that window on 4.3 and 4.6 — its own track, its own files — and 4.7
opened straight off the back of 4.6 finishing. There is no idle gap anywhere in the
sequence. This is E3's 3.7 with the same shape and a better outcome, and it worked for the
reason E2's retro identified: the filler was real work in the blocked developer's own area,
not make-work that needed the other developer's review.

**One thing the plan and the repository disagree about.** The README assigns 4.2 to DEV-A.
It was delivered on `dev-b/E4.2-candidate-pool` (merged `c5a29cb`, PR #16). No harm — the
file was `matching.repository.js`'s permitted gap and no DEV-A branch had it open — but
this is E1's ownership-drift finding recurring for the second time. E1's rule was "an owner
change is an edit to the README table in the same push as the branch." The table still says
DEV-A. One line, and the repo stops lying.

## Did the one-line export of `TEACHER_VIEW` cost anything?

**No. It bought exactly what it was supposed to and nothing else happened.**

`teacher.repository.js` has been opened twice in its life:

```
2.1  e875643   created, frozen
4.1  7d3ee7c   TEACHER_VIEW becomes an export
```

One line, in the blocking PR, announced in chat first per `OWNERSHIP.md` §1 rule 2. No
other E4 PR went near the file, and there is exactly one consumer:

```
server/src/repositories/matching.repository.js:3
  import { TEACHER_VIEW } from '#repositories/teacher.repository.js';
```

`matching.repository.js:246` spreads it and appends the three ranking inputs a card does
not carry. **No second copy of the select list exists**, which is the whole point: E2
shipped three defects of the class "two subsystems disagree about a contract", and "what a
teacher looks like" having two definitions would have been a fourth.

The E2 crossing and the E4 crossing both went the same way, which is the finding worth
carrying. 4.7 also touched `client/src/pages/guest/TeacherProfile.jsx` — DEV-A's file from
2.5, untouched since, and **not named in E4's shared-file table at all** — to make the
profile's back link return to the match list instead of the public list. It was announced in
chat before the commit. Two cross-track edits in one epic, both announced, both one concern,
neither a conflict. The rule is doing the work; the table not naming the second file is the
gap, and the fix is E1's: name the file, or announce it. Announcing worked.

## The defect this pass was built to find

§18's acceptance criterion — "a teacher with one 5-star rating ranks below one with 4.6
across 40" — **fails end to end against seeded data.**

> **Fixed in E8's PR 8.2, 2026-08-23.** `globalRating` is smoothed through `bayesian` like
> the three components beside it, which is the one-expression fix this section asks for.
> Re-run the same way — Gil V. and Shira G. flipped `ONLINE`, integrals at level 5 — the
> endpoint now answers Shira G., **Dana K., Gil V.**, and the row in the manual table below
> passes. Everything else recorded here stands, including the finding that 4.6's unit tests
> pass against fixtures that are right.



Recorded 2026-08-17 during 4.7's development, before this pass: with Gil V. and Shira G.
flipped `ONLINE`, `GET /questions/:id/matches` returns **Gil first**.

`globalRating` is the one §9.2 component left unsmoothed. Gil's single 5-star scores a full
1.0 at weight 0.2, `newTeacherBoost` adds 0.05, and the totals land at roughly:

```
Gil V.   ≈ 0.793     one 5-star rating
Dana K.  ≈ 0.765     4.60 across 40
```

`topicFit` **is** smoothed correctly and does favour Dana — the arithmetic that §9.3 covers
works. The gap is the component §9.3 does not cover.

Three things make this worth more than the fix:

1. **4.6's unit tests all pass.** They assert `rankCandidates` against fixtures, and the
   fixtures are right. The defect only appears when the seed's real rows go through the
   whole endpoint. This is E2's finding — a contract two subsystems agree about in
   isolation and disagree about in composition — arriving for the fourth epic running.
2. **It was invisible through the endpoint on the seed as shipped.** Gil is `OFFLINE`, so
   an integrals question surfaces three teachers and the Bayesian pair never meets. The
   epic's README predicted exactly this and told 4.8 to flip the rows and revert. That
   prediction is the reason the defect has a name instead of being found in a demo.
3. **The fix is a design decision, not a typo.** Either §9.2's unsmoothed `globalRating` is
   intended and §18's criterion is wrong, or the criterion is right and `globalRating` needs
   the same Bayesian treatment `topicFit` gets. Smoothing it is the smaller change and makes
   the criterion pass. **This is DEV-B's call, in its own PR against
   `matching.scoring.js`.** 4.8 changes no source.

## The classifier was down for the whole pass

Classification failed for every question during 4.8's pass. **The cause is not yet
established** and is filed as its own item; the key in the repo-root `.env` is current and
its format was confirmed valid by its holder, so the credential is not the fault. The open
suspect is `LLM_MODEL = 'gemini-3.5-flash-lite'` (`config/constants/llm.js:42`) — a model id
that must be live for the key's tier or every call 404s — and the way to settle it is one
request against the API rather than more reading.

**That is an unplanned live test of `MVP.md` §8.1, and of E4's widest input.** E3's design
promise is that a dead classifier does not block the flow: the question is created anyway,
`classification_ok` is false, and it lands on the sentinel — `topic_id = 0`, `subtopic_id`
null, `estimated_level` null. E4's promise is that the sentinel is a *legal* input and the
*widest* pool, skipping both the topic filter and the level filter.

E3's retro records the Gemini free-tier quota firing the fallback twice during E3's own
development. This is the third occurrence and the largest, and it means the sentinel path
in §3 of the checklist was not a contrived test — it was the only path available.

**What it blocks:** every checklist item needing a classified question — the level filter,
the leaf-under-parent filter, the `declared_level` fallback, and §5's integrals question at
level 5. Those are runnable through 3.5's override endpoint, which is a legitimate path and
the one the product gives a student who disagrees with the machine. Whether they were run
that way is recorded below.

Filed as its own item. It is an environment defect, not a code defect, and it belongs to
whoever holds the key.

## The checklist, as run

The pass was run locally on 2026-08-17 by DEV-B, with DEV-A on the two-machine item. **The
recorded values are not yet transcribed into this table** — every row below is awaiting the
output it was run against, and a row carries a tick only once it carries its value. E2's
retro is readable a month later because it quotes `{"status":"ok","db":"ok","uptime":491}`
and "7 for 1, 5 and 20 rows" rather than "verified"; for this epic the equivalent is the
ranked list itself, five names in returned order, twice, from two runs.

| Item | Result |
|---|---|
| **Flow** | |
| `/health` green before starting | ⏳ |
| Register → ask → confirm → one button → `/app/ask/:id/teachers` | ⏳ |
| Ordered, ≤ `MATCH_COUNT` (5), every teacher `ONLINE` | ⏳ |
| Every card shows a price **and** the minutes it buys | ⏳ |
| No score, no rank number, no "responds in ~20s" | ⏳ |
| Reload → same teachers, same order | ⏳ |
| "Look again" unchanged → same teachers, same order | ⏳ |
| **Send request** confirms and stops — no offer route | ⏳ |
| **The pool — §9.1** | |
| Flip a listed teacher `OFFLINE` → gone; flip back → returns | ⏳ |
| `level_max` below `estimated_level` → never appears | ⏳ |
| No leaf under the question's parent → never appears | ⏳ |
| Ceiling down → list shrinks, the expensive ones go | ⏳ |
| `rejected_by` by hand → vanishes; back to `[]` → returns | ⏳ |
| `?priceBand=A\|B\|C` moves the ceiling; unknown band → `VALIDATION_ERROR` | ⏳ |
| **The sentinel** | |
| `topic_id = 0` returns teachers — filter skipped, not failed | ⏳ |
| Pool filtered by price and availability and nothing else | ⏳ |
| `requiredLevel` falls back `estimated_level ?? declared_level ?? 3` | ⏳ |
| Heading renders a sentence, never "General / Unclassified" | ⏳ |
| **Two empty pools** | |
| All `OFFLINE` → `200`, `[]`, `NO_AVAILABLE_TEACHERS`, right sentence | ⏳ |
| `ido.student` → `200`, `INSUFFICIENT_CREDIT`, different sentence | ⏳ |
| Neither is 4xx, neither logs an error | ⏳ |
| `NO_AVAILABLE_TEACHERS` thrown nowhere | ✅ 8 hits across `server/src` and `shared/`, all string values, comments or the status map |
| Empty-pool copy varies with whether raising the ceiling could help | ⏳ |
| `INSUFFICIENT_CREDIT` → `/app/wallet`, a `Placeholder` (PR 7.7) | ✅ expected — E7 owns the destination |
| **The ranking — §18** | |
| Gil + Shira `ONLINE`, integrals at level 5 → **Dana above Gil** | ✅ **passes since E8's 8.2** (2026-08-23). Failed here — Gil first; see "The defect this pass was built to find" |
| The integrals specialist ranks above the generalist | ⏳ |
| Revert to `OFFLINE` → list returns to three | ⏳ |
| `reviews` row → `studiedWith` true and the badge renders; delete → goes | ⏳ |
| Change nothing, re-run → identical order | ⏳ |
| **Boundaries** | |
| Another student's question id → `NOT_FOUND`, never `FORBIDDEN` | ⏳ |
| Session not `PENDING` → `SESSION_NOT_ACTIVE` (409) | ⏳ |
| Teacher's token → `FORBIDDEN`; no token → `UNAUTHORIZED` | ⏳ |
| Non-existent id → `NOT_FOUND` in the standard shape | ⏳ |
| **Performance and logs** | |
| Constant SQL statement count regardless of pool size | ⏳ |
| `EXPLAIN` matches the plan 4.2 recorded | ⏳ |
| Cold call timed; second faster; the difference is the averages | ⏳ |
| No student raw text at info level, no wallet balance | ⏳ |
| Selection screen at 375px, `scrollWidth === clientWidth` | ⏳ |
| Band change is a history entry — reload and share restore the list | ⏳ |
| **Two machines** | |
| Two students, two machines → own ceiling, own minutes, no cross-talk | ⏳ |

**Mutation ledger.** Every hand-written row — the two `ONLINE` flips, the `reviews` row, the
`rejected_by` array, the bulk `OFFLINE`, the session state — is local, and every one is
undone. Nothing was run against Neon. The revert verification transcribes here with the
values above.

The deployed half was measured on 2026-08-17 and is final:

| Item | Result |
|---|---|
| `GET /health`, cold | ✅ `{"success":true,"data":{"status":"ok","db":"ok","uptime":8}}` — **33.5 s** (DEPLOYMENT.md §7 predicts ~50 s) |
| Vercel client reachable | ✅ `200` in 5.4 s |
| Neon seeded | ✅ `/api/v1/teachers` returns real rows — `Yossi M.`, `TOP`, 4.7 across 120 |
| `VITE_API_URL` baked into the bundle | ✅ `https://tutor-now-api.onrender.com/api/v1` — E1's placeholder bug absent |
| CORS, Vercel origin | ✅ `Access-Control-Allow-Origin` and `Allow-Credentials` present |
| CORS, bogus origin | ✅ header absent — the whitelist is not a wildcard |

`NO_AVAILABLE_TEACHERS` is thrown nowhere, confirmed by grep on 2026-08-17: eight hits
across `server/src` and `shared/`, all of them string values, comments, or the status map.
One line reads like a contradiction and is not — `shared/errorCodes.js:68` maps
`NO_AVAILABLE_TEACHERS → 409`, and that entry is unreached. It is the catalogue's default
status for a code this epic deliberately never throws, exactly as `LLM_FAILED` sat unthrown
through E3.

## Data the product does not write

Stated in words, per the brief, so that the first person who re-runs matching after a demo
session does not file the design as a bug.

**Every input E4 ranks on has exactly one writer today, and it is the seed.**

| Input | Written by | Until |
|---|---|---|
| `teacher_topic_stats` — all four columns | `prisma/seed/teachers.js` | E8's review service |
| `reviews` — and therefore `studiedWith` | nothing | E8 |
| `offers_received` / `offers_accepted` — and therefore `acceptance_rate` | seeded, then frozen | E5's offer flow |

A session completed this afternoon moves no ranking. A student who studies with a teacher
gets no 💙 badge. The acceptance rate is history that stopped. **Every one of those is
correct behaviour for E4 and every one of them looks like a bug during a demo.**

`studiedWith` is `false` for every real pair until E8 or a hand-written row, which is why
4.8's checklist inserts one and deletes it in the same section.

The deterministic tie-break exists for the same reason: on a database with no history the
smoothed components all collapse to the prior, only `new_teacher_boost` varies, and two
calls must still return the same five teachers in the same order — or the price control and
the "Look again" button both look broken while working perfectly.

## Carried into E5

**The filler list, all six items open at close:**

| # | Item | Owner | State |
|---|---|---|---|
| F1 | Leaf topics — the seed stops writing parent rows | DEV-B | Open. `prisma/seed/teachers.js:317` still adds each subtopic's parent |
| F2 | Publish `TEACHING_LEVELS` / `BIO_MAX_LENGTH` through `/public` | DEV-A | Open. Still four copies |
| F3 | Nullable `onboarded_at` | DEV-B | Open. No such column |
| F4 | `TeacherStatusToggle` refreshes on status change | DEV-B | Open. Still keyed on `location.pathname` |
| F5 | `prisma/seed/questions.js` — two `PENDING` demo questions | DEV-B | Open. Never opened |
| — | `globalRating` smoothing | DEV-B | **New.** The §18 defect above, its own PR |
| — | The classification outage | DEV-B | **New.** Cause not yet established. Blocks E5's demo — a question must exist before an offer can be sent |

Four debts entered E3 from E2, four left it, E4 added two and finished none. **Filler that
is genuinely optional does not get done, four epics running.** E2's retro said filler works
when it is small, owned and in the blocked developer's own area — all six of these are, and
the missing condition turns out to be a fourth one: a position in the order table. For E5,
either the filler gets numbered and scheduled like a PR, or it stops being written down as
if it will happen.

**Open from E3:** 3.8's 32-item checklist has never been run. E3's `RETRO.md` was written
from repository evidence on 2026-08-17 and 3.8 is marked `◐`. It is one sitting and it runs
before E5's first PR, by whichever developer is not closing E5.

**Open environment defect:** the `GEMINI_API_KEY` above. E5 does not read it, but E5's demo
does — a question has to exist before an offer can be sent.

**Where E4 stops.** The student presses **Send request** and a modal names the teacher, the
real opening-block cost, and says plainly that the sending part is not built. No route was
invented for what comes next. The callback is frozen:

```js
onChoose({ teacherId, pricePerBlock })
```

E5 replaces one function body in `ChooseTeacher.jsx`, a file DEV-B already owns. The
`sessionId` it needs is already on the `QuestionResponse` the screen loads.

**Carried as process:**

1. Freeze the domain router and repository in one blocking PR, and **write the permitted
   gaps down**. Four-for-four. 4.2's single permitted edit to a frozen file is the model.
2. A pure seam with a deterministic stub lets the consumer merge before the producer, and
   the consumer's diff does not reopen. E3 left this untested; E4 tested it. Repeat it.
3. Cut by seam, not by layer. One blocking PR, one cross-track wait, zero idle time.
4. An owner change is an edit to the README table in the same push as the branch. Said
   after E1, ignored in E4's 4.2. Third time asking.
5. A cross-track edit to another developer's file is fine when announced in chat first.
   Twice in this epic, both clean. The table should still name the file where it can.
6. A unit test on fixtures is not a verification pass. The §18 defect passed every test it
   had and failed the only run that used real rows.
7. The closing PR opens the day the last feature PR merges.
