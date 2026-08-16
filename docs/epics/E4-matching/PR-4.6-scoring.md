# PR 4.6 — `matching.scoring` — full scoring per §9.2

| | |
|---|---|
| **Epic** | E4 — Matching Engine |
| **Owner** | DEV-B (rotem) |
| **Size** | L |
| **Written by** | Agent. **Reviewed against `MVP.md` §9.2 line by line** — this is the differentiator, and a wrong weight is invisible in a passing test. |
| **Depends on** | 4.3 (merged) |
| **Blocks** | 4.7 |
| **Branch** | `dev-b/E4.6-scoring` |

## Contract implemented

`MVP.md` §9.2 (the six weighted components) and §9.3 (smoothing), as the body of
`rankCandidates` in `matching.scoring.js`. The signature was frozen in 4.1 and does not
change; this PR replaces a stub.

## Scope

The ordering. One pure function, six components, and no other file in the epic changes.

```
score = 0.35 · topic_fit
      + 0.20 · global_rating
      + 0.20 · resolve_rate
      + 0.10 · acceptance_rate
      + 0.10 · history_bonus
      + 0.05 · new_teacher_boost
```

**Every weight comes from `MATCH_WEIGHTS`** in `constants/matching.js`, which already holds
the six keys and already asserts at boot that they sum to 1.0. Write the sum as a reduction
over that object rather than as six additions, so that adding a seventh component is a change
in one file — and so that a typo cannot produce a total of 0.97 that nobody notices for three
epics. There is deliberately **no `priceFit`**: price is a hard filter (§5.2, §9.5), its old
0.05 is on `resolveRate`, and the constants file explains why at length.

**The six components, and what each is actually computed from:**

| Component | Computation | Notes |
|---|---|---|
| `topic_fit` | `bayesian(subtopicStats, averages.rating, BAYES_C) / MAX_STARS` | The heavy one. Smoothed rating **in the question's subtopic**, then normalized to [0,1] — §9.2 says "normalized", and a raw 4.6 would swamp five components that live in [0,1]. When `subtopicStats` is null, fall through to `topicStats` (the parent row, which the seed writes at `PARENT_TOPIC_WEIGHT`); when both are null, `bayesian({sum:0,count:0}, …)` already answers the prior, which is the correct "we know nothing about them here". |
| `global_rating` | `(ratingSum / ratingCount) / MAX_STARS`, `0` when unrated | Cross-cutting quality, from `teacher_profiles`. §9.2 writes it unsmoothed — it is the only component that is — because it is already an average over the teacher's whole history. |
| `resolve_rate` | `bayesian({sum: resolvedCount, count: sessionsCount}, averages.resolveRate, BAYES_C)` | **The real KPI.** Already in [0,1]; do not divide by anything. |
| `acceptance_rate` | `bayesian({sum: offersAccepted, count: offersReceived}, averages.acceptRate, BAYES_C)` | Reliability, not availability — availability is a filter (§9.5). |
| `history_bonus` | `hasPositiveHistory ? 1 : 0` | Already a boolean on the candidate; 4.5 sets it from `findPositiveHistoryTeacherIds`. |
| `new_teacher_boost` | `sessionsCount < NEW_TEACHER_SESSIONS ? 1 : 0` | Cold start. `NEW_TEACHER_SESSIONS` is 5. |

**Smoothing takes a `{sum, count}` pair and nothing else.** `bayesian` was finished and pinned
in 4.3; this PR calls it three times and does not touch it. The one subtlety worth a comment:
`resolve_rate` and `acceptance_rate` smooth a *rate* against a *rate*, so `sum` is the
numerator count and `count` is the denominator count — `{sum: resolvedCount, count:
sessionsCount}`, not a pre-divided ratio. §9.3 says they are "smoothed identically" and this is
what identically means.

**Tie-break, and it is not decoration.** Sort by score descending, then by `teacherId`
ascending. On a database with no history every component collapses to the prior and every
candidate scores identically to the last bit — which is not a hypothetical, it is what a fresh
production database looks like on day one and what `roni.t@demo.tutornow.il` looks like today.
Without a deterministic second key, two identical calls return two orders and the price control
and the refresh button both look broken.

**Purity is an acceptance criterion, not a style note.** No `prisma`, no `req`, no `Date`, no
`Math.random`, no logging. The function answers for an empty array, for a candidate whose every
stat is zero, and for `averages` at the neutral fallback. It is the easiest thing in the
codebase to test exhaustively, which is the point: this is the platform deciding which human
being a student talks to.

### The tests are half this PR

