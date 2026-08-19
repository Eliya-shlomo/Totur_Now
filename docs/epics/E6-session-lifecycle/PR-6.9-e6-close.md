# PR 6.9 — E6 close: verification + retro

| | |
|---|---|
| **Epic** | E6 — Session Lifecycle & Video |
| **Owner** | DEV-B (rotem) |
| **Size** | S — the writing. The **running** is half a day with two people and two cameras. |
| **Written by** | **Human — no agent.** Fifth epic running. A verification pass written by the thing being verified is not a verification pass. |
| **Depends on** | 6.2–6.8 |
| **Blocks** | E7, E8 |
| **Branch** | `dev-b/E6.9-e6-close` |

## Contract implemented

None. This PR produces `RETRO.md`, ticks the epic README, and amends `DEPLOYMENT.md` and
`MVP.md` with what the run actually found.

## Scope

**This is the epic's only review.** Every defect E2 through E5 found at verification had
passed review and passed its tests: the seed-versus-validator disagreement, the stale status
pill, E4's inverted ranking, E5's availability pill releasing a live lock. Not one was caught
by a test. **Treat this as the quality gate, not the paperwork.**

E6 raises the stakes in one specific way the previous four did not: **this is the first epic
where a defect moves real credit.** A ranking that sorts wrong is embarrassing. A refund that
takes a commission is money.

### 1. The four items E5 deferred, run first

E5's retro scheduled them against E6's opening and they were run in the sitting before 6.0.
**Record their results here, with their output**, and mark E5's retro as closed:

- the two-machine lock run against the Render URL, with `lock.sh`
- the deployed read-only half, the cold-start timing, and **the Socket.IO transport through
  Render** — a fallback to long-polling is a plausible outcome and E6 has a direct interest:
  it decides whether 6.5's block warning arrives on time on the deployed build
- the countdown's killed-network and nothing-sent-at-zero cases
- F4 — the header pill updating on a server-side lock without a navigation

If any of them did not run, say so in the same sentence as the reason, the way E5's retro did.
**A checklist that infers results is worth nothing.**

### 2. The session lifecycle, on two machines with two cameras

| # | Check |
|---|---|
| 1 | Accept an offer. Both people land on the session screen and **see and hear each other in the page** |
| 2 | The opening ten minutes are charged once. The ledger says so |
| 3 | Both clocks show the same number, within a second, on two machines |
| 4 | The warning fires at T-60s on both, with the student's tab backgrounded |
| 5 | Extending updates both screens and charges exactly one block |
| 6 | Declining ends the session at T+30s and both screens move on |
| 7 | The teacher's credit equals the gross minus the fee, and the fee matches what the offer email quoted |
| 8 | The rating blocks the way out; submitting it moves the aggregates |
| 9 | No-show inside 60 seconds refunds in full, and the teacher gets nothing |
| 10 | **Reconciliation across every wallet touched today**: balance equals the sum of the ledger |

### 3. The failure modes, deliberately provoked

| # | Check |
|---|---|
| 11 | `DAILY_API_KEY` unset: the whole flow completes, minus the call |
| 12 | A third browser joining trips `max_participants` and the screen explains it |
| 13 | Daily's own leave button: the screen says the session is still running |
| 14 | One participant closes their browser: the other is told, and the meter keeps running |
| 15 | Extend at the exact moment of the auto-end sweep: one outcome, one charge |
| 16 | Double-tapped extend: one block |
| 17 | A third user requesting `/sessions/:id/video` gets a `404` **byte-identical** to a nonexistent id |

### 4. Deployed, on Render

| # | Check |
|---|---|
| 18 | `DAILY_API_KEY` is set in the Render dashboard **before** this run. Item 11 proves the flow survives without it; nobody wants to discover it that way in a demo |
| 19 | A full session between two machines against the deployed build |
| 20 | The block warning arrives on time through Render's transport — long-polling or websocket, recorded either way |
| 21 | Cold start: the first accept after the instance has slept. How long, and does the room still get created |
| 22 | The crons on a sleeping instance: confirm that a session left to expire while the instance is down reads as over on the next request. **The lazy evaluation is the correctness guarantee and this is the only test of it** |

### 5. `RETRO.md`

Same shape as E5's, and at least these entries:

- **What the freeze did.** Per file, whether a later PR reopened it and whether the reopen was
  argued in writing first. E5 managed three of four and its retro named the fourth — a
  post-merge fix that entered a frozen repository ten minutes after its PR merged — as the one
  place in five epics where the discipline slipped. E6's answer to whether it happened again
  is the interesting number.
