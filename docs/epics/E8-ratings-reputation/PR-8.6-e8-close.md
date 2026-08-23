# PR 8.6 — E8 close: §18's ranking pass, and the retro

| | |
|---|---|
| **Epic** | E8 — Ratings & Reputation |
| **Owner** | DEV-A (eliya) |
| **Size** | S |
| **Written by** | Agent |
| **Depends on** | 8.1, 8.2, 8.3, 8.4, 8.5 — all merged |
| **Blocks** | nothing |
| **Branch** | `dev-a/E8.6-e8-close` |

## Contract implemented

None. **This PR changes no source.** It runs §18's acceptance criterion for E8 end to end,
records what happened, and closes the epic.

> **Acceptance:** rating a teacher 5 stars on an integrals question measurably raises
> their rank for the next integrals question — and slightly raises it for other calculus
> questions.

It also re-runs E4's criterion, because 8.2 is the PR that was supposed to make it pass
and E4's retro is the document that says it does not.

## Scope

**The pass, in order.** Every step is run against a named database and the name is written
at the top of the retro — E7's fifth risk was two databases and tooling that did not agree
on which, and it cost that epic two PRs' worth of confusion. Open by naming it.

1. **Baseline.** `npm run db:up && npm run db:seed`. Record, for the teacher under test:
   their `teacher_topic_stats` rows for the integrals leaf and the calculus parent, and
   their `teacher_profiles` counters.
2. **Rank before.** Ask an integrals question at level 5 as a seeded student. Record the
   full ordered list from `/app/ask/:id/teachers` and the teacher's position in it.
   Re-ask without changing anything and confirm the order is identical — the sort is
   deterministic and a pass that cannot reproduce its own baseline is measuring noise.
3. **The rating.** Run one session with the teacher under test, to a 5-star resolved
   rating on that integrals question.
4. **The propagation.** `/teach` shows the leaf up by one session and 5.00 rating sum, the
   parent up by 0.30 and 1.50. Screenshot it — 8.5 exists so this step does not need
   `psql`, and the retro carries both anyway.
5. **Clear the cache.** `getPlatformAverages()` holds its result for
   `PLATFORM_AVERAGES_CACHE_MS` and every smoothed component is measured against it.
   Restart the server or call `clearPlatformAveragesCache()`. **This is not optional and
   it is not a defect** — see the review checklist.
6. **Rank after, same topic.** Ask the same integrals question again. The teacher has
   moved up, and the retro records by how much and against whom.
7. **Rank after, sibling topic.** Ask a *different* calculus subtopic at the same level.
   The teacher has moved up **less** — that is the "and slightly" half of the criterion,
   and it is the parent row at 0.3 doing exactly what §7 says it does.
8. **Rank after, unrelated topic.** Ask a geometry question. The teacher has **not**
   moved. If they have, the propagation is writing somewhere it should not.
9. **E4's criterion.** Flip Gil V. and Shira G. `ONLINE`. Ask the integrals question.
   **Dana K. above Gil V.** — the check E4's retro recorded as failing. Revert both rows
   to `OFFLINE` and confirm the list returns to three teachers.
10. **The sentinel.** Rate a session on an unclassified question (`topic_id = 0`). **No
    `teacher_topic_stats` row is created or changed.** Confirm by row count before and
    after.
11. **The unfinished rating.** End a session and close the tab. `/app/history` shows it
    with a badge and a link; follow it, submit, and the row becomes rated,
    `unratedCount` drops, and the session's status is `RATED`.
12. **The public profile.** Log out. `/teachers/<id>` shows the reviews written above,
    with no student name anywhere in the response.
13. **Money did not move.** `node scripts/reconcile.mjs check` — five invariants, zero
    rows. E8 touches no money and this is the step that proves it rather than asserting
    it.

**The mutation ledger.** Every hand-written row — the two `ONLINE` flips, the sentinel
edit, any status change — is listed in the retro and every one is undone. E4's retro set
this format and E7's followed it. Say which database, say what was written, say that it was
reverted, and show the revert.

**The retro.** `docs/epics/E8-ratings-reputation/RETRO.md`, following E4's and E7's shape:
what the pass found, what it did not cover, the defects it turned up filed as their own
rows, and the open items. Two items are known before the pass starts and belong in it
whatever else happens:

- **The 0.3 exists in two places** — `PARENT_TOPIC_WEIGHT` and the seed's `PARENT_WEIGHT`
  — and unifying them needs a decision about where a constant lives that both `server/`
  and `prisma/seed/` can import. E7's 7.9 is what the third copy would have become.
