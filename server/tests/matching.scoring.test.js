import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BAYES_C,
  MATCH_WEIGHTS,
  MAX_STARS,
  NEUTRAL_PLATFORM_AVERAGES,
  NEW_TEACHER_SESSIONS,
  PARENT_TOPIC_WEIGHT,
} from '#config/constants/index.js';
import { rankCandidates } from '#services/matching.scoring.js';

/**
 * `rankCandidates` — MVP.md §9.2, PR 4.6.
 *
 * This function decides which human being a student talks to, and it is the easiest
 * thing in the codebase to test exhaustively, which is the point. Six properties, one
 * per failure mode a plausible implementation actually has:
 *
 *   1. §18's acceptance criterion, in the seed's own numbers
 *   2. specialist above generalist above nobody, and the parent row not discounted twice
 *   3. the weights are read from `MATCH_WEIGHTS`, not typed into the service
 *   4. every component lands in [0, 1] before its weight is applied
 *   5. determinism, and a tie-break on a stable key
 *   6. degenerate inputs — empty, zeroed, absent, and the neutral prior
 *
 * **Nothing below types a weight, a smoothing constant or a star ceiling.** Everything
 * comes from the constants barrel, so a test cannot pass for the wrong reason the day
 * somebody tunes one — `matching.bayes.test.js` and `pricing.test.js` have the full
 * story, and it is the same mistake in three files.
 *
 * **Fixtures are `number`s, from the seed.** `matching.repository.js` converts the four
 * `Decimal` columns before the scorer sees them (4.2), so a fixture built from a
 * `Decimal` would exercise a path this function never takes. The stats numbers below are
 * `prisma/seed/teachers.js`'s, not invented integers, because that file says in its own
 * header that without its Bayesian pair the E4 acceptance test cannot fail even when the
 * code is wrong.
 */

/** Every field the seam names, all inert. Overrides are the point of each case. */
const candidate = (teacherId, overrides = {}) => ({
  teacherId,
  sessionsCount: 0,
  resolvedCount: 0,
  ratingSum: 0,
  ratingCount: 0,
  offersReceived: 0,
  offersAccepted: 0,
  subtopicStats: null,
  topicStats: null,
  hasPositiveHistory: false,
  ...overrides,
});

const idsOf = (pool, averages) => rankCandidates(pool, averages).map((entry) => entry.teacherId);

const scoreOf = (one, averages) => rankCandidates([one], averages)[0].score;

