import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `OFFER_SENT` → `ACTIVE`, the room that follows it, and `SessionState` on the way back
 * out. PR 6.3, MVP.md §10 and §12.
 *
 * **No test in this repository calls Daily.** `createSessionVideo` arrives through the
 * deps argument like every other collaborator, so the two paths that matter — the room
 * that was minted and the room that could not be — are both assertable with no API key,
 * no network and no database. A suite that needed a key is a suite that fails in CI and
 * gets skipped, which is the epic README's ruling and the reason 6.1's seam is a
 * function rather than a `fetch` in the middle of a service.
 *
 * **What this file cannot test.** `findSessionForMeter` is a `SELECT … FOR UPDATE`, and
 * whether that lock is actually taken is invisible to every test below: they run one
 * request at a time, and a sequential suite cannot tell a locked read from an unlocked
 * one. What *is* asserted is that `assertTransition` is fed the value that read returned
 * rather than one fetched earlier, which is the half a test can see. The other half is
 * the brief's manual run: two browsers, two accepts on the same offer.
 *
 * **`SessionState` is tested here rather than beside 5.4's shapes**, because 6.3 is what
 * makes an `ACTIVE` session exist at all. `offer.respond.test.js` keeps the two offer
 * shapes it has asserted since 5.4, and neither file re-tests the other's.
 *
 * Nothing here types a block count or a block length. `OPENING_BLOCKS` and
 * `BLOCK_MINUTES` are imported and the expected `endsAt` computed from them, so the day
 * somebody tunes the appendix this file moves with it instead of passing for the wrong
 * reason.
 */

// The service imports `config/db.js` transitively for `$transaction`, and that validates
// the environment at import time and calls `process.exit(1)` on a missing
// `DATABASE_URL`. Filling the required variables before the dynamic import keeps
// `npm test` runnable on a machine with no `.env`.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { BLOCK_MINUTES, OFFER_STATUS, OPENING_BLOCKS } = await import('#config/constants/index.js');
const { ERROR_CODES } = await import('#config/errors/codes.js');
const { AppError } = await import('#utils/AppError.js');
const { activateAcceptedOffer, attachSessionVideo } =
  await import('#services/session.activate.service.js');
