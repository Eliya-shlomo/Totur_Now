import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_PRICE_PER_BLOCK,
  MIN_PRICE_PER_BLOCK,
  OPENING_BLOCKS,
  PRICE_BANDS,
  TEACHING_LEVELS,
} from '#config/constants/index.js';
import { ERROR_CODES } from '#config/errors/codes.js';

/**
 * The candidate pool — MVP.md §9.1, PR 4.2.
 *
 * **Nothing here touches a database.** The one collaborator, `findCandidates`, arrives
 * through `resolveCandidatePool`'s second argument — the idiom
 * `classification.service.js` established in 3.3 — and that is what lets this file
 * assert the properties the brief actually names: that a student who can afford
 * nobody produces **no candidate query at all**, and that an empty `rejected_by` is
 * passed as `undefined` rather than as `[]`. Both are facts about the call, and a
 * suite running against real Postgres could observe an empty list but never the
 * absence of the statement that would have produced it.
 *
 * The row-level criteria in the PR brief — three teachers on the seed, the sibling
 * leaf, the legacy parent rows changing no result, the statement count at 3 and at 30
 * candidates, the `EXPLAIN` plan — are the manual test's, against the local database.
 * They are properties of a Prisma `where` and of Postgres, and a fake asserting them
 * would only be asserting itself. `question.intake.test.js` draws the same line for
 * the same reason.
 *
 * Every bound comes from `#config/constants/`, so no test can pass by agreeing with a
 * copy of a number somebody has since changed.
 */

// The service imports `config/db.js` transitively, which validates the environment at
// import time and calls `process.exit(1)` on a missing `DATABASE_URL`. Filling the
// required variables before the dynamic import keeps `npm test` runnable on a machine
// with no `.env`. Nothing here is used: the only collaborator is injected.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { resolveCandidatePool } = await import('#services/matching.candidates.service.js');

const TEACHER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_TEACHER_ID = '66666666-6666-4666-8666-666666666666';

/** The taxonomy shape every case below uses: one parent, one leaf under it. */
const TOPIC_ID = 9;
const SUBTOPIC_ID = 91;

/** The seed's `avi.student` — comfortable at every price on the platform. */
const COMFORTABLE = MAX_PRICE_PER_BLOCK * OPENING_BLOCKS;

/** Enough of a `MatchCandidate` for a caller that only counts them. */
const candidate = (teacherId) => ({ teacherId });

/**
 * A classified question, as `MATCHING_QUESTION_VIEW` returns one. Overrides are the
 * point of every case below — the nulls are what §9.1 has to survive.
 */
const question = (overrides = {}) => ({
  topicId: TOPIC_ID,
  subtopicId: SUBTOPIC_ID,
  estimatedLevel: 5,
  declaredLevel: 4,
  rejectedBy: [],
  ...overrides,
});

/**
 * A `findCandidates` that records what it was asked for and answers with `pool`.
 *
 * `calls` is the assertion surface for everything §9.1 resolves before the query, and
 * its length is the assertion surface for the branch that must not run one.
 */
function spy(pool = [candidate(TEACHER_ID)]) {
  const calls = [];

  return {
    calls,
    deps: {
      findCandidates: async (filters) => {
        calls.push(filters);
        return pool;
      },
    },
  };
}

describe('resolveCandidatePool — the level filter, §9.1 and the sentinel', () => {
  it('filters on the estimated level when the classifier produced one', async () => {
    const { calls, deps } = spy();

    await resolveCandidatePool(
      { question: question({ estimatedLevel: 5, declaredLevel: 4 }), walletBalance: COMFORTABLE },
      deps,
    );

    assert.equal(calls[0].requiredLevel, 5);
  });

  it('falls back to the declared level, not to the floor, when the estimate is null', async () => {
    // The student's own claim is on the question row for exactly this reason — E3
    // stored it per question rather than reading a mutable profile. Filtering at the
    // floor here would widen the pool on a question we know something about.
    const { calls, deps } = spy();

    await resolveCandidatePool(
      {
        question: question({ estimatedLevel: null, declaredLevel: 4 }),
        walletBalance: COMFORTABLE,
      },
      deps,
    );

    assert.equal(calls[0].requiredLevel, 4);
  });

  it('falls back to the lowest teaching level when both are null, and never to null', async () => {
    // `level_max >= NULL` is NULL, which excludes everybody. An unclassifiable
    // question must narrow the pool by price and availability and by nothing else.
    const { calls, deps } = spy();

    await resolveCandidatePool(
      {
        question: question({ estimatedLevel: null, declaredLevel: null }),
        walletBalance: COMFORTABLE,
      },
      deps,
    );

    assert.equal(calls[0].requiredLevel, Math.min(...TEACHING_LEVELS));
  });

  it('passes the sentinel question through untouched, nulls and all', async () => {
    // `topic_id = 0`, `subtopic_id` null, `estimated_level` null — E3's fallback path
    // writes exactly this shape and it is a legal input, not an edge case. The service
    // resolves the level and hands the repository the nulls; skipping the topic filter
    // is the repository's half of the rule.
    const { calls, deps } = spy();

    await resolveCandidatePool(
      {
        question: question({ topicId: 0, subtopicId: null, estimatedLevel: null }),
        walletBalance: COMFORTABLE,
      },
      deps,
    );

    assert.equal(calls[0].topicId, 0);
    assert.equal(calls[0].subtopicId, null);
  });
});