/** Exact within rounding. These are claims about the formula, not about tolerances. */
const identical = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: ${actual} vs ${expected}`);

/**
 * Dana K. and Gil V. on `integration-by-parts` — the seed's deliberate Bayesian pair,
 * profile totals included, because §9.2 scores five things besides the subtopic rating
 * and the criterion has to survive all of them.
 *
 * Gil wins the cold-start boost (2 sessions, below `NEW_TEACHER_SESSIONS`) and the
 * unsmoothed `global_rating` outright — his single rating is a perfect one. He must
 * still lose, and that is what makes this a test rather than a formality.
 *
 * `offersReceived` is the seed's own derivation, `round(sessions / acceptanceRate)`:
 * Dana accepts at 0.82, Gil at 0.50.
 */
const DANA = candidate('dana', {
  sessionsCount: 105,
  resolvedCount: 93,
  ratingSum: 483,
  ratingCount: 105,
  offersAccepted: 105,
  offersReceived: 128,
  subtopicStats: { ratingSum: 184, ratingCount: 40, resolvedCount: 36, sessionsCount: 40 },
});

const GIL = candidate('gil', {
  sessionsCount: 2,
  resolvedCount: 1,
  ratingSum: 5,
  ratingCount: 1,
  offersAccepted: 2,
  offersReceived: 4,
  subtopicStats: { ratingSum: 5, ratingCount: 1, resolvedCount: 1, sessionsCount: 2 },
});

/** Dana's leaf row, and what the seed writes into its parent from the same sessions. */
const LEAF = DANA.subtopicStats;
const PARENT = Object.fromEntries(
  Object.entries(LEAF).map(([column, value]) => [column, value * PARENT_TOPIC_WEIGHT]),
);

/**
 * Priors as points on the scales rather than claims about this platform's averages.
 *
 * The rating sweep stops one star below the top for the reason `matching.bayes.test.js`
 * pins as its own test: at a prior of a perfect score, smoothing has nowhere to pull
 * Gil from and the pair inverts correctly. 4.3 measured the real threshold at ≈4.5077
 * against a seeded platform sitting at 4.4835.
 */
const RATING_PRIORS = Array.from({ length: (MAX_STARS - 1) * 2 - 1 }, (_, i) => 1 + i * 0.5);
const RATE_PRIORS = [0.25, NEUTRAL_PLATFORM_AVERAGES.resolveRate, 0.75];

const PLATFORMS = RATING_PRIORS.flatMap((rating) =>
  RATE_PRIORS.map((rate) => ({ rating, resolveRate: rate, acceptRate: rate })),
);

/** A platform where every component saturates, so a perfect candidate scores exactly 1. */
const PERFECT_PLATFORM = { rating: MAX_STARS, resolveRate: 1, acceptRate: 1 };

const PERFECT = candidate('perfect', {
  ratingSum: MAX_STARS,
  ratingCount: 1,
  hasPositiveHistory: true,
});

describe('rankCandidates — §18’s acceptance criterion', () => {
  it('ranks the seed’s one 5.0 below its 4.6-across-forty', () => {
    // The whole reason §9.3 calls smoothing "the critical piece". Unsmoothed, Gil's
    // single perfect rating beats Dana's forty and the ranking is noise dressed as an
    // algorithm. The ordering is the assertion; neither score is, because both move the
    // day `BAYES_C` is tuned and the ordering must not.
    assert.deepEqual(idsOf([GIL, DANA], NEUTRAL_PLATFORM_AVERAGES), ['dana', 'gil']);
  });

  it('is a real test — Gil’s raw average is the higher one', () => {
    // Derived from the fixtures rather than asserted as 5.0 vs 4.6, so that editing a
    // seed number cannot quietly turn the case above into a comparison of 4.6 with 3.
    const mean = ({ ratingSum, ratingCount }) => ratingSum / ratingCount;

    assert.ok(mean(GIL.subtopicStats) > mean(DANA.subtopicStats));
    assert.ok(mean(GIL) > mean(DANA));
  });

  it('keeps the ordering across every plausible platform, not one convenient prior', () => {
    // The platform average is a live number that drifts with every rating. One prior
    // proves the arithmetic on one day; this proves the criterion.
    for (const averages of PLATFORMS) {
      assert.deepEqual(
        idsOf([GIL, DANA], averages),
        ['dana', 'gil'],
        `prior ${JSON.stringify(averages)} inverted the pair`,
      );
    }
  });

  it('records where the FULL score flips, which is not where smoothing alone flips', () => {
    // **Read this before trusting the three tests above.** 4.3 measured the pair
    // inverting at a prior of ≈4.5077 and the seeded platform sitting at 4.4835, and
    // recorded 0.024 stars of headroom. That measurement is about `bayesian` in
    // isolation and it does not carry to §9.2's six components: `global_rating` is
    // unsmoothed and hands Gil his perfect single rating outright, and
    // `new_teacher_boost` is his for free. Measured against the seeded database, the
    // full score flips at a prior of ≈4.1277 — below where the platform actually sits,
    // so **Gil outranks Dana on the seeded data by ≈0.018**, and §18's criterion does
    // not hold end to end today.
    //
    // This is a recorded measurement, not an endorsement. The scorer matches §9.2
    // component for component; what it shows is that §9.2's composition, not its
    // smoothing, is what the criterion depends on. The decision belongs to 4.8.
    const seeded = { rating: 4.483516, resolveRate: 0.844607, acceptRate: 0.723545 };

    assert.deepEqual(idsOf([GIL, DANA], seeded), ['gil', 'dana']);

    // The cold-start boost is the whole margin. Take it away — leave everything else,
    // including the unsmoothed perfect rating — and the criterion holds again.
    const experienced = candidate('gil', { ...GIL, sessionsCount: NEW_TEACHER_SESSIONS });

    assert.deepEqual(idsOf([experienced, DANA], seeded), ['dana', 'gil']);
  });

  it('gives Gil the cold-start boost and a perfect global rating, both by the book', () => {
    // Pinned so the next person does not "fix" the fixture by taking them away. Both
    // components are working exactly as §9.2 says — and per the test above they are
    // between them the reason the criterion fails at the seeded prior.
    const components = { newTeacherBoost: GIL.sessionsCount < NEW_TEACHER_SESSIONS };

    assert.ok(components.newTeacherBoost);
    assert.ok(DANA.sessionsCount >= NEW_TEACHER_SESSIONS);
    assert.equal(GIL.ratingSum / GIL.ratingCount, MAX_STARS);
  });
});

describe('rankCandidates — the topic fallback, subtopic → parent → prior', () => {
  const specialist = candidate('a-specialist', { subtopicStats: LEAF });
  const generalist = candidate('b-generalist', { topicStats: PARENT });
  const unrated = candidate('c-unrated');

  it('puts the specialist above the generalist above the teacher with neither', () => {
    // All else is equal — the three differ in the stats rows and in nothing else. Ids
    // are lettered so that a tie-break on `teacherId` would produce this same order and
    // hide a broken fallback; the strict score comparison below is what rules that out.
    assert.deepEqual(idsOf([unrated, generalist, specialist], NEUTRAL_PLATFORM_AVERAGES), [
      'a-specialist',
      'b-generalist',
      'c-unrated',
    ]);

    const scores = [specialist, generalist, unrated].map((one) =>
      scoreOf(one, NEUTRAL_PLATFORM_AVERAGES),
    );

    assert.ok(scores[0] > scores[1], 'the specialist did not beat the generalist');
    assert.ok(scores[1] > scores[2], 'the generalist did not beat the unrated teacher');
  });

  it('reads the parent row exactly as written and does not discount it a second time', () => {
    // The review checklist's item, as a test. `PARENT_TOPIC_WEIGHT` describes how a
    // session *writes* into the parent's stats — the seed's `deriveTopicStats` already
    // applied it — so a teacher whose parent row holds a given pair must score exactly
    // as a teacher whose leaf row holds the same pair. Multiplying by it again here
    // ranks everyone in a plausible order and a wrong one, which is why this compares
    // scores rather than an order.
    const viaLeaf = candidate('x', { subtopicStats: PARENT });
    const viaParent = candidate('x', { topicStats: PARENT });

    identical(
      scoreOf(viaParent, NEUTRAL_PLATFORM_AVERAGES),
      scoreOf(viaLeaf, NEUTRAL_PLATFORM_AVERAGES),
      'the parent row was weighted a second time',
    );
  });

  it('prefers the leaf row when both are present', () => {
    // Fallback, not a blend. A teacher with a weak leaf and a strong parent is judged on
    // the leaf, because the leaf is what the question is about.
    const weakLeaf = { ratingSum: 1, ratingCount: 1, resolvedCount: 0, sessionsCount: 1 };
    const both = candidate('x', { subtopicStats: weakLeaf, topicStats: LEAF });
    const leafOnly = candidate('x', { subtopicStats: weakLeaf });

    identical(
      scoreOf(both, NEUTRAL_PLATFORM_AVERAGES),
      scoreOf(leafOnly, NEUTRAL_PLATFORM_AVERAGES),
      'the parent row leaked into a candidate that has a leaf row',
    );
  });

  it('answers the prior exactly for a teacher with no history in the topic at all', () => {
    // `bayesian({sum: 0, count: 0}, prior, c)` is `prior`, so `topic_fit` is the prior
    // over `MAX_STARS` — neither promoted nor punished. Isolated by zeroing everything
    // else and taking a platform whose two rate priors are zero.
    for (const rating of RATING_PRIORS) {
      const averages = { rating, resolveRate: 0, acceptRate: 0 };
      const score = scoreOf(candidate('x', { sessionsCount: NEW_TEACHER_SESSIONS }), averages);

      identical(
        score,
        MATCH_WEIGHTS.topicFit * (rating / MAX_STARS),
        `prior ${rating} did not reach topic_fit as the prior`,
      );
    }
  });
});

describe('rankCandidates — the weights are read, not typed', () => {
  it('scores a saturated candidate at the sum of MATCH_WEIGHTS', () => {
    // Every component at 1, so the score is the total of the weights — 1.0, asserted at
    // boot in `constants/matching.js` and derived here rather than written down. Fails
    // if a weight is retyped in the service, if a key is dropped from the reduction, or
    // if a seventh component is added to the constants and not to the scorer.
    const total = Object.values(MATCH_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

    identical(
      scoreOf(PERFECT, PERFECT_PLATFORM),
      total,
      'the saturated candidate missed the total',
    );
  });

  it('drops by exactly the weight of each component that can be switched off', () => {
    // Three of the six can be taken to zero exactly, and each one's contribution is then
    // its own weight and nothing else. A `0.1` retyped as `0.01` in the service fails
    // here and nowhere else in this file.
    const baseline = scoreOf(PERFECT, PERFECT_PLATFORM);

    const withoutHistory = candidate('x', { ...PERFECT, hasPositiveHistory: false });
    const experienced = candidate('x', {
      ...PERFECT,
      sessionsCount: NEW_TEACHER_SESSIONS,
      resolvedCount: NEW_TEACHER_SESSIONS,
    });
    const unrated = candidate('x', { ...PERFECT, ratingSum: 0, ratingCount: 0 });

    identical(
      baseline - scoreOf(withoutHistory, PERFECT_PLATFORM),
      MATCH_WEIGHTS.history,
      'history is not worth its weight',
    );
    identical(
      baseline - scoreOf(experienced, PERFECT_PLATFORM),
      MATCH_WEIGHTS.newTeacherBoost,
      'the cold-start boost is not worth its weight',
    );
    identical(
      baseline - scoreOf(unrated, PERFECT_PLATFORM),
      MATCH_WEIGHTS.globalRating,
      'the global rating is not worth its weight',
    );
  });

  it('equals a sum computed from MATCH_WEIGHTS at test time', () => {
    // The components are recomputed here from the constants rather than read out of the
    // service, because what this asserts is the *reduction*: that each component is
    // multiplied by the weight the constants file currently holds under its own key.
    const smooth = (sum, count, prior) => (sum + prior * BAYES_C) / (count + BAYES_C);
    const averages = NEUTRAL_PLATFORM_AVERAGES;
    const one = DANA;

    const components = {
      topicFit:
        smooth(one.subtopicStats.ratingSum, one.subtopicStats.ratingCount, averages.rating) /
        MAX_STARS,
      globalRating: one.ratingSum / one.ratingCount / MAX_STARS,
      resolveRate: smooth(one.resolvedCount, one.sessionsCount, averages.resolveRate),
      acceptanceRate: smooth(one.offersAccepted, one.offersReceived, averages.acceptRate),
      history: one.hasPositiveHistory ? 1 : 0,
      newTeacherBoost: one.sessionsCount < NEW_TEACHER_SESSIONS ? 1 : 0,
    };

    // A seventh weight with no component here is a failing test rather than a silent
    // `NaN` in production, and it says which key is missing.
    assert.deepEqual(Object.keys(components).sort(), Object.keys(MATCH_WEIGHTS).sort());

    const expected = Object.entries(MATCH_WEIGHTS).reduce(
      (total, [key, weight]) => total + weight * components[key],
      0,
    );

    identical(scoreOf(one, averages), expected, 'the weighted sum disagrees with MATCH_WEIGHTS');
  });
});

describe('rankCandidates — normalization, the [0, 1] guard', () => {
  const FIXTURES = [
    DANA,
    GIL,
    PERFECT,
    candidate('specialist', { subtopicStats: LEAF }),
    candidate('generalist', { topicStats: PARENT }),
    candidate('zeroed'),
    candidate('saturated-stats', {
      ratingSum: MAX_STARS * 40,
      ratingCount: 40,
      sessionsCount: 40,
      resolvedCount: 40,
      offersReceived: 40,
      offersAccepted: 40,
      subtopicStats: {
        ratingSum: MAX_STARS * 40,
        ratingCount: 40,
        resolvedCount: 40,
        sessionsCount: 40,
      },
      hasPositiveHistory: true,
    }),
  ];

  it('never scores outside [0, 1], for any fixture on any platform', () => {
    // The one that catches an unnormalized `topic_fit`. A `bayesian` rating left on the
    // star scale is roughly five times its weight, which pushes a strong candidate well
    // past 1 — and which otherwise presents as "the algorithm merely likes topical
    // teachers a lot", i.e. as the algorithm working.
    for (const averages of [...PLATFORMS, PERFECT_PLATFORM, NEUTRAL_PLATFORM_AVERAGES]) {
      for (const entry of rankCandidates(FIXTURES, averages)) {
        assert.ok(
          entry.score >= 0 && entry.score <= 1,
          `${entry.teacherId} scored ${entry.score} on ${JSON.stringify(averages)}`,
        );
      }
    }
  });

  it('reaches exactly 1 and exactly 0 at the two ends, and neither is an accident', () => {
    // A convex combination of six components in [0, 1] with weights summing to 1 hits
    // both ends only when every component does. Anything scoring above 1 is a component
    // that was not normalized; anything below 0 is a sign error.
    const floorPlatform = { rating: 0, resolveRate: 0, acceptRate: 0 };
    const nobody = candidate('nobody', { sessionsCount: NEW_TEACHER_SESSIONS });

    identical(scoreOf(PERFECT, PERFECT_PLATFORM), 1, 'the saturated candidate did not reach 1');
    identical(scoreOf(nobody, floorPlatform), 0, 'the empty candidate did not reach 0');
  });

  it('divides the topic rating by MAX_STARS and the two rates by nothing', () => {
    // §9.2 component by component, as three isolating comparisons. `topic_fit` at its
    // ceiling is worth its weight and no more; a resolve rate of 1 is worth its weight
    // and no more. Three components in [0, 1] and one in [1, MAX_STARS] is the single
    // most likely bug in this file.
    const topical = candidate('x', {
      sessionsCount: NEW_TEACHER_SESSIONS,
      subtopicStats: {
        ratingSum: MAX_STARS * 40,
        ratingCount: 40,
        resolvedCount: 0,
        sessionsCount: 40,
      },
    });
    const resolver = candidate('x', {
      sessionsCount: NEW_TEACHER_SESSIONS,
      resolvedCount: NEW_TEACHER_SESSIONS,
    });
    const floorPlatform = { rating: MAX_STARS, resolveRate: 0, acceptRate: 0 };

    // `topic_fit` at the ceiling: prior and record both at `MAX_STARS`, so the smoothed
    // value is `MAX_STARS` and the normalized component is 1.
    identical(
      scoreOf(topical, floorPlatform),
      MATCH_WEIGHTS.topicFit,
      'topic_fit is not normalized by MAX_STARS',
    );

    // A perfect resolve rate against a zero prior: `(n + 0) / (n + c)`, strictly under 1
    // and strictly over 0 — a rate that had been divided by `MAX_STARS` would be a fifth
    // of this, and one multiplied by it five times over.
    const resolverScore = scoreOf(resolver, floorPlatform) - MATCH_WEIGHTS.topicFit;
    const smoothedRate = NEW_TEACHER_SESSIONS / (NEW_TEACHER_SESSIONS + BAYES_C);

    identical(resolverScore, MATCH_WEIGHTS.resolveRate * smoothedRate, 'resolve_rate was rescaled');
  });
});

describe('rankCandidates — determinism and the tie-break', () => {
  const averages = NEUTRAL_PLATFORM_AVERAGES;

  it('returns the same order for the same input, twice', () => {
    const pool = [DANA, GIL, candidate('roni')];

    assert.deepEqual(rankCandidates(pool, averages), rankCandidates(pool, averages));
  });

  it('returns the same order however the pool arrived', () => {
    // The pool's order is the database's, and the database's is not stable.
    const pool = [DANA, GIL, candidate('roni'), candidate('adi', { topicStats: PARENT })];
    const expected = idsOf(pool, averages);

    assert.deepEqual(idsOf([...pool].reverse(), averages), expected);
    assert.deepEqual(idsOf([pool[2], pool[0], pool[3], pool[1]], averages), expected);
  });

  it('breaks ties on teacherId ascending', () => {
    // On a fresh database every component collapses to the prior and every candidate
    // scores identically to the last bit. Without a second key the price control and
    // "show me more teachers" both look broken.
    const tied = ['e', 'c', 'a', 'd', 'b'].map((id) => candidate(id));

    assert.deepEqual(idsOf(tied, averages), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(idsOf([...tied].reverse(), averages), ['a', 'b', 'c', 'd', 'e']);

    const scores = rankCandidates(tied, averages).map((entry) => entry.score);
    assert.equal(new Set(scores).size, 1, 'the fixtures were not actually tied');
  });

  it('puts score before the tie-break, not after it', () => {
    // `zz` outranks `aa` on merit. A sort keyed on `teacherId` first would pass every
    // other test in this block.
    const pool = [candidate('aa'), candidate('zz', { subtopicStats: LEAF })];

    assert.deepEqual(idsOf(pool, averages), ['zz', 'aa']);
  });
});

describe('rankCandidates — degenerate inputs', () => {
  it('answers for an empty pool', () => {
    assert.deepEqual(rankCandidates([], NEUTRAL_PLATFORM_AVERAGES), []);
  });

  it('returns {teacherId, score} pairs and not the candidate rows', () => {
    // So that it cannot quietly become the serializer, and so that no ranking input
    // reaches a payload by accident. §14.2: the student sees an order, not grades.
    const [first] = rankCandidates([DANA], NEUTRAL_PLATFORM_AVERAGES);

    assert.deepEqual(Object.keys(first).sort(), ['score', 'teacherId']);
  });

  it('scores a candidate whose every stat is zero and both rows are null', () => {
    const score = scoreOf(candidate('roni'), NEUTRAL_PLATFORM_AVERAGES);

    assert.equal(typeof score, 'number');
    assert.ok(Number.isFinite(score));
    assert.ok(score > 0, 'a teacher with no history is punished to zero');
  });

  it('scores a row that arrived without its columns', () => {
    // Not a shape the repository produces, but `matching.core.test.js` builds one and a
    // `NaN` score sorts unpredictably and silently — the worst failure this function
    // has. Missing counts read as zero, which is what "no history" means.
    const score = scoreOf(
      { teacherId: 'bare', subtopicStats: null, topicStats: null },
      NEUTRAL_PLATFORM_AVERAGES,
    );

    assert.ok(!Number.isNaN(score), 'a missing column produced NaN');
    assert.ok(Number.isFinite(score));
  });

  it('never produces NaN or Infinity, on the neutral prior or on an empty platform', () => {
    // `NEUTRAL_PLATFORM_AVERAGES` is what 4.3 falls back to when every denominator on the
    // platform is zero — an empty database, where it is constant across candidates and
    // therefore changes nobody's order. Assert `NaN` explicitly: it is falsy in a
    // comparison, sorts arbitrarily, and shows up as a shuffled list rather than a crash.
    const platforms = [NEUTRAL_PLATFORM_AVERAGES, { rating: 0, resolveRate: 0, acceptRate: 0 }];
    const pool = [DANA, GIL, candidate('roni'), candidate('bare-ish', { subtopicStats: PARENT })];

    for (const averages of platforms) {
      for (const entry of rankCandidates(pool, averages)) {
        assert.equal(typeof entry.score, 'number', `${entry.teacherId} did not score a number`);
        assert.ok(!Number.isNaN(entry.score), `${entry.teacherId} scored NaN`);
        assert.ok(Number.isFinite(entry.score), `${entry.teacherId} scored ${entry.score}`);
      }
    }
  });

  it('leaves the caller’s array and rows untouched', () => {
    // The caller joins this order back onto the rows it still holds. A sort in place, or
    // a component written back onto a candidate, would make that join order-dependent.
    const pool = [GIL, DANA];
    const before = JSON.stringify(pool);

    rankCandidates(pool, NEUTRAL_PLATFORM_AVERAGES);

    assert.equal(JSON.stringify(pool), before);
    assert.equal(pool[0].teacherId, 'gil');
  });
});
