# PR 7.4 — §5.5's two unwritten refunds: early exit and platform failure

| | |
|---|---|
| **Epic** | E7 — Wallet & Billing |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | **Human — no agent.** `MVP.md` §17.5: this is one of the three critical money transactions, and it is tested by hand |
| **Depends on** | E6 (merged through 6.9). **Independent of 7.1–7.3** |
| **Blocks** | 7.8 |
| **Branch** | `dev-a/E7.4-remaining-refunds` |

## Contract implemented

No new endpoint, no new socket event, no new column. Two branches inside
`terminateSession`, in `server/src/services/session.end.service.js`.
`MVP.md` §5.5, rows 2 and 3.

## Scope

`MVP.md` §5.5 has six rows. E6 implemented four of them. These are the other two:

| §5.5 scenario | Outcome | Today |
|---|---|---|
| Platform technical failure | **Full refund** | `end_reason` has an `error` value and nothing has ever written it |
| Student closes within 60s of start | **Full refund** | `terminateSession` charges in full at any elapsed time |

**Both are money branches inside `ENDED`, and neither is a new state.** §10's diagram
gives `ACTIVE` exactly two edges — `ENDED` and `NO_SHOW` — and `session.state.js`'s
`TRANSITIONS` table is not edited by this PR. §5.5 is a *pricing* rule about a session
that ended, not a lifecycle rule about a new way to end. A third terminal state for "the
same ending, refunded" would be a table every future reader has to reconcile with a
diagram that does not have it.

So `terminateSession` gains one function — call it `settleSession` — that answers
`{ platformFee, teacherEarning, refund, endReason }` from the locked row, and the
existing arithmetic becomes its last branch. Three cases, in this order:

**1. The platform never provided a video call → full refund, `end_reason = 'error'`.**
This is §5.5's "technical failure" in the only form this product can actually detect: the
session reached `ACTIVE`, ran, and `sessions.video_room_url` is still null, so the
student paid for a video lesson the platform never delivered. It is E6b's defect turned
into a refund rule — every session on the deployed application between PR 6.1 and 6b.1
was exactly this, and every one of them charged in full.

It applies **whoever ends the session** — the student, the teacher, or the auto-end
sweep. A platform failure is not the participants' to bear, and which of them gave up
first is not a fact about whose fault it was.

**2. The student ended it inside `NO_SHOW_WINDOW_SEC` of `started_at` → full refund,
`end_reason` unchanged.** §5.5's row, and the reason the window constant exists at all —
it has had exactly one reader since 6.6 and that reader is the *teacher's* no-show path.
The reason stays `student_ended` because the column says *why the session is over*, which
6.6 already established when it refused to invent a `teacher_ended` value; the refund is
a fact about the money, and the money is on the session's own columns.

**Actor-scoped, deliberately.** Only the student's own end button takes this branch. The
auto-end sweep cannot reach it — the opening block is ten minutes and the window is
sixty seconds — and a *teacher* ending at forty seconds is a teacher who walked out,
which is nearer to §5.5's no-show row than to this one. Making it actor-blind would let
the one party who benefits from a refund trigger it.

**3. Otherwise → 6.6's arithmetic, untouched.** `platformFeeRate` at `started_at`, the
split, the earning.

In cases 1 and 2, `platform_fee` and `teacher_earning` are both `0` and `refundSession`
pays back the whole `total_charged` — the same shape `reportSessionNoShow` already
writes, and for the same reason it wrote it: a refund net of commission is the platform
keeping money for a lesson it is admitting did not happen.

**`sessions_count` still moves, and `no_show_count` does not.** The teacher arrived and
did what they were asked in both cases; the money went back because §5.5 assigns the cost
to the platform or to nobody, not because the teacher failed. `no_show_count` is a
teacher-quality signal and putting a platform outage in it would rank a teacher down for
a missing API key. `releaseTeacherAfterSession` is therefore called exactly as it is
today and is not edited.

**One column is added to `findSessionForMeter`'s `SELECT`**: `s.video_room_url`. Case 1
cannot be decided without it, and the alternative — a second read inside the locked
transaction — is a read outside the lock's `FOR UPDATE OF s`. One column on an existing
raw select is the smallest possible edit to that repository, and it is a human-written
PR by §17.5, which is the review this file wants.

## Files you may touch

```
server/src/services/session.end.service.js          settleSession, and the header's transaction diagram
server/src/repositories/session.repository.js       ONE column on findSessionForMeter: s.video_room_url
server/tests/session.end.test.js                    the three branches, and the boundary at exactly 60s
server/tests/e2e.session.lifecycle.test.js          fixtures that must age started_at — see below
docs/epics/E7-wallet-billing/README.md              tick the status box
```

## Files you must NOT touch

