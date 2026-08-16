import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MATCH_COUNT } from '#config/constants/index.js';
import { ERROR_CODES } from '#config/errors/codes.js';

/**
 * The matches endpoint's service — MVP.md §9 and §12, PR 4.5.
 *
 * **Nothing here touches a database.** All five collaborators arrive through
 * `getQuestionMatches`'s second argument — the idiom `classification.service.js`
 * established in 3.3 — and that is what lets this file assert the properties the brief
 * actually names: that an empty pool reaches **neither the platform aggregate nor the
 * history read**, that a stranger's question is `NOT_FOUND` before any wallet is read,
 * and that no request ever produces a second averages call. Every one of those is a
 * fact about a call that did not happen, which a suite running against real Postgres
 * can never see.
 *
 * **`rankCandidates` is not injected, on purpose.** It is the seam's one stub, and
 * stubbing it a second time here is what 4.1, 4.3 and 4.5's brief each forbid by name.
 * It is pure and its order is deterministic — `teacherId` ascending — so the order
 * assertions below sort the ids they were given rather than hardcoding a list, and
 * they stay true when 4.6 replaces the body with §9.2's six components.
 *
 * The row-level criteria in the brief — three teachers on the seed, `priceCeiling: 20`
 * for `avi.student`, a hand-written `reviews` row flipping one badge, the statement
 * count under `DEBUG=prisma:query` — are the manual test's, against the local
 * database. They are properties of a Prisma `where` and of Postgres, and a fake
 * asserting them would only be asserting itself. `matching.pool.test.js` draws the
 * same line for the same reason.
 *
 * `MATCH_COUNT` is imported, never typed. A test that wrote `5` would pass for the
 * wrong reason the day somebody tunes it.
 */

