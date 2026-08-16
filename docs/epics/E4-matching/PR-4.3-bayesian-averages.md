# PR 4.3 — `bayesian()` + `getPlatformAverages()`

| | |
|---|---|
| **Epic** | E4 — Matching Engine |
| **Owner** | DEV-B (rotem) |
| **Size** | S |
| **Written by** | Agent |
| **Depends on** | 4.1 (merged) |
| **Blocks** | 4.6 |
| **Branch** | `dev-b/E4.3-bayesian-averages` |

## Contract implemented

`MVP.md` §9.3 — Bayesian smoothing — and the cached `getPlatformAverages()` of §9.4. Nothing
user-visible. This is the prior every smoothed component in 4.6 is measured against.

## Scope

**`matching.scoring.js` transfers to DEV-B with this PR.** 4.1 created it with both signatures
and a working `bayesian` body; from here it is yours and DEV-A does not open it again. Put
your name on the header comment the way `classification.service.js` records its 3.1 → 3.3
handover.

**1. `bayesian({ sum, count }, prior, c)` — finish and pin it.** The body is §9.3 in one line
and 4.1 already wrote it:

```
(sum + prior * c) / (count + c)
```

What this PR adds is the tests, and they are the point of the PR. §9.3 calls this "the
critical piece" for one reason: *a teacher with a single 5.0 must rank below one with 4.6
across 40.* Pin that with the seed's own numbers, not invented ones —
`gil.v@demo.tutornow.il` is `{ sum: 5, count: 1 }` on `integration-by-parts` and
`dana.k@demo.tutornow.il` is `{ sum: 184, count: 40 }`, and the seed says in a comment that
this pair exists so the E4 acceptance test can fail when the code is wrong.

Three properties worth a test each, because each one is a way to get it subtly right for the
wrong reason:

- `count: 0` returns the prior **exactly**. A new teacher is neither promoted nor punished.
- The result is always between the prior and the raw mean, and moves toward the raw mean as
  `count` grows. Assert it at `count` of 1, 5 and 40 rather than at one convenient value.
- `BAYES_C` comes from `constants/matching.js`. A test that types `5` passes for the wrong
  reason the day somebody tunes it — `pricing.test.js` has the full story on why that
  matters, and it is the same mistake in a different file.

**2. `matching.averages.service.js`, new, DEV-B's.** `getPlatformAverages()` returns
`{ rating, resolveRate, acceptRate }`, cached for `PLATFORM_AVERAGES_CACHE_MS` (five minutes,
already in constants).

The three ratios come from `aggregatePlatformAverages()` in the frozen
`matching.repository.js`, which 4.1 wrote and which returns the six sums rather than the
ratios — dividing is this file's job, because deciding what a zero denominator means is a
business rule and not a query:

| Average | Numerator / denominator | Zero denominator |
|---|---|---|
| `rating` | `sum(rating_sum) / sum(rating_count)` over `teacher_profiles` | `NEUTRAL_PLATFORM_AVERAGES.rating` |
| `resolveRate` | `sum(resolved_count) / sum(sessions_count)` | `NEUTRAL_PLATFORM_AVERAGES.resolveRate` |
| `acceptRate` | `sum(offers_accepted) / sum(offers_received)` | `NEUTRAL_PLATFORM_AVERAGES.acceptRate` |

`NEUTRAL_PLATFORM_AVERAGES` is in `constants/matching.js` (4.1). It is only reachable on a
platform with no history at all, where every candidate collapses to the same prior and the
value therefore cannot change anyone's order — which is exactly why it should be a named
constant with that sentence next to it rather than a `?? 0` three call sites deep.

**The cache is module-level, and it needs a way out.** Five minutes of process-local state is
right for production and actively confusing during verification: a number changed in `psql`
does not appear until the window closes, on a server that may also have cold-started and
thrown the cache away. Export a `clearPlatformAveragesCache()` for tests and say in the header
that 4.8's checklist restarts the server rather than waiting. Do not add a query parameter or
an env var to bypass it — that is a production surface for a development problem.

**Injected collaborators, second argument,** the same idiom `classification.service.js` and
`question.intake.service.js` use. The properties worth asserting here are "the second call
inside the window does not hit the database" and "the call after it does", and a unit test
cannot observe a call it cannot intercept. `node --test`'s module mocking would need a flag on
the root `npm test` script that this PR may not touch.

## Files you may touch

```
server/src/services/matching.averages.service.js    new
server/src/services/matching.scoring.js             bayesian only — rankCandidates stays stubbed
                                                    until 4.6. Ownership header updated.
server/tests/matching.bayes.test.js                 new
server/tests/matching.averages.test.js              new
docs/epics/E4-matching/README.md                    tick the status box
```

## Files you must NOT touch

