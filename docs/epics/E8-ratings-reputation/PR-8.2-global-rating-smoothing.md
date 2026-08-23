# PR 8.2 — The defect E4 filed and four epics inherited: `globalRating` is unsmoothed

| | |
|---|---|
| **Epic** | E8 — Ratings & Reputation |
| **Owner** | DEV-A (eliya) |
| **Size** | S |
| **Written by** | Agent. **Not a §17.5 area** — but see the review checklist: the tests it breaks may not be relaxed |
| **Depends on** | nothing. Independent of every other PR in this epic |
| **Blocks** | 8.6's measurement, and only in the sense that measuring after it is honest and measuring before it is not |
| **Branch** | `dev-a/E8.2-global-rating-smoothing` |

## Contract implemented

No endpoint, no wire shape, no new file. **`MVP.md` §9.3** — "a teacher with a single 5.0
rating **must** rank below one with 4.6 across 40 sessions. Otherwise the algorithm is
noise" — applied to the one §9.2 component it was never applied to.

It is also §18's acceptance criterion for **E4**, which E4's own retro recorded as failing
end to end.

## Scope

One line of arithmetic in `server/src/services/matching.scoring.js`:

```js
globalRating: ratingCount > 0 ? ratingSum / ratingCount / MAX_STARS : 0,
```

becomes the smoothed form every other rating-shaped component in that file already uses:

```js
globalRating: bayesian({ sum: ratingSum, count: ratingCount }, averages.rating, BAYES_C) / MAX_STARS,
```

`bayesian` is in the same file and already imported. `averages.rating` is already a
parameter. `MAX_STARS` is already imported. **The diff is one expression, and everything
else in this PR is the argument for it and the tests that pin it.**

### What it changes, measured

E4's retro recorded the numbers on 2026-08-17, with Gil V. and Shira G. flipped `ONLINE`,
against `GET /questions/:id/matches` for an integrals question at level 5:

```
Gil V.   ≈ 0.793     one 5-star rating
Dana K.  ≈ 0.765     4.60 across 40 sessions
```

Gil's single five-star scores a full **1.0** at weight 0.20. Dana's forty sessions score
0.92 for the same weight. Twenty ratings of evidence is worth 0.016 of score and one
rating is worth 0.20 — which is the sentence §9.3 exists to prevent.

`topicFit` **is** smoothed, and it does favour Dana. The gap is entirely the component
§9.3's formula was never applied to.

### The two behaviours this changes, both deliberately

**An unrated teacher stops scoring zero and starts scoring the platform prior.** Today the
`: 0` branch punishes a teacher with no ratings by the full 0.20; `bayesian` with
`count: 0` returns `prior` exactly, which its own docstring calls the property worth
stating — "a teacher with no history is neither promoted nor punished".

`matching.scoring.js`'s current header defends the zero as "§9.2's own wording". It is
§9.2's wording, and §9.2's wording is what §9.3 is written to correct. There is also a
product argument: **§9.2 already has a cold-start component.** `new_teacher_boost` gives
1.0 at weight 0.05 for the first five sessions, and §6.1's whole "why open" case rests on
a teacher with no history being able to earn one. Scoring their rating at zero *and*
handing them a 0.05 boost is the platform punishing and compensating the same fact with
two different numbers. After this PR, cold start is the boost, and the rating component is
neutral.

**Ratings become harder to move and that is the point.** After 8.1 a live review moves
`topicFit` too, so the total a single rating can shift falls while the total a *career*
can shift is unchanged. That is the ordering §9.3 describes and §18 names as E8's
acceptance criterion.

### The tests this breaks, both of which are correct today

`server/tests/matching.scoring.test.js`:

- **`'the global rating is not worth its weight'`** (~line 304) asserts that an unrated
  candidate scores exactly `MATCH_WEIGHTS.globalRating` below a perfect one. That is a
  precise statement of the `: 0` branch and it stops being true — under smoothing the gap
  is `weight × (1 - prior/MAX_STARS)`. The assertion is **rewritten to the new rule**, not
  deleted: the property still worth pinning is that the component is worth its weight and
  no more.
- **`'equals a sum computed from MATCH_WEIGHTS at test time'`** (~line 322) recomputes
  `globalRating: one.ratingSum / one.ratingCount / MAX_STARS` by hand. It becomes
  `smooth(one.ratingSum, one.ratingCount, averages.rating) / MAX_STARS`, using the
  `smooth` helper that test already defines for the other three.

**Neither is relaxed and neither is deleted.** They are the two tests that would have
caught this being changed by accident, and after this PR they are the two tests that would
catch it being changed back.

### The test this PR adds

The one that has never existed: **§9.3's own sentence, as an assertion.** Two candidates
built from E4's Bayesian pair — one five-star rating against 4.60 across forty — scored
against `NEUTRAL_PLATFORM_AVERAGES`, asserting the second outranks the first. E4's seed
carries that pair precisely so this test can fail when the code is wrong (`teachers.js`'s
own header says so). Until now nothing asserted it above the level of `topicFit`.

## Files you may touch