describe('resolveCandidatePool — the price ceiling, §9.1 and §5.2', () => {
  it('is the band ceiling when the balance affords more than the band allows', async () => {
    const { calls, deps } = spy();

    const pool = await resolveCandidatePool(
      { question: question(), walletBalance: COMFORTABLE, priceBand: 'A' },
      deps,
    );

    assert.equal(pool.priceCeiling, PRICE_BANDS.A.maxPrice);
    assert.equal(calls[0].maxPrice, PRICE_BANDS.A.maxPrice);
  });

  it('is what the balance affords when that is lower than the band', async () => {
    // The seed's `noya.student`: 24 credits, no band, so the ceiling is the wallet's
    // alone. The arithmetic is asserted against the constant, never against a 12
    // somebody typed here.
    const balance = 24;
    const { calls, deps } = spy();

    const pool = await resolveCandidatePool({ question: question(), walletBalance: balance }, deps);

    assert.equal(pool.priceCeiling, Math.floor(balance / OPENING_BLOCKS));
    assert.equal(calls[0].maxPrice, pool.priceCeiling);
  });

  it('means no band ceiling when the band is absent, rather than no results', async () => {
    // `bandCeiling(undefined)` answers `MAX_PRICE_PER_BLOCK` so a student who never
    // touched the filter sees every teacher they can afford.
    const { deps } = spy();

    const pool = await resolveCandidatePool(
      { question: question(), walletBalance: COMFORTABLE },
      deps,
    );

    assert.equal(pool.priceCeiling, MAX_PRICE_PER_BLOCK);
  });

  it('rounds a balance down to whole credits — an opening block is two blocks', async () => {
    // An odd balance buys no fraction of a teacher. `OPENING_BLOCKS` is §5.1's, and
    // §9.1's `* 2` is this constant rather than a literal.
    const balance = MIN_PRICE_PER_BLOCK * OPENING_BLOCKS + 1;
    const { deps } = spy();

    const pool = await resolveCandidatePool({ question: question(), walletBalance: balance }, deps);

    assert.equal(pool.priceCeiling, MIN_PRICE_PER_BLOCK);
  });

  it('expresses the wallet rule once, as a ceiling, and not again as a per-row filter', async () => {
    // §9.1 writes `wallet_balance >= price_per_block * 2` per row. Folded into the
    // ceiling it is one integer computed before the query — and the repository is
    // handed a price bound and no balance at all. Two spellings of one rule is the
    // defect class E2 shipped three of.
    const { calls, deps } = spy();

    await resolveCandidatePool({ question: question(), walletBalance: 40 }, deps);

    assert.deepEqual(Object.keys(calls[0]).sort(), [
      'excludeTeacherIds',
      'maxPrice',
      'requiredLevel',
      'subtopicId',
      'topicId',
    ]);
  });
});

