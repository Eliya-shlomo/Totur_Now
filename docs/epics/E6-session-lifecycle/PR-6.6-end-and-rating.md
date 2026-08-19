# PR 6.6 — Termination, no-show refund, rating → `RATED`

| | |
|---|---|
| **Epic** | E6 — Session Lifecycle & Video |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | **Human — no agent.** It moves credit in three directions, one of which is a refund, and it is the only PR in the project that writes the aggregates E4's ranking reads. |
| **Depends on** | 6.5 |
| **Blocks** | 6.7 |
| **Branch** | `dev-b/E6.6-end-and-rating` |

## Contract implemented

`MVP.md` §10's `ACTIVE → ENDED`, `ACTIVE → NO_SHOW` and `ENDED → RATED` edges. §12's
`POST /sessions/:id/end`, `POST /sessions/:id/report-no-show` and `POST /sessions/:id/review`.
§13's `session:ended`.

## Scope

### 1. Ending a session — one path, five reasons

Everything that ends a session goes through `session.end.service.js`. There is no second
place that writes `ENDED`, and 6.5's auto-end cron is rewired to call this instead of the
direct `endSession` it shipped with — **that rewiring is part of this PR and is named here so
it is not mistaken for scope creep.**

```js
endSession({ sessionId, endReason, actorId })
//  1. lock the session; assertTransition(status, 'ENDED')     → SESSION_NOT_ACTIVE (409)
//  2. gross  = session.total_charged
//     feeRate = platformFeeRate({ teacherCreatedAt, at: startedAt })   ← E5's util
//     fee     = Math.round(gross × feeRate)
//     earning = gross - fee
//  3. creditTeacher({ amount: earning, note: 'session ...' })
//  4. session → ENDED, ended_at, end_reason, platform_fee, teacher_earning
//  5. teacher → ONLINE   (conditional on IN_SESSION — E5's release, same shape)
//     teacher_profiles.sessions_count += 1
//  after COMMIT: emitSessionEnded → session:{id}, both sides
```

| `end_reason` | Set by |
|---|---|
| `student_ended` | either side pressing the end button — see below, there is no `teacher_ended` |
| `no_extension` | 6.5's auto-end cron, at `ends_at + GRACE_SECONDS` |
| `no_credit` | the student declined at the warning and could not have afforded it anyway |
| `budget_cap` | the cap refused the next block |
| `error` | reserved; nothing writes it in E6 |

**Either side may press end and both write the same reason set.** §11.2's enumeration has no
`teacher_ended` value and inventing one is a migration. The *actor* is not lost — the emit
carries it and the log records it — but the column says why the session is over, not who was
holding the mouse. `POST /sessions/:id/end` therefore has `authenticate` and no `authorize`,
which 6.2 already wired.

**`platform_fee` is computed at `started_at`, not at `ended_at`.** §5.3's low-demand window is
`[6, 14)` in `TIMEZONE`, and a session that begins at 13:55 and ends at 14:05 must not become
chargeable halfway through. The teacher was quoted a number when they accepted; that is the
number that holds. E5's `platformFeeRate` takes `at` for exactly this reason.

**`sessions_count` moves here and `resolved_count` moves at the rating.** They are two
different facts and E4's Bayesian smoothing divides one by the other.

### 2. No-show — the refund path

```
POST /sessions/:id/report-no-show    student only, 6.2's authorize
//  1. lock; assert ACTIVE
//  2. assert now() - started_at <= NO_SHOW_WINDOW_SEC       → SESSION_NOT_ACTIVE (409)
//  3. assert blocks_used === OPENING_BLOCKS                  → a session that was
//       extended was not a no-show, and the window makes that nearly impossible anyway
//  4. refundSession({ amount: total_charged })   — the full amount, no fee, no earning
//  5. session → NO_SHOW, ended_at, end_reason = 'teacher_no_show'
//  6. teacher → ONLINE; teacher_profiles.no_show_count += 1
//     sessions_count is NOT incremented — nobody taught anything
```

