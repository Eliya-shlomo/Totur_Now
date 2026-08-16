import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { NEUTRAL_PLATFORM_AVERAGES, PLATFORM_AVERAGES_CACHE_MS } from '#config/constants/index.js';

/**
 * The platform averages — MVP.md §9.3 and §9.4, PR 4.3.
 *
 * **Nothing here touches a database.** The two collaborators — the aggregate and the
 * clock — arrive through `getPlatformAverages`'s second argument, the idiom
 * `classification.service.js` established in 3.3 and `matching.candidates.service.js`
 * carried into 4.2. That is what lets this file assert the properties §9.4 is actually
 * about: that the second call inside the window issues **no query at all**, that the
 * call after the window issues one, and that a zero denominator reaches a named
 * constant rather than a `NaN`. The first two are facts about a statement that did not
 * run, and a suite against real Postgres could see the same three numbers twice without
 * ever seeing that one query produced them.
 *
 * The row-level criteria in the PR brief — a rating in the 4.0–4.8 range on the seeded
 * database, both rates strictly between 0 and 1, the `psql` cross-check and the
 * `truncate teacher_profiles cascade` run — are the manual test's, against the local
 * database. They are properties of the seed and of the aggregate query, and a fake
 * asserting them would only be asserting itself. `matching.pool.test.js` draws the same
 * line for the same reason.
 *
 * Every bound comes from `#config/constants/`, so no test can pass by agreeing with a
 * copy of a number somebody has since changed.
 */

// The service imports the repository, which imports `config/db.js`, which validates the
// environment at import time and calls `process.exit(1)` on a missing `DATABASE_URL`.
// Filling the required variables before the dynamic import keeps `npm test` runnable on
// a machine with no `.env`. Nothing here is used: both collaborators are injected.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { getPlatformAverages, clearPlatformAveragesCache } =
  await import('#services/matching.averages.service.js');

/**
 * The six sums as `aggregatePlatformAverages()` returns them — already coalesced to
 * numbers by the repository, which is why nothing below tests for `null`.
 *
 * Deliberately not round. Every ratio here is a number nobody would type by accident,
 * so a test that passed by agreeing with a hard-coded decimal would have to agree with
 * `4.483516483516484` first.
 */
const SUMS = {
  ratingSum: 2448,
  ratingCount: 546,
  resolvedCount: 421,
  sessionsCount: 552,
  offersAccepted: 552,
  offersReceived: 763,
};

/** A platform with no history at all — the state `truncate teacher_profiles` leaves. */
const EMPTY = {
  ratingSum: 0,
  ratingCount: 0,
  resolvedCount: 0,
  sessionsCount: 0,
  offersAccepted: 0,
  offersReceived: 0,
};

/**
 * An `aggregatePlatformAverages` that counts how often it was asked.
 *
 * `calls.length` is the assertion surface for the entire cache: every §9.4 property is
 * a statement about how many times this ran.
 */
function spy(...responses) {
  const calls = [];
  const queue = responses.length > 0 ? responses : [SUMS];

  return {
    calls,
    aggregate: async () => {
      calls.push(Date.now());
      const next = queue[Math.min(calls.length - 1, queue.length - 1)];

      if (next instanceof Error) throw next;

      return next;
    },
  };
}