- **Whether one screen for two roles was right.** §18 wanted two and this epic overruled it.
  Report honestly: how many `role` checks ended up in 6.7, and whether the merge cost more than
  two timers would have.
- **The wallet service, one epic early.** Whether three functions turned out to be the right
  three, and what E7 will find missing.
- **E4's ranking defect is now live**, and it must be written down before somebody files it as
  an E6 regression: `globalRating` is unsmoothed, §18's ranking criterion fails on seed data,
  and it has been inert for two epics because nothing moved the aggregates. 6.6 moves them.
  **It is E8's and E6 did not touch it.**
- **What a session still cannot do**: nothing writes `CANCELLED`; nobody is refunded for a
  teacher who vanishes after the no-show window; `wallet:updated` is unappended and E7 owns it;
  §13's catalogue is now complete except that one name.
- **The mutation ledger** — every hand-written row this pass made, why, and the undo. E5's
  version of this section is the reason its results could be re-run, including the warning that
  `truncate offers` alone leaves every probe session standing.

### 6. Amendments to land in this PR

- `DEPLOYMENT.md`: the Socket.IO transport result, the Daily key's place in the Render
  dashboard, and the cold-start number
- `MVP.md` §20: the video risk row is already retired in this epic's planning — confirm it
  reads true after the deployed run, and add whatever E6 actually found in its place
- The epic README's status boxes, all ten

## Files you may touch

```
docs/epics/E6-session-lifecycle/RETRO.md    new
docs/epics/E6-session-lifecycle/README.md   status boxes, and any amendment the run forced
docs/epics/E5-offers-realtime/RETRO.md      close the four deferred items with their results
docs/DEPLOYMENT.md                          transport, the Daily key, cold start
docs/MVP.md                                 §20 only
```

## Files you must NOT touch

```
server/**    a defect found here is its own PR, named in the retro
client/**    same
prisma/**    same
shared/**    same
```

**A defect found during this pass is filed and fixed in its own PR.** E5 found two and shipped
them as 5.10 and 5.11, which is why its retro could name them. A fix folded into the closing
PR is a fix with no reviewer and no title.

## Acceptance criteria

- [ ] All 22 checks above have a recorded result: pass, fail, or **did not run and why**
- [ ] Every failure is a filed PR number, not a paragraph
- [ ] The reconciliation query returns zero rows at the end of the pass
- [ ] E5's four deferred items are closed in E5's own retro with their output
- [ ] `RETRO.md` carries the mutation ledger and its undo commands, and the undo was actually run
- [ ] The database is back at the seed baseline afterwards, verified by count
- [ ] `DEPLOYMENT.md` names the Socket.IO transport Render actually used
- [ ] Every status box in the epic README is ticked or annotated
- [ ] `MVP.md` §18's E6 block matches what shipped — if a PR moved, the roadmap says so

## Manual test

The 22 checks are the manual test. Two machines, two people, two cameras, half a day. Items
1–17 locally, 18–22 against Render.

**Two sessions, not two tabs** — and from 6.3 on, two sets of camera permissions as well, so
the second browser must be one you are willing to grant them in.

## Review checklist additions

- Confirm no check is marked passed on inference. E5's retro made this its standard and it is
  the reason its results are worth reading: two items were deferred by decision and two simply
  were not among the results returned, and it said so rather than folding them into the passes.
- Confirm the mutation ledger's undo commands were run and the baseline verified by count, not
  by assumption.
- Confirm every defect has a PR number and that none was fixed inside this branch.

## Notes

**Why this PR is human-written, said once more because it is the fifth time.** Five epics, five
verification passes, and the running total is that a person clicking through the product has
found every defect that mattered and the test suite has found none of them. That is not an
argument against tests — the suites caught plenty during development — it is an observation
about what a suite is for. It checks that the thing you built does what you thought. It cannot
check that what you thought was right.

**What E6 hands to E7 and E8**, and the retro should say it in these words so neither epic has
to reverse-engineer it:

- **E7 inherits a working wallet service and three functions it did not write.** Top-up, the
  ledger endpoint and the wallet screen build on top. The invariant to keep is §11.3's, and
  the reconciliation query is the test.
- **E8 inherits aggregates that finally move**, and a ranking defect that has been waiting two
  epics to become visible. It is on E8's path, not E6's, and it now has real data to be wrong
  about.
