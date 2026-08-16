import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BAYES_C, MAX_STARS, NEUTRAL_PLATFORM_AVERAGES } from '#config/constants/index.js';
import { bayesian } from '#services/matching.scoring.js';

/**
 * Bayesian smoothing — MVP.md §9.3, PR 4.3.
 *
 * §9.3 calls this "the critical piece" and §18 makes it an acceptance criterion for the
 * whole epic, for one reason: *a teacher with a single 5.0 must rank below a teacher
 * with 4.6 across forty sessions.* Unsmoothed, the opposite happens and the ranking is
 * noise dressed as an algorithm.
 *
 * `matching.core.test.js` pinned the shape of this function when 4.1 froze the seam.
 * This file is the property work that PR brief 4.3 assigns here, and it is deliberately
 * the harder half: the criterion asserted across a range of priors rather than at one
 * convenient value, the interval and monotonicity asserted in both directions, and the
 * limit of the claim written down as a test rather than discovered later by somebody
 * generalizing it.
 *
 * **Nothing below types a smoothing constant or a platform average.** `BAYES_C` comes
 * from the barrel, and a test that wrote `5` would pass for the wrong reason the day
 * somebody tunes it — `pricing.test.js` has the full story, and it is the same mistake
 * in a different file. The priors below are points on the 1–`MAX_STARS` rating scale,
 * not claims about what this platform's average is; the real one is the manual test's,
 * against the seeded database.
 */

/**
 * The seed's deliberate Bayesian pair on `integration-by-parts`, and the reason it is in
 * the seed at all: `prisma/seed/teachers.js` says in a comment that without this pair in
 * the data, the E4 acceptance test cannot fail even when the code is wrong.
 *
 * `gil.v@demo.tutornow.il` — one session rated 5.0, and a second that finished unrated.
 * `dana.k@demo.tutornow.il` — 4.60 across forty.
 */
const GIL = { sum: 5, count: 1 };
const DANA = { sum: 184, count: 40 };

/** Dana's raw mean, derived rather than typed, so the seed and this file cannot drift. */
const DANA_MEAN = DANA.sum / DANA.count;

/**
 * Equality for the two identities below, which hold in arithmetic and not in binary
 * floats: `184 / 40` is not 4.6 and `4.6 * 40` is not 184, so `(sum + p*c) / (count + c)`
 * lands a few ulps from where algebra says it does. The tolerance is 1e-12 rather than a
 * comfortable 0.01 — these are exact claims about the formula, and anything that misses
 * by more than rounding is a different formula.
 */
