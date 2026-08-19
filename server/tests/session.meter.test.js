import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The meter — `POST /sessions/:id/extend` and the two sweeps that surround it. PR 6.5,
 * MVP.md §5.1, §12 and §13.
 *
 * **The extend endpoint is one transaction and the order inside it is the whole design**,
 * so most of this file asserts order: that the cap is checked before the charge, that a
 * refused cap wrote nothing, that the `ends_at` guard runs after the charge and takes the
 * charge down with it when it matches nothing.
 *
 * **What a sequential suite cannot see.** `findSessionForMeter` is `SELECT … FOR UPDATE`
 * and `chargeStudent` locks the wallet row; whether either lock is real is invisible to
 * every test below, because they run one request at a time. What *is* asserted is that the
 * value the `where` matches on comes from the read taken **before** the transaction — the
 * one property that makes a double-tapped button buy one block instead of two, and the one
 * a reviewer is most likely to simplify away. The other half is the brief's manual run:
 * two backgrounded `curl` extends, one ledger row.
 *
 * Nothing here types a block length, a price or a cap. Every expectation is computed from
 * the constants, so the day somebody tunes the appendix this file moves with it instead of
 * passing for the wrong reason.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { BLOCK_MINUTES, EXTENSION_BLOCKS, GRACE_SECONDS, WARNING_SECONDS } =
  await import('#config/constants/index.js');