```
server/src/repositories/matching.repository.js      frozen since 4.1 — aggregatePlatformAverages
                                                    is already there; call it
server/src/services/matching.candidates.service.js  DEV-A's, 4.2
server/src/services/matching.service.js             DEV-A's, 4.5
server/src/config/constants/matching.js             4.1 finished it. BAYES_C, the cache window and
                                                    NEUTRAL_PLATFORM_AVERAGES are all already in it
server/src/repositories/teacher.repository.js       frozen since 2.1
package.json / package-lock.json                    a five-minute cache is a Map and a timestamp
client/**                                           nothing client-side in this PR
```

## Acceptance criteria

- [ ] `bayesian({ sum: 0, count: 0 }, p, BAYES_C) === p` for three different `p`
- [ ] With the platform rating as the prior, Gil's `{5, 1}` smooths **below** Dana's `{184, 40}` — assert the comparison, not the two values
- [ ] The smoothed value moves monotonically toward the raw mean as `count` rises through 1, 5, 40
- [ ] No test in this PR contains the literal `5` for `BAYES_C`, and none contains a hand-typed platform average
- [ ] `getPlatformAverages()` on the seeded database returns a rating in the 4.0–4.8 range, and both rates strictly between 0 and 1
- [ ] Two calls inside the window issue **one** aggregate query; a call after `clearPlatformAveragesCache()` issues a second
- [ ] On a database with no teachers, all three fall back to `NEUTRAL_PLATFORM_AVERAGES` and nothing divides by zero or returns `NaN`
- [ ] `grep -c prisma server/src/services/matching.scoring.js` is still `0`
- [ ] `rankCandidates` still returns `score: 0` for everyone — this PR does not start scoring
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` pass

## Manual test

1. `npm run db:up && npm run db:seed`, then call `getPlatformAverages()` from a node one-liner and check the three numbers against `psql`:
   `select sum(rating_sum)::float / sum(rating_count), sum(resolved_count)::float / sum(sessions_count), sum(offers_accepted)::float / sum(offers_received) from teacher_profiles;`
2. `update teacher_profiles set rating_sum = rating_sum + 100 where user_id = '<dana>'` → call again inside five minutes and confirm the **old** value comes back; call `clearPlatformAveragesCache()` and confirm the new one does. **Undo the update** (`npm run db:seed` restores it — the seed derives aggregates from `stats`)
3. `truncate teacher_profiles cascade` on a throwaway local database → confirm the neutral fallback and no `NaN`. Re-seed
4. `node --input-type=module -e "import('./server/src/services/matching.scoring.js').then(m => { const p = 4.4; console.log(m.bayesian({sum:5,count:1}, p, 5), m.bayesian({sum:184,count:40}, p, 5)); })"`

## Review checklist additions

- Confirm the divide-by-zero branch is a named constant and not an inline `|| 0`. A silent zero prior would push every rated teacher above every unrated one and look like the algorithm working.
- Confirm the cache stores the resolved value and not the promise-of-a-value, or the first two concurrent callers each fire an aggregate. If you cache the promise instead, say so and test it — either is defensible, an accident is not.
- Confirm `aggregatePlatformAverages` is called and no new query was written in this service. The repository is frozen and it already has one.
- Confirm the tests read `BAYES_C` and `PLATFORM_AVERAGES_CACHE_MS` from the barrel.

## Notes

**Why `bayesian` lives inside `matching.scoring.js` rather than in `utils/`.** §18 lists it as
its own deliverable and it is pure, so `server/src/utils/` looks like the natural home —
except that `OWNERSHIP.md` §2 assigns `utils/` to DEV-A, and this function is the arithmetic
core of DEV-B's seam. Keeping it in the file that uses it means DEV-B's half of E4 is two
files, both DEV-B's, and the pure/impure line still holds: `matching.scoring.js` imports
nothing but constants.

**Why the averages are a service and the sums are a repository.** `sum(resolved_count) /
sum(sessions_count)` is a query; "and when nobody has ever had a session, the platform's
resolve rate is 0.5" is a decision. Putting the decision in the repository would hide it under
a function whose name promises an aggregate, and 4.6's tests would have no way to exercise the
empty-platform branch without an empty database.

**Why the cache window is five minutes and not zero.** §9.4 says so, and the reason is that
this aggregate scans every teacher on every match request — including every press of the price
control, which re-calls the endpoint by design. The staleness it buys is invisible: a platform
average moves by a few thousandths per session, and it is a *prior*, whose entire job is to be
the number a teacher with no history is compared against.

**This PR cannot change any ranking, and that is how you know it is done.** `rankCandidates`
still scores everyone at zero until 4.6. If a match list starts coming back in a different
order after this merges, something imported the averages into the wrong place.