const identical = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: ${actual} vs ${expected}`);

/**
 * Points on the rating scale, half a star apart, stopping one star below the top.
 *
 * The gap at the top is the point: Gil's raw mean *is* `MAX_STARS`, so a prior equal to
 * it cannot pull him below anybody, and the last test in the first block says so
 * outright. A sweep that ran to 5 would be asserting something false.
 */
const PRIORS = Array.from({ length: (MAX_STARS - 1) * 2 - 1 }, (_, index) => 1 + index * 0.5);

describe('bayesian — §9.3, the acceptance criterion', () => {
  it('ranks the seed’s one 5.0 below its 4.6-across-forty', () => {
    // §18's criterion, in the numbers the seed actually holds. The comparison is the
    // assertion; neither smoothed value is, because both move the day `BAYES_C` is tuned
    // and the ordering is the thing that must not.
    const prior = NEUTRAL_PLATFORM_AVERAGES.rating;

    assert.ok(bayesian(GIL, prior, BAYES_C) < bayesian(DANA, prior, BAYES_C));
  });

  it('keeps that ordering across the whole plausible range of priors', () => {
    // One prior proves the arithmetic on one day. The platform average is a live number
    // that drifts with every rating, so the criterion is worth having at every value it
    // can plausibly take rather than at the one the neutral constant happens to be.
    for (const prior of PRIORS) {
      assert.ok(
        bayesian(GIL, prior, BAYES_C) < bayesian(DANA, prior, BAYES_C),
        `prior ${prior} inverted the pair`,
      );
    }
  });

  it('does not claim the ordering at a prior of a perfect score, and should not', () => {
    // The limit of the claim, written down so nobody widens `PRIORS` to `MAX_STARS` and
    // spends an afternoon on it. Smoothing pulls a teacher toward the prior; when the
    // prior *is* 5.0, pulling Gil toward it leaves him at 5.0 and pulls Dana up from
    // 4.6 — so the pair inverts, and that is the formula working. It is also a platform
    // where every teacher averages a perfect score, which is not a platform.
    assert.ok(bayesian(GIL, MAX_STARS, BAYES_C) > bayesian(DANA, MAX_STARS, BAYES_C));
  });
});

describe('bayesian — §9.3, the properties that make it smoothing', () => {
  it('returns the prior exactly when there is no history', () => {
    // A teacher with no ratings is neither promoted nor punished — the property §9.3
    // names and the one the cold-start teachers in the seed depend on. Exact equality
    // rather than a tolerance: `(0 + p*c) / (0 + c)` is `p` for every `p`, and a formula
    // that only approximates it has an extra term in it.
    for (const prior of [1, 3.25, NEUTRAL_PLATFORM_AVERAGES.rating, MAX_STARS]) {
      assert.equal(bayesian({ sum: 0, count: 0 }, prior, BAYES_C), prior);
    }
  });

  it('stays between the prior and the raw mean, and moves toward the mean as count grows', () => {
    // Asserted at 1, 5 and 40 rather than at one convenient value, because a formula
    // that divides by the wrong denominator is still inside the interval at count 1.
    const prior = NEUTRAL_PLATFORM_AVERAGES.rating;
    let previous = prior;

    for (const count of [1, 5, 40]) {
      const smoothed = bayesian({ sum: DANA_MEAN * count, count }, prior, BAYES_C);

      assert.ok(smoothed > prior && smoothed < DANA_MEAN, `count ${count} left the interval`);
      assert.ok(smoothed > previous, `count ${count} did not move toward the raw mean`);
      previous = smoothed;
    }
  });

  it('does the same downwards, for a teacher who is below the platform', () => {
    // The mirror case, and not a formality: a smoothing that only worked upward would
    // pass every test above and would quietly promote every bad teacher on the platform.
    // §9.2 scores `resolve_rate` and `acceptance_rate` through this same function, where
    // being below the prior is the common case rather than the exception.
    const prior = MAX_STARS - 1;
    const mean = 2;
    let previous = prior;

    for (const count of [1, 5, 40]) {
      const smoothed = bayesian({ sum: mean * count, count }, prior, BAYES_C);

      assert.ok(smoothed < prior && smoothed > mean, `count ${count} left the interval`);
      assert.ok(smoothed < previous, `count ${count} did not move toward the raw mean`);
      previous = smoothed;
    }
  });

  it('returns the raw mean when it already equals the prior', () => {
    // The fixed point. A teacher who is exactly average is moved by no amount of
    // smoothing, at any count — which is what "pulled toward the prior" means when
    // there is nowhere to pull.
    for (const count of [0, 1, 40]) {
      identical(
        bayesian({ sum: DANA_MEAN * count, count }, DANA_MEAN, BAYES_C),
        DANA_MEAN,
        `count ${count} moved a teacher who is exactly average`,
      );
    }
  });

  it('converges on the raw mean once a teacher has a real history', () => {
    // The other end of the same property: the prior is training wheels, not a permanent
    // handicap. A teacher with thousands of ratings is judged on their own record.
    const prior = NEUTRAL_PLATFORM_AVERAGES.rating;
    const count = 10_000;
    const smoothed = bayesian({ sum: DANA_MEAN * count, count }, prior, BAYES_C);

    assert.ok(Math.abs(smoothed - DANA_MEAN) < 0.01, `still ${smoothed} at count ${count}`);
  });

  it('credits a teacher with exactly BAYES_C ratings of the prior', () => {
    // What the constant *means*, asserted rather than described. At `count === BAYES_C`
    // the teacher's own record and the prior carry equal weight, so the result is their
    // midpoint — which is the sentence `constants/matching.js` puts next to the number.
    const prior = NEUTRAL_PLATFORM_AVERAGES.rating;
    const smoothed = bayesian({ sum: DANA_MEAN * BAYES_C, count: BAYES_C }, prior, BAYES_C);

    identical(smoothed, (DANA_MEAN + prior) / 2, 'BAYES_C ratings did not weigh half');
  });

  it('smooths the two rates on their own 0–1 scale, not only ratings', () => {
    // §9.2 sends `resolved/sessions` and `accepted/received` through here with the two
    // rate priors. Nothing in the formula is scale-aware, and this is the test that says
    // so on purpose — the seed's `roni.t` is 0/0 on both and must come back neutral.
    const { resolveRate, acceptRate } = NEUTRAL_PLATFORM_AVERAGES;

    assert.equal(bayesian({ sum: 0, count: 0 }, resolveRate, BAYES_C), resolveRate);
    assert.equal(bayesian({ sum: 0, count: 0 }, acceptRate, BAYES_C), acceptRate);

    // A perfect record over one session is the resolve-rate shape of the same defect the
    // Gil/Dana pair catches for ratings: 1/1 must not outrank 36/40.
    const perfectOnce = bayesian({ sum: 1, count: 1 }, resolveRate, BAYES_C);
    const strongOverForty = bayesian({ sum: 36, count: 40 }, resolveRate, BAYES_C);

    assert.ok(perfectOnce < strongOverForty);
  });
});
