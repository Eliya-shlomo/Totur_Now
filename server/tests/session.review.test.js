import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The rating — PR 6.6, MVP.md §6.2 and §10's `ENDED → RATED` edge.
 *
 * **Most of this file is about one expression.** `rating_count` must move only when stars
 * were given, and `rating_sum += stars ?? 0` beside an unconditional `rating_count += 1`
 * is one character from being written — it makes every unrated review a zero-star one and
 * drags a teacher's average down for the life of their account. `isResolved` is required
 * and `stars` is not, so unrated reviews are the common case rather than the edge, and
 * that is what makes the defect expensive rather than rare.
 *
 * The second half is the terminal edge: `ENDED` is the only legal `from`, which is one
 * assert refusing a session still running, one already rated, and a `NO_SHOW` nobody
 * should be rating. §10's table does that work and this file checks that the table is what
 * is being consulted, rather than a list of statuses typed into the service.
 *
 * **8.1 added a third half: the topic rows.** What is asserted here is the *wiring* — that
 * the same four numbers reach both writers, that the rows arrive with the locked session's
 * teacher and the transaction's `tx`, and that a failure anywhere in the flow leaves the
 * topic table alone. §7's arithmetic itself is `topicStats.test.js`'s and is not restated
 * here, because a rule asserted in two files is a rule that can be changed in one.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { ERROR_CODES } = await import('#config/errors/codes.js');