describe('resolveCandidatePool — the two empty pools, §9.4', () => {
  it('answers INSUFFICIENT_CREDIT without running a candidate query at all', async () => {
    // The seeded `ido.student` at 0 credits. No price in §5.2's range clears the
    // balance, so the query has a knowable empty answer — this is the assertion that
    // it is never asked, and it is the reason the collaborator is injected.
    const { calls, deps } = spy();

    const pool = await resolveCandidatePool({ question: question(), walletBalance: 0 }, deps);

    assert.equal(pool.reason, ERROR_CODES.INSUFFICIENT_CREDIT);
    assert.deepEqual(pool.candidates, []);
    assert.equal(calls.length, 0);
  });

  it('short-circuits one credit below the cheapest opening block, and not one above', async () => {
    // The boundary is `MIN_PRICE_PER_BLOCK`, so it is asserted on both sides of it
    // rather than at a comfortable distance.
    const cheapest = MIN_PRICE_PER_BLOCK * OPENING_BLOCKS;
    const below = spy();
    const exactly = spy();

    const short = await resolveCandidatePool(
      { question: question(), walletBalance: cheapest - 1 },
      below.deps,
    );
    const enough = await resolveCandidatePool(
      { question: question(), walletBalance: cheapest },
      exactly.deps,
    );

    assert.equal(short.reason, ERROR_CODES.INSUFFICIENT_CREDIT);
    assert.equal(below.calls.length, 0);
    assert.equal(enough.reason, null);
    assert.equal(exactly.calls.length, 1);
  });

  it('treats a missing wallet row as no credit rather than as free credit', async () => {
    // `findWalletBalance` answers `null` and not `0` when the row is absent, and says
    // the caller decides what that means. This is that decision: you can afford
    // nothing either way, and the alternative is `NaN` reaching a `where`.
    for (const walletBalance of [null, undefined]) {
      const { calls, deps } = spy();

      const pool = await resolveCandidatePool({ question: question(), walletBalance }, deps);

      assert.equal(pool.reason, ERROR_CODES.INSUFFICIENT_CREDIT);
      assert.equal(calls.length, 0);
    }
  });

  it('still reports the ceiling when the student cannot afford anybody', async () => {
    // It is what lets the empty state say *how short* they are, which is the whole
    // argument for the wallet rule being a ceiling.
    const { deps } = spy();

    const pool = await resolveCandidatePool({ question: question(), walletBalance: 4 }, deps);

    assert.equal(pool.priceCeiling, Math.floor(4 / OPENING_BLOCKS));
  });

  it('answers NO_AVAILABLE_TEACHERS when the query ran and found nobody', async () => {
    // The other empty pool, and a different sentence to a student: nobody who teaches
    // this is online right now, and only the other one ends in a top-up link.
    const { deps } = spy([]);

    const pool = await resolveCandidatePool(
      { question: question(), walletBalance: COMFORTABLE, priceBand: 'A' },
      deps,
    );

    assert.equal(pool.reason, ERROR_CODES.NO_AVAILABLE_TEACHERS);
    assert.deepEqual(pool.candidates, []);
  });

  it('reports no reason at all when the pool is not empty', async () => {
    const { deps } = spy([candidate(TEACHER_ID), candidate(OTHER_TEACHER_ID)]);

    const pool = await resolveCandidatePool(
      { question: question(), walletBalance: COMFORTABLE },
      deps,
    );

    assert.equal(pool.reason, null);
    assert.equal(pool.candidates.length, 2);
  });

  it('neither empty pool is thrown', async () => {
    // Both codes are in `shared/errorCodes.js` and this epic throws neither, exactly
    // as E3 never threw `LLM_FAILED`. §9.4's own pseudocode returns a reason, and a
    // 402 or a 409 would make the screen show an error for the product working as
    // designed. When this test fails, read that sentence before "fixing" it.
    await assert.doesNotReject(() =>
      resolveCandidatePool({ question: question(), walletBalance: 0 }, spy().deps),
    );
    await assert.doesNotReject(() =>
      resolveCandidatePool({ question: question(), walletBalance: COMFORTABLE }, spy([]).deps),
    );
  });
});

describe('resolveCandidatePool — rejected_by, §9.1 and §7', () => {
  it('passes an empty rejection list as undefined and never as []', async () => {
    // Every question in the database carries `'{}'` and will until E5 writes the first
    // rejected offer. An exclusion list with nothing in it belongs out of the query
    // rather than in it and empty — `undefined` is the value Prisma drops the key for.
    const { calls, deps } = spy();

    await resolveCandidatePool(
      { question: question({ rejectedBy: [] }), walletBalance: COMFORTABLE },
      deps,
    );

    assert.equal(calls[0].excludeTeacherIds, undefined);
  });

  it('passes the ids through when a teacher has rejected the question', async () => {
    const { calls, deps } = spy();

    await resolveCandidatePool(
      { question: question({ rejectedBy: [TEACHER_ID] }), walletBalance: COMFORTABLE },
      deps,
    );

    assert.deepEqual(calls[0].excludeTeacherIds, [TEACHER_ID]);
  });
});

describe('resolveCandidatePool — what the pool is not', () => {
  it('returns the candidate rows in the order they arrived, ranking nothing', async () => {
    // §9.5 is explicit that availability and price are filters and quality is scoring.
    // A sort here would be a second opinion about order, in DEV-A's file, against
    // DEV-B's seam.
    const pool = [candidate('c'), candidate('a'), candidate('b')];
    const { deps } = spy(pool);

    const resolved = await resolveCandidatePool(
      { question: question(), walletBalance: COMFORTABLE },
      deps,
    );

    assert.deepEqual(
      resolved.candidates.map((row) => row.teacherId),
      ['c', 'a', 'b'],
    );
  });

  it('does not slice to MATCH_COUNT — that is the endpoint’s, after ranking', async () => {
    const pool = Array.from({ length: 12 }, (_, index) => candidate(`teacher-${index}`));
    const { deps } = spy(pool);

    const resolved = await resolveCandidatePool(
      { question: question(), walletBalance: COMFORTABLE },
      deps,
    );

    assert.equal(resolved.candidates.length, pool.length);
  });
});