```
server/src/services/wallet.service.js         refundSession is 6.5's and already correct
server/src/services/session.state.js          §10's table. No new state, no new edge
server/src/services/session.meter.service.js  the extend path charges and stays charging
prisma/schema/**                              'error' fits end_reason VARCHAR(40); 6a.4 has a migration in flight
shared/api.d.ts                               SessionEndReason already lists 'error'
server/src/jobs/session.autoEnd.job.js        it calls terminateSession and keeps calling it unchanged
client/**                                     no screen changes. §14.3 already renders end_reason
docs/epics/E6a-*/**                           another epic's chain
```

## Acceptance criteria

- [ ] A session with `video_room_url IS NULL`, ended by either participant, writes `end_reason = 'error'`, `platform_fee = 0`, `teacher_earning = 0`, and one `REFUND` row for the whole `total_charged`
- [ ] A student ending 40 seconds after `started_at` gets a full refund; `end_reason` is still `student_ended`
- [ ] A student ending at exactly `NO_SHOW_WINDOW_SEC` is **charged** — the boundary is the same "strictly inside" the no-show path uses
- [ ] A student ending at 90 seconds is charged in full and the teacher is credited
- [ ] A *teacher* ending at 40 seconds on a session that had video is charged in full — the branch is the student's alone
- [ ] Case 1 wins over case 2: a 40-second end with no video writes `'error'`, not `'student_ended'`, and refunds once, not twice
- [ ] `TRANSITIONS` in `session.state.js` is byte-identical
- [ ] `sessions_count` increments in every case; `no_show_count` increments in none of them
- [ ] `node scripts/reconcile.mjs check` returns zero rows after a refunded end — invariants 3 and 4 are the ones this PR can break
- [ ] `npm test` passes, including `e2e.session.lifecycle.test.js`

## Manual test

Two browsers, per §17.5. One student, one teacher.

1. **Early exit.** Accept an offer, then have the student press End within 40 seconds.
   `select total_charged, platform_fee, teacher_earning, end_reason from sessions where id = …`
   — the charge stands on the session row, the fee and earning are `0`.
   `select type, amount from wallet_transactions where session_id = …` — a
   `SESSION_CHARGE` and a `REFUND` that sum to zero, and no `TEACHER_EARNING`.
   The student's balance is back where it started.
2. **Charged exit.** Repeat, ending at 90 seconds. `TEACHER_EARNING` is present and the
   fee matches `platformFeeRate` at `started_at`.
3. **Platform failure.** Stop the server, unset `DAILY_API_KEY`, restart, run one session
   through, end it after two minutes. `end_reason` is `error` and the whole charge came
   back.
4. `node scripts/reconcile.mjs check` after all three — zero rows.

## Review checklist additions

- **The existing E2E fixtures start and end in the same millisecond, which is inside the
  window.** They will start refunding and their charge assertions will go red. The fix is
  to age `started_at` in the fixture so the session is genuinely older than the window —
  **not** to relax the assertion, and **not** to make the window configurable per test. A
  refund rule that only holds when a constant is stubbed is a refund rule nothing tests.
- The three cases must be one function returning one object, not three `if`s scattered
  through the transaction. The ordering between case 1 and case 2 is a decision, and a
  decision spread over forty lines is a decision the next reader re-makes.
- The branch reads `total_charged` from the **locked** row, the same value 6.6 already
  uses. A refund computed from `blocks_used × price_per_block` would be a second
  arithmetic for a number the session already carries, and invariant 2 of `reconcile.mjs`
  exists because those two can disagree.
- No new `AppError`, no new code, no new message. All three cases are a successful end.

## Notes

**Why this is E7's and not a bug fix against E6.** 6.6's brief scoped the two terminal
edges and the no-show refund and did that completely. §5.5's other two rows are pricing
rules — what a session *costs* under two conditions — and pricing is this epic. Filed
here rather than as a defect because nothing is broken: `terminateSession` does exactly
what it was asked to do.

**It is off the epic's dependency chain on purpose.** It touches
`session.end.service.js`, which no other PR in E7 opens, so it can be written on any day
the wallet chain is blocked on a review. That is the epic's stated filler.

**Read `reportSessionNoShow` before writing `settleSession`.** It is the same refund, one
branch earlier, and it already answers most of the questions this PR asks: fee and
earning explicitly zero rather than merely unset, `refundSession` only when
`total_charged > 0` because the wallet service refuses a non-positive amount, and the
conditional `updateMany` count as the race guard. Match it; do not improve on it in this
PR.

Case 1 is the reason E6b existed. Between PR 6.1 and 6b.1 the deployed application ran
every session without a room, showed "No video on this session", kept the clock running,
and charged in full — and no layer's job was to say so. This PR does not stop that
happening; 6b.1's key and its startup assertion do. It makes it not cost the student
money when it happens anyway.