**`NO_SHOW` is terminal and is not rated.** Rating somebody who never arrived produces a review
row about nothing and would take `resolved_count` down with it. The refund is the outcome, and
6.7's screen sends the student back to the match list rather than to a rating modal.

**`NO_SHOW_WINDOW_SEC` is 60 and gets its first reader here.** After a minute the student's
remedy is to end the session, which charges — that is the product's answer and it is why the
window is short and enforced on the server.

### 3. The rating — the write only

```
POST /sessions/:id/review   { isResolved, stars?, comment? }   student only
//  1. lock; assertTransition(status, 'RATED')    → ENDED is the only legal from
//  2. insert reviews (session_id UNIQUE — one per session, the database says so)
//  3. teacher_profiles: resolved_count += isResolved ? 1 : 0
//                       rating_sum   += stars ?? 0
//                       rating_count += stars == null ? 0 : 1
//  4. session → RATED
```

`isResolved` is the required field and the core KPI (§6.2). `stars` is optional, 1–5, and the
`CHECK` constraint is already on the table. **A review with no stars must not move
`rating_count`** — that is how an average becomes wrong, and it is one `??` away from being
wrong.

**Everything that reads these four columns stays E8's.** The badge, the history screen, the
public profile — none of them is in this PR. All 6.6 adds on the client is the route swap:
`routes.student.jsx`'s `Placeholder title="Rate this session" pr="8.4"` becomes the real
screen, and the placeholder's `pr=` is corrected in the PR that replaces it, per E1's retro
rule.

**The modal blocks.** §10 makes the rating mandatory, so the way out of an `ENDED` session is
submitting it. 6.7 owns how that feels; this PR owns the fact that until the review exists the
session's terminal state has not been reached and `isRated` is `false`.

## Files you may touch

```
server/src/services/session.end.service.js       new — end, no-show, the credit and the refund
server/src/services/session.review.service.js    new — the review write and the aggregates
server/src/controllers/session.controller.js     fill end, report-no-show, review
server/src/validators/session.schema.js          the review body — 6.2 left the shape
server/src/repositories/session.repository.js    ONLY the bodies 6.2 left as gaps
server/src/repositories/teacher.presence.repository.js  aggregate increments, or a new
                                                 session-owned read if that file is E2's
server/src/jobs/session.autoEnd.job.js           6.5's — rewired to call endSession here
client/src/pages/student/RateSession.jsx         new — the blocking modal's screen
client/src/router/routes.student.jsx             one line: the review placeholder
client/src/api/session.api.js                    append endSession, reportNoShow, submitReview
server/tests/session.end.test.js                 new
server/tests/session.review.test.js              new
docs/epics/E6-session-lifecycle/README.md        tick the status box
```

## Files you must NOT touch

```
server/src/utils/commission.js          E5's. Import platformFeeRate; do not restate §5.3
server/src/services/wallet.service.js   6.5's, frozen. Call the three functions; add no fourth
server/src/services/matching.*.js       E4's readers of the aggregates this PR writes
server/src/services/teacher.public.service.js  E2's. Nothing in E6 renders a badge
server/src/routes/**                    frozen again after 6.2
shared/**                               frozen at 6.2
prisma/**                               no migration. reviews and its CHECK exist
client/src/pages/student/Session.jsx    6.7's
```

## Acceptance criteria