const { AUTO_AWAY_MINUTES, AUTO_AWAY_WARNING_MINUTES } = await import('#config/constants/index.js');
const { ERROR_CODES } = await import('#config/errors/codes.js');
const { extendSessionBlock } = await import('#services/session.meter.service.js');
const { runBlockWarning, resetBlockWarnings } = await import('#jobs/session.blockWarning.job.js');
const { runAutoEnd } = await import('#jobs/session.autoEnd.job.js');
const { runAutoAway, resetAwayWarnings } = await import('#jobs/presence.autoAway.job.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER_ID = '44444444-4444-4444-8444-444444444444';

const PRICE_PER_BLOCK = 12;
const BUDGET_CAP = 60;
const BALANCE = 96;

/** What one extension costs and how long it buys. The constants, never the numbers. */
const EXTENSION_PRICE = EXTENSION_BLOCKS * PRICE_PER_BLOCK;
const EXTENSION_MS = EXTENSION_BLOCKS * BLOCK_MINUTES * 60 * 1000;

const ENDS_AT = new Date('2026-08-19T12:00:00.000Z');

/** The transaction client. A sentinel, so "did this write get the `tx`" is assertable. */
const TX = Object.freeze({ transactionClient: true });

function spy(implementation = () => undefined) {
  const fn = (...args) => {
    fn.calls.push(args);

    return implementation(...args);
  };

  fn.calls = [];

  return fn;
}

/** The session as the caller saw it — the unlocked read, before `BEGIN`. */
const seenRow = (overrides = {}) => ({
  id: SESSION_ID,
  status: 'ACTIVE',
  studentId: STUDENT_ID,
  teacherId: TEACHER_ID,
  endsAt: ENDS_AT,
  ...overrides,
});

/** The session under `SELECT … FOR UPDATE`. */
const lockedRow = (overrides = {}) => ({
  id: SESSION_ID,
  status: 'ACTIVE',
  studentId: STUDENT_ID,
  teacherId: TEACHER_ID,
  pricePerBlock: PRICE_PER_BLOCK,
  budgetCap: BUDGET_CAP,
  blocksUsed: 2,
  totalCharged: 24,
  startedAt: new Date(ENDS_AT.getTime() - 10 * 60 * 1000),
  endsAt: ENDS_AT,
  ...overrides,
});

function deps(overrides = {}) {
  const base = {
    loadSession: spy(async () => seenRow()),
    lockSession: spy(async () => lockedRow()),
    chargeCredits: spy(async () => ({ balanceAfter: BALANCE - EXTENSION_PRICE })),
    extend: spy(async () => ({ count: 1 })),
    saveBlock: spy(async () => ({ id: 'block-3' })),
    notifyExtended: spy(),
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

const extend = (collaborators, userId = STUDENT_ID) =>
  extendSessionBlock({ sessionId: SESSION_ID, studentId: userId }, collaborators);

describe('POST /sessions/:id/extend — the happy path', () => {
  it('charges one block, moves ends_at by exactly one block, and records it', async () => {
    const collaborators = deps();

    const result = await extend(collaborators);

    const [charge, chargeTx] = collaborators.chargeCredits.calls[0];
    const [written, extendTx] = collaborators.extend.calls[0];
    const [block] = collaborators.saveBlock.calls[0];

    assert.equal(charge.amount, EXTENSION_PRICE);
    assert.equal(charge.userId, STUDENT_ID);
    assert.equal(chargeTx, TX);

    assert.equal(written.endsAt.getTime(), ENDS_AT.getTime() + EXTENSION_MS);
    assert.equal(written.blocksUsed, 2 + EXTENSION_BLOCKS);
    assert.equal(written.totalCharged, 24 + EXTENSION_PRICE);
    assert.equal(extendTx, TX);

    assert.equal(block.blockNumber, 2 + EXTENSION_BLOCKS);
    assert.equal(block.minutes, EXTENSION_BLOCKS * BLOCK_MINUTES);
    assert.equal(block.amount, EXTENSION_PRICE);

    assert.equal(result.endsAt, new Date(ENDS_AT.getTime() + EXTENSION_MS).toISOString());
    assert.equal(result.balance, BALANCE - EXTENSION_PRICE);
    assert.equal(collaborators.runTransaction.committed, true);
  });

  it('announces the new deadline to the session’s room, after the commit', async () => {
    const collaborators = deps();

    await extend(collaborators);

    const [sessionId, payload] = collaborators.notifyExtended.calls[0];

    // The teacher has no HTTP response coming; this emit is how their tab learns. And it
    // carries the absolute instant, not "five more minutes" — a backgrounded tab and the
    // server must not disagree about when a paid-for block ends.
    assert.equal(sessionId, SESSION_ID);
    assert.equal(payload.endsAt, new Date(ENDS_AT.getTime() + EXTENSION_MS).toISOString());
    assert.equal(payload.balance, BALANCE - EXTENSION_PRICE);
    assert.equal(payload.blocksUsed, 2 + EXTENSION_BLOCKS);
  });

  it('prices the block off the session’s snapshot, never off anything on the wire', async () => {
    const collaborators = deps({ lockSession: spy(async () => lockedRow({ pricePerBlock: 8 })) });

    await extend(collaborators);

    assert.equal(collaborators.chargeCredits.calls[0][0].amount, EXTENSION_BLOCKS * 8);
  });
});

describe('the two 402s, and what each of them wrote', () => {
  it('refuses past the budget cap, before the charge, having written nothing', async () => {
    const collaborators = deps({
      lockSession: spy(async () => lockedRow({ totalCharged: BUDGET_CAP })),
    });

    const error = await thrownBy(extend(collaborators));

    assert.equal(error.code, ERROR_CODES.BUDGET_CAP_REACHED);
    assert.equal(error.statusCode, 402);

    // The cap is a comparison. Enforcing it after the debit would make it a refund path.
    assert.equal(collaborators.chargeCredits.calls.length, 0);
    assert.equal(collaborators.extend.calls.length, 0);
    assert.equal(collaborators.saveBlock.calls.length, 0);
  });

  it('allows the extension that lands exactly on the cap', async () => {
    const collaborators = deps({
      lockSession: spy(async () => lockedRow({ totalCharged: BUDGET_CAP - EXTENSION_PRICE })),
    });

    await extend(collaborators);

    assert.equal(collaborators.chargeCredits.calls.length, 1);
  });

  it('lets INSUFFICIENT_CREDIT out of the wallet and leaves ends_at where it was', async () => {
    const collaborators = deps({
      chargeCredits: spy(async () => {
        throw new (await import('#utils/AppError.js')).AppError(
          ERROR_CODES.INSUFFICIENT_CREDIT,
          'You do not have enough credits for this.',
        );
      }),
    });

    const error = await thrownBy(extend(collaborators));

    assert.equal(error.code, ERROR_CODES.INSUFFICIENT_CREDIT);
    assert.equal(collaborators.extend.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
    assert.equal(collaborators.notifyExtended.calls.length, 0);
  });
});

describe('the double tap, and the guard that refuses it', () => {
  /**
   * The property the whole design turns on. `findSessionForMeter` is `FOR UPDATE`, so a
   * second request wakes after the first commits and reads the `ends_at` the first one
   * wrote — matching its own expectation and buying a second block. What stops it is that
   * the expected value comes from the *unlocked* read, taken before `BEGIN`: both taps
   * carry the same instant, and only one of them matches.
   */
  it('matches on the ends_at the caller read, not on the one the lock returned', async () => {
    const alreadyExtended = new Date(ENDS_AT.getTime() + EXTENSION_MS);
    const collaborators = deps({
      loadSession: spy(async () => seenRow()),
      lockSession: spy(async () => lockedRow({ endsAt: alreadyExtended })),
    });

    await extend(collaborators);

    const [written] = collaborators.extend.calls[0];

    assert.equal(written.expectedEndsAt.getTime(), ENDS_AT.getTime());
    assert.equal(written.endsAt.getTime(), ENDS_AT.getTime() + EXTENSION_MS);
  });

  it('answers the loser SESSION_NOT_ACTIVE and rolls its charge back', async () => {
    const collaborators = deps({ extend: spy(async () => ({ count: 0 })) });

    const error = await thrownBy(extend(collaborators));

    // Not retried, deliberately: a retry is the second block this guard exists to refuse.
    assert.equal(error.code, ERROR_CODES.SESSION_NOT_ACTIVE);
    assert.equal(error.statusCode, 409);
    assert.equal(collaborators.saveBlock.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
    assert.equal(collaborators.notifyExtended.calls.length, 0);
  });
});

describe('who may extend, and which sessions can be extended', () => {
  it('answers a stranger NOT_FOUND without opening a transaction', async () => {
    const collaborators = deps();

    const error = await thrownBy(extend(collaborators, STRANGER_ID));

    // `authorize('student')` proves the caller is *a* student. NOT_FOUND rather than
    // FORBIDDEN, because FORBIDDEN would confirm the session id is real — 5.4's rule and
    // 6.4's, and the three endpoints must not disagree.
    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
    assert.equal(collaborators.runTransaction.calls.length, 0);
  });

  it('answers the teacher of the session NOT_FOUND too', async () => {
    const collaborators = deps();

    const error = await thrownBy(extend(collaborators, TEACHER_ID));

    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
  });

  for (const status of ['PENDING', 'OFFER_SENT', 'ENDED', 'RATED', 'CANCELLED', 'NO_SHOW']) {
    it(`refuses to extend a ${status} session, and charges nothing`, async () => {
      const collaborators = deps({ lockSession: spy(async () => lockedRow({ status })) });

      const error = await thrownBy(extend(collaborators));

      assert.equal(error.code, ERROR_CODES.SESSION_NOT_ACTIVE);
      assert.equal(collaborators.chargeCredits.calls.length, 0);
    });
  }

  it('refuses a session that vanished between the two reads', async () => {
    const collaborators = deps({ lockSession: spy(async () => null) });

    const error = await thrownBy(extend(collaborators));

    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
    assert.equal(collaborators.runTransaction.rolledBack, true);
  });
});

describe('the block warning sweep', () => {
  const dueSession = (overrides = {}) => ({
    id: SESSION_ID,
    studentId: STUDENT_ID,
    teacherId: TEACHER_ID,
    pricePerBlock: PRICE_PER_BLOCK,
    budgetCap: BUDGET_CAP,
    blocksUsed: 2,
    totalCharged: 24,
    endsAt: new Date(Date.now() + 20_000),
    ...overrides,
  });

  const warningDeps = (overrides = {}) => ({
    findDue: spy(async () => [dueSession()]),
    loadBalance: spy(async () => BALANCE),
    notifyWarning: spy(),
    ...overrides,
  });

  beforeEach(() => resetBlockWarnings());

  it('asks the repository for exactly the WARNING_SECONDS window', async () => {
    const collaborators = warningDeps();

    await runBlockWarning(collaborators);

    const [from, to] = collaborators.findDue.calls[0];

    assert.equal(to.getTime() - from.getTime(), WARNING_SECONDS * 1000);
  });

  it('computes all four numbers server-side', async () => {
    const collaborators = warningDeps();

    await runBlockWarning(collaborators);

    const [, payload] = collaborators.notifyWarning.calls[0];

    // A screen that worked out affordability would work it out differently from the
    // endpoint that enforces it, and the disagreement shows up as an Extend button that
    // is enabled and then 402s.
    assert.equal(payload.extensionPrice, EXTENSION_PRICE);
    assert.equal(payload.balanceAfter, BALANCE - EXTENSION_PRICE);
    assert.equal(payload.canAfford, true);
    assert.equal(payload.withinCap, true);
    assert.ok(payload.secondsLeft > 0 && payload.secondsLeft <= WARNING_SECONDS);
  });

  it('says canAfford false and withinCap false with the same predicates the endpoint uses', async () => {
    const collaborators = warningDeps({
      loadBalance: spy(async () => EXTENSION_PRICE - 1),
      findDue: spy(async () => [dueSession({ totalCharged: BUDGET_CAP })]),
    });

    await runBlockWarning(collaborators);

    const [, payload] = collaborators.notifyWarning.calls[0];

    assert.equal(payload.canAfford, false);
    assert.equal(payload.withinCap, false);
    assert.equal(payload.balanceAfter, -1);
  });

  it('warns once per block however many ticks fall inside the window', async () => {
    // One row, read three times — the same `ends_at`, which is what the idempotence is
    // keyed on. Six ticks fit in a sixty-second window at a ten-second tick.
    const row = dueSession();
    const collaborators = warningDeps({ findDue: spy(async () => [row]) });

    await runBlockWarning(collaborators);
    await runBlockWarning(collaborators);
    await runBlockWarning(collaborators);

    assert.equal(collaborators.notifyWarning.calls.length, 1);
  });

  it('warns again once the session has bought another block', async () => {
    const row = dueSession();
    const collaborators = warningDeps({ findDue: spy(async () => [row]) });

    await runBlockWarning(collaborators);

    const extended = dueSession({ endsAt: new Date(row.endsAt.getTime() + EXTENSION_MS) });

    collaborators.findDue = spy(async () => [extended]);

    await runBlockWarning(collaborators);

    // A new `ends_at` is a new block, and the student needs the question again.
    assert.equal(collaborators.notifyWarning.calls.length, 2);
  });

  it('writes nothing and never throws', async () => {
    const collaborators = warningDeps({
      findDue: spy(async () => {
        throw new Error('database is down');
      }),
    });

    assert.deepEqual(await runBlockWarning(collaborators), { warned: 0 });
  });

  it('reads no wallet on an empty tick', async () => {
    const collaborators = warningDeps({ findDue: spy(async () => []) });

    await runBlockWarning(collaborators);

    assert.equal(collaborators.loadBalance.calls.length, 0);
  });
});

describe('the auto-end sweep', () => {
  const autoEndDeps = (overrides = {}) => {
    const base = {
      findDue: spy(async () => [{ id: SESSION_ID, studentId: STUDENT_ID, teacherId: TEACHER_ID }]),
      lockSession: spy(async () => lockedRow()),
      endWithReason: spy(async () => ({ count: 1 })),
      notifyEnded: spy(),
      ...overrides,
    };

    base.runTransaction = spy(async (fn) => fn(TX));

    return base;
  };

  it('sweeps GRACE_SECONDS past the deadline, not the deadline itself', async () => {
    const collaborators = autoEndDeps();

    await runAutoEnd(collaborators);

    const [deadline] = collaborators.findDue.calls[0];

    // The warning goes out at T-60s and the student may still be reading it. §5.1's grace
    // is the room to press the button.
    assert.ok(Date.now() - deadline.getTime() >= GRACE_SECONDS * 1000);
  });

  it('ends with no_extension and tells both sides after the commit', async () => {
    const collaborators = autoEndDeps();

    const result = await runAutoEnd(collaborators);

    const [written, tx] = collaborators.endWithReason.calls[0];
    const [sessionId, payload] = collaborators.notifyEnded.calls[0];

    assert.equal(result.ended, 1);
    assert.equal(written.status, 'ENDED');
    assert.equal(written.endReason, 'no_extension');
    assert.equal(tx, TX);

    assert.equal(sessionId, SESSION_ID);
    assert.equal(payload.endReason, 'no_extension');
    // Nobody ended it. The clock did.
    assert.equal(payload.actorId, null);
  });

  it('does nothing to a session somebody ended between the sweep and the lock', async () => {
    const collaborators = autoEndDeps({
      lockSession: spy(async () => lockedRow({ status: 'ENDED' })),
    });

    const result = await runAutoEnd(collaborators);

    // Whoever ended it announced it. A second `session:ended` is two endings on one screen.
    assert.equal(result.ended, 0);
    assert.equal(collaborators.endWithReason.calls.length, 0);
    assert.equal(collaborators.notifyEnded.calls.length, 0);
  });

  it('announces nothing when the conditional write matched nothing', async () => {
    const collaborators = autoEndDeps({ endWithReason: spy(async () => ({ count: 0 })) });

    const result = await runAutoEnd(collaborators);

    assert.equal(result.ended, 0);
    assert.equal(collaborators.notifyEnded.calls.length, 0);
  });

  it('keeps sweeping when one session fails, and never throws', async () => {
    let seen = 0;
    const collaborators = autoEndDeps({
      findDue: spy(async () => [{ id: SESSION_ID }, { id: 'other' }]),
      lockSession: spy(async () => {
        seen += 1;

        if (seen === 1) throw new Error('deadlock detected');

        return lockedRow();
      }),
    });

    const result = await runAutoEnd(collaborators);

    assert.equal(result.ended, 1);
  });

  it('credits nobody — 6.6 owns the money at termination', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../src/jobs/session.autoEnd.job.js', import.meta.url)),
      'utf8',
    );

    assert.equal(
      /creditTeacher|wallet\.service/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
      false,
    );
  });
});

describe('the 55-minute away warning — the constant’s first reader', () => {
  /** One teacher, quiet since a fixed instant — the value the idempotence is keyed on. */
  const QUIET_SINCE = new Date(Date.now() - (AUTO_AWAY_WARNING_MINUTES + 1) * 60 * 1000);

  const awayDeps = (overrides = {}) => ({
    sweepIdle: spy(async () => []),
    announceStatus: spy(),
    findDueForWarning: spy(async () => [{ userId: TEACHER_ID, lastSeenAt: QUIET_SINCE }]),
    warnIdle: spy(),
    ...overrides,
  });

  beforeEach(() => resetAwayWarnings());

  it('asks for the window between the warning line and the away line', async () => {
    const collaborators = awayDeps();

    await runAutoAway(collaborators);

    const [from, to] = collaborators.findDueForWarning.calls[0];

    assert.equal(
      to.getTime() - from.getTime(),
      (AUTO_AWAY_MINUTES - AUTO_AWAY_WARNING_MINUTES) * 60 * 1000,
    );
  });

  it('warns the teacher and nobody else, with the minutes they have left', async () => {
    const collaborators = awayDeps();

    await runAutoAway(collaborators);

    const [teacherId, payload] = collaborators.warnIdle.calls[0];

    assert.equal(teacherId, TEACHER_ID);
    assert.equal(payload.minutesUntilAway, AUTO_AWAY_MINUTES - AUTO_AWAY_WARNING_MINUTES);
  });

  it('asks once per quiet stretch, not once per tick', async () => {
    const collaborators = awayDeps();

    await runAutoAway(collaborators);
    await runAutoAway(collaborators);

    assert.equal(collaborators.warnIdle.calls.length, 1);
  });

  it('asks again after the teacher beats and goes quiet a second time', async () => {
    const collaborators = awayDeps();

    await runAutoAway(collaborators);

    collaborators.findDueForWarning = spy(async () => [
      { userId: TEACHER_ID, lastSeenAt: new Date(QUIET_SINCE.getTime() + 60 * 1000) },
    ]);

    await runAutoAway(collaborators);

    // A newer `last_seen_at` is a teacher who came back and went quiet again.
    assert.equal(collaborators.warnIdle.calls.length, 2);
  });

  it('leaves the 60-minute sweep exactly as 5.5 wrote it', async () => {
    const collaborators = awayDeps({ sweepIdle: spy(async () => [TEACHER_ID]) });

    const result = await runAutoAway(collaborators);

    assert.equal(result.swept, 1);
    assert.deepEqual(collaborators.announceStatus.calls[0], [
      TEACHER_ID,
      { teacherId: TEACHER_ID, status: 'OFFLINE' },
    ]);
  });

  it('still sweeps when the warning query fails', async () => {
    const collaborators = awayDeps({
      findDueForWarning: spy(async () => {
        throw new Error('database is down');
      }),
      sweepIdle: spy(async () => [TEACHER_ID]),
    });

    // The sweep is the one with a state change behind it; the prompt must not take it down.
    assert.deepEqual(await runAutoAway(collaborators), { swept: 1 });
  });
});

const meterSource = await readFile(
  fileURLToPath(new URL('../src/services/session.meter.service.js', import.meta.url)),
  'utf8',
);

describe('the lines this PR is most likely to get wrong', () => {
  const code = meterSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('charges inside the transaction callback and emits outside it', () => {
    const callback = code.slice(
      code.indexOf('runTransaction(async'),
      code.indexOf('notifyExtended('),
    );

    assert.match(callback, /await chargeCredits\(/);
    // A charge outside the callback is money that survives a rollback; an emit inside it
    // announces a block a rollback could still take away.
    assert.equal(/notifyExtended/.test(callback), false);
  });

  it('checks the cap above the charge, in the source as well as in the calls', () => {
    assert.ok(code.indexOf('BUDGET_CAP_REACHED') < code.indexOf('chargeCredits('));
  });

  it('types no block length, price or cap', () => {
    assert.match(code, /EXTENSION_BLOCKS \* BLOCK_MINUTES/);
    // A literal block length in milliseconds is the one that survives a tuned appendix
    // and is wrong afterwards. `BLOCK_MINUTES * 60 * 1000` is the conversion and stays.
    assert.equal(/\b(?:5|10|40)\s*\*\s*60\s*\*\s*1000/.test(code), false);
  });
});