const { submitSessionReview } = await import('#services/session.review.service.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER_ID = '44444444-4444-4444-8444-444444444444';

/** The question's two topics — a classified question, which is the ordinary case. */
const TOPIC_ID = 9;
const SUBTOPIC_ID = 91;

const TX = Object.freeze({ transactionClient: true });

function spy(implementation = () => undefined) {
  const fn = (...args) => {
    fn.calls.push(args);

    return implementation(...args);
  };

  fn.calls = [];

  return fn;
}

/** An `ENDED` session — the only state a review is legal from. */
const lockedRow = (overrides = {}) => ({
  id: SESSION_ID,
  status: 'ENDED',
  studentId: STUDENT_ID,
  teacherId: TEACHER_ID,
  totalCharged: 24,
  startedAt: new Date('2026-08-19T16:00:00.000Z'),
  endedAt: new Date('2026-08-19T16:10:00.000Z'),
  endReason: 'student_ended',
  ...overrides,
});

function deps(overrides = {}) {
  const base = {
    lockSession: spy(async () => lockedRow()),
    saveReview: spy(async () => ({ id: 'review-1' })),
    moveAggregates: spy(async () => ({ userId: TEACHER_ID })),
    loadTopicIds: spy(async () => ({ topicId: TOPIC_ID, subtopicId: SUBTOPIC_ID })),
    moveTopicStats: spy(async ({ rows }) => rows.length),
    markRated: spy(async () => ({ count: 1 })),
    ...overrides,
  };

  base.runTransaction = spy(async (fn) => {
    try {
      const value = await fn(TX);

      base.runTransaction.committed = true;

      return value;
    } catch (error) {
      base.runTransaction.rolledBack = true;

      throw error;
    }
  });

  return base;
}

async function thrownBy(promise) {
  try {
    await promise;

    return null;
  } catch (error) {
    return error;
  }
}

const review = (collaborators, body = {}, studentId = STUDENT_ID) =>
  submitSessionReview(
    { sessionId: SESSION_ID, studentId, isResolved: true, ...body },
    collaborators,
  );

describe('the aggregates — the arithmetic every average in the product depends on', () => {
  it('moves resolved_count and leaves both rating columns alone when no stars were given', async () => {
    const collaborators = deps();

    await review(collaborators, { isResolved: true });

    const [aggregates, tx] = collaborators.moveAggregates.calls[0];

    assert.equal(aggregates.resolvedCount, 1);
    assert.equal(aggregates.ratingSum, 0);
    // **The line.** A `1` here turns every unrated review into a zero-star one.
    assert.equal(aggregates.ratingCount, 0);
    assert.equal(tx, TX);
  });

  it('moves rating_sum and rating_count together when stars were given', async () => {
    const collaborators = deps();

    await review(collaborators, { stars: 4 });

    const [aggregates] = collaborators.moveAggregates.calls[0];

    assert.equal(aggregates.ratingSum, 4);
    assert.equal(aggregates.ratingCount, 1);
  });

  it('counts a one-star review — the falsy value that a truthiness check would drop', async () => {
    const collaborators = deps();

    await review(collaborators, { stars: 1 });

    const [aggregates] = collaborators.moveAggregates.calls[0];

    assert.equal(aggregates.ratingSum, 1);
    assert.equal(aggregates.ratingCount, 1);
  });

  it('leaves resolved_count alone when the student says it was not solved', async () => {
    const collaborators = deps();

    await review(collaborators, { isResolved: false, stars: 2 });

    const [aggregates] = collaborators.moveAggregates.calls[0];

    // §6.2's KPI is "did this get answered", and a rating is a different question — a
    // student may rate a teacher well for a question that stayed open.
    assert.equal(aggregates.resolvedCount, 0);
    assert.equal(aggregates.ratingCount, 1);
  });
});

describe('the topic rows — §7 propagation, joined to the same transaction (8.1)', () => {
  it('hands the topic writer the same four numbers the profile writer got', async () => {
    const collaborators = deps();

    await review(collaborators, { isResolved: true, stars: 5 });

    const [aggregates] = collaborators.moveAggregates.calls[0];
    const [{ rows }] = collaborators.moveTopicStats.calls[0];
    const leaf = rows.find((row) => row.topicId === SUBTOPIC_ID);

    // One computation, two writers. Two expressions for `stars == null ? 0 : 1` is how
    // the topic table and the profile columns come to disagree about the same review —
    // and nothing would ever report it, because each is internally consistent.
    assert.equal(leaf.ratingSum, aggregates.ratingSum);
    assert.equal(leaf.ratingCount, aggregates.ratingCount);
    assert.equal(leaf.resolvedCount, aggregates.resolvedCount);
  });

  it('counts the session once however long it ran', async () => {
    const collaborators = deps({
      lockSession: spy(async () => lockedRow({ totalCharged: 240 })),
    });

    await review(collaborators, { stars: 4 });

    const [{ rows }] = collaborators.moveTopicStats.calls[0];

    // Money is what scales with blocks; reputation is not. §14.2's card says "solved 12
    // questions in Integrals", not twelve hours of them.
    assert.equal(rows.find((row) => row.topicId === SUBTOPIC_ID).sessionsCount, 1);
  });

  it('writes them for the locked session’s teacher, inside the transaction', async () => {
    const collaborators = deps();

    await review(collaborators, { stars: 3 });

    const [payload, tx] = collaborators.moveTopicStats.calls[0];

    // Off the locked row and never off the request — the same rule the review row itself
    // is written under.
    assert.equal(payload.teacherId, TEACHER_ID);
    assert.equal(tx, TX);
    assert.deepEqual(collaborators.loadTopicIds.calls[0], [SESSION_ID, TX]);
  });

  it('asks for the topics after the counters moved and before the session is rated', async () => {
    const order = [];
    const collaborators = deps({
      moveAggregates: spy(async () => order.push('aggregates')),
      moveTopicStats: spy(async () => order.push('topics')),
      markRated: spy(async () => {
        order.push('rated');

        return { count: 1 };
      }),
    });

    await review(collaborators, { stars: 5 });

    assert.deepEqual(order, ['aggregates', 'topics', 'rated']);
  });

  it('passes an empty row set through when the question was never classified', async () => {
    const collaborators = deps({
      loadTopicIds: spy(async () => ({ topicId: 0, subtopicId: null })),
    });

    await review(collaborators, { stars: 5 });

    // The service does not branch on the sentinel — `topicStatDeltas` answers `[]` and
    // the repository writes nothing. A guard here would be a second place that knows
    // what "unclassified" means.
    const [{ rows }] = collaborators.moveTopicStats.calls[0];

    assert.deepEqual(rows, []);
  });

  it('writes no topic rows when the review row was refused', async () => {
    const collaborators = deps({
      saveReview: spy(async () => {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }),
    });

    await thrownBy(review(collaborators, { stars: 5 }));

    // The double submit. `reviews` is `UNIQUE` on `session_id`, and the second click
    // must not move a reputation column of either kind.
    assert.equal(collaborators.moveTopicStats.calls.length, 0);
    assert.equal(collaborators.loadTopicIds.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
  });

  it('rolls the whole thing back when the topic write fails', async () => {
    const collaborators = deps({
      moveTopicStats: spy(async () => {
        throw Object.assign(new Error('deadlock detected'), { code: 'P2034' });
      }),
    });

    const error = await thrownBy(review(collaborators, { stars: 5 }));

    // The direction that matters: the review and the profile counters are already
    // written at this point, and they must not survive without the topic rows. Nothing
    // reconciles this table — that is the whole argument for one transaction.
    assert.equal(error.code, 'P2034');
    assert.equal(collaborators.markRated.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
  });
});

describe('the review row', () => {
  it('writes the session, both people and the three fields', async () => {
    const collaborators = deps();

    await review(collaborators, { stars: 5, comment: 'Very clear.' });

    const [row, tx] = collaborators.saveReview.calls[0];

    assert.equal(row.sessionId, SESSION_ID);
    assert.equal(row.studentId, STUDENT_ID);
    // Off the locked row, never off the request: a student cannot review somebody who
    // was not in their session.
    assert.equal(row.teacherId, TEACHER_ID);
    assert.equal(row.isResolved, true);
    assert.equal(row.stars, 5);
    assert.equal(row.comment, 'Very clear.');
    assert.equal(tx, TX);
  });

  it('writes null rather than undefined for what the student left out', async () => {
    const collaborators = deps();

    await review(collaborators);

    const [row] = collaborators.saveReview.calls[0];

    // A missing key and an explicit null must not be different rows — the column is what
    // says "no stars".
    assert.equal(row.stars, null);
    assert.equal(row.comment, null);
  });

  it('marks the session RATED last, and only after the counters moved', async () => {
    const collaborators = deps();

    const result = await review(collaborators);

    assert.deepEqual(collaborators.markRated.calls[0], [SESSION_ID, TX]);
    assert.equal(collaborators.runTransaction.committed, true);
    assert.deepEqual(result, { sessionId: SESSION_ID, status: 'RATED', isRated: true });
  });

  /**
   * `reviews.session_id` is `UNIQUE` and that is a stronger guarantee than any `SELECT`
   * this service could run, because a `SELECT` races the insert it is guarding. Unmapped,
   * Prisma's `P2002` reaches `errorHandler` as a 500 — for a double-tapped submit button.
   */
  it('answers the double submit 409, not 500', async () => {
    const collaborators = deps({
      saveReview: spy(async () => {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }),
    });

    const error = await thrownBy(review(collaborators));

    assert.equal(error.code, ERROR_CODES.SESSION_NOT_ACTIVE);
    assert.equal(error.statusCode, 409);
    assert.equal(collaborators.moveAggregates.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
  });

  it('lets an unexpected database error through as itself', async () => {
    const collaborators = deps({
      saveReview: spy(async () => {
        throw Object.assign(new Error('connection terminated'), { code: 'P1001' });
      }),
    });

    const error = await thrownBy(review(collaborators));

    // A 500 is the honest answer to a database that went away, and swallowing it into a
    // 409 would tell the student their review was saved. It leaves as Prisma's own error,
    // not as an `AppError`.
    assert.equal(error.code, 'P1001');
    assert.equal(error.name, 'Error');
    assert.match(error.message, /connection terminated/);
  });
});

describe('who may rate, and which sessions', () => {
  it('answers a stranger NOT_FOUND without writing anything', async () => {
    const collaborators = deps();

    const error = await thrownBy(review(collaborators, {}, STRANGER_ID));

    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
    assert.equal(collaborators.saveReview.calls.length, 0);
  });

  it('answers the teacher NOT_FOUND — §10 has no arrow the other way', async () => {
    const collaborators = deps();

    const error = await thrownBy(review(collaborators, {}, TEACHER_ID));

    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
  });

  for (const status of ['ACTIVE', 'RATED', 'NO_SHOW', 'PENDING', 'OFFER_SENT', 'CANCELLED']) {
    it(`refuses to rate a ${status} session`, async () => {
      const collaborators = deps({ lockSession: spy(async () => lockedRow({ status })) });

      const error = await thrownBy(review(collaborators));

      assert.equal(error.code, ERROR_CODES.SESSION_NOT_ACTIVE);
      assert.equal(collaborators.saveReview.calls.length, 0);
      assert.equal(collaborators.moveAggregates.calls.length, 0);
    });
  }

  it('refuses a session that is not there', async () => {
    const collaborators = deps({ lockSession: spy(async () => null) });

    const error = await thrownBy(review(collaborators));

    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
  });

  it('refuses when the session moved out of ENDED between the lock and the write', async () => {
    const collaborators = deps({ markRated: spy(async () => ({ count: 0 })) });

    const error = await thrownBy(review(collaborators));

    assert.equal(error.code, ERROR_CODES.SESSION_NOT_ACTIVE);
    assert.equal(collaborators.runTransaction.rolledBack, true);
  });
});

const reviewSource = await readFile(
  fileURLToPath(new URL('../src/services/session.review.service.js', import.meta.url)),
  'utf8',
);

describe('the lines this PR is most likely to get wrong', () => {
  const code = reviewSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('asks §10’s table which states may be rated, rather than listing them', () => {
    assert.match(code, /assertTransition\(locked\.status, 'RATED'\)/);
    // A status typed here is a second copy of `TRANSITIONS`, free to disagree with it.
    assert.equal(/'NO_SHOW'|'ACTIVE'/.test(code), false);
  });

  it('guards rating_count on the presence of stars and not on their truthiness', () => {
    // `stars ? 1 : 0` drops a one-star review, which is a real rating and the harshest
    // one a student can give.
    assert.match(code, /stars == null \? 0 : 1/);
  });

  it('reads no review back — every reader of these columns is E8’s', () => {
    // `findReviewTopicIds` is 8.1's and reads `questions`, not `reviews`; the negative
    // lookahead keeps this assertion about review *rows*, which is what it always meant.
    assert.equal(/findReview(?!TopicIds)|review\.findMany|review\.findUnique/.test(code), false);
  });

  it('propagates through the shared rule rather than restating §7 here', () => {
    // 8.1. The weight exists in `topicStats.js` and in the seed, and a third copy is
    // what §5.3's commission turned into before 7.9 unpicked it.
    assert.match(code, /topicStatDeltas\(/);
    assert.equal(/0\.3|PARENT_TOPIC_WEIGHT/.test(code), false);
  });

  it('writes the topic rows inside the same transaction callback', () => {
    // A `prisma.$transaction` anywhere in this flow is the defect 8.1 is most likely to
    // introduce and the one a green suite cannot see: both writers are stubbed in every
    // test above, so only the source says which transaction they run in.
    const callback = code.slice(code.indexOf('runTransaction(async (tx)'));

    assert.match(callback, /moveTopicStats\(/);
    assert.equal(/\$transaction/.test(callback), false);
  });
});