```
server/src/services/matching.scoring.js      one expression, and the header paragraph that defended the old one
server/tests/matching.scoring.test.js        two assertions rewritten, one added — see Scope
docs/epics/E8-ratings-reputation/README.md   tick the status box
docs/epics/E4-matching/RETRO.md              ONE line under "The defect this pass was built to find": fixed, here
```

## Files you must NOT touch

```
server/src/config/constants/matching.js      MATCH_WEIGHTS and BAYES_C are unchanged. This is not a re-weighting
server/src/services/matching.averages.service.js  the prior is fine; it is the consumer that was wrong
server/src/repositories/matching.repository.js    reads the same rows it always did
server/src/utils/matchView.js                the card renders an order, not a score (§14.2)
server/src/utils/topicStats.js               8.1's, and this PR does not need it
shared/**                                    the score reaches no client
client/**                                    §14.2: the student sees an order, not grades
prisma/**                                    no column, no seed change. The seed's pair is the fixture
docs/epics/E6a-*/**  docs/epics/E6b-*/**     other epics' chains
```

## Acceptance criteria

- [ ] With Gil V. and Shira G. flipped `ONLINE`, `GET /questions/:id/matches` for an integrals question at level 5 returns **Dana K. above Gil V.** — the exact check E4's retro recorded as failing
- [ ] A new unit test asserts §9.3's sentence directly: one 5.0 rating ranks below 4.60 across 40, from `rankCandidates` alone, with no database
- [ ] `'the global rating is not worth its weight'` still exists, rewritten to the smoothed rule, and fails if the `: 0` branch is restored
- [ ] `'equals a sum computed from MATCH_WEIGHTS at test time'` still recomputes all six components by hand and still asserts `deepEqual` on the key sets
- [ ] An unrated teacher scores `averages.rating / MAX_STARS` for this component — neither 0 nor 1
- [ ] `matching.bayes.test.js` passes untouched. `bayesian` itself does not change
- [ ] `npm test` passes with no assertion weakened to `assert.ok` or a widened tolerance
- [ ] `grep -n "ratingCount > 0" server/src/services/matching.scoring.js` returns nothing
- [ ] The file still contains no import from a repository, no Prisma client and no clock — 4.1's purity grep still comes back empty

## Manual test

1. `npm run db:up && npm run db:seed && npm run dev`.
2. `update teacher_profiles set status = 'ONLINE' where user_id in (<Gil>, <Shira>);`
3. As a seeded student, ask the integrals question at level 5 and open
   `/app/ask/:id/teachers`.
4. **Dana K. is above Gil V.** Before this PR she is not.
5. Restart the server (or call `clearPlatformAveragesCache()`) and repeat — the order is
   identical. Ties break on `teacherId` and the sort is deterministic.
6. Revert the two rows to `OFFLINE`. The list returns to three teachers.

## Review checklist additions

- **A red test in this PR is a decision, never a number to update.** Both broken
  assertions encode the old behaviour on purpose. Changing an expected value here without
  the paragraph explaining why is how a ranking rule becomes a ranking bug, and this file
  decides which teacher every student in the product is offered.
- **`MATCH_WEIGHTS` does not change.** If the fix appears to need a re-weighting, it is
  the wrong fix — the weights sum to 1.0 and `constants/matching.js` asserts it at boot.
- **The header paragraph that defends the unsmoothed component must be rewritten, not
  deleted.** It currently reads that `globalRating` is "the one component §9.2 leaves
  unsmoothed" and that "unrated scores zero rather than the prior, which is §9.2's own
  wording". Both sentences become false in this PR. Leaving them is worse than having
  written nothing, and this repo's convention is that the argument moves with the code.
- The ownership paragraph in that header records a 4.1 → 4.3 transfer to DEV-B. That is
  history and it stays; add a line saying 8.2 changed one expression and why, the same way
  4.3's own line reads.

## Notes

**Why now, after four epics of it being known.** E4's retro filed this with a name, a
measurement and an owner — "its own PR against `matching.scoring.js`" — and it was never
written. E6's note 15 predicted the reason it stayed quiet: *nothing moved the numbers*.
The seed was the only writer, so the order was wrong and completely stable, which reads
like a fixture rather than a defect.

8.1 ends that. From the first real rating, a teacher's position moves — and the component
that moves it furthest per unit of evidence is the unsmoothed one. **E8's own §18
criterion is "rating a teacher 5 stars on an integrals question measurably raises their
rank", and it is not measurable while a different rating can raise it by more.**

**Order matters and it is the reverse of the obvious one.** This PR lands before 8.1. If
8.1 goes first, the next ranking measurement contains two changes and will attribute both
to whichever is easier to see — which is precisely the failure mode E4's retro describes
about its own unit tests: fixtures that were right, composed into a system that was not.

**This PR is not a re-weighting and must not become one.** §9.2's six weights are the
product's judgement about what matters and they are out of scope. The claim here is
narrower and entirely §9.3's: three of those six components are ratios over a
teacher-supplied denominator, §9.3 says they are smoothed identically, and one of them was
not.

**7.9 is open against `session.end.service.js` and `utils/commission.js`.** Neither is on
this allowlist. Both PRs could be described as "the scoring one" by somebody skimming;
they share no file.