/** A clock the test moves by hand, so proving a five-minute window costs no seconds. */
function clock(start = 1_700_000_000_000) {
  let current = start;

  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

/** The cache is module-level, so every case starts by forgetting the one before it. */
beforeEach(() => {
  clearPlatformAveragesCache();
});

describe('getPlatformAverages — the three ratios, §9.4', () => {
  it('divides the six sums into the three averages', async () => {
    const { aggregate } = spy();

    const averages = await getPlatformAverages({ aggregate, ...clock() });

    assert.equal(averages.rating, SUMS.ratingSum / SUMS.ratingCount);
    assert.equal(averages.resolveRate, SUMS.resolvedCount / SUMS.sessionsCount);
    assert.equal(averages.acceptRate, SUMS.offersAccepted / SUMS.offersReceived);
  });

  it('returns those three and nothing else', async () => {
    // The shape `rankCandidates` is typed against. A fourth key here would be a sum
    // leaking out of the repository through a function that promises averages.
    const { aggregate } = spy();

    const averages = await getPlatformAverages({ aggregate, ...clock() });

    assert.deepEqual(Object.keys(averages).sort(), ['acceptRate', 'rating', 'resolveRate']);
  });
});

describe('getPlatformAverages — the zero denominators, §9.4', () => {
  it('falls back to the neutral prior on a platform with no history at all', async () => {
    // The `truncate teacher_profiles cascade` case, and the one the brief names: all
    // three neutral, and nothing divides by zero.
    const { aggregate } = spy(EMPTY);

    const averages = await getPlatformAverages({ aggregate, ...clock() });

    assert.deepEqual(averages, NEUTRAL_PLATFORM_AVERAGES);
  });

  it('returns no NaN on an empty platform — asserted, not implied', async () => {
    // `0 / 0` is `NaN`, `NaN` compares false against everything, and a `NaN` prior would
    // make every smoothed component `NaN` and every candidate score `NaN` — which sorts
    // as "no opinion" rather than as an error. This is the criterion in the brief and it
    // is worth its own assertion rather than riding on the one above.
    const { aggregate } = spy(EMPTY);

    const averages = await getPlatformAverages({ aggregate, ...clock() });

    for (const [key, value] of Object.entries(averages)) {
      assert.ok(Number.isFinite(value), `${key} is ${value}`);
    }
  });

  it('falls back one ratio at a time, leaving the others real', async () => {
    // The state this platform is actually in on day one: teachers with ratings, and not
    // one offer sent. Neutralizing all three because one denominator is zero would throw
    // away the history the platform does have.
    const cases = [
      ['rating', { ...SUMS, ratingSum: 0, ratingCount: 0 }],
      ['resolveRate', { ...SUMS, resolvedCount: 0, sessionsCount: 0 }],
      ['acceptRate', { ...SUMS, offersAccepted: 0, offersReceived: 0 }],
    ];

    for (const [key, sums] of cases) {
      clearPlatformAveragesCache();
      const { aggregate } = spy(sums);

      const averages = await getPlatformAverages({ aggregate, ...clock() });

      assert.equal(averages[key], NEUTRAL_PLATFORM_AVERAGES[key]);

      for (const other of Object.keys(averages)) {
        if (other !== key) {
          assert.notEqual(
            averages[other],
            NEUTRAL_PLATFORM_AVERAGES[other],
            `${other} went neutral`,
          );
        }
      }
    }
  });

  it('does not treat a zero numerator as a missing denominator', async () => {
    // A platform that has run sessions and resolved none of them has a resolve rate, and
    // it is 0. `0` and "we do not know" are different facts, and only the second one is
    // the neutral prior — a `!numerator` guard would report the platform as average when
    // it is failing.
    const { aggregate } = spy({ ...SUMS, resolvedCount: 0 });

    const averages = await getPlatformAverages({ aggregate, ...clock() });

    assert.equal(averages.resolveRate, 0);
  });

  it('treats a negative denominator as no denominator', async () => {
    // The six columns are `Int @default(0)` and none of them can go negative, so this is
    // corruption rather than a rate — and `-3 / -7` is a perfectly finite number that
    // would rank every teacher against a lie. The guard is `> 0` and this is why.
    const { aggregate } = spy({ ...SUMS, ratingSum: -3, ratingCount: -7 });

    const averages = await getPlatformAverages({ aggregate, ...clock() });

    assert.equal(averages.rating, NEUTRAL_PLATFORM_AVERAGES.rating);
  });
});

describe('getPlatformAverages — the five-minute cache, §9.4', () => {
  it('issues one aggregate for two calls inside the window', async () => {
    // The property the whole cache exists for: this aggregate scans every teacher on
    // every match request, including every press of the price control.
    const { calls, aggregate } = spy();
    const time = clock();

    await getPlatformAverages({ aggregate, ...time });
    await getPlatformAverages({ aggregate, ...time });

    assert.equal(calls.length, 1);
  });

  it('serves the cached numbers even when the database has moved on', async () => {
    // The manual test's step 2, as a unit test: bump a teacher's `rating_sum` in `psql`
    // and the old value comes back until the window closes. That is the staleness §9.4
    // buys deliberately, so it is pinned rather than left as a surprise.
    const moved = { ...SUMS, ratingSum: SUMS.ratingSum + 100 };
    const { calls, aggregate } = spy(SUMS, moved);
    const time = clock();

    const first = await getPlatformAverages({ aggregate, ...time });
    const second = await getPlatformAverages({ aggregate, ...time });

    assert.equal(second.rating, first.rating);
    assert.equal(calls.length, 1);
  });

  it('holds the entry to the last millisecond of the window and not past it', async () => {
    // Asserted on both sides of the boundary rather than at a comfortable distance,
    // because "expires after five minutes" and "expires after four" both pass a test
    // that only ever advances the clock by an hour. The window comes from the barrel.
    const { calls, aggregate } = spy();
    const time = clock();

    await getPlatformAverages({ aggregate, ...time });

    time.advance(PLATFORM_AVERAGES_CACHE_MS - 1);
    await getPlatformAverages({ aggregate, ...time });
    assert.equal(calls.length, 1);

    time.advance(1);
    await getPlatformAverages({ aggregate, ...time });
    assert.equal(calls.length, 2);
  });

  it('reads the database again after clearPlatformAveragesCache()', async () => {
    // The escape hatch, and the reason it is exported: without it no test can assert
    // anything about this cache twice in one process, and 4.8's checklist would have to
    // restart the server to see a number it just changed.
    const { calls, aggregate } = spy();
    const time = clock();

    await getPlatformAverages({ aggregate, ...time });
    clearPlatformAveragesCache();
    await getPlatformAverages({ aggregate, ...time });

    assert.equal(calls.length, 2);
  });

  it('collapses two concurrent cold callers into one aggregate', async () => {
    // The cache holds the promise and not the resolved value, which is a choice and is
    // documented in the service header. A value cache is only populated once the first
    // call has *finished*, so two requests arriving together would each fire their own
    // scan — precisely when the platform is busiest. This is that choice, asserted.
    const { calls, aggregate } = spy();
    const time = clock();

    const [first, second] = await Promise.all([
      getPlatformAverages({ aggregate, ...time }),
      getPlatformAverages({ aggregate, ...time }),
    ]);

    assert.equal(calls.length, 1);
    assert.deepEqual(first, second);
  });
});

describe('getPlatformAverages — when the aggregate fails', () => {
  it('does not cache a rejection for five minutes', async () => {
    // The cost of caching the promise, paid back here. Without the eviction one dropped
    // connection would be replayed — as a rejection — to every match request until the
    // window closed, and the platform would stay broken long after the database came
    // back.
    const { calls, aggregate } = spy(new Error('connection terminated'), SUMS);
    const time = clock();

    await assert.rejects(() => getPlatformAverages({ aggregate, ...time }));

    const averages = await getPlatformAverages({ aggregate, ...time });

    assert.equal(calls.length, 2);
    assert.equal(averages.rating, SUMS.ratingSum / SUMS.ratingCount);
  });

  it('reports the failure rather than answering with the neutral prior', async () => {
    // `NEUTRAL_PLATFORM_AVERAGES` is what an *empty* platform looks like, not what a
    // broken query looks like. Swallowing this would hand 4.6 a plausible prior built on
    // nothing, and the match list would look fine while being sorted against a guess.
    const { aggregate } = spy(new Error('connection terminated'));

    await assert.rejects(() => getPlatformAverages({ aggregate, ...clock() }), {
      message: 'connection terminated',
    });
  });
});