`server/tests/matching.scoring.test.js`, and the fixtures come from **the seed**, not from
invented integers. `prisma/seed/teachers.js` says in its own header that the distribution is
the deliverable and that the Bayesian pair exists "so the E4 acceptance test cannot fail even
when the code is wrong" if it is missing. Use it.

Six properties, one per failure mode that a plausible implementation actually has:

1. **§18's acceptance criterion, directly.** Dana K. on `integration-by-parts`
   (`{sum: 184, count: 40}`, 105 sessions) ranks **above** Gil V. (`{sum: 5, count: 1}`, 2
   sessions), even though Gil's raw average is 5.0 and Dana's is 4.60. Assert the ordering, not
   the scores.
2. **The specialist beats the generalist.** Given the same question, a candidate with subtopic
   history outranks one with only parent-topic history, who outranks one with neither, all
   else equal.
3. **Weights are read, not typed.** A test that mutates a local copy of `MATCH_WEIGHTS` — or,
   better, one that asserts the score of a hand-built candidate equals a sum computed from
   `MATCH_WEIGHTS` at test time — fails if somebody retypes 0.35 in the service.
4. **Every component is in [0,1] before weighting**, for every fixture. This is the one that
   catches an unnormalized `topic_fit`, which would otherwise look like the algorithm merely
   liking topical teachers a lot.
5. **Determinism.** The same input twice, and a shuffled input, produce the same order.
6. **Degenerate inputs.** Empty array; a candidate with every field zero and both stats null;
   `averages` set to `NEUTRAL_PLATFORM_AVERAGES`. None throws, none returns `NaN`, and `NaN` is
   asserted against explicitly — a `NaN` score sorts unpredictably and silently, which is the
   worst failure this function has.

**Fixtures use `number`, because the seam does.** The repository converts `Prisma.Decimal` to
`number` (4.2), and a fixture built from `new Prisma.Decimal(...)` would test a path the
scorer never sees. If a real row ever reaches this function as a `Decimal`, the weighted
multiply produces something that is neither a number nor an error — assert `typeof score ===
'number'` and `Number.isFinite(score)` on at least one fixture drawn from a real query, in
4.8's pass if not here.

## Files you may touch

```
server/src/services/matching.scoring.js             rankCandidates body. The signature is 4.1's.
server/tests/matching.scoring.test.js               new
docs/epics/E4-matching/README.md                    tick the status box
```

That is the whole allowlist, and it is short on purpose: this PR changes the order of a list
and nothing else in the system.

## Files you must NOT touch

```
server/src/services/matching.service.js             DEV-A's, 4.5. Its diff must not change when
                                                    this merges — that is the seam working.
server/src/services/matching.candidates.service.js  DEV-A's, 4.2
server/src/services/matching.averages.service.js    yours from 4.3, and finished
server/src/repositories/matching.repository.js      frozen since 4.1
server/src/utils/matchView.js                       DEV-A's, 4.5
server/src/config/constants/matching.js             4.1 finished it. Every number is already there.
shared/api.d.ts                                     no payload changes — `score` reaches no client
client/**                                           nothing client-side in this PR
```

## Acceptance criteria