// The service imports `config/db.js` transitively, which validates the environment at
// import time and calls `process.exit(1)` on a missing `DATABASE_URL`. Filling the
// required variables before the dynamic import keeps `npm test` runnable on a machine
// with no `.env`. Nothing here is used: every collaborator is injected.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { getQuestionMatches } = await import('#services/matching.service.js');
const { toTeacherCard } = await import('#utils/teacherView.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '33333333-3333-4333-8333-333333333333';

/** The taxonomy shape every case below uses: one parent, one leaf under it. */
const TOPIC_ID = 9;
const SUBTOPIC_ID = 91;

/** A comfortable balance and the ceiling 4.2 would have resolved from it. */
const WALLET_BALANCE = 120;
const PRICE_CEILING = 20;

/** Ids are ordered so that "the scorer's order" is visibly not "the pool's order". */
const teacherId = (n) =>
  `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;

/**
 * A `MATCHING_QUESTION_VIEW` row — owned by `STUDENT_ID`, session `PENDING`.
 * The overrides are the point of the refusal cases below.
 */
const question = (overrides = {}) => ({
  id: QUESTION_ID,
  studentId: STUDENT_ID,
  topicId: TOPIC_ID,
  subtopicId: SUBTOPIC_ID,
  estimatedLevel: 5,
  declaredLevel: 4,
  rejectedBy: [],
  session: { id: 'session-1', status: 'PENDING' },
  ...overrides,
});

/**
 * A `findCandidates` row: `TEACHER_VIEW`'s columns plus the ranking inputs.
 *
 * Written out in full rather than trimmed to what the assertions read, because two of
 * them are about what the serializer *does not* emit — `ratingSum`, `offersReceived`
 * and `status` are on every real row and must appear in no payload.
 */
const candidate = (id, overrides = {}) => ({
  userId: id,
  teacherId: id,
  bio: 'Ten years of calculus.',
  pricePerBlock: 16,
  levelMax: 5,
  status: 'ONLINE',
  sessionsCount: 40,
  resolvedCount: 36,
  ratingSum: 184,
  ratingCount: 40,
  offersReceived: 50,
  offersAccepted: 45,
  user: { fullName: 'Dana Levi' },
  topics: [{ topic: { id: SUBTOPIC_ID, slug: 'integration-by-parts', nameHe: 'x', nameEn: 'y' } }],
  subtopicStats: { ratingSum: 46, ratingCount: 10, resolvedCount: 11.4, sessionsCount: 12.6 },
  topicStats: { ratingSum: 90, ratingCount: 20, resolvedCount: 22, sessionsCount: 25 },
  ...overrides,
});

/**
 * The five collaborators, each recording that it was called.
 *
 * `calls` is the assertion surface for everything the brief states as an ordering
 * rule: which reads happen before a refusal, and which do not happen at all once the
 * pool is known to be empty.
 */
function spies({
  questionRow = question(),
  pool = {},
  balance = WALLET_BALANCE,
  history = [],
} = {}) {
  const calls = {
    findQuestion: [],
    findBalance: [],
    resolvePool: [],
    loadAverages: [],
    findPositiveHistory: [],
  };

  const deps = {
    findQuestion: async (id) => {
      calls.findQuestion.push(id);
      return questionRow;
    },
    findBalance: async (id) => {
      calls.findBalance.push(id);
      return balance;
    },
    resolvePool: async (input) => {
      calls.resolvePool.push(input);
      return { candidates: [], priceCeiling: PRICE_CEILING, reason: null, ...pool };
    },
    loadAverages: async () => {
      calls.loadAverages.push(true);
      return { rating: 4.2, resolveRate: 0.8, acceptRate: 0.6 };
    },
    findPositiveHistory: async (id) => {
      calls.findPositiveHistory.push(id);
      return history;
    },
  };

  return { calls, deps };
}

/** The request every case makes unless it is testing the arguments themselves. */
const request = (overrides = {}) => ({
  questionId: QUESTION_ID,
  studentId: STUDENT_ID,
  ...overrides,
});

/** Every key in a payload, however deeply nested — the leak sweep's input. */
function deepKeys(value, found = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => deepKeys(item, found));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      deepKeys(nested, found);
    }
  }

  return found;
}

describe('getQuestionMatches — ownership (§12, 3.5’s rule)', () => {
  it('answers NOT_FOUND for a question that does not exist, and reads nothing else', async () => {
    // The refusal is first for a reason: a caller who does not own the row should not
    // cost a wallet read, and should not learn from timing that one happened.
    const { calls, deps } = spies({ questionRow: null });

    await assert.rejects(getQuestionMatches(request(), deps), (error) => {
      assert.equal(error.code, ERROR_CODES.NOT_FOUND);
      assert.equal(error.statusCode, 404);
      return true;
    });

    assert.equal(calls.findBalance.length, 0);
    assert.equal(calls.resolvePool.length, 0);
  });

  it('answers NOT_FOUND — never FORBIDDEN — for another student’s question', async () => {
    // FORBIDDEN would confirm the id exists. The message must be the one a missing
    // question gets, or the distinction is back in the response body.
    const { calls, deps } = spies({ questionRow: question({ studentId: OTHER_STUDENT_ID }) });
    const missing = spies({ questionRow: null });

    const stranger = await getQuestionMatches(request(), deps).catch((error) => error);
    const absent = await getQuestionMatches(request(), missing.deps).catch((error) => error);

    assert.equal(stranger.code, ERROR_CODES.NOT_FOUND);
    assert.notEqual(stranger.code, ERROR_CODES.FORBIDDEN);
    assert.equal(stranger.message, absent.message);
    assert.equal(calls.resolvePool.length, 0);
  });
});

describe('getQuestionMatches — the session guard (§9.5)', () => {
  it('refuses a session that has left PENDING with SESSION_NOT_ACTIVE, 409', async () => {
    // Once an offer is out, a fresh list is a way to double-book a student. 409 comes
    // from the code's own entry in ERROR_STATUS, never from a number typed at a throw.
    const { calls, deps } = spies({
      questionRow: question({ session: { id: 's', status: 'OFFER_SENT' } }),
    });

    await assert.rejects(getQuestionMatches(request(), deps), (error) => {
      assert.equal(error.code, ERROR_CODES.SESSION_NOT_ACTIVE);
      assert.equal(error.statusCode, 409);
      return true;
    });

    assert.equal(calls.findBalance.length, 0);
  });

  it('refuses a question whose session row is missing', async () => {
    // There is nothing left to match, and inventing a default for a row that must
    // exist would hide a bug rather than report one.
    const { deps } = spies({ questionRow: question({ session: null }) });

    await assert.rejects(getQuestionMatches(request(), deps), {
      code: ERROR_CODES.SESSION_NOT_ACTIVE,
    });
  });
});

describe('getQuestionMatches — the two empty answers (§9.4)', () => {
  it('returns INSUFFICIENT_CREDIT as a 200 payload, and reaches neither the prior nor the history', async () => {
    // The brief's own criterion, and the reason the collaborators are injected: both
    // reads are wasted work for a student who cannot afford anybody. Their absence is
    // not observable against a real database.
    const { calls, deps } = spies({
      pool: { candidates: [], priceCeiling: 0, reason: ERROR_CODES.INSUFFICIENT_CREDIT },
    });

    const payload = await getQuestionMatches(request(), deps);

    assert.deepEqual(payload, {
      teachers: [],
      reason: ERROR_CODES.INSUFFICIENT_CREDIT,
      priceCeiling: 0,
      walletBalance: WALLET_BALANCE,
    });
    assert.equal(calls.loadAverages.length, 0);
    assert.equal(calls.findPositiveHistory.length, 0);
  });

  it('returns NO_AVAILABLE_TEACHERS as a 200 payload and never throws it', async () => {
    // This endpoint does not raise the code, exactly as E3 never threw LLM_FAILED. An
    // empty list is a state the screen renders; a 409 would show an error for the
    // product working as designed.
    const { calls, deps } = spies({
      pool: { candidates: [], reason: ERROR_CODES.NO_AVAILABLE_TEACHERS },
    });

    const payload = await getQuestionMatches(request(), deps);

    assert.deepEqual(payload.teachers, []);
    assert.equal(payload.reason, ERROR_CODES.NO_AVAILABLE_TEACHERS);
    assert.equal(payload.priceCeiling, PRICE_CEILING);
    assert.equal(calls.loadAverages.length, 0);
  });

  it('reports the ceiling and the balance in both empty states', async () => {
    // "How short am I" is the only useful thing an empty selection screen can say, and
    // it needs both numbers.
    const { deps } = spies({
      pool: { candidates: [], priceCeiling: 4, reason: ERROR_CODES.INSUFFICIENT_CREDIT },
      balance: 8,
    });

    const payload = await getQuestionMatches(request(), deps);

    assert.equal(payload.priceCeiling, 4);
    assert.equal(payload.walletBalance, 8);
  });
});

describe('getQuestionMatches — what the pool is asked for', () => {
  it('passes the question, the balance and the band through untouched', async () => {
    // The band is the student's, forwarded verbatim: an absent one means no ceiling and
    // `bandCeiling(undefined)` already answers that, so nothing here defaults it.
    const questionRow = question();
    const { calls, deps } = spies({ questionRow });

    await getQuestionMatches(request({ priceBand: 'A' }), deps);

    assert.deepEqual(calls.resolvePool[0], {
      question: questionRow,
      walletBalance: WALLET_BALANCE,
      priceBand: 'A',
    });
  });

  it('forwards an absent band as undefined rather than a default', async () => {
    const { calls, deps } = spies();

    await getQuestionMatches(request(), deps);

    assert.equal(calls.resolvePool[0].priceBand, undefined);
    assert.ok('priceBand' in calls.resolvePool[0]);
  });

  it('reads a missing wallet row as zero, in the pool and in the payload', async () => {
    // `findWalletBalance` reports `null` rather than flattening it, so the product
    // reading is made here — once, so the number 4.2 filters on is the number the
    // response reports.
    const { calls, deps } = spies({
      balance: null,
      pool: { candidates: [], reason: ERROR_CODES.INSUFFICIENT_CREDIT, priceCeiling: 0 },
    });

    const payload = await getQuestionMatches(request(), deps);

    assert.equal(calls.resolvePool[0].walletBalance, 0);
    assert.equal(payload.walletBalance, 0);
  });
});

describe('getQuestionMatches — the ranked list', () => {
  it('returns the scorer’s order, not the pool’s', async () => {
    // The stub orders by teacherId ascending. The expectation is computed from the ids
    // this case made up rather than written out, so it survives 4.6 replacing the body.
    const ids = [teacherId(7), teacherId(3), teacherId(5)];
    const { deps } = spies({ pool: { candidates: ids.map((id) => candidate(id)) } });

    const payload = await getQuestionMatches(request(), deps);

    assert.deepEqual(
      payload.teachers.map((match) => match.teacher.id),
      [...ids].sort(),
    );
    assert.equal(payload.reason, null);
  });

  it('never returns more than MATCH_COUNT teachers', async () => {
    const ids = Array.from({ length: MATCH_COUNT + 2 }, (_, index) => teacherId(index + 1));
    const { deps } = spies({ pool: { candidates: ids.map((id) => candidate(id)) } });

    const payload = await getQuestionMatches(request(), deps);

    assert.equal(payload.teachers.length, MATCH_COUNT);
  });

  it('is deterministic — two identical calls, the same teachers in the same order', async () => {
    // On a fresh database every candidate scores identically, and a nondeterministic
    // sort would make the price control and "show me more teachers" both look broken.
    const ids = [teacherId(4), teacherId(9), teacherId(1)];
    const { deps } = spies({ pool: { candidates: ids.map((id) => candidate(id)) } });

    const first = await getQuestionMatches(request(), deps);
    const second = await getQuestionMatches(request(), deps);

    assert.deepEqual(first, second);
  });

  it('reads the platform averages once per request', async () => {
    const { calls, deps } = spies({ pool: { candidates: [candidate(teacherId(2))] } });

    await getQuestionMatches(request(), deps);

    assert.equal(calls.loadAverages.length, 1);
    assert.equal(calls.findPositiveHistory.length, 1);
    assert.equal(calls.findPositiveHistory[0], STUDENT_ID);
  });
});

describe('getQuestionMatches — studiedWith (§9.2, §14.2)', () => {
  it('flags exactly the teachers this student has rated well', async () => {
    const known = teacherId(2);
    const stranger = teacherId(8);
    const { deps } = spies({
      pool: { candidates: [candidate(known), candidate(stranger)] },
      history: [known],
    });

    const payload = await getQuestionMatches(request(), deps);
    const byId = new Map(payload.teachers.map((match) => [match.teacher.id, match]));

    assert.equal(byId.get(known).studiedWith, true);
    assert.equal(byId.get(stranger).studiedWith, false);
  });

  it('emits false and never undefined when the student has no history at all', async () => {
    // The seam types the flag `boolean`, and a scorer weighing `undefined` would score
    // a teacher this student has simply never met as NaN.
    const { deps } = spies({ pool: { candidates: [candidate(teacherId(6))] }, history: [] });

    const payload = await getQuestionMatches(request(), deps);

    assert.equal(payload.teachers[0].studiedWith, false);
  });
});

describe('matchView — the card and the three extra fields', () => {
  it('emits E2’s card, field for field', async () => {
    // `toTeacherCard` imported and not forked: a hand-built card here would be the
    // second definition of a teacher, which is the defect class E2 shipped three of.
    const row = candidate(teacherId(2));
    const { deps } = spies({ pool: { candidates: [row] } });

    const payload = await getQuestionMatches(request(), deps);

    assert.deepEqual(payload.teachers[0].teacher, toTeacherCard(row));
    assert.equal(Object.keys(payload.teachers[0].teacher).length, 10);
  });

  it('rounds subtopic sessions for display and computes the rate from the raw pair', async () => {
    // The column is NUMERIC(8,2) because of the 0.3 parent propagation. "Solved 12.6
    // questions" is not a card; a rate rounded to match it would be a different number
    // than the teacher earned.
    const row = candidate(teacherId(2), {
      subtopicStats: { ratingSum: 0, ratingCount: 0, resolvedCount: 11.4, sessionsCount: 12.6 },
    });
    const { deps } = spies({ pool: { candidates: [row] } });

    const payload = await getQuestionMatches(request(), deps);

    assert.equal(payload.teachers[0].subtopicSessions, 13);
    assert.equal(payload.teachers[0].subtopicResolveRate, 11.4 / 12.6);
  });

  it('gives a teacher with no history in the subtopic 0 sessions and a null rate', async () => {
    // Null, never 0. "Resolved nothing" and "has not been asked yet" are different
    // claims, and 4.7 renders them differently.
    const { deps } = spies({
      pool: { candidates: [candidate(teacherId(2), { subtopicStats: null })] },
    });

    const payload = await getQuestionMatches(request(), deps);

    assert.equal(payload.teachers[0].subtopicSessions, 0);
    assert.equal(payload.teachers[0].subtopicResolveRate, null);
    assert.notEqual(payload.teachers[0].subtopicResolveRate, 0);
  });

  it('gives a zeroed stats row a null rate rather than dividing by zero', async () => {
    const row = candidate(teacherId(2), {
      subtopicStats: { ratingSum: 0, ratingCount: 0, resolvedCount: 0, sessionsCount: 0 },
    });
    const { deps } = spies({ pool: { candidates: [row] } });

    const payload = await getQuestionMatches(request(), deps);

    assert.equal(payload.teachers[0].subtopicResolveRate, null);
  });
});

describe('matchView — what never leaves the server', () => {
  it('carries no score, no rank, and no column a card does not have', async () => {
    // §14.2: the student sees an order, not grades. The score is destructured away at
    // the join and is never handed to the serializer; the ranking inputs on the row —
    // the offer counters, the rating pair, the stats — reach no payload either.
    const { deps } = spies({
      pool: { candidates: [candidate(teacherId(2)), candidate(teacherId(4))] },
      history: [teacherId(2)],
    });

    const payload = await getQuestionMatches(request(), deps);
    const keys = deepKeys(payload);

    for (const forbidden of [
      'score',
      'rank',
      'ratingSum',
      'offersReceived',
      'offersAccepted',
      'email',
      'status',
      'userId',
      'teacherId',
      'hasPositiveHistory',
      'subtopicStats',
      'topicStats',
    ]) {
      assert.ok(!keys.has(forbidden), `${forbidden} reached the payload`);
    }
  });

  it('answers the four contract keys and nothing else', async () => {
    const { deps } = spies({ pool: { candidates: [candidate(teacherId(2))] } });

    const payload = await getQuestionMatches(request(), deps);

    assert.deepEqual(Object.keys(payload).sort(), [
      'priceCeiling',
      'reason',
      'teachers',
      'walletBalance',
    ]);
    assert.deepEqual(Object.keys(payload.teachers[0]).sort(), [
      'studiedWith',
      'subtopicResolveRate',
      'subtopicSessions',
      'teacher',
    ]);
  });
});