- [ ] Either participant can end an `ACTIVE` session; it becomes `ENDED` with `ended_at` and `end_reason = 'student_ended'`, and `session:ended` reaches both
- [ ] The teacher is credited exactly `total_charged - round(total_charged × feeRate)`, in one `TEACHER_EARNING` ledger row, and `platform_fee + teacher_earning === total_charged` **to the credit**
- [ ] `feeRate` is resolved against `started_at`, not `ended_at` — a session spanning 14:00 is charged at the rate it was quoted
- [ ] The teacher goes back to `ONLINE` from `IN_SESSION`, conditionally — a teacher who went `OFFLINE` mid-session stays `OFFLINE`
- [ ] `sessions_count` incremented by one on a normal end, and **not** on a no-show
- [ ] Ending an already-`ENDED` session → `409 SESSION_NOT_ACTIVE`, no second credit
- [ ] Reporting a no-show within 60s refunds `total_charged` in full: the student's balance is back where it started, one `REFUND` row, no `TEACHER_EARNING` row, `no_show_count` up by one
- [ ] Reporting a no-show after 60s → `409`
- [ ] Reporting a no-show on an extended session → `409`
- [ ] A review with `isResolved: true` and no stars: `resolved_count` +1, `rating_count` **unchanged**, `rating_sum` unchanged, session `RATED`
- [ ] A review with 4 stars: `rating_count` +1, `rating_sum` +4
- [ ] A second review on the same session → the unique constraint refuses it as a `409`, not a 500
- [ ] Reviewing a session that is not `ENDED` → `409 SESSION_NOT_ACTIVE`
- [ ] A `NO_SHOW` session cannot be reviewed
- [ ] **Reconciliation holds after every case above**, including the refund
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. Run a full session. Note both balances first. End it from the student's side
2. `select total_charged, platform_fee, teacher_earning from sessions where id = …` — the two add up to the first
3. `select type, amount, balance_after from wallet_transactions where session_id = …` — a `SESSION_CHARGE` and a `TEACHER_EARNING`, and the teacher's balance moved by the second
4. Run another. End it from the **teacher's** side. Same reason, same arithmetic
5. Run a third and report a no-show inside 60 seconds. The student's balance is exactly where it was before the accept; the teacher has nothing
6. Wait 61 seconds on a fourth and report → `409`
7. Rate one with `isResolved: true` and no stars. `rating_count` did not move. Then rate another with 4 stars; it did
8. `select sessions_count, resolved_count, rating_sum, rating_count, no_show_count from teacher_profiles where user_id = …` — every number is explainable from the four runs above
9. The §11.3 reconciliation query. Zero rows

## Review checklist additions

- Confirm `platformFeeRate` is called with `at: session.startedAt`. Defaulting to `new Date()` is the silent version of this defect and it only shows up across the 14:00 boundary — E5 lost a test run to exactly this at 12:17.
- Confirm `rating_count` moves only when `stars` is present. `rating_sum += stars ?? 0` alongside an unconditional `rating_count += 1` is the bug, and it makes every unrated review count as a zero-star one.
- Confirm the teacher release is conditional on `IN_SESSION`. Unconditional is E5's defect from the other side, and no sequential test notices.
- Confirm the refund is the full `total_charged` and that no fee is taken from it. A refund net of commission is the platform keeping money for a lesson that did not happen.
- Confirm the unique-constraint violation on `reviews.session_id` is caught and answered as a `409`. Prisma's `P2002` reaching `errorHandler` unmapped is a 500 for a double-click.
- Confirm the auto-end cron now calls this service and no longer writes `ENDED` itself. Two writers of a terminal state is two arithmetics.

## Notes

**This PR is the first writer of the four columns E4's ranking reads**, and one consequence
should be predicted before somebody files it as a regression: **teachers will start changing
position on the match list.** E4's retro recorded that `globalRating` is unsmoothed and that
§18's ranking criterion fails on seed data; that defect has been inert for two epics because
nothing moved the aggregates. From this PR on, a single demo rating moves a real teacher up or
down. **E6 does not fix it — it is E8's** — and 6.9's retro says so in plain words, the same
way E5's said that an `ACTIVE` session charging nothing was a design and not a bug.

**Why the rating write is E6's at all.** §10 makes `ENDED → RATED` mandatory, so without it no
session in this product ever reaches a terminal state and E8 inherits a table full of `ENDED`
rows with no way to close them. The write is thirty lines. Every screen that *reads* it is
E8's and none of them is here.

**Why no `teacher_ended` reason.** `end_reason` is a `VARCHAR(40)` with a documented value set
and adding to it is free in the column but not free in meaning — every reader would have to
learn that `student_ended` and `teacher_ended` are the same outcome. The actor is on the emit
and in the log. If a report ever needs to split them, that is a column about the actor, not a
sixth reason.
