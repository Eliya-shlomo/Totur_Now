import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BAYES_C, NEUTRAL_PLATFORM_AVERAGES } from '#config/constants/index.js';
import { bayesian, rankCandidates } from '#services/matching.scoring.js';

/**
 * The E4 seam — MVP.md §9.2, §9.3.
 *
 * Small on purpose. This is the freeze, not the coverage: `bayesian` ships with a
 * real body in the blocking PR, so the arithmetic that body promises is pinned here,
 * and `rankCandidates` ships stubbed, so what is pinned is its *shape* and its
 * determinism rather than any order it produces. 4.3 owns the property-based work on
 * the smoothing and 4.6 owns the scoring tests.
 *
 * Nothing below types a smoothing constant. A test that wrote `5` would pass for the
 * wrong reason the day somebody tunes `BAYES_C` — `pricing.test.js` has the full
 * story on why that matters, and it is the same mistake in a different file.
 */

/** The seed's deliberate Bayesian pair on `integration-by-parts`, per §18's criterion. */
const ONE_FIVE_STAR = { sum: 5, count: 1 };
const FORTY_AT_4_6 = { sum: 184, count: 40 };

/** Enough of a `MatchCandidate` for the stub, which reads one field. */
const candidate = (teacherId) => ({ teacherId, subtopicStats: null, topicStats: null });

describe('bayesian — §9.3', () => {
  it('returns the prior exactly when there is no history', () => {
    // A teacher with no ratings is neither promoted nor punished. Exact equality,
    // not a tolerance: (0 + p*c) / (0 + c) is p for every p, and a formula that
    // only approximates it has an extra term in it.
    for (const prior of [1, 3.25, NEUTRAL_PLATFORM_AVERAGES.rating]) {
      assert.equal(bayesian({ sum: 0, count: 0 }, prior, BAYES_C), prior);
    }
  });

  it('ranks one 5.0 below 4.6 across forty — the criterion the epic exists to pass', () => {
    // §18's acceptance criterion, and the whole reason §9.3 calls this "the critical
    // piece". Unsmoothed, 5.0 beats 4.6 and the ranking is noise. The comparison is
    // the assertion; the two values are not.
    const prior = NEUTRAL_PLATFORM_AVERAGES.rating;

    assert.ok(bayesian(ONE_FIVE_STAR, prior, BAYES_C) < bayesian(FORTY_AT_4_6, prior, BAYES_C));
  });

  it('stays between the prior and the raw mean, and moves toward the mean as count grows', () => {
    // The property that makes it smoothing rather than an average with extra steps.
    // Asserted at three counts rather than one convenient value: a formula that
    // divides by the wrong denominator is still between the two at count 1.
    const prior = NEUTRAL_PLATFORM_AVERAGES.rating;
    const mean = 4.6;
    let previous = prior;

    for (const count of [1, 5, 40]) {
      const smoothed = bayesian({ sum: mean * count, count }, prior, BAYES_C);

      assert.ok(smoothed > prior && smoothed < mean, `count ${count} left the interval`);
      assert.ok(smoothed > previous, `count ${count} moved away from the raw mean`);
      previous = smoothed;
    }
  });
});

describe('rankCandidates — the stub, and the shape 4.6 inherits', () => {
  const averages = NEUTRAL_PLATFORM_AVERAGES;

  it('answers for an empty pool', () => {
    assert.deepEqual(rankCandidates([], averages), []);
  });

  it('returns {teacherId, score} pairs and not the candidate rows', () => {
    // So that it cannot quietly become the serializer. The caller already holds the
    // rows and joins this order back onto them.
    const [first] = rankCandidates([candidate('b')], averages);

    assert.deepEqual(Object.keys(first).sort(), ['score', 'teacherId']);
  });

  it('returns the same order for the same input', () => {
    // On a fresh database every candidate scores identically, so the tie-break is
    // what stops "show me more teachers" from looking broken. This must hold after
    // 4.6 lands too, which is why it is asserted on the order and not on the scores.
    const pool = ['c', 'a', 'b'].map(candidate);

    assert.deepEqual(rankCandidates(pool, averages), rankCandidates(pool, averages));
  });

  it('breaks ties on teacherId ascending, whatever order the pool arrived in', () => {
    const ids = (pool) => rankCandidates(pool, averages).map((entry) => entry.teacherId);

    assert.deepEqual(ids(['c', 'a', 'b'].map(candidate)), ['a', 'b', 'c']);
    assert.deepEqual(ids(['a', 'b', 'c'].map(candidate)), ['a', 'b', 'c']);
  });
});