- **The two `sessions_count` denominators disagree** by design: `teacher_profiles`' moves
  at session end, `teacher_topic_stats`' at rating. 8.4's history screen makes the gap
  closable by a student's action, and closing it automatically would mean writing topic
  stats inside the settlement transaction, which is one of §17.5's three.

**The docs.** `docs/README.md`'s epic index row for E8 gets its real status.
`docs/OWNERSHIP.md` gets the rows for the files this epic created or took over —
`utils/topicStats.js`, `review.repository.js`'s new half, and `matching.scoring.js`, whose
own header records a 4.1 → 4.3 ownership transfer that the single-developer note now
supersedes.

## Files you may touch

```
docs/epics/E8-ratings-reputation/RETRO.md     NEW
docs/epics/E8-ratings-reputation/README.md    tick every status box; paste the pass
docs/README.md                                the epic index row for E8
docs/OWNERSHIP.md                             the files this epic created or took over
```

## Files you must NOT touch

```
server/**     if the pass finds a defect, it is a new PR, not a widening of this one
client/**     same
shared/**     same
prisma/**     same
scripts/**    reconcile.mjs is run here, not edited here
docs/epics/E6a-*/**  docs/epics/E6b-*/**   6a.6 and 6b.4 are open and own their folders
```

A close PR that edits code is a defect wearing a close PR's branch name. That is 6b.4's
own sentence and it holds here.

## Acceptance criteria

- [ ] Every one of the thirteen steps above has a recorded result in `RETRO.md` — ✅, ❌ or ⏳ with a reason, never a blank
- [ ] §18's E8 criterion is answered with **numbers**: the teacher's position before, after in the same topic, after in the sibling topic, and after in an unrelated one
- [ ] E4's criterion is answered: Dana K. above Gil V., or a defect filed with the measurement
- [ ] The sentinel step confirms **zero** `teacher_topic_stats` rows written for an unclassified question
- [ ] `node scripts/reconcile.mjs check` output is pasted, five invariants, zero rows
- [ ] The database the pass ran against is named in the first paragraph of the retro
- [ ] The mutation ledger lists every hand-written row and shows each one reverted
- [ ] `docs/README.md`'s E8 row is accurate — including "provisionally" and the open count, if that is what is true
- [ ] `git diff --stat` shows changes under `docs/` only
- [ ] The two known open items above are in the retro whether or not the pass found anything else

## Manual test

The thirteen steps in Scope **are** the manual test. Run them in order, on one database, in
one sitting, and write down what happened rather than what was expected.

## Review checklist additions

- **A cache miss is not a defect and must not be fixed during the pass.** If step 6 shows
  no movement, step 5 was skipped: `getPlatformAverages()` is cached for five minutes by
  design and `clearPlatformAveragesCache()` exists because a test that cannot clear it
  cannot assert anything twice in one process. Re-run step 5, do not edit
  `matching.averages.service.js`.
- **"Measurably" means a number, not a screenshot of a reordered list.** The retro records
  the position and, where the list is close, the neighbours it passed. E4's retro recorded
  0.793 against 0.765 and that is why its defect had a name instead of an argument.
- **A failed step is recorded as failed.** E4's retro's most valuable line is a ❌. A pass
  that reports only successes is a pass nobody can act on.
- No source file is in the diff. If one is, the fix belongs on the PR that owns the file.

## Notes

**Why the sibling-topic step is the interesting one.** §18's criterion has two halves and
the first is easy — a five-star review raising a rank is what any of the six components
would do. The second half, "slightly raises it for other calculus questions", is
*specifically* the 0.3 parent propagation, and it is the only observable consequence of
the row §18 numbered 8.2 and nobody wrote. If step 7 shows no movement at all, 8.1 wrote
one row instead of two; if it shows the same movement as step 6, the leaf and the parent
were written at the same weight. Both are silent failures that a passing test suite would
not catch — which is E2's finding, arriving for the fifth epic running.

**Why the unrelated-topic step exists.** It is the negative control. Without it, "the
teacher moved up" is also what a bug in `globalRating` or a stale platform average would
produce, and 8.2 changed `globalRating` in the same epic.

**E4's criterion is re-run here rather than in 8.2** because 8.2 is a unit-level change
with unit-level tests, and E4's retro's whole point was that its unit tests passed while
the endpoint was wrong — "a contract two subsystems agree about in isolation and disagree
about in composition". The composition is measured once, here, with the seed's Bayesian
pair in the data, which `teachers.js` says is exactly why the pair is in the data.
