import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The teacher's two answers — `POST /offers/:id/accept`, `POST /offers/:id/reject`
 * and `GET /sessions/:id`. PR 5.4, MVP.md §10 and §12.
 *
 * **What this file cannot test, said first so a green run is not mistaken for a
 * verified release.** `releaseTeacherLock` is a conditional `UPDATE` whose `where`
 * carries `status = 'OFFER_LOCKED'`, and dropping that predicate is invisible to every
 * test below: they all run one request at a time, and a sequential suite cannot tell a
 * conditional release from an unconditional one — both leave the teacher `ONLINE` when
 * the teacher was locked. `offer.send.test.js` draws the same line around the lock for
 * the same reason. The verification is the brief's manual test: reject with the teacher
 * set `OFFLINE` by hand, and confirm they are still `OFFLINE` afterwards.
 *
 * What it *can* test is the service's ordering and, more usefully, the calls that
 * **did not happen** — that a stranger's request never reads a teacher row, that a
 * rejection that found nothing to reject never resets a session, that a late accept
 * never activates one, that nothing anywhere imports a wallet. A suite running against
 * real Postgres can see a row that moved; it can never see the absence of the statement
 * that would have moved it. That is what every collaborator arriving through the second
 * argument buys.
 *
 * Nothing here types a block count or a block length. `OPENING_BLOCKS` and
 * `BLOCK_MINUTES` are imported and the expected `endsAt` is computed from them, so the
 * day somebody tunes the appendix this file moves with it instead of passing for the
 * wrong reason.
 */