- [ ] Dana K. outranks Gil V. on an `integration-by-parts` question, using the seed's own numbers
- [ ] A subtopic specialist outranks a parent-topic-only teacher outranks a teacher with neither
- [ ] `grep -n "0\.35\|0\.2\|0\.1\|0\.05" server/src/services/matching.scoring.js` finds nothing — the weights are read from `MATCH_WEIGHTS`
- [ ] `grep -n "5" server/src/services/matching.scoring.js` finds no bare `BAYES_C`, `MAX_STARS` or `NEW_TEACHER_SESSIONS`
- [ ] Every component of every fixture is in `[0, 1]` before its weight is applied
- [ ] `rankCandidates([], averages)` is `[]`; the same input shuffled gives the same order; two identical calls agree
- [ ] No fixture produces `NaN`, `Infinity`, or a score outside `[0, 1]`
- [ ] `grep -c "prisma\|require\|Date\|Math.random" server/src/services/matching.scoring.js` is `0`
- [ ] **`git diff main -- server/src/services/matching.service.js` is empty** — 4.5 was built against the stub and did not need touching
- [ ] Calling the endpoint before and after this merge returns the **same** teachers, in a different order
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` pass

## Manual test

1. `npm run db:up && npm run db:seed && npm run dev`
2. Call `GET /questions/<integrals question>/matches` and record the order **before** merging this branch (three teachers, `teacherId` order)
3. Merge, restart, call again: the same three teachers, now ordered by score. Dana K. should lead — she has the most subtopic history at a high rating
4. `psql`: `update teacher_profiles set status='ONLINE' where user_id in (select id from users where email in ('gil.v@demo.tutornow.il','shira.g@demo.tutornow.il'));` → five candidates, and **Gil must be last or near it despite his 5.0**. This is §18's acceptance criterion, end to end. **Set both back to `OFFLINE`**
5. `insert into reviews (session_id, student_id, teacher_id, is_resolved, stars) values (null, '<avi>', '<the last-ranked teacher>', true, 5);` → they should move up by roughly the `history` weight. **Delete the row**
6. `node --test server/tests/matching.scoring.test.js` and read the assertions against §9.2's table, line by line

## Review checklist additions

- Read §9.2's table against the implementation **component by component**, out loud if necessary. A swapped `resolve_rate` and `acceptance_rate` produces a plausible ranking on seeded data and a wrong one in production, and no test written from the implementation will catch it.
- Confirm `topic_fit` is divided by `MAX_STARS` and the two rates are not. Three components in [0,1] and one in [0,5] is the single most likely bug here, and it presents as "the algorithm really likes topical teachers", which is also what it is supposed to do.
- Confirm the fallback order for topic stats is subtopic → parent → prior, and that the parent row is not weighted a second time. The seed already applied `PARENT_TOPIC_WEIGHT` when it wrote the row; multiplying by 0.3 again here would double-discount it.
- Confirm the tie-break exists and is on a stable key.
- Confirm no `console.log` and no logger call survived. This function runs once per candidate per request.

## Notes

**Why the parent row is read but not re-weighted.** `PARENT_TOPIC_WEIGHT = 0.3` describes how a
session *writes* into the parent's stats — `deriveTopicStats` in the seed does exactly that, and
E8's review service will do the same. By the time this function reads
`teacher_topic_stats(parent)`, the discount is already in the numbers. Applying it again is a
mistake that would be invisible: everything still ranks in a plausible order, just wrong.

**Why `global_rating` is not smoothed when everything else is.** §9.2 says so, and the reason
holds: it is already an average over the teacher's entire history, so the small-sample problem
§9.3 exists to solve is much weaker there than in a single subtopic. A teacher with one rating
overall gets `0.20 · 1.0` from it — and loses far more on `topic_fit`, which is 0.35 and *is*
smoothed. If 4.8's pass shows one-rating teachers ranking too high, smoothing this one too is a
one-line change; do not make it pre-emptively and do not make it in this PR.

**Why this PR is L and touches two files.** Because the tests are the deliverable. The
arithmetic is fifteen lines; the six properties above are what make it possible to change a
weight in six months without re-deriving the whole algorithm from `MVP.md`. §18 marks the
selection screen as "reviewed hard"; this file deserves the same and gets it here instead.

**Nothing in the running product updates the numbers this function reads.**
`teacher_topic_stats` has one writer — the seed — until E8's review service exists, `reviews`
is empty, and the offer counters are E5's. Everything here is correct and verifiable today,
and none of it will *move* until those epics land. That belongs in the file's header comment,
not only in this brief, because the person who notices will be someone re-running a match after
a demo session and wondering why the order did not change.

## Mathematical Boundaries & Prior Notes

**Recorded by 4.3, which measured it.** §18's acceptance criterion — Gil's `{sum: 5, count: 1}`
must rank below Dana's `{sum: 184, count: 40}` — is not a property of smoothing in general. It
is a property of smoothing *at this platform's prior*, and the margin is thinner than the
criterion's wording suggests.

With `BAYES_C = 5`, the ordering holds only while the prior rating is **below ≈ 4.5077**. Above
that the pair inverts, and correctly so: smoothing pulls both teachers toward the prior, Gil's
raw 5.0 has almost nowhere to be pulled from once the prior approaches it, and Dana's 4.60 is
pulled *up* past him. The seeded database sits at **4.4835** (`sum(rating_sum) /
sum(rating_count)` over `teacher_profiles`), so the criterion passes with about **0.024 stars**
of headroom.

Two ways to break it without touching a line of scoring code:

- **Tuning `BAYES_C` downwards.** At `c = 2` the criterion already fails. Less smoothing means
  Gil keeps more of his single 5.0, which is what the constant means and why §9.3 calls it the
  critical piece. Raising it is safe in this direction; lowering it is not.
- **Evaluating against a synthetic prior above the threshold.** A fixture platform where every
  teacher averages 4.6+ will invert the pair, and the failure will look like a scoring bug
  rather than like the fixture it is. `matching.bayes.test.js` sweeps priors from 1 to one star
  below `MAX_STARS` for this reason, and pins the inversion at a perfect-score prior as its own
  test so nobody widens the sweep and spends an afternoon on it.

Neither is a defect today. Both are worth knowing before 4.6 reads a real platform average into
`rankCandidates` for the first time, and before 4.8 concludes anything from one seeded run.
