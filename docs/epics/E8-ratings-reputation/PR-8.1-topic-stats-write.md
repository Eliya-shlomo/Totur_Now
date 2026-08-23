# PR 8.1 — The write nobody wrote: `teacher_topic_stats`, at 1.0 and at 0.3

| | |
|---|---|
| **Epic** | E8 — Ratings & Reputation |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent. Not a §17.5 area — see the epic README's argument, not this line |
| **Depends on** | E6 (6.6 merged — the review, the transaction and the three profile counters) |
| **Blocks** | 8.5, 8.6 |
| **Branch** | `dev-a/E8.1-topic-stats-write` |

## Contract implemented

No endpoint. No wire shape. **`MVP.md` §18's row 8.2**, §7's "ratings update the subtopic
at weight 1.0 and the parent at weight 0.3", and the half of §9.3 that has never had a
writer.

The internal seam is frozen in the epic README under "The internal seam" —
`topicStatDeltas`, pure, returning zero, one or two rows.

## Scope

**One review currently moves three columns on `teacher_profiles` and nothing on
`teacher_topic_stats`.** This PR makes it move the topic table too, inside the transaction
that already exists, and changes no behaviour anybody can see until 8.5 and 8.6 look at
the result.

Three pieces:

**A pure function, `server/src/utils/topicStats.js`.** It takes the question's `topicId`
and `subtopicId` and the same four numbers `session.review.service.js` already computes
for `applyReviewAggregates` — `sessionsCount: 1`, `resolvedCount`, `ratingSum`,
`ratingCount` — and returns the rows to write. The leaf at 1.0, the parent at
`PARENT_TOPIC_WEIGHT`, imported and never written as a literal. It sits beside
`commission.js` and `standing.js`, which are the two other pure product rules in `utils/`,
and it is pure for their reason: this is the arithmetic somebody will want to change, and
a rule that needs a database to test is a rule nobody re-tests.

Three cases it must get right, each of which is a test:

- **No leaf → no rows.** A question that landed on the sentinel (`topic_id = 0`,
  `subtopic_id` null, §8.1's fallback) carries no topical evidence. Writing a stats row
  for it would give the teacher history in a topic whose meaning is "we do not know" —
  and §9.1 lets `topic_id == 0` past the topic filter, so that row would score in *every*
  match this teacher is ever a candidate for. Return `[]`.
- **Leaf equal to parent → one row.** A classifier that answers the same id twice must
  not be counted 1.3 times.
- **Leaf with no parent → one row.** `topics.parent_id` is nullable and a leaf is not
  guaranteed to have one on the wire.

**A repository write, in `review.repository.js`.** `applyTopicStats(rows, tx)` —
`teacher_topic_stats` has the composite primary key `(teacher_id, topic_id)` and the row
may not exist, so it is an **upsert per row with `increment` in the update branch**, never
a read-then-write. Two round trips at most, both inside the caller's transaction. It goes
in `review.repository.js` because that file's stated remit is "reviews and the columns a
review moves, in one place, written by one service", and this is the second set of
columns a review moves.

**A second read, also in `review.repository.js`.** The topics are not on anything the
service holds: `findSessionForMeter` selects the session's money and clock state and does
not join `questions`. `findReviewTopicIds(sessionId, tx)` reads
`sessions.question_id → questions.topic_id, subtopic_id`. **Do not widen
`findSessionForMeter`** — it is a `$queryRaw ... FOR UPDATE OF s` that the meter and the
settlement also call, and adding a join there makes every tick and every end pay for two
columns neither reads. The topics are not racing anything; the classification override
(3.5) is a pre-session edit and the `ENDED → RATED` edge has already been won under the
lock by the time this runs.

**The service change is four lines.** `session.review.service.js` gains one read, one
`topicStatDeltas(...)` call and one `applyTopicStats(...)`, between the existing
`moveAggregates` and `markRated` — **inside the same `runTransaction` callback**, and
both new collaborators go into `defaultDeps` so the existing test file can inject them.

## Files you may touch

```
server/src/utils/topicStats.js               NEW. The pure arithmetic. Imports PARENT_TOPIC_WEIGHT
server/src/repositories/review.repository.js findReviewTopicIds + applyTopicStats, both tx-taking
server/src/services/session.review.service.js two deps, three statements, same transaction
server/tests/topicStats.test.js              NEW. The pure function: sentinel, equal ids, no parent, the 0.3
server/tests/session.review.test.js          the service now writes topic rows too
prisma/seed/teachers.js                      COMMENT ONLY on PARENT_WEIGHT — see Notes
docs/epics/E8-ratings-reputation/README.md   tick the status box
```

## Files you must NOT touch

```
server/src/repositories/session.repository.js  findSessionForMeter is not widened. See Scope
server/src/services/matching.scoring.js        8.2's, and it reads these rows — it does not write them
server/src/services/session.end.service.js     sessions_count is its column and stays its column
server/src/config/constants/matching.js        PARENT_TOPIC_WEIGHT is imported, not moved or edited
prisma/schema/**                               every column already exists. §17.5, OWNERSHIP.md §2
server/src/services/wallet.service.js          a rating moves no money
shared/api.d.ts                                8.3 opens E8's block. This PR has no wire shape
client/**                                      nothing renders this yet
docs/epics/E6a-*/**  docs/epics/E6b-*/**       other epics' chains
```

## Acceptance criteria

- [ ] `npm test` passes, including a new `topicStats.test.js` that covers: a leaf and a parent (two rows, the second at exactly 0.3 of the first), a sentinel question (zero rows), leaf equal to parent (one row), and a review with **no stars** (`ratingCount: 0` on both rows, `ratingSum: 0`, and `sessionsCount` still moved)
- [ ] After rating a real session on a classified question: `select * from teacher_topic_stats where teacher_id = '…'` shows the leaf row up by `sessions_count 1.00`, and the parent row up by `0.30`
- [ ] Rating a session with `isResolved: false` moves `sessions_count` on both rows and `resolved_count` on neither
- [ ] Rating a session on an **unclassified** question (`topic_id = 0`) writes **no** `teacher_topic_stats` row at all — the row count for that teacher is unchanged
- [ ] A teacher with no prior row for that topic gets one created, at the same values an increment would have produced from zero
- [ ] `select count(*) from reviews` and the number of `teacher_topic_stats` rows moved stay consistent under a forced failure: throw inside the transaction after `moveAggregates` and **nothing** is written — no review, no profile counters, no topic rows
- [ ] `grep -n "0\.3" server/src/utils/topicStats.js` returns nothing — the weight is imported
- [ ] `node scripts/reconcile.mjs check` returns five zero-row invariants, unchanged
- [ ] The second submit of the same review still returns `409 SESSION_NOT_ACTIVE` and writes no topic rows

## Manual test

1. `npm run db:up && npm run db:seed && npm run dev`.
2. `select topic_id, sessions_count, rating_sum, rating_count, resolved_count from teacher_topic_stats where teacher_id = '<a seeded teacher>' order by topic_id;` — keep this output.
3. Run one session end to end with that teacher on a classified question (integrals, level 5). End it.
4. On `/app/session/:id/review`: solved = on, 5 stars, submit.
5. Re-run the query in step 2. The leaf row is `sessions_count +1.00`, `resolved_count +1.00`, `rating_sum +5.00`, `rating_count +1.00`. The parent row is `+0.30`, `+0.30`, `+1.50`, `+0.30`.
6. Repeat with **no stars**: `rating_sum` and `rating_count` do not move on either row; `sessions_count` and `resolved_count` do.
7. Ask a question the classifier cannot place (or `update questions set topic_id = 0, subtopic_id = null where id = '…'` before the rating). Rate it. **No new row, no changed row.**
8. `node scripts/reconcile.mjs check` — five invariants, zero rows.

## Review checklist additions

- **One transaction, and a reviewer should be able to see it.** The two new calls are
  between `moveAggregates` and `markRated`, inside the `runTransaction` callback. A
  `prisma.$transaction` opened anywhere in `review.repository.js` is the defect this PR is
  most likely to introduce, and it is invisible in a green test run.
- **`ratingCount` is `0` when the student gave no stars, at topic level too.** The service
  already computes `stars == null ? 0 : 1` and `topicStatDeltas` must receive that number
  rather than recomputing it. At profile level getting this wrong drags an average down;
  here it also divides `topicFit`, which carries 0.35.
- **No literal `0.3`, `1.0` or `5` in `topicStats.js`.** The weight is
  `PARENT_TOPIC_WEIGHT`; the leaf multiplier is the absence of one.
- **The discount is applied here and nowhere else.** `matching.scoring.js`'s
  `topicRatingPair` deliberately does not import `PARENT_TOPIC_WEIGHT` and its header says
  why. If this PR's diff touches that file, it is the wrong PR.
- Grep the new repository functions for `prisma` — both take a `tx` and neither opens one.

## Notes

**Why this is not a new `rating.service.js`, which is what §18's row 8.2 asks for.** A
second service is a second transaction, and a `reviews` row that commits while its topic
stats do not is exactly the failure 6.6's own header describes one level up: "a KPI that
under-reports for ever, and unlike the ledger there is no reconciliation query that would
ever find it". The write is four statements. It joins the transaction that already holds
the session lock.

**The 0.3 will exist twice after this PR and must not exist three times.**
`prisma/seed/teachers.js:242` has `const PARENT_WEIGHT = 0.3` inside `deriveTopicStats`,
which is the seed's own implementation of this rule. It stays: `prisma/seed/*` cannot
reach `server`'s `#config` subpath imports, and moving a ranking parameter into
`@tutor/shared` would put it in the package the *client* imports. The only edit this PR
makes there is a comment naming `PARENT_TOPIC_WEIGHT` as the number it must equal.
Unifying them is an open item for the retro. E7's 7.9 — §5.3's commission read from three
different dates at three call sites — is what the third copy turns into.

**Floats into a `NUMERIC(8,2)` column.** `0.3 × 3` is `0.8999999999999999` in IEEE 754.
Postgres rounds on the way in and the column is the source of truth, so the test asserts
the **stored** value read back, not the computed one. Do not add rounding in JavaScript to
make an assertion pass — that is a second rounding of a number the column already rounds,
and it is the shape of the bug E7 refused for wallet minutes.

**Why `sessions_count` at topic level counts rated sessions and the profile's counts
ended ones.** `releaseTeacherAfterSession` moves `teacher_profiles.sessions_count` when a
session ends, rated or not; this PR moves the topic column when it is rated. The
alternative — writing topic stats at session end — needs the question's topics inside the
settlement transaction, which is one of §17.5's three critical ones and is not being
reopened for a denominator. The consequence is that the two resolve rates disagree for a
teacher whose students close the tab, it is recorded in the epic README's risks, and 8.4's
history screen is what lets a student close that gap by finishing the rating.

**`sessions_count` here is `1` and not `blocksUsed`.** A session is one session however
long it ran. The seed's `stats` array uses the same unit, `matchView.js` renders
`subtopicSessions` as a count of questions solved, and §14.2's card says "solved 12
questions in Integrals". Money is the thing that scales with blocks; reputation is not.
