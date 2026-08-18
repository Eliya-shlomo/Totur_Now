import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The two background jobs — offer expiry and auto-away. PR 5.5, MVP.md §10, §13.
 *
 * **What this file cannot test, said first so a green run is not mistaken for a
 * verified release.** Both jobs are a `where` clause and some plumbing, and the
 * `where` clauses are the product:
 *
 * - `sweepIdleTeachers`'s `status = 'ONLINE'` is what keeps an `OFFER_LOCKED` teacher
 *   from being swept out from under a live offer. Dropping it is invisible here —
 *   these tests hand the job a list of ids and never see the query that produced it.
 * - `releaseTeacherLock`'s `status = 'OFFER_LOCKED'` is what leaves an `OFFLINE`
 *   teacher `OFFLINE`. 5.4's suite draws the same line around the same statement.
 *
 * Those are the brief's manual test, against `psql` and two browsers. What this file
 * *can* test is the ordering, the instants the jobs compute, and — most usefully —
 * **the calls that did not happen**: that nothing here appends to `rejected_by`, that
 * an empty tick logs nothing and emits nothing, that a teacher who was not locked is
 * never announced `ONLINE`. A suite against real Postgres can see a row that moved; it
 * can never see the absence of the statement that would have moved it.
 *
 * Nothing below types 60 minutes or 10 seconds. `AUTO_AWAY_MINUTES` and
 * `CRON_TICK_SECONDS` are imported and the expected instants computed from them, so
 * the day somebody tunes the appendix this file moves with it rather than passing for
 * the wrong reason.
 */

