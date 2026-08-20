import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Termination — PR 6.6, MVP.md §10's two terminal edges, §5.3's split and §11.3-B's third
 * money movement.
 *
 * **The arithmetic is the point of this file.** `platform_fee + teacher_earning` must
 * equal `total_charged` to the credit, the fee must be resolved at `started_at` rather
 * than at `ended_at`, and the refund must be the whole charge with nothing taken out of
 * it. Every one of those is a number a test can check exactly, and every one of them is a
 * defect that would ship silently: a fee resolved at the wrong instant is invisible except
 * across one hour boundary a day, which is how E5 lost a test run at 12:17.
 *
 * **What a sequential suite cannot see, again.** `findSessionForMeter` is
 * `SELECT … FOR UPDATE` and `creditTeacher` locks the wallet row; whether either lock is
 * real is invisible here. What is asserted is that a lost race credits nobody — the
 * conditional write's `count` is checked before the money moves — and the rest is the
 * brief's manual run.
 *
 * Nothing here types a commission rate. `platformFeeRate` is imported and the expectation
 * computed from it, because §5.3 has three branches (a new teacher, a low-demand hour, and
 * everything else) and a test that typed `0.15` would pass for the wrong reason on two of
 * them.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { NO_SHOW_WINDOW_SEC, OPENING_BLOCKS } = await import('#config/constants/index.js');