// The services import `config/db.js` transitively for `$transaction`, and that
// validates the environment at import time and calls `process.exit(1)` on a missing
// `DATABASE_URL`. Filling the required variables before the dynamic import keeps
// `npm test` runnable on a machine with no `.env`.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { BLOCK_MINUTES, OFFER_STATUS, OPENING_BLOCKS } = await import('#config/constants/index.js');
const { ERROR_CODES } = await import('#config/errors/codes.js');
const { acceptOffer, rejectOffer } = await import('#services/offer.respond.service.js');
const { getSessionView } = await import('#services/session.view.service.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_TEACHER_ID = '77777777-7777-4777-8777-777777777777';
const QUESTION_ID = '55555555-5555-4555-8555-555555555555';
const OFFER_ID = '66666666-6666-4666-8666-666666666666';

const PRICE_PER_BLOCK = 12;

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

/** A `findOfferForRespond` row: `PENDING`, live for another thirty seconds. */
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

/** The same row, forty minutes past its instant and still reading `PENDING`. */
const staleOffer = (overrides = {}) =>
  offer({ expiresAt: new Date(Date.now() - 40 * 60_000), ...overrides });

/**
 * The happy path's collaborators, each replaceable by name.
 *
 * `runTransaction` mirrors Prisma's contract rather than merely calling the callback:
 * it records `committed` or `rolledBack` and rethrows, so "the failure path rolls back
 * rather than compensating" is an assertion instead of a code-review item.
 */
function deps(overrides = {}) {
  const base = {
    findOffer: spy(async () => offer()),
    markResponded: spy(async () => ({ count: 1 })),
    activateSession: spy(async () => ({ count: 1 })),
    resetSession: spy(async () => ({ count: 1 })),
    takeTeacher: spy(async () => ({ locked: true })),
    releaseTeacher: spy(async () => ({ locked: true })),
    appendRejection: spy(async () => [TEACHER_ID]),
    announceStatus: spy(),
    notifyAccepted: spy(),
    notifyRejected: spy(),
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
const input = (overrides = {}) => ({ offerId: OFFER_ID, teacherId: TEACHER_ID, ...overrides });

/** Asserts the rejection carries a specific `ERROR_CODES` value, not merely that it threw. */
async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}`);

    return true;
  });
}

describe('acceptOffer — the four steps', () => {
  it('marks the offer ACCEPTED, activates the session and takes the teacher', async () => {
    const collaborators = deps();

    await acceptOffer(input(), collaborators);

    const [responded] = collaborators.markResponded.calls[0];

    assert.equal(responded.offerId, OFFER_ID);
    assert.equal(responded.status, OFFER_STATUS.ACCEPTED);
    assert.equal(collaborators.activateSession.calls.length, 1);
    assert.deepEqual(collaborators.takeTeacher.calls[0], [TEACHER_ID, TX]);
    assert.equal(collaborators.runTransaction.committed, true);
  });

  it('every write inside the transaction receives the tx, never the global client', async () => {
    const collaborators = deps();

    await acceptOffer(input(), collaborators);

    assert.equal(collaborators.markResponded.calls[0][1], TX);
    assert.equal(collaborators.activateSession.calls[0][1], TX);
    assert.equal(collaborators.takeTeacher.calls[0][1], TX);
  });

  it('computes endsAt from OPENING_BLOCKS x BLOCK_MINUTES, not from a literal', async () => {
    const collaborators = deps();

    const response = await acceptOffer(input(), collaborators);

    const [{ startedAt, endsAt }] = collaborators.activateSession.calls[0];
    const expected = OPENING_BLOCKS * BLOCK_MINUTES * 60 * 1000;

    assert.equal(endsAt.getTime() - startedAt.getTime(), expected);

    // The same two instants reach the column and the caller. A response that
    // recomputed them would be a second clock.
    assert.equal(response.startedAt, startedAt.toISOString());
    assert.equal(response.endsAt, endsAt.toISOString());
    assert.equal(response.status, 'ACTIVE');
  });

  it('announces IN_SESSION and tells the student, after the commit', async () => {
    const collaborators = deps();

    await acceptOffer(input(), collaborators);

    assert.deepEqual(collaborators.announceStatus.calls[0], [TEACHER_ID, 'IN_SESSION']);
    assert.deepEqual(collaborators.notifyAccepted.calls[0], [
      STUDENT_ID,
      { offerId: OFFER_ID, sessionId: SESSION_ID },
    ]);
  });

  it('emits no zoomUrl key at all — not zoomUrl: null', async () => {
    const collaborators = deps();

    await acceptOffer(input(), collaborators);

    const [, payload] = collaborators.notifyAccepted.calls[0];

    // `in`, not a truthiness check. §13 names the field and E5 has no Zoom; a null
    // that means "later" is indistinguishable from a null that means "failed".
    assert.equal('zoomUrl' in payload, false);
  });
});

describe('acceptOffer — expiry is asserted in code, not read off status', () => {
  it('refuses an offer past its instant even though status still reads PENDING', async () => {
    const collaborators = deps({ findOffer: spy(async () => staleOffer()) });

    await rejectsWithCode(acceptOffer(input(), collaborators), ERROR_CODES.OFFER_EXPIRED);

    // The status the row carried was `PENDING`. Nothing in the service consulted it.
    assert.equal(staleOffer().status, OFFER_STATUS.PENDING);
    assert.equal(collaborators.activateSession.calls.length, 0);
  });

  it('sweeps that offer in the same call: EXPIRED, session back to PENDING, teacher released', async () => {
    const collaborators = deps({ findOffer: spy(async () => staleOffer()) });

    await rejectsWithCode(acceptOffer(input(), collaborators), ERROR_CODES.OFFER_EXPIRED);

    const [swept, tx] = collaborators.markResponded.calls[0];

    assert.equal(swept.status, OFFER_STATUS.EXPIRED);
    assert.equal(tx, TX);
    assert.deepEqual(collaborators.resetSession.calls[0], [SESSION_ID, TX]);
    assert.deepEqual(collaborators.releaseTeacher.calls[0], [TEACHER_ID, TX]);
    assert.deepEqual(collaborators.announceStatus.calls[0], [TEACHER_ID, 'ONLINE']);
  });

  it('does not reset a session or release anybody when the sweep found nothing to sweep', async () => {
    const collaborators = deps({
      findOffer: spy(async () => staleOffer({ status: OFFER_STATUS.ACCEPTED })),
      markResponded: spy(async () => ({ count: 0 })),
    });

    await rejectsWithCode(acceptOffer(input(), collaborators), ERROR_CODES.OFFER_EXPIRED);

    // An already-`ACCEPTED` offer past its original deadline belongs to a live
    // session. A sweep that reached in would end it.
    assert.equal(collaborators.resetSession.calls.length, 0);
    assert.equal(collaborators.releaseTeacher.calls.length, 0);
    assert.equal(collaborators.announceStatus.calls.length, 0);
  });

  it('still answers OFFER_EXPIRED when the tidy-up itself fails', async () => {
    const collaborators = deps({
      findOffer: spy(async () => staleOffer()),
      markResponded: spy(async () => {
        throw new Error('connection terminated');
      }),
    });

    await rejectsWithCode(acceptOffer(input(), collaborators), ERROR_CODES.OFFER_EXPIRED);
  });
});

describe('acceptOffer — the races it has to lose', () => {
  it('answers OFFER_EXPIRED and rolls back when the offer was no longer PENDING', async () => {
    const collaborators = deps({ markResponded: spy(async () => ({ count: 0 })) });

    await rejectsWithCode(acceptOffer(input(), collaborators), ERROR_CODES.OFFER_EXPIRED);

    // No second `ACTIVE` session out of an already-answered offer.
    assert.equal(collaborators.activateSession.calls.length, 0);
    assert.equal(collaborators.takeTeacher.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
  });

  it('answers SESSION_NOT_ACTIVE when the session had already moved', async () => {
    const collaborators = deps({ activateSession: spy(async () => ({ count: 0 })) });

    await rejectsWithCode(acceptOffer(input(), collaborators), ERROR_CODES.SESSION_NOT_ACTIVE);

    assert.equal(collaborators.takeTeacher.calls.length, 0);
    assert.equal(collaborators.runTransaction.rolledBack, true);
  });

  it('answers TEACHER_UNAVAILABLE when the teacher was no longer OFFER_LOCKED', async () => {
    const collaborators = deps({ takeTeacher: spy(async () => ({ locked: false })) });

    await rejectsWithCode(acceptOffer(input(), collaborators), ERROR_CODES.TEACHER_UNAVAILABLE);

    assert.equal(collaborators.runTransaction.rolledBack, true);
  });

  it('announces nothing and tells nobody when the transaction rolled back', async () => {
    const collaborators = deps({ takeTeacher: spy(async () => ({ locked: false })) });

    await rejectsWithCode(acceptOffer(input(), collaborators), ERROR_CODES.TEACHER_UNAVAILABLE);

    assert.equal(collaborators.announceStatus.calls.length, 0);
    assert.equal(collaborators.notifyAccepted.calls.length, 0);
  });

  it('never compensates a failure by hand — no release on the accept path', async () => {
    const collaborators = deps({ activateSession: spy(async () => ({ count: 0 })) });

    await rejectsWithCode(acceptOffer(input(), collaborators), ERROR_CODES.SESSION_NOT_ACTIVE);

    // Postgres undoes the offer write; a `catch` that put the teacher back would be a
    // second lock implementation with worse semantics.
    assert.equal(collaborators.releaseTeacher.calls.length, 0);
  });
});

describe('rejectOffer — three writes and the array E4 has been waiting for', () => {
  it('marks REJECTED, resets the session and releases the teacher', async () => {
    const collaborators = deps();

    const response = await rejectOffer(input(), collaborators);

    assert.equal(collaborators.markResponded.calls[0][0].status, OFFER_STATUS.REJECTED);
    assert.deepEqual(collaborators.resetSession.calls[0], [SESSION_ID, TX]);
    assert.deepEqual(collaborators.releaseTeacher.calls[0], [TEACHER_ID, TX]);
    assert.equal(response.status, OFFER_STATUS.REJECTED);
    assert.equal(collaborators.runTransaction.committed, true);
  });

  it('appends to rejected_by inside the transaction, with the tx and never prisma', async () => {
    const collaborators = deps();

    await rejectOffer(input(), collaborators);

    const [args, tx] = collaborators.appendRejection.calls[0];

    assert.deepEqual(args, { questionId: QUESTION_ID, teacherId: TEACHER_ID });

    // Prisma has no array-append for a scalar list, so the write is read-append-write
    // and two rejections in the same second lose one entry unless both hold this
    // transaction. The sentinel is the whole assertion.
    assert.equal(tx, TX);
  });

  it('announces ONLINE and tells the student, after the commit', async () => {
    const collaborators = deps();

    await rejectOffer(input(), collaborators);

    assert.deepEqual(collaborators.announceStatus.calls[0], [TEACHER_ID, 'ONLINE']);
    assert.deepEqual(collaborators.notifyRejected.calls[0], [
      STUDENT_ID,
      { offerId: OFFER_ID, sessionId: SESSION_ID },
    ]);
  });

  it('announces nothing when the release did not match — an OFFLINE teacher stays OFFLINE', async () => {
    const collaborators = deps({ releaseTeacher: spy(async () => ({ locked: false })) });

    await rejectOffer(input(), collaborators);

    // The teacher closed their laptop while the offer was open. Announcing `ONLINE`
    // would put them back on every open match list, which is the same defect the
    // repository's `where` exists to prevent, one layer up.
    assert.equal(collaborators.announceStatus.calls.length, 0);

    // The student is still told: their question is unmatched again either way.
    assert.equal(collaborators.notifyRejected.calls.length, 1);
  });
});

describe('rejectOffer — the no-op successes', () => {
  it('answers 200 for an expired offer and sweeps it rather than erroring', async () => {
    const collaborators = deps({ findOffer: spy(async () => staleOffer()) });

    const response = await rejectOffer(input(), collaborators);

    assert.equal(response.status, OFFER_STATUS.EXPIRED);
    assert.equal(collaborators.markResponded.calls[0][0].status, OFFER_STATUS.EXPIRED);
    assert.deepEqual(collaborators.releaseTeacher.calls[0], [TEACHER_ID, TX]);

    // Nothing was rejected, so nothing goes in `rejected_by` and the student is not
    // told a teacher declined. The clock declined, and the sweep says so.
    assert.equal(collaborators.appendRejection.calls.length, 0);
    assert.equal(collaborators.notifyRejected.calls.length, 0);
  });

  it('does nothing at all when the offer was already answered', async () => {
    const collaborators = deps({
      findOffer: spy(async () => offer({ status: OFFER_STATUS.ACCEPTED })),
      markResponded: spy(async () => ({ count: 0 })),
    });

    const response = await rejectOffer(input(), collaborators);

    // A stray reject must not tear down a session this teacher has already accepted.
    assert.equal(response.status, OFFER_STATUS.ACCEPTED);
    assert.equal(collaborators.resetSession.calls.length, 0);
    assert.equal(collaborators.appendRejection.calls.length, 0);
    assert.equal(collaborators.releaseTeacher.calls.length, 0);
    assert.equal(collaborators.notifyRejected.calls.length, 0);
  });
});

describe('both verbs — whose offer it is', () => {
  it('answers NOT_FOUND for another teacher’s offer, on both paths', async () => {
    const mine = deps({ findOffer: spy(async () => offer({ teacherId: OTHER_TEACHER_ID })) });
    const also = deps({ findOffer: spy(async () => offer({ teacherId: OTHER_TEACHER_ID })) });

    await rejectsWithCode(acceptOffer(input(), mine), ERROR_CODES.NOT_FOUND);
    await rejectsWithCode(rejectOffer(input(), also), ERROR_CODES.NOT_FOUND);

    // NOT_FOUND rather than FORBIDDEN: a 403 would confirm the id is real.
    assert.equal(mine.runTransaction.calls.length, 0);
    assert.equal(also.runTransaction.calls.length, 0);
  });

  it('answers NOT_FOUND for an offer that does not exist', async () => {
    const collaborators = deps({ findOffer: spy(async () => null) });

    await rejectsWithCode(acceptOffer(input(), collaborators), ERROR_CODES.NOT_FOUND);
  });
});

/** A `findSessionForView` row, with one live offer on it. */
const sessionView = (overrides = {}) => ({
  id: SESSION_ID,
  status: 'OFFER_SENT',
  studentId: STUDENT_ID,
  teacherId: TEACHER_ID,
  questionId: QUESTION_ID,
  pricePerBlock: PRICE_PER_BLOCK,
  startedAt: null,
  endsAt: null,
  question: {
    teacherBrief: 'Stuck applying the chain rule to a nested trig function.',
    estimatedLevel: 5,
    declaredLevel: 4,
    topic: { id: 9, nameHe: 'חשבון דיפרנציאלי', nameEn: 'Calculus' },
    subtopic: { id: 91, nameHe: 'כלל השרשרת', nameEn: 'The chain rule' },
  },
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
  ...overrides,
});

/** A `TEACHER_VIEW` row, for the student's side of the answer. */
const teacherRow = (overrides = {}) => ({
  userId: TEACHER_ID,
  bio: 'Third-year maths undergraduate.',
  pricePerBlock: PRICE_PER_BLOCK,
  levelMax: 5,
  status: 'OFFER_LOCKED',
  sessionsCount: 12,
  resolvedCount: 10,
  ratingSum: 44,
  ratingCount: 10,
  user: { fullName: 'Dana Levi' },
  topics: [{ topic: { id: 9, slug: 'calculus', nameHe: 'חשבון דיפרנציאלי', nameEn: 'Calculus' } }],
  ...overrides,
});

function viewDeps(overrides = {}) {
  return {
    loadSession: spy(async () => sessionView()),
    loadTeacher: spy(async () => teacherRow()),
    ...overrides,
  };
}

describe('GET /sessions/:id — one route, two shapes', () => {
  it('answers the teacher with IncomingOffer', async () => {
    const collaborators = viewDeps();

    const view = await getSessionView({ sessionId: SESSION_ID, userId: TEACHER_ID }, collaborators);

    assert.equal(view.offerId, OFFER_ID);
    assert.equal(view.sessionId, SESSION_ID);
    assert.equal(view.topicLabel, 'כלל השרשרת');
    assert.equal(view.level, 5);
    assert.equal(typeof view.expiresAt, 'string');

    // The teacher's side is not the student's: no card, no price column.
    assert.equal('teacher' in view, false);
    assert.equal('pricePerBlock' in view, false);
  });

  it('answers the student with the OfferResponse shape and the teacher card', async () => {
    const collaborators = viewDeps();

    const view = await getSessionView({ sessionId: SESSION_ID, userId: STUDENT_ID }, collaborators);

    assert.equal(view.offerId, OFFER_ID);
    assert.equal(view.status, OFFER_STATUS.PENDING);
    assert.equal(view.pricePerBlock, PRICE_PER_BLOCK);

    // 5.8's recovery link is `/app/ask/:questionId/teachers`, and a reload has nothing
    // else to build it from. `OfferResponse` has no such field — the deviation is
    // written on `studentView` and in 5.8's PR description.
    assert.equal(view.questionId, QUESTION_ID);
    assert.equal(view.teacher.id, TEACHER_ID);
    assert.equal(view.teacher.fullName, 'Dana Levi');

    // The row says `OFFER_LOCKED`, which `toTeacherCard` reads as not online — and it is
    // this offer doing the locking. "Offline" beside a running countdown tells the
    // student they asked somebody who is not there. `offerView.js` makes the same call
    // for the POST body, from the pre-lock row.
    assert.equal(view.teacher.isOnline, true);

    // `brief` is the teacher's field. A student reading their own question does not
    // get the teacher's payload by accident.
    assert.equal('brief' in view, false);
  });

  it('reports a PENDING offer past its instant as EXPIRED', async () => {
    const collaborators = viewDeps({
      loadSession: spy(async () =>
        sessionView({
          offers: [
            {
              id: OFFER_ID,
              status: OFFER_STATUS.PENDING,
              teacherId: TEACHER_ID,
              expiresAt: new Date(Date.now() - 40 * 60_000),
              respondedAt: null,
              createdAt: new Date(),
            },
          ],
        }),
      ),
    });

    const view = await getSessionView({ sessionId: SESSION_ID, userId: STUDENT_ID }, collaborators);

    // The column said `PENDING`. The sweeper was asleep, and the countdown must not
    // start on an offer that died forty minutes ago.
    assert.equal(view.status, OFFER_STATUS.EXPIRED);
  });

  it('answers the student with nulls, not a 404, on a session with no offer', async () => {
    const collaborators = viewDeps({
      loadSession: spy(async () =>
        sessionView({ status: 'PENDING', teacherId: null, pricePerBlock: null, offers: [] }),
      ),
    });

    const view = await getSessionView({ sessionId: SESSION_ID, userId: STUDENT_ID }, collaborators);

    assert.equal(view.sessionId, SESSION_ID);
    assert.equal(view.offerId, null);
    assert.equal(view.status, null);
    assert.equal(view.expiresAt, null);
    assert.equal(view.teacher, null);

    // No teacher on the session means no teacher read at all.
    assert.equal(collaborators.loadTeacher.calls.length, 0);
  });

  it('answers NOT_FOUND for a third user, and reads no teacher row on the way', async () => {
    const collaborators = viewDeps();

    await rejectsWithCode(
      getSessionView({ sessionId: SESSION_ID, userId: STRANGER_ID }, collaborators),
      ERROR_CODES.NOT_FOUND,
    );

    // The same answer a missing session gets, so the response does not say whether
    // the id exists.
    assert.equal(collaborators.loadTeacher.calls.length, 0);
  });

  it('answers NOT_FOUND for a session that does not exist', async () => {
    const collaborators = viewDeps({ loadSession: spy(async () => null) });

    await rejectsWithCode(
      getSessionView({ sessionId: SESSION_ID, userId: STUDENT_ID }, collaborators),
      ERROR_CODES.NOT_FOUND,
    );
  });
});

/**
 * The accept path's own source, read as text.
 *
 * The two checks below are about what is *not* in this file, and no amount of
 * dependency injection can express "nothing imported a wallet". Reading the source is
 * the honest way to assert it, and it is the brief's review line made mechanical
 * rather than left to whoever reads the diff.
 */
const respondSource = await readFile(
  fileURLToPath(new URL('../src/services/offer.respond.service.js', import.meta.url)),
  'utf8',
);

describe('the two steps the accept path does not have', () => {
  it('imports nothing from a wallet or a Zoom module', () => {
    const imports = respondSource.match(/^import[\s\S]*?;$/gm) ?? [];

    // E5 charges nothing and creates no meeting. This is the brief's review line made
    // mechanical: an import added in a later epic's hurry fails here rather than
    // being noticed by whoever reads the diff.
    assert.equal(
      imports.some((line) => /wallet|zoom/i.test(line)),
      false,
    );
  });

  it('names both absences with the epic that owns them', () => {
    assert.ok(respondSource.includes('[E7]'), 'the opening-block charge is not marked as E7');
    assert.ok(respondSource.includes('[E6]'), 'the Zoom meeting is not marked as E6');
  });
});