// The jobs import `config/db.js` transitively for `$transaction`, and that validates
// the environment at import time and calls `process.exit(1)` on a missing
// `DATABASE_URL`. Filling the required variables before the dynamic import keeps
// `npm test` runnable on a machine with no `.env` — 5.4's arrangement, for 5.4's reason.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { AUTO_AWAY_MINUTES, CRON_TICK_SECONDS } = await import('#config/constants/index.js');
const { runOfferExpiry } = await import('#jobs/offer.expiry.job.js');
const { runAutoAway } = await import('#jobs/presence.autoAway.job.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_TEACHER_ID = '77777777-7777-4777-8777-777777777777';
const QUESTION_ID = '55555555-5555-4555-8555-555555555555';
const OFFER_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_OFFER_ID = '88888888-8888-4888-8888-888888888888';

/** The transaction client. A sentinel, so "did this write get the `tx`" is assertable. */
const TX = Object.freeze({ transactionClient: true });

/** Records every call, and returns whatever the implementation says. */
function spy(implementation = () => undefined) {
  const fn = (...args) => {
    fn.calls.push(args);

    return implementation(...args);
  };

  fn.calls = [];

  return fn;
}

/** A `findOfferForRespond` row for an offer the sweep has just marked `EXPIRED`. */
const expiredOffer = (overrides = {}) => ({
  id: OFFER_ID,
  status: 'EXPIRED',
  expiresAt: new Date(Date.now() - 61_000),
  teacherId: TEACHER_ID,
  session: {
    id: SESSION_ID,
    status: 'OFFER_SENT',
    studentId: STUDENT_ID,
    questionId: QUESTION_ID,
  },
  ...overrides,
});

/** The expiry job's collaborators, each replaceable by name. */
function expiryDeps(overrides = {}) {
  const base = {
    expireOffers: spy(async () => [OFFER_ID]),
    findOffer: spy(async () => expiredOffer()),
    resetSession: spy(async () => ({ count: 1 })),
    releaseTeacher: spy(async () => ({ locked: true })),
    notifyExpired: spy(),
    notifyRejected: spy(),
    announceStatus: spy(),
    ...overrides,
  };

  // Mirrors Prisma's contract rather than merely calling the callback, so "the writes
  // were inside one transaction" is an assertion instead of a code-review item.
  base.runTransaction = spy(async (fn) => {
    const value = await fn(TX);

    base.runTransaction.committed = true;

    return value;
  });

  return base;
}

/** The auto-away job's collaborators. */
const awayDeps = (overrides = {}) => ({
  sweepIdle: spy(async () => [TEACHER_ID]),
  announceStatus: spy(),
  ...overrides,
});

describe('runOfferExpiry', () => {
  it('sweeps, resets the session, releases the teacher and tells both sides', async () => {
    const deps = expiryDeps();

    const result = await runOfferExpiry(deps);

    assert.deepEqual(result, { expired: 1 });

    // Both writes inside the one transaction, and both carrying the `tx` — a write
    // that quietly used the global client would commit outside it.
    assert.deepEqual(deps.resetSession.calls, [[SESSION_ID, TX]]);
    assert.deepEqual(deps.releaseTeacher.calls, [[TEACHER_ID, TX]]);
    assert.equal(deps.runTransaction.committed, true);

    // The teacher hears that the clock ran out; the student hears the same thing a
    // decline would produce, because their screen recovers the same way.
    assert.deepEqual(deps.notifyExpired.calls, [
      [TEACHER_ID, { offerId: OFFER_ID, sessionId: SESSION_ID }],
    ]);
    assert.deepEqual(deps.notifyRejected.calls, [
      [STUDENT_ID, { offerId: OFFER_ID, sessionId: SESSION_ID }],
    ]);

    // E4's first hard filter is `status = 'ONLINE'`, so a released teacher is a card
    // every open match list is currently rendering wrongly.
    assert.deepEqual(deps.announceStatus.calls, [
      [TEACHER_ID, { teacherId: TEACHER_ID, status: 'ONLINE' }],
    ]);
  });

  it('asks for offers expiring before now', async () => {
    const before = Date.now();
    const deps = expiryDeps();

    await runOfferExpiry(deps);

    const [instant] = deps.expireOffers.calls[0];

    assert.ok(instant instanceof Date, 'the sweep is given a Date, never a duration');
    assert.ok(instant.getTime() >= before && instant.getTime() <= Date.now());
  });

  it('does nothing at all on an empty tick', async () => {
    const deps = expiryDeps({ expireOffers: spy(async () => []) });

    const result = await runOfferExpiry(deps);

    assert.deepEqual(result, { expired: 0 });
    assert.equal(deps.findOffer.calls.length, 0);
    assert.equal(deps.runTransaction.calls.length, 0);
    assert.equal(deps.notifyExpired.calls.length, 0);
    assert.equal(deps.notifyRejected.calls.length, 0);
    assert.equal(deps.announceStatus.calls.length, 0);
  });

  it('leaves a teacher who was no longer locked alone', async () => {
    // They closed the laptop while the modal was open, so they are already `OFFLINE`.
    // Announcing `ONLINE` would put them back on every open match list — the defect
    // `releaseTeacherLock`'s `where` exists to prevent, one layer up.
    const deps = expiryDeps({ releaseTeacher: spy(async () => ({ locked: false })) });

    await runOfferExpiry(deps);

    assert.equal(deps.announceStatus.calls.length, 0);

    // The two people watching a countdown are still told. Whether the teacher's row
    // moved is not their business.
    assert.equal(deps.notifyExpired.calls.length, 1);
    assert.equal(deps.notifyRejected.calls.length, 1);
  });

  it('settles every offer in the tick, and one failure does not stop the rest', async () => {
    const deps = expiryDeps({
      expireOffers: spy(async () => [OFFER_ID, OTHER_OFFER_ID]),
      findOffer: spy(async (offerId) =>
        offerId === OFFER_ID
          ? Promise.reject(new Error('row vanished'))
          : expiredOffer({ id: OTHER_OFFER_ID, teacherId: OTHER_TEACHER_ID }),
      ),
    });

    const result = await runOfferExpiry(deps);

    // The count is what the sweep moved, not what the notification step managed —
    // both rows are `EXPIRED` in the database either way.
    assert.deepEqual(result, { expired: 2 });
    assert.deepEqual(deps.notifyExpired.calls, [
      [OTHER_TEACHER_ID, { offerId: OTHER_OFFER_ID, sessionId: SESSION_ID }],
    ]);
  });

  it('survives a sweep that throws, and settles nothing', async () => {
    const deps = expiryDeps({
      expireOffers: spy(async () => {
        throw new Error('database is down');
      }),
    });

    const result = await runOfferExpiry(deps);

    assert.deepEqual(result, { expired: 0 });
    assert.equal(deps.findOffer.calls.length, 0);
  });
});

describe('runAutoAway', () => {
  it('announces every teacher the sweep moved', async () => {
    const deps = awayDeps({ sweepIdle: spy(async () => [TEACHER_ID, OTHER_TEACHER_ID]) });

    const result = await runAutoAway(deps);

    assert.deepEqual(result, { swept: 2 });
    assert.deepEqual(deps.announceStatus.calls, [
      [TEACHER_ID, { teacherId: TEACHER_ID, status: 'OFFLINE' }],
      [OTHER_TEACHER_ID, { teacherId: OTHER_TEACHER_ID, status: 'OFFLINE' }],
    ]);
  });

  it('asks for teachers last seen before now minus AUTO_AWAY_MINUTES', async () => {
    const before = Date.now();
    const deps = awayDeps();

    await runAutoAway(deps);

    const [instant] = deps.sweepIdle.calls[0];
    const window = AUTO_AWAY_MINUTES * 60 * 1000;

    assert.ok(instant instanceof Date, 'the sweep is given a Date, never a duration');
    assert.ok(instant.getTime() >= before - window && instant.getTime() <= Date.now() - window);
  });

  it('does nothing at all on an empty tick', async () => {
    const deps = awayDeps({ sweepIdle: spy(async () => []) });

    const result = await runAutoAway(deps);

    assert.deepEqual(result, { swept: 0 });
    assert.equal(deps.announceStatus.calls.length, 0);
  });

  it('survives a sweep that throws', async () => {
    const deps = awayDeps({
      sweepIdle: spy(async () => {
        throw new Error('database is down');
      }),
    });

    assert.deepEqual(await runAutoAway(deps), { swept: 0 });
    assert.equal(deps.announceStatus.calls.length, 0);
  });
});

/**
 * The two properties no behavioural test can see, read off the source.
 *
 * A grep in a test file is unusual and it is here on purpose: both of these are
 * absences, and an absence has no call to spy on. The first is the one the brief calls
 * the most likely well-meant change to this file.
 */
describe('the expiry job as written', () => {
  const source = (name) =>
    readFile(fileURLToPath(new URL(`../src/jobs/${name}`, import.meta.url)), 'utf8');

  it('never touches rejected_by', async () => {
    const text = await source('offer.expiry.job.js');
    const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    // A teacher who never saw the modal has not rejected anything, and E4's last hard
    // filter would exclude them from this student's pool for good. §12 puts the column
    // on the reject endpoint and only there.
    assert.equal(/rejectedBy|rejected_by|appendRejectedBy/.test(code), false);
  });

  it('does not announce presence through the service wrapper', async () => {
    const code = (await source('presence.autoAway.job.js')).replace(
      /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      '',
    );

    // `publishTeacherStatus` also forces a `last_seen_at` write, which would have the
    // auto-away job stamping the very column it reads — for a teacher whose silence is
    // the entire reason they are being swept.
    assert.equal(code.includes('publishTeacherStatus'), false);
    assert.equal(code.includes('emitTeacherStatus'), true);
  });

  it('schedules on CRON_TICK_SECONDS rather than a typed interval', async () => {
    const code = await source('index.js');

    assert.ok(code.includes('CRON_TICK_SECONDS'));
    assert.equal(new RegExp(`\\*/${CRON_TICK_SECONDS} `).test(code), false, 'no typed expression');
  });
});