const { NEW_TEACHER_FEE_DAYS } = await import('#config/constants/index.js');
const { ERROR_CODES } = await import('#config/errors/codes.js');
const { platformFeeRate } = await import('#utils/commission.js');
const { reportSessionNoShow, terminateSession } = await import('#services/session.end.service.js');
const { runAutoEnd } = await import('#jobs/session.autoEnd.job.js');
const { AppError } = await import('#utils/AppError.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER_ID = '44444444-4444-4444-8444-444444444444';

const TOTAL_CHARGED = 24;

/** A teacher old enough that §5.3's free window is over — otherwise the fee is 0. */
const TEACHER_CREATED_AT = new Date(Date.now() - (NEW_TEACHER_FEE_DAYS + 30) * 24 * 60 * 60 * 1000);

/** 16:00 UTC — outside §5.3's low-demand window, so the ordinary rate applies. */
const STARTED_AT = new Date('2026-08-19T16:00:00.000Z');

const TX = Object.freeze({ transactionClient: true });

function spy(implementation = () => undefined) {
  const fn = (...args) => {
    fn.calls.push(args);

    return implementation(...args);
  };

  fn.calls = [];

  return fn;
}

const lockedRow = (overrides = {}) => ({
  id: SESSION_ID,
  status: 'ACTIVE',
  studentId: STUDENT_ID,
  teacherId: TEACHER_ID,
  pricePerBlock: 12,
  budgetCap: 60,
  blocksUsed: OPENING_BLOCKS,
  totalCharged: TOTAL_CHARGED,
  startedAt: STARTED_AT,
  // 7.4 — a normal session had a room. `settleSession` refunds in full when no room was
  // ever minted (§5.5's "platform technical failure"), so a fixture that omitted this
  // would make every test in this file assert the refund path by accident.
  hasVideo: true,
  endsAt: new Date(STARTED_AT.getTime() + 10 * 60 * 1000),
  endedAt: null,
  endReason: null,
  teacherCreatedAt: TEACHER_CREATED_AT,
  ...overrides,
});

function deps(overrides = {}) {
  const base = {
    lockSession: spy(async () => lockedRow()),
    closeSession: spy(async () => ({ count: 1 })),
    creditEarning: spy(async () => ({ balanceAfter: 100 })),
    refundStudent: spy(async () => ({ balanceAfter: 96 })),
    releaseTeacher: spy(async () => ({ released: true })),
    notifyEnded: spy(),
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

const end = (collaborators, actorId = STUDENT_ID) =>
  terminateSession({ sessionId: SESSION_ID, endReason: 'student_ended', actorId }, collaborators);

describe('ending a session — the split', () => {
  it('credits the teacher the gross minus the fee, and the two add up exactly', async () => {
    const collaborators = deps();

    await end(collaborators);

    const [written] = collaborators.closeSession.calls[0];
    const [credit, creditTx] = collaborators.creditEarning.calls[0];

    const feeRate = platformFeeRate({ teacherCreatedAt: TEACHER_CREATED_AT, at: STARTED_AT });
    const fee = Math.round(TOTAL_CHARGED * feeRate);

    assert.equal(written.platformFee, fee);
    assert.equal(written.teacherEarning, TOTAL_CHARGED - fee);

    // The acceptance criterion, as one line: nothing is lost to a second rounding.
    assert.equal(written.platformFee + written.teacherEarning, TOTAL_CHARGED);

    assert.equal(credit.userId, TEACHER_ID);
    assert.equal(credit.amount, TOTAL_CHARGED - fee);
    assert.equal(creditTx, TX);
  });

  /**
   * §5.3's low-demand window is `[6, 14)`. A session that begins at 13:55 and ends at
   * 14:05 is charged at the rate the teacher was quoted when they accepted — the defect
   * here is `new Date()` as the `at`, which is invisible except across one boundary a day.
   */
  it('resolves the fee at started_at and not at the moment it ends', async () => {
    const lowDemand = new Date('2026-08-19T10:00:00.000Z');
    const collaborators = deps({
      lockSession: spy(async () => lockedRow({ startedAt: lowDemand })),
    });

    await end(collaborators);

    const [written] = collaborators.closeSession.calls[0];
    const expected = platformFeeRate({ teacherCreatedAt: TEACHER_CREATED_AT, at: lowDemand });

    assert.equal(written.platformFee, Math.round(TOTAL_CHARGED * expected));
  });

  it('takes no fee from a teacher still inside their free window', async () => {
    const collaborators = deps({
      lockSession: spy(async () => lockedRow({ teacherCreatedAt: new Date() })),
    });

    await end(collaborators);

    const [written] = collaborators.closeSession.calls[0];

    assert.equal(written.platformFee, 0);
    assert.equal(written.teacherEarning, TOTAL_CHARGED);
  });

  it('writes ENDED with the reason and the instant, and tells both sides after', async () => {
    const collaborators = deps();

    const result = await end(collaborators);

    const [written] = collaborators.closeSession.calls[0];
    const [sessionId, payload] = collaborators.notifyEnded.calls[0];

    assert.equal(written.status, 'ENDED');
    assert.equal(written.endReason, 'student_ended');
    assert.equal(result.endedAt, written.endedAt.toISOString());

    // Whoever did not press the button has no HTTP response coming.
    assert.equal(sessionId, SESSION_ID);
    assert.equal(payload.endReason, 'student_ended');
    assert.equal(payload.actorId, STUDENT_ID);
    assert.equal(collaborators.runTransaction.committed, true);
  });

  it('counts the session and releases the teacher, conditionally', async () => {
    const collaborators = deps();

    await end(collaborators);

    const [release, releaseTx] = collaborators.releaseTeacher.calls[0];

    assert.equal(release.teacherId, TEACHER_ID);
    assert.equal(release.sessionsCount, 1);
    assert.equal(release.noShowCount ?? 0, 0);
    assert.equal(releaseTx, TX);
  });

  it('credits nobody when the session was never charged', async () => {
    const collaborators = deps({ lockSession: spy(async () => lockedRow({ totalCharged: 0 })) });

    await end(collaborators);

    // `wallet.service.js` refuses a non-positive amount as a programming error, so a
    // zero-credit row is not written — it is not written *at all*.
    assert.equal(collaborators.creditEarning.calls.length, 0);
    assert.equal(collaborators.closeSession.calls[0][0].teacherEarning, 0);
  });
});

describe('who may end it, and what happens when two of them try', () => {
  it('lets the teacher end it, with the same reason the student writes', async () => {
    const collaborators = deps();

    await end(collaborators, TEACHER_ID);

    // §11.2 has no `teacher_ended` value and inventing one is a migration. The actor is
    // on the emit; the column says why, not who.
    assert.equal(collaborators.closeSession.calls[0][0].endReason, 'student_ended');
    assert.equal(collaborators.notifyEnded.calls[0][1].actorId, TEACHER_ID);
  });

  it('answers a stranger NOT_FOUND and moves no money', async () => {
    const collaborators = deps();

    const error = await thrownBy(end(collaborators, STRANGER_ID));

    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
    assert.equal(collaborators.closeSession.calls.length, 0);
    assert.equal(collaborators.creditEarning.calls.length, 0);
  });

  it('checks nobody when the clock is the caller', async () => {
    const collaborators = deps();

    await terminateSession(
      { sessionId: SESSION_ID, endReason: 'no_extension', actorId: null },
      collaborators,
    );

    assert.equal(collaborators.closeSession.calls[0][0].endReason, 'no_extension');
    assert.equal(collaborators.notifyEnded.calls[0][1].actorId, null);
  });

  for (const status of ['ENDED', 'RATED', 'NO_SHOW', 'PENDING', 'OFFER_SENT']) {
    it(`refuses to end a ${status} session, and credits nobody`, async () => {
      const collaborators = deps({ lockSession: spy(async () => lockedRow({ status })) });

      const error = await thrownBy(end(collaborators));

      assert.equal(error.code, ERROR_CODES.SESSION_NOT_ACTIVE);
      assert.equal(collaborators.creditEarning.calls.length, 0);
    });
  }

  /**
   * The end button and the auto-end sweep in the same tick. The conditional write is the
   * guard and it is checked **before** the credit — crediting twice is the one mistake in
   * this epic no reconciliation query can repair afterwards.
   */
  it('credits nobody when the conditional write lost the race', async () => {
    const collaborators = deps({ closeSession: spy(async () => ({ count: 0 })) });

    const error = await thrownBy(end(collaborators));

    assert.equal(error.code, ERROR_CODES.SESSION_NOT_ACTIVE);
    assert.equal(collaborators.creditEarning.calls.length, 0);
    assert.equal(collaborators.releaseTeacher.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
    assert.equal(collaborators.notifyEnded.calls.length, 0);
  });

  it('refuses a session that is not there', async () => {
    const collaborators = deps({ lockSession: spy(async () => null) });

    const error = await thrownBy(end(collaborators));

    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
  });
});

describe('the no-show refund', () => {
  const report = (collaborators, studentId = STUDENT_ID) =>
    reportSessionNoShow({ sessionId: SESSION_ID, studentId }, collaborators);

  /**
   * A session that started seconds ago. The default fixture's `startedAt` is a fixed
   * instant in the past — right for the fee arithmetic above and far outside this
   * window — so every test that expects a report to *succeed* says so explicitly.
   */
  const justStarted = (overrides = {}) =>
    lockedRow({ startedAt: new Date(Date.now() - 5000), ...overrides });

  it('refunds the whole charge, with no fee taken out of it', async () => {
    const collaborators = deps({ lockSession: spy(async () => justStarted()) });

    const result = await report(collaborators);

    const [refund, refundTx] = collaborators.refundStudent.calls[0];
    const [written] = collaborators.closeSession.calls[0];

    // A refund net of commission is the platform keeping money for a lesson that did not
    // happen.
    assert.equal(refund.amount, TOTAL_CHARGED);
    assert.equal(refund.userId, STUDENT_ID);
    assert.equal(refundTx, TX);

    assert.equal(written.status, 'NO_SHOW');
    assert.equal(written.endReason, 'teacher_no_show');
    assert.equal(written.platformFee, 0);
    assert.equal(written.teacherEarning, 0);
    assert.equal(result.balance, 96);
  });

  it('credits the teacher nothing and counts the no-show, not the session', async () => {
    const collaborators = deps({ lockSession: spy(async () => justStarted()) });

    await report(collaborators);

    const [release] = collaborators.releaseTeacher.calls[0];

    assert.equal(collaborators.creditEarning.calls.length, 0);
    assert.equal(release.noShowCount, 1);
    // Nobody taught anything, and `sessions_count` is a denominator E4 divides by.
    assert.equal(release.sessionsCount ?? 0, 0);
  });

  it('refuses a report after NO_SHOW_WINDOW_SEC, having written nothing', async () => {
    const late = new Date(Date.now() - (NO_SHOW_WINDOW_SEC + 1) * 1000);
    const collaborators = deps({ lockSession: spy(async () => lockedRow({ startedAt: late })) });

    const error = await thrownBy(report(collaborators));

    assert.equal(error.code, ERROR_CODES.SESSION_NOT_ACTIVE);
    assert.equal(error.statusCode, 409);
    assert.equal(collaborators.refundStudent.calls.length, 0);
    assert.equal(collaborators.closeSession.calls.length, 0);
  });

  it('accepts a report at the last second of the window', async () => {
    const justNow = new Date(Date.now() - (NO_SHOW_WINDOW_SEC - 1) * 1000);
    const collaborators = deps({ lockSession: spy(async () => lockedRow({ startedAt: justNow })) });

    await report(collaborators);

    assert.equal(collaborators.refundStudent.calls.length, 1);
  });

  it('refuses a session somebody extended — that was not a no-show', async () => {
    const collaborators = deps({
      lockSession: spy(async () => justStarted({ blocksUsed: OPENING_BLOCKS + 1 })),
    });

    const error = await thrownBy(report(collaborators));

    assert.equal(error.code, ERROR_CODES.SESSION_NOT_ACTIVE);
    assert.equal(collaborators.refundStudent.calls.length, 0);
  });

  it('answers the teacher of the session NOT_FOUND — they cannot report themselves', async () => {
    const collaborators = deps({ lockSession: spy(async () => justStarted()) });

    const error = await thrownBy(report(collaborators, TEACHER_ID));

    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
  });

  for (const status of ['ENDED', 'RATED', 'NO_SHOW']) {
    it(`refuses a no-show report on a ${status} session`, async () => {
      const collaborators = deps({ lockSession: spy(async () => justStarted({ status })) });

      const error = await thrownBy(report(collaborators));

      assert.equal(error.code, ERROR_CODES.SESSION_NOT_ACTIVE);
    });
  }
});

describe('the auto-end sweep, rewired', () => {
  it('goes through the one termination path with no_extension and no actor', async () => {
    const endDueSession = spy(async () => ({ status: 'ENDED' }));

    const result = await runAutoEnd({
      findDue: spy(async () => [{ id: SESSION_ID }]),
      endDueSession,
    });

    assert.equal(result.ended, 1);
    assert.deepEqual(endDueSession.calls[0][0], {
      sessionId: SESSION_ID,
      endReason: 'no_extension',
      actorId: null,
    });
  });

  it('treats a session somebody already ended as ordinary, not as a failure', async () => {
    const result = await runAutoEnd({
      findDue: spy(async () => [{ id: SESSION_ID }]),
      endDueSession: spy(async () => {
        throw new AppError(ERROR_CODES.SESSION_NOT_ACTIVE, 'This session is no longer running.');
      }),
    });

    assert.equal(result.ended, 0);
  });

  it('keeps sweeping when one session throws something unexpected', async () => {
    let seen = 0;

    const result = await runAutoEnd({
      findDue: spy(async () => [{ id: SESSION_ID }, { id: 'other' }]),
      endDueSession: spy(async () => {
        seen += 1;

        if (seen === 1) throw new Error('deadlock detected');

        return { status: 'ENDED' };
      }),
    });

    assert.equal(result.ended, 1);
  });

  it('writes no terminal state of its own any more', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../src/jobs/session.autoEnd.job.js', import.meta.url)),
      'utf8',
    );

    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    // 6.5 shipped this job writing `ENDED` itself because the termination path did not
    // exist. Two writers of a terminal state is two arithmetics.
    assert.equal(/endSession|creditTeacher|emitSessionEnded/.test(code), false);
    assert.match(code, /terminateSession/);
  });
});

const endSource = await readFile(
  fileURLToPath(new URL('../src/services/session.end.service.js', import.meta.url)),
  'utf8',
);

describe('the lines this PR is most likely to get wrong', () => {
  const code = endSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('imports §5.3 rather than restating it', () => {
    assert.match(code, /platformFeeRate/);
    // Two implementations are two answers to "what did I earn", and the teacher was
    // quoted the first one at offer time.
    assert.equal(/0\.15|PLATFORM_FEE_PCT/.test(code), false);
  });

  it('passes started_at as the instant the rate is resolved at', () => {
    assert.match(code, /at: locked\.startedAt/);
  });

  it('emits outside the transaction callback', () => {
    const callback = code.slice(code.indexOf('runTransaction(async'), code.indexOf('announceEnd('));

    assert.equal(/notifyEnded/.test(callback), false);
  });
});

describe("§5.5's two refunds — PR 7.4", () => {
  /** A session that ended `seconds` after it started, with the student pressing End. */
  const endedAfter = (seconds, overrides = {}) =>
    lockedRow({ startedAt: new Date(Date.now() - seconds * 1000), ...overrides });

  const settlement = (collaborators) => collaborators.closeSession.calls[0][0];
  const refunds = (collaborators) => collaborators.refundStudent.calls;
  const earnings = (collaborators) => collaborators.creditEarning.calls;

  describe('case 1 — the platform never provided a room', () => {
    /**
     * Not hypothetical. Between PR 6.1 and 6b.1 every session on the deployed application
     * ran without a room, because `render.yaml` never declared `DAILY_API_KEY` — and every
     * one of them charged in full. §5.5 calls that a platform technical failure.
     */
    it('refunds the whole charge and writes `error` as the reason', async () => {
      const collaborators = deps({
        lockSession: spy(async () => endedAfter(600, { hasVideo: false })),
      });

      await terminateSession(
        { sessionId: SESSION_ID, endReason: 'student_ended', actorId: STUDENT_ID },
        collaborators,
      );

      const written = settlement(collaborators);

      assert.equal(written.endReason, 'error');
      assert.equal(written.platformFee, 0);
      assert.equal(written.teacherEarning, 0);
      assert.equal(refunds(collaborators)[0][0].amount, TOTAL_CHARGED);
      assert.equal(earnings(collaborators).length, 0);
    });

    it('applies whoever ended it — the teacher, and the clock', async () => {
      for (const actorId of [TEACHER_ID, null]) {
        const collaborators = deps({
          lockSession: spy(async () => endedAfter(600, { hasVideo: false })),
        });

        await terminateSession(
          { sessionId: SESSION_ID, endReason: 'student_ended', actorId },
          collaborators,
        );

        // A platform failure is not the participants' to bear, and which of them gave up
        // first is not a fact about whose fault it was.
        assert.equal(settlement(collaborators).endReason, 'error');
        assert.equal(refunds(collaborators)[0][0].amount, TOTAL_CHARGED);
      }
    });

    it('wins over case 2, and refunds once rather than twice', async () => {
      const collaborators = deps({
        lockSession: spy(async () => endedAfter(40, { hasVideo: false })),
      });

      await terminateSession(
        { sessionId: SESSION_ID, endReason: 'student_ended', actorId: STUDENT_ID },
        collaborators,
      );

      // A student who walks out at forty seconds *because there is no camera* is owed the
      // refund for the platform's reason, and `end_reason` should say so.
      assert.equal(settlement(collaborators).endReason, 'error');
      assert.equal(refunds(collaborators).length, 1);
    });

    it('tells both sides the reason the row says, not the one it was asked for', async () => {
      const collaborators = deps({
        lockSession: spy(async () => endedAfter(600, { hasVideo: false })),
      });

      const result = await terminateSession(
        { sessionId: SESSION_ID, endReason: 'student_ended', actorId: STUDENT_ID },
        collaborators,
      );

      // `student_ended` on the wire for a session the platform failed to deliver would be
      // the product blaming the student for its own outage.
      assert.equal(result.endReason, 'error');
      assert.equal(collaborators.notifyEnded.calls[0][1].endReason, 'error');
    });
  });

  describe('case 2 — the student left inside the opening window', () => {
    it('refunds in full and leaves the reason alone', async () => {
      const collaborators = deps({ lockSession: spy(async () => endedAfter(40)) });

      await terminateSession(
        { sessionId: SESSION_ID, endReason: 'student_ended', actorId: STUDENT_ID },
        collaborators,
      );

      const written = settlement(collaborators);

      // The column says *why the session is over*. 6.6 refused to invent `teacher_ended`
      // for the same reason; the refund is a fact about the money.
      assert.equal(written.endReason, 'student_ended');
      assert.equal(written.platformFee, 0);
      assert.equal(written.teacherEarning, 0);
      assert.equal(refunds(collaborators)[0][0].amount, TOTAL_CHARGED);
      assert.equal(earnings(collaborators).length, 0);
    });

    it('charges at exactly the window — the boundary is strictly inside', async () => {
      const collaborators = deps({
        lockSession: spy(async () => endedAfter(NO_SHOW_WINDOW_SEC)),
      });

      await terminateSession(
        { sessionId: SESSION_ID, endReason: 'student_ended', actorId: STUDENT_ID },
        collaborators,
      );

      // The same boundary `reportSessionNoShow` draws. Two sixty-second windows that
      // disagreed about the sixtieth second would be worse than either rule alone.
      assert.equal(refunds(collaborators).length, 0);
      assert.equal(earnings(collaborators).length, 1);
    });

    it('charges a student who left after the window', async () => {
      const collaborators = deps({ lockSession: spy(async () => endedAfter(90)) });

      await terminateSession(
        { sessionId: SESSION_ID, endReason: 'student_ended', actorId: STUDENT_ID },
        collaborators,
      );

      const written = settlement(collaborators);

      assert.equal(refunds(collaborators).length, 0);
      assert.equal(written.platformFee + written.teacherEarning, TOTAL_CHARGED);
    });

    it("is the student's alone — a teacher ending at forty seconds is charged", async () => {
      const collaborators = deps({ lockSession: spy(async () => endedAfter(40)) });

      await terminateSession(
        { sessionId: SESSION_ID, endReason: 'student_ended', actorId: TEACHER_ID },
        collaborators,
      );

      // Actor-blind, this would let the one party who benefits from a refund trigger it.
      // A teacher leaving at forty seconds is nearer §5.5's no-show row than this one.
      assert.equal(refunds(collaborators).length, 0);
      assert.equal(earnings(collaborators).length, 1);
    });

    it('refuses a student who extended and then left inside the window', async () => {
      const collaborators = deps({
        lockSession: spy(async () =>
          endedAfter(40, { blocksUsed: OPENING_BLOCKS + 1, totalCharged: TOTAL_CHARGED }),
        ),
      });

      await terminateSession(
        { sessionId: SESSION_ID, endReason: 'student_ended', actorId: STUDENT_ID },
        collaborators,
      );

      // `reportSessionNoShow`'s second guard, word for word. Buying another block says the
      // session is working; pressing End eight seconds later says it is not, and the clock
      // alone would refund both blocks.
      assert.equal(refunds(collaborators).length, 0);
      assert.equal(earnings(collaborators).length, 1);
    });
  });

  describe('case 3 — everything else is 6.6, unchanged', () => {
    it('still splits the gross and still credits the teacher', async () => {
      const collaborators = deps({ lockSession: spy(async () => endedAfter(600)) });

      await terminateSession(
        { sessionId: SESSION_ID, endReason: 'student_ended', actorId: STUDENT_ID },
        collaborators,
      );

      const written = settlement(collaborators);

      assert.equal(written.endReason, 'student_ended');
      assert.equal(written.platformFee + written.teacherEarning, TOTAL_CHARGED);
      assert.equal(refunds(collaborators).length, 0);
      assert.equal(earnings(collaborators)[0][0].amount, written.teacherEarning);
    });

    it('never credits and refunds the same session', async () => {
      for (const row of [endedAfter(40), endedAfter(600), endedAfter(600, { hasVideo: false })]) {
        const collaborators = deps({ lockSession: spy(async () => row) });

        await terminateSession(
          { sessionId: SESSION_ID, endReason: 'student_ended', actorId: STUDENT_ID },
          collaborators,
        );

        assert.ok(
          refunds(collaborators).length === 0 || earnings(collaborators).length === 0,
          'a session paid the teacher and refunded the student',
        );
      }
    });

    it('refunds nothing on a session that charged nothing', async () => {
      const collaborators = deps({
        lockSession: spy(async () => endedAfter(40, { totalCharged: 0 })),
      });

      await terminateSession(
        { sessionId: SESSION_ID, endReason: 'student_ended', actorId: STUDENT_ID },
        collaborators,
      );

      // `wallet.service.js` refuses a non-positive amount as a programming error, so the
      // guard is the same one the earning has.
      assert.equal(refunds(collaborators).length, 0);
    });
  });

  it("leaves §10's table alone — this is a pricing rule, not a lifecycle one", async () => {
    const stateSource = await readFile(
      fileURLToPath(new URL('../src/services/session.state.js', import.meta.url)),
      'utf8',
    );

    // A third terminal state meaning "the same ending, refunded" would be a table every
    // future reader has to reconcile with a diagram that does not contain it.
    assert.match(stateSource, /ACTIVE: Object\.freeze\(\['ENDED', 'NO_SHOW'\]\)/);
  });
});