const { getSessionView } = await import('#services/session.view.service.js');
const { toSessionState } = await import('#utils/sessionView.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER_ID = '44444444-4444-4444-8444-444444444444';
const QUESTION_ID = '55555555-5555-4555-8555-555555555555';
const OFFER_ID = '66666666-6666-4666-8666-666666666666';

const PRICE_PER_BLOCK = 12;
const BUDGET_CAP = 40;
const BALANCE = 96;

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

/** A `findOfferForRespond` row, already proven live and the caller's by 5.4. */
const offer = (overrides = {}) => ({
  id: OFFER_ID,
  status: OFFER_STATUS.PENDING,
  expiresAt: new Date(Date.now() + 30_000),
  teacherId: TEACHER_ID,
  session: {
    id: SESSION_ID,
    status: 'OFFER_SENT',
    studentId: STUDENT_ID,
    questionId: QUESTION_ID,
  },
  ...overrides,
});

/** What `findSessionForMeter` returns under the lock. */
const lockedRow = (overrides = {}) => ({
  id: SESSION_ID,
  status: 'OFFER_SENT',
  studentId: STUDENT_ID,
  teacherId: TEACHER_ID,
  pricePerBlock: PRICE_PER_BLOCK,
  budgetCap: BUDGET_CAP,
  blocksUsed: 0,
  totalCharged: 0,
  startedAt: null,
  endsAt: null,
  ...overrides,
});

/** What Daily answers with, through 6.1's seam. */
const room = (overrides = {}) => ({
  provider: 'daily',
  roomName: 'tn-abc123',
  roomUrl: 'https://tutornow.daily.co/tn-abc123',
  expiresAt: Math.floor(Date.now() / 1000) + 86_400,
  ...overrides,
});

/**
 * The happy path's collaborators, each replaceable by name.
 *
 * `runTransaction` mirrors Prisma's contract rather than merely calling the callback:
 * it records `committed` or `rolledBack` and rethrows, so "the failure path rolls back
 * rather than compensating" is an assertion instead of a code-review item.
 */
function deps(overrides = {}) {
  const base = {
    lockSession: spy(async () => lockedRow()),
    markResponded: spy(async () => ({ count: 1 })),
    activateSession: spy(async () => ({ count: 1 })),
    takeTeacher: spy(async () => ({ locked: true })),
    announceStatus: spy(),
    notifyAccepted: spy(),
    createRoom: spy(async () => room()),
    saveRoom: spy(async () => ({ count: 1 })),
    // 6.5's two. `chargeCredits` is `wallet.service.js`'s `chargeStudent`, which takes
    // the `tx` and opens nothing of its own — stubbed here so the accept's five steps
    // are still assertable with no wallet, no ledger and no database.
    chargeCredits: spy(async () => ({ balanceAfter: BALANCE - OPENING_BLOCKS * PRICE_PER_BLOCK })),
    saveBlock: spy(async () => ({ id: 'block-1' })),
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

/** The service's one input, with the caller overridable. */
const input = (overrides = {}) => ({ offer: offer(), teacherId: TEACHER_ID, ...overrides });

/** Asserts the rejection carries a specific `ERROR_CODES` value, not merely that it threw. */
async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}`);

    return true;
  });
}

describe('activateAcceptedOffer — the five steps', () => {
  it('locks the session, marks the offer ACCEPTED, activates it and takes the teacher', async () => {
    const collaborators = deps();

    const result = await activateAcceptedOffer(input(), collaborators);
    await result.video;

    const [responded] = collaborators.markResponded.calls[0];

    assert.deepEqual(collaborators.lockSession.calls[0], [SESSION_ID, TX]);
    assert.equal(responded.offerId, OFFER_ID);
    assert.equal(responded.status, OFFER_STATUS.ACCEPTED);
    assert.equal(collaborators.activateSession.calls.length, 1);
    assert.deepEqual(collaborators.takeTeacher.calls[0], [TEACHER_ID, TX]);
    assert.equal(collaborators.runTransaction.committed, true);
  });

  it('every write inside the transaction receives the tx, never the global client', async () => {
    const collaborators = deps();

    const result = await activateAcceptedOffer(input(), collaborators);
    await result.video;

    assert.equal(collaborators.lockSession.calls[0][1], TX);
    assert.equal(collaborators.markResponded.calls[0][1], TX);
    assert.equal(collaborators.activateSession.calls[0][1], TX);
    assert.equal(collaborators.takeTeacher.calls[0][1], TX);
  });

  it('computes endsAt from OPENING_BLOCKS x BLOCK_MINUTES, not from a literal', async () => {
    const collaborators = deps();

    const result = await activateAcceptedOffer(input(), collaborators);
    await result.video;

    const [{ startedAt, endsAt }] = collaborators.activateSession.calls[0];

    assert.equal(
      endsAt.getTime() - startedAt.getTime(),
      OPENING_BLOCKS * BLOCK_MINUTES * 60 * 1000,
    );

    // The same two instants reach the column and the caller. A result that recomputed
    // them would be a second clock.
    assert.equal(result.startedAt, startedAt);
    assert.equal(result.endsAt, endsAt);
    assert.equal(result.status, 'ACTIVE');
  });

  it('charges the opening block inside the transaction, and writes both counters', async () => {
    const collaborators = deps();

    const result = await activateAcceptedOffer(input(), collaborators);
    await result.video;

    const amount = OPENING_BLOCKS * PRICE_PER_BLOCK;
    const [written] = collaborators.activateSession.calls[0];
    const [charge, chargeTx] = collaborators.chargeCredits.calls[0];
    const [block, blockTx] = collaborators.saveBlock.calls[0];

    // 6.3 passed neither and said an unbilled `ACTIVE` session was not a billing bug.
    // 6.5 is the PR that made that sentence false.
    assert.equal(written.blocksUsed, OPENING_BLOCKS);
    assert.equal(written.totalCharged, amount);

    // The student, the session, a positive amount — and the `tx`, which is what makes
    // the charge and the state change one transaction rather than two.
    assert.equal(charge.userId, STUDENT_ID);
    assert.equal(charge.sessionId, SESSION_ID);
    assert.equal(charge.amount, amount);
    assert.equal(chargeTx, TX);

    assert.equal(block.blockNumber, 1);
    assert.equal(block.minutes, OPENING_BLOCKS * BLOCK_MINUTES);
    assert.equal(block.amount, amount);
    assert.equal(blockTx, TX);
  });

  it('rolls the whole accept back when the student cannot afford the opening block', async () => {
    const collaborators = deps({
      chargeCredits: spy(async () => {
        throw new AppError(ERROR_CODES.INSUFFICIENT_CREDIT, 'You do not have enough credits.');
      }),
    });

    const error = await activateAcceptedOffer(input(), collaborators).catch((thrown) => thrown);

    // The offer stays `PENDING` and the teacher stays `OFFER_LOCKED` because Postgres
    // undoes all three writes above with the charge — nothing here compensates by hand,
    // and 5.5's sweep releases the teacher when the offer runs out.
    assert.equal(error.code, ERROR_CODES.INSUFFICIENT_CREDIT);
    assert.equal(collaborators.runTransaction.rolledBack, true);
    assert.equal(collaborators.saveBlock.calls.length, 0);
    assert.equal(collaborators.announceStatus.calls.length, 0);
    assert.equal(collaborators.notifyAccepted.calls.length, 0);
  });

  it('prices the block off the locked row, never off the offer', async () => {
    const collaborators = deps({ lockSession: spy(async () => lockedRow({ pricePerBlock: 7 })) });

    const result = await activateAcceptedOffer(input(), collaborators);
    await result.video;

    const [charge] = collaborators.chargeCredits.calls[0];

    // 5.3 snapshots `price_per_block` onto the session at offer time precisely so a tier
    // change while the modal is open cannot reprice a block the student was quoted.
    assert.equal(charge.amount, OPENING_BLOCKS * 7);
  });

  it('refuses to charge a session that reached OFFER_SENT with no price', async () => {
    const collaborators = deps({
      lockSession: spy(async () => lockedRow({ pricePerBlock: null })),
    });

    const error = await activateAcceptedOffer(input(), collaborators).catch((thrown) => thrown);

    assert.equal(error.code, ERROR_CODES.INTERNAL_ERROR);
    assert.equal(collaborators.chargeCredits.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
  });

  it('announces IN_SESSION and tells the student, after the commit', async () => {
    const collaborators = deps();

    const result = await activateAcceptedOffer(input(), collaborators);
    await result.video;

    assert.deepEqual(collaborators.announceStatus.calls[0], [TEACHER_ID, 'IN_SESSION']);
    assert.deepEqual(collaborators.notifyAccepted.calls[0], [
      STUDENT_ID,
      { offerId: OFFER_ID, sessionId: SESSION_ID },
    ]);
  });

  it('puts no room URL on the wire — §13 is {offerId, sessionId} and nothing else', async () => {
    const collaborators = deps();

    const result = await activateAcceptedOffer(input(), collaborators);
    await result.video;

    const [, payload] = collaborators.notifyAccepted.calls[0];

    // A token is per-caller and an event is not. The URL leaves the server through
    // `GET /sessions/:id/video` alone.
    assert.deepEqual(Object.keys(payload).sort(), ['offerId', 'sessionId']);
  });
});

describe('activateAcceptedOffer — the assert, and what it is asserted against', () => {
  it('reads the status under the lock, not off the offer row the caller already had', async () => {
    // The offer's own copy says `OFFER_SENT` — the legal edge. The locked read says the
    // session has since ended. A service that trusted the caller's row would pass the
    // assert and start a session on top of an `ENDED` one.
    const collaborators = deps({ lockSession: spy(async () => lockedRow({ status: 'ENDED' })) });

    await rejectsWithCode(
      activateAcceptedOffer(input({ offer: offer() }), collaborators),
      ERROR_CODES.SESSION_NOT_ACTIVE,
    );

    assert.equal(collaborators.markResponded.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
  });

  it('asserts before it writes anything at all', async () => {
    const collaborators = deps({ lockSession: spy(async () => lockedRow({ status: 'RATED' })) });

    await rejectsWithCode(
      activateAcceptedOffer(input(), collaborators),
      ERROR_CODES.SESSION_NOT_ACTIVE,
    );

    assert.equal(collaborators.activateSession.calls.length, 0);
    assert.equal(collaborators.takeTeacher.calls.length, 0);
  });

  it('answers NOT_FOUND when the locked read finds no session', async () => {
    const collaborators = deps({ lockSession: spy(async () => null) });

    await rejectsWithCode(activateAcceptedOffer(input(), collaborators), ERROR_CODES.NOT_FOUND);

    assert.equal(collaborators.runTransaction.rolledBack, true);
  });
});

describe('activateAcceptedOffer — the races it has to lose', () => {
  it('answers OFFER_EXPIRED and rolls back when the offer was no longer PENDING', async () => {
    const collaborators = deps({ markResponded: spy(async () => ({ count: 0 })) });

    await rejectsWithCode(activateAcceptedOffer(input(), collaborators), ERROR_CODES.OFFER_EXPIRED);

    // No second `ACTIVE` session out of an already-answered offer.
    assert.equal(collaborators.activateSession.calls.length, 0);
    assert.equal(collaborators.takeTeacher.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
  });

  it('answers SESSION_NOT_ACTIVE when the row moved between the lock and the write', async () => {
    const collaborators = deps({ activateSession: spy(async () => ({ count: 0 })) });

    await rejectsWithCode(
      activateAcceptedOffer(input(), collaborators),
      ERROR_CODES.SESSION_NOT_ACTIVE,
    );

    assert.equal(collaborators.takeTeacher.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
  });

  it('answers TEACHER_UNAVAILABLE when the teacher was no longer OFFER_LOCKED', async () => {
    const collaborators = deps({ takeTeacher: spy(async () => ({ locked: false })) });

    await rejectsWithCode(
      activateAcceptedOffer(input(), collaborators),
      ERROR_CODES.TEACHER_UNAVAILABLE,
    );

    assert.equal(collaborators.runTransaction.rolledBack, true);
  });

  it('announces nothing, tells nobody and creates no room when it rolled back', async () => {
    const collaborators = deps({ takeTeacher: spy(async () => ({ locked: false })) });

    await rejectsWithCode(
      activateAcceptedOffer(input(), collaborators),
      ERROR_CODES.TEACHER_UNAVAILABLE,
    );

    assert.equal(collaborators.announceStatus.calls.length, 0);
    assert.equal(collaborators.notifyAccepted.calls.length, 0);

    // A room minted for a session that never started is litter on the Daily account,
    // and a `fetch` fired for a transaction that rolled back.
    assert.equal(collaborators.createRoom.calls.length, 0);
    assert.equal(collaborators.saveRoom.calls.length, 0);
  });
});

describe('the room — outside the transaction, and never fatal', () => {
  it('answers while Daily is still being asked, and writes the column after', async () => {
    const order = [];
    let answerDaily;

    const collaborators = deps({
      notifyAccepted: spy(() => order.push('emit')),
      createRoom: spy(
        () =>
          new Promise((resolve) => {
            order.push('createRoom');

            answerDaily = () => resolve(room());
          }),
      ),
      saveRoom: spy(async () => {
        order.push('saveRoom');

        return { count: 1 };
      }),
    });

    const result = await activateAcceptedOffer(input(), collaborators);

    // **Daily has not answered yet and the activation has already returned.** The
    // student's screen navigates on `offer:accepted` and then fetches; it must not wait
    // on the room any more than the teacher's `200` does. The emit is first, before the
    // request even goes out.
    assert.deepEqual(order, ['emit', 'createRoom']);
    assert.equal(collaborators.saveRoom.calls.length, 0);

    answerDaily();
    await result.video;

    assert.deepEqual(order, ['emit', 'createRoom', 'saveRoom']);
  });

  it('persists exactly what Daily answered with', async () => {
    const collaborators = deps();

    const result = await activateAcceptedOffer(input(), collaborators);

    assert.equal(await result.video, true);
    assert.deepEqual(collaborators.saveRoom.calls[0], [
      { sessionId: SESSION_ID, roomName: room().roomName, roomUrl: room().roomUrl },
    ]);
  });

  it('activates the session anyway when the key is unset and the seam throws', async () => {
    const collaborators = deps({
      createRoom: spy(async () => {
        const error = new Error('Video is not available right now.');

        error.code = ERROR_CODES.EXTERNAL_SERVICE_ERROR;

        throw error;
      }),
    });

    const result = await activateAcceptedOffer(input(), collaborators);

    // The accept succeeded. The columns stay null, `hasVideo` is `false`, 6.4 repairs
    // it on the first join, and the session runs in the meantime.
    assert.equal(result.status, 'ACTIVE');
    assert.equal(await result.video, false);
    assert.equal(collaborators.saveRoom.calls.length, 0);
    assert.equal(collaborators.runTransaction.committed, true);
  });

  it('activates the session anyway when Daily is unreachable', async () => {
    const collaborators = deps({
      createRoom: spy(async () => {
        throw new Error('fetch failed');
      }),
    });

    const result = await activateAcceptedOffer(input(), collaborators);

    assert.equal(result.status, 'ACTIVE');
    assert.equal(await result.video, false);
  });

  it('activates the session anyway when the column write itself fails', async () => {
    const collaborators = deps({
      saveRoom: spy(async () => {
        throw new Error('connection terminated');
      }),
    });

    const result = await activateAcceptedOffer(input(), collaborators);

    assert.equal(result.status, 'ACTIVE');
    assert.equal(await result.video, false);
  });

  it('never rejects, so an ignored promise is never an unhandled rejection', async () => {
    // Production drops this promise on the floor — that is what keeps Daily off the
    // accept's critical path. A rejection nobody holds is a process-level event on Node.
    const failed = await attachSessionVideo(SESSION_ID, {
      createRoom: async () => {
        throw new Error('fetch failed');
      },
      saveRoom: spy(),
    });

    assert.equal(failed, false);
  });

  it('treats a lost race for the column as not-an-error', async () => {
    // `setSessionVideoRoom` is conditional on `video_room_name IS NULL`. Zero means 6.4's
    // repair minted one first; the session has a room either way.
    const persisted = await attachSessionVideo(SESSION_ID, {
      createRoom: async () => room(),
      saveRoom: async () => ({ count: 0 }),
    });

    assert.equal(persisted, false);
  });
});

/** A `findSessionForView` row for a session that is running. */
const activeSession = (overrides = {}) => ({
  id: SESSION_ID,
  status: 'ACTIVE',
  studentId: STUDENT_ID,
  teacherId: TEACHER_ID,
  questionId: QUESTION_ID,
  pricePerBlock: PRICE_PER_BLOCK,
  startedAt: new Date('2026-08-19T09:00:00.000Z'),
  endsAt: new Date('2026-08-19T09:10:00.000Z'),
  budgetCap: BUDGET_CAP,
  blocksUsed: 0,
  totalCharged: 0,
  teacherEarning: 0,
  videoRoomName: 'tn-abc123',
  endedAt: null,
  endReason: null,
  student: { id: STUDENT_ID, fullName: 'Noa Cohen', avatarUrl: null },
  teacher: { id: TEACHER_ID, fullName: 'Dana Levi', avatarUrl: 'https://cdn/x.png' },
  question: {
    teacherBrief: 'Stuck applying the chain rule to a nested trig function.',
    estimatedLevel: 5,
    declaredLevel: 4,
    topic: { id: 9, nameHe: 'חשבון דיפרנציאלי', nameEn: 'Calculus' },
    subtopic: { id: 91, nameHe: 'כלל השרשרת', nameEn: 'The chain rule' },
  },
  offers: [],
  ...overrides,
});

function viewDeps(overrides = {}) {
  return {
    loadSession: spy(async () => activeSession()),
    loadTeacher: spy(async () => null),
    loadBalance: spy(async () => BALANCE),
    ...overrides,
  };
}

describe('GET /sessions/:id — SessionState, once the session is ACTIVE', () => {
  it('answers the student with their balance and a null teacherEarning', async () => {
    const collaborators = viewDeps();

    const view = await getSessionView({ sessionId: SESSION_ID, userId: STUDENT_ID }, collaborators);

    assert.equal(view.role, 'student');
    assert.equal(view.balance, BALANCE);
    assert.equal(view.teacherEarning, null);
    assert.equal(view.counterpart.userId, TEACHER_ID);
    assert.equal(view.counterpart.fullName, 'Dana Levi');
  });

  it('answers the teacher with their earning and a null balance, reading no wallet', async () => {
    const collaborators = viewDeps();

    const view = await getSessionView({ sessionId: SESSION_ID, userId: TEACHER_ID }, collaborators);

    assert.equal(view.role, 'teacher');
    assert.equal(view.balance, null);
    assert.equal(view.teacherEarning, 0);
    assert.equal(view.counterpart.userId, STUDENT_ID);

    // `balance` is null on this payload by contract, so a wallet read would be a query
    // whose result is thrown away — once per tick, on a screen with a meter on it.
    assert.equal(collaborators.loadBalance.calls.length, 0);
  });

  it('nulls the other role’s field rather than omitting the key', async () => {
    const collaborators = viewDeps();

    const student = await getSessionView(
      { sessionId: SESSION_ID, userId: STUDENT_ID },
      collaborators,
    );
    const teacher = await getSessionView(
      { sessionId: SESSION_ID, userId: TEACHER_ID },
      collaborators,
    );

    // `in`, not a truthiness check. A renderer cannot tell an absent key from a
    // forbidden one, and the contract types both fields `number | null`.
    assert.equal('teacherEarning' in student, true);
    assert.equal('balance' in teacher, true);

    // One shape, two fillings. The keys must match exactly or 6.7 is two screens.
    assert.deepEqual(Object.keys(student).sort(), Object.keys(teacher).sort());
  });

  it('carries no room URL and no token — hasVideo is the whole of it', async () => {
    const collaborators = viewDeps();

    const view = await getSessionView({ sessionId: SESSION_ID, userId: STUDENT_ID }, collaborators);

    assert.equal(view.hasVideo, true);
    assert.equal('videoRoomUrl' in view, false);
    assert.equal('roomUrl' in view, false);
    assert.equal('token' in view, false);
  });

  it('reports hasVideo false when 6.3’s fetch failed, on a perfectly healthy session', async () => {
    const collaborators = viewDeps({
      loadSession: spy(async () => activeSession({ videoRoomName: null })),
    });

    const view = await getSessionView({ sessionId: SESSION_ID, userId: STUDENT_ID }, collaborators);

    assert.equal(view.status, 'ACTIVE');
    assert.equal(view.hasVideo, false);
  });

  it('reports the meter as the row has it — 6.3 charges nothing', async () => {
    const collaborators = viewDeps();

    const view = await getSessionView({ sessionId: SESSION_ID, userId: STUDENT_ID }, collaborators);

    assert.equal(view.blocksUsed, 0);
    assert.equal(view.totalCharged, 0);
    assert.equal(view.budgetCap, BUDGET_CAP);
    assert.equal(view.pricePerBlock, PRICE_PER_BLOCK);
  });

  it('derives brief, topicLabel and level exactly as the offer shapes do', async () => {
    const collaborators = viewDeps();

    const view = await getSessionView({ sessionId: SESSION_ID, userId: TEACHER_ID }, collaborators);

    // Subtopic over topic, estimate over declaration. The same question must not
    // describe itself differently either side of an accept.
    assert.equal(view.topicLabel, 'כלל השרשרת');
    assert.equal(view.level, 5);
    assert.equal(view.brief, activeSession().question.teacherBrief);
  });

  it('answers isRated only at RATED, and reads no reviews to decide', async () => {
    const running = toSessionState({ session: activeSession(), role: 'student', balance: BALANCE });
    const rated = toSessionState({
      session: activeSession({ status: 'RATED' }),
      role: 'student',
      balance: BALANCE,
    });

    assert.equal(running.isRated, false);
    assert.equal(rated.isRated, true);
  });

  it('serialises every instant as ISO 8601, and null where there is none', async () => {
    const view = toSessionState({ session: activeSession(), role: 'student', balance: BALANCE });

    assert.equal(view.startedAt, '2026-08-19T09:00:00.000Z');
    assert.equal(view.endsAt, '2026-08-19T09:10:00.000Z');
    assert.equal(view.endedAt, null);
    assert.equal(view.endReason, null);
  });

  it('answers NOT_FOUND for a third user, and reads no wallet on the way', async () => {
    const collaborators = viewDeps();

    await rejectsWithCode(
      getSessionView({ sessionId: SESSION_ID, userId: STRANGER_ID }, collaborators),
      ERROR_CODES.NOT_FOUND,
    );

    assert.equal(collaborators.loadBalance.calls.length, 0);
  });

  it('answers SessionState for every state at ACTIVE or past it', async () => {
    for (const status of ['ACTIVE', 'ENDED', 'RATED', 'NO_SHOW']) {
      const collaborators = viewDeps({ loadSession: spy(async () => activeSession({ status })) });

      const view = await getSessionView(
        { sessionId: SESSION_ID, userId: STUDENT_ID },
        collaborators,
      );

      assert.equal(view.status, status, `${status} did not answer SessionState`);
      assert.equal(view.role, 'student');
    }
  });

  it('leaves 5.8’s screen alone — OFFER_SENT still answers the offer shapes', async () => {
    const collaborators = viewDeps({
      loadSession: spy(async () =>
        activeSession({
          status: 'OFFER_SENT',
          startedAt: null,
          endsAt: null,
          offers: [
            {
              id: OFFER_ID,
              status: OFFER_STATUS.PENDING,
              teacherId: TEACHER_ID,
              expiresAt: new Date(Date.now() + 30_000),
              respondedAt: null,
              createdAt: new Date(),
            },
          ],
        }),
      ),
    });

    const view = await getSessionView({ sessionId: SESSION_ID, userId: STUDENT_ID }, collaborators);

    // 5.8 switches on the offer's status and knows nothing about `role`. A session that
    // answered `SessionState` here would break the awaiting screen on a reload.
    assert.equal(view.offerId, OFFER_ID);
    assert.equal(view.status, OFFER_STATUS.PENDING);
    assert.equal('role' in view, false);
    assert.equal(collaborators.loadBalance.calls.length, 0);
  });
});

/**
 * The activation's own source, read as text.
 *
 * The checks below are about what is *not* in this file, and no amount of dependency
 * injection can express "no `fetch` inside a transaction". Reading the source is the
 * honest way to assert it, and it is the brief's first review line made mechanical
 * rather than left to whoever reads the diff.
 */
const activateSource = await readFile(
  fileURLToPath(new URL('../src/services/session.activate.service.js', import.meta.url)),
  'utf8',
);

describe('the line this PR is most likely to get wrong', () => {
  it('creates no room and calls no fetch inside the transaction callback', () => {
    const callback = activateSource.slice(
      activateSource.indexOf('await runTransaction('),
      activateSource.indexOf('collaborators.announceStatus('),
    );

    // Inside the transaction, a `fetch` holds a row lock on the session *and* the
    // teacher for as long as Daily takes to answer — thirty seconds on a bad day. It
    // passes every test in this file and only hurts under load, which is why this one
    // reads the text.
    assert.equal(/\bfetch\b/.test(callback), false);
    assert.equal(/createRoom|createSessionVideo|saveRoom/.test(callback), false);
  });

  it('charges through the wallet service and never touches the ledger itself', () => {
    const imports = activateSource.match(/^import[\s\S]*?;$/gm) ?? [];

    // The charge arrives as a dependency, from `wallet.service.js` — §17.5's
    // human-written file — and never as a `walletTransaction.create` in this service. A
    // second place that appends a ledger row is a second place the row lock is missing
    // from.
    assert.equal(
      imports.some((line) => /wallet\.service/.test(line)),
      true,
    );
    assert.equal(/walletTransaction|wallet\.repository/.test(activateSource), false);
  });

  it('charges inside the transaction callback, where the rollback can reach it', () => {
    const callback = activateSource.slice(
      activateSource.indexOf('await runTransaction('),
      activateSource.indexOf('collaborators.announceStatus('),
    );

    // The opposite requirement to the room above, and for the same reason stated the
    // other way round: a charge outside this callback is money that survives a rolled
    // back accept.
    assert.match(callback, /await chargeCredits\(/);
    assert.match(callback, /await saveBlock\(/);
  });
});
