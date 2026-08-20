import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * The offer transaction — `POST /sessions/:id/offer`, PR 5.3, MVP.md §11.3 A.
 *
 * **What this file cannot test, said first so that a green run is not mistaken for a
 * verified lock.** The mechanism this PR exists for is a conditional `UPDATE`
 * re-evaluating its `WHERE` under READ COMMITTED while a second transaction blocks on
 * the row. That is a property of Postgres, and nothing running in `node --test` with no
 * database can observe it: **every test below issues one request at a time, which is
 * exactly the shape of suite the brief says would still pass if the lock were wrong.**
 * The verification for `lockTeacherForOffer` is two browsers and the paired `curl`
 * processes in the PR brief, on the day this merges. `matching.pool.test.js` draws the
 * same line for the same reason.
 *
 * What it *can* test is everything about the service's ordering, and most of that is a
 * fact about a call that **did not happen** — that a broke student never reaches the
 * lock, that a lost race never writes an offer, that a rolled-back transaction
 * announces nothing. A suite running against real Postgres can see a teacher who ended
 * up unlocked; it can never see the absence of the statement that would have locked
 * them. Those assertions are the reason every collaborator arrives through
 * `sendOffer`'s second argument.
 *
 * Nothing here types a TTL, a block count or an error status. `OFFER_TTL_SECONDS` and
 * `OPENING_BLOCKS` are imported, and a test that wrote `60` or `2` would pass for the
 * wrong reason the day somebody tunes the appendix — `offer.core.test.js` and
 * `pricing.test.js` both make this point, and it is the same mistake in a third file.
 */

// The service imports `config/db.js` transitively for `$transaction`, and that
// validates the environment at import time and calls `process.exit(1)` on a missing
// `DATABASE_URL`. Filling the required variables before the dynamic import keeps
// `npm test` runnable on a machine with no `.env`. Nothing here is used: every
// collaborator is injected, and `runTransaction` is replaced outright.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { NEW_TEACHER_FEE_DAYS, OFFER_TTL_SECONDS, OPENING_BLOCKS, PLATFORM_FEE_PCT } =
  await import('#config/constants/index.js');
const { ERROR_CODES } = await import('#config/errors/codes.js');
const { sendOffer } = await import('#services/session.offer.service.js');
const { toIncomingOffer, toOfferResponse } = await import('#utils/offerView.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER_ID = '44444444-4444-4444-8444-444444444444';
const QUESTION_ID = '55555555-5555-4555-8555-555555555555';
const OFFER_ID = '66666666-6666-4666-8666-666666666666';

/** Credits per block, and a balance comfortably above the opening block. */
const PRICE_PER_BLOCK = 12;
const WALLET_BALANCE = 100;

/** One day, for the two fixtures below and the clock they are measured against. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * **The instant every commission assertion runs at, and it has to be pinned.**
 *
 * §5.3 charges nothing during `LOW_DEMAND_HOURS`, which is `[6, 14)` resolved through
 * `TIMEZONE`. `platformFeeRate` reads the wall clock, `sendOffer` gives it no seam to
 * inject one through, and the consequence is that an unpinned test of the fee asserts
 * the gross every morning and the net every afternoon. The first run of this block
 * failed at 12:17 Jerusalem time for exactly that reason — which is the same class of
 * defect as `isLowDemandHour` existing at all, and `utils/time.js`'s header says so:
 * a rule written against the host's clock passes locally and is wrong in production.
 *
 * 18:00 UTC is 20:00 in Asia/Jerusalem in March, outside the window at either offset,
 * so the choice does not depend on whether the date lands inside daylight saving.
 */
const FIXED_NOW = new Date('2026-03-10T18:00:00Z');

/** Inside the same window, so the free-hour branch gets its own assertion. */
const LOW_DEMAND_NOW = new Date('2026-03-10T08:00:00Z');

/**
 * A teacher past the new-teacher exemption, so `platformFeeRate` charges.
 *
 * Derived from `NEW_TEACHER_FEE_DAYS` rather than typed as a date: a fixture that said
 * "2024-01-01" would silently drift into the free window the day somebody lengthens it,
 * and the commission would quietly become `0` in every assertion below.
 */
const ESTABLISHED_SINCE = new Date(FIXED_NOW.getTime() - (NEW_TEACHER_FEE_DAYS + 1) * MS_PER_DAY);

/** The brief's acceptance criterion, literally: "a teacher created yesterday". */
const JOINED_YESTERDAY = new Date(FIXED_NOW.getTime() - MS_PER_DAY);

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

/** A `findSessionForOffer` row: `PENDING`, owned by `STUDENT_ID`. */
const session = (overrides = {}) => ({
  id: SESSION_ID,
  status: 'PENDING',
  studentId: STUDENT_ID,
  questionId: QUESTION_ID,
  question: {
    teacherBrief: 'Stuck applying the chain rule to a nested trig function.',
    topicId: 9,
    subtopicId: 91,
    estimatedLevel: 5,
    declaredLevel: 4,
  },
  ...overrides,
});

/**
 * A `TEACHER_VIEW` row, written out in full rather than trimmed to what the assertions
 * read — three of them are about what the serializer *does not* emit, and `status`,
 * `sessionsCount` and `resolvedCount` are on every real row.
 */
const teacher = (overrides = {}) => ({
  userId: TEACHER_ID,
  bio: 'Third-year maths undergraduate.',
  pricePerBlock: PRICE_PER_BLOCK,
  levelMax: 5,
  status: 'ONLINE',
  sessionsCount: 12,
  resolvedCount: 10,
  ratingSum: 44,
  ratingCount: 10,
  user: { fullName: 'Dana Levi' },
  topics: [{ topic: { id: 9, slug: 'calculus', nameHe: 'חשבון דיפרנציאלי', nameEn: 'Calculus' } }],
  ...overrides,
});

/** A `findSessionForView` row — the post-commit enrichment read, with topic names. */
const sessionView = (overrides = {}) => ({
  id: SESSION_ID,
  status: 'OFFER_SENT',
  question: {
    teacherBrief: 'Stuck applying the chain rule to a nested trig function.',
    estimatedLevel: 5,
    declaredLevel: 4,
    topic: { id: 9, nameHe: 'חשבון דיפרנציאלי', nameEn: 'Calculus' },
    subtopic: { id: 91, nameHe: 'כלל השרשרת', nameEn: 'The chain rule' },
  },
  ...overrides,
});

/**
 * A `findTeacherForNotification` row — the second post-commit read, added in 5.6.
 *
 * Two fields, because that is all the function selects: the start date §5.3's
 * commission needs, and the address the email needs. Deliberately not a
 * `TEACHER_VIEW` row — the card columns are already in hand from `findTeacher` at
 * this point, and a fixture carrying both would hide a service reading the wrong one.
 */
const teacherContact = (overrides = {}) => ({
  createdAt: ESTABLISHED_SINCE,
  user: { fullName: 'Dana Levi', email: 'dana@demo.tutornow.il' },
  ...overrides,
});

/**
 * The happy path's collaborators, each replaceable by name.
 *
 * `runTransaction` mirrors Prisma's contract rather than merely calling the callback:
 * it records `committed` or `rolledBack` and rethrows, so "the failure path rolls back
 * rather than compensating" is an assertion instead of a code-review item.
 *
 * `writeOffer` echoes the `expiresAt` it was handed. That is what lets one test follow
 * a single instant from the service's clock into the column, the response and the
 * socket payload without any of the three being hardcoded.
 */
function deps(overrides = {}) {
  const base = {
    findSession: spy(async () => session()),
    findBalance: spy(async () => WALLET_BALANCE),
    findTeacher: spy(async () => teacher()),
    lockTeacher: spy(async () => ({ locked: true })),
    writeOffer: spy(async ({ teacherId, expiresAt }) => ({
      id: OFFER_ID,
      status: 'PENDING',
      teacherId,
      expiresAt,
      createdAt: new Date(),
    })),
    markOfferSent: spy(async () => ({ count: 1 })),
    countOffer: spy(async () => ({})),
    loadSessionView: spy(async () => sessionView()),
    loadTeacherContact: spy(async () => teacherContact()),
    announceStatus: spy(),
    notifyTeacher: spy(),
    emailTeacher: spy(async () => undefined),
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

/** The service's one input, with the caller and the pick both overridable. */
const input = (overrides = {}) => ({
  sessionId: SESSION_ID,
  studentId: STUDENT_ID,
  teacherId: TEACHER_ID,
  ...overrides,
});

/** Asserts the rejection carries a specific `ERROR_CODES` value, not merely that it threw. */
async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}`);

    return true;
  });
}

describe('sendOffer — the happy path', () => {
  it('answers an OfferResponse carrying the created offer and the price snapshot', async () => {
    const collaborators = deps();

    const response = await sendOffer(input(), collaborators);

    assert.equal(response.offerId, OFFER_ID);
    assert.equal(response.sessionId, SESSION_ID);
    assert.equal(response.status, 'PENDING');
    assert.equal(response.pricePerBlock, PRICE_PER_BLOCK);
    assert.equal(response.teacher.id, TEACHER_ID);
    assert.ok(collaborators.runTransaction.committed);
  });

  it('expires the offer OFFER_TTL_SECONDS from now, to the second', async () => {
    const before = Date.now();

    const response = await sendOffer(input(), deps());

    const after = Date.now();
    const expiresAt = new Date(response.expiresAt).getTime();

    // A window rather than an equality, because the service reads its own clock. The
    // TTL is imported: a test that wrote 60 would pass for the wrong reason the day
    // the appendix is tuned.
    assert.ok(expiresAt >= before + OFFER_TTL_SECONDS * 1000);
    assert.ok(expiresAt <= after + OFFER_TTL_SECONDS * 1000);
  });

  it('writes one instant to the column, the response and the socket payload', async () => {
    const collaborators = deps();

    const response = await sendOffer(input(), collaborators);

    const [written] = collaborators.writeOffer.calls[0];
    const [, payload] = collaborators.notifyTeacher.calls[0];

    // Three clocks is the failure `createOffer`'s header names: the countdown, the
    // sweep and the accept path all have to read the same instant.
    assert.equal(written.expiresAt.toISOString(), response.expiresAt);
    assert.equal(payload.expiresAt, response.expiresAt);
  });

  it('snapshots the price from the teacher row onto the session', async () => {
    const collaborators = deps({ findTeacher: spy(async () => teacher({ pricePerBlock: 19 })) });

    const response = await sendOffer(input(), collaborators);

    const [written] = collaborators.markOfferSent.calls[0];

    // A price that arrives from the client is a price the client can choose — the
    // schema refuses one in the body and this is the other half of that rule.
    assert.equal(written.pricePerBlock, 19);
    assert.equal(response.pricePerBlock, 19);
  });

  it('reports the teacher as online, from the row read before the lock', async () => {
    // Re-reading after the lock would answer OFFER_LOCKED and the card would say
    // `isOnline: false` — which on the awaiting screen reads as "you sent a request to
    // somebody who is not there". They are there; they are holding this offer.
    const response = await sendOffer(input(), deps());

    assert.equal(response.teacher.isOnline, true);
  });

  it('announces the lock and then the offer, both after the commit', async () => {
    const collaborators = deps();

    await sendOffer(input(), collaborators);

    assert.deepEqual(collaborators.announceStatus.calls[0], [TEACHER_ID, 'OFFER_LOCKED']);
    assert.equal(collaborators.notifyTeacher.calls.length, 1);
    assert.equal(collaborators.notifyTeacher.calls[0][0], TEACHER_ID);
    assert.ok(collaborators.runTransaction.committed);
  });

  it('sends the teacher a non-empty brief and the topic label from the enrichment read', async () => {
    const collaborators = deps();

    await sendOffer(input(), collaborators);

    const [, payload] = collaborators.notifyTeacher.calls[0];

    assert.equal(payload.offerId, OFFER_ID);
    assert.ok(payload.brief.length > 0);
    assert.equal(payload.topicLabel, 'כלל השרשרת');
    assert.equal(payload.level, 5);
  });
});

describe('sendOffer — the transaction is one unit', () => {
  it('hands the same tx to the lock, the offer, the session and the counter', async () => {
    const collaborators = deps();

    await sendOffer(input(), collaborators);

    // A write that quietly used the global client would commit outside the
    // transaction, which is why every writer in `session.repository.js` requires the
    // parameter rather than defaulting it.
    assert.equal(collaborators.lockTeacher.calls[0][1], TX);
    assert.equal(collaborators.writeOffer.calls[0][1], TX);
    assert.equal(collaborators.markOfferSent.calls[0][1], TX);
    assert.equal(collaborators.countOffer.calls[0][1], TX);
  });

  it('counts the offer against the teacher exactly once, inside the transaction', async () => {
    const collaborators = deps();

    await sendOffer(input(), collaborators);

    // §9.2 reads `offers_received` as the acceptance-rate denominator, and 4.8's retro
    // records it as history that stopped. Counted at send rather than at answer, so an
    // offer that expires unanswered counts against the teacher.
    assert.equal(collaborators.countOffer.calls.length, 1);
    assert.deepEqual(collaborators.countOffer.calls[0][0], TEACHER_ID);
  });

  it('does no work inside the transaction before the lock is held', async () => {
    const order = [];
    const collaborators = deps({
      lockTeacher: spy(async () => {
        order.push('lock');

        return { locked: true };
      }),
    });
    const writeOffer = collaborators.writeOffer;

    collaborators.writeOffer = spy(async (...args) => {
      order.push('offer');

      return writeOffer(...args);
    });

    await sendOffer(input(), collaborators);

    // The lock is taken first so that everything after it is already exclusive.
    assert.deepEqual(order, ['lock', 'offer']);
  });
});

describe('sendOffer — the session has to be the caller’s, and PENDING', () => {
  it('answers NOT_FOUND for a session that does not exist', async () => {
    const collaborators = deps({ findSession: spy(async () => null) });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.NOT_FOUND);
    assert.equal(collaborators.runTransaction.calls.length, 0);
  });

  it('answers NOT_FOUND, never FORBIDDEN, for another student’s session', async () => {
    const collaborators = deps({
      findSession: spy(async () => session({ studentId: OTHER_STUDENT_ID })),
    });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.NOT_FOUND);
  });

  it('gives a stranger and a missing row the identical message', async () => {
    // FORBIDDEN — or a different message — confirms the id exists. The uuid is
    // unguessable so the leak is small, but it is free to avoid.
    const missing = await sendOffer(input(), deps({ findSession: spy(async () => null) })).catch(
      (error) => error,
    );
    const stranger = await sendOffer(
      input(),
      deps({ findSession: spy(async () => session({ studentId: OTHER_STUDENT_ID })) }),
    ).catch((error) => error);

    assert.equal(missing.message, stranger.message);
    assert.equal(missing.statusCode, stranger.statusCode);
  });

  for (const status of ['OFFER_SENT', 'ACTIVE', 'ENDED', 'CANCELLED']) {
    it(`answers SESSION_NOT_ACTIVE for a ${status} session, and locks nobody`, async () => {
      const collaborators = deps({ findSession: spy(async () => session({ status })) });

      await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.SESSION_NOT_ACTIVE);

      // A reload re-enables every card on E4's screen, so a second press is an
      // ordinary user action. It must not cost the teacher a lock.
      assert.equal(collaborators.lockTeacher.calls.length, 0);
      assert.equal(collaborators.runTransaction.calls.length, 0);
    });
  }
});

describe('sendOffer — affordability, before the lock and never after', () => {
  it('refuses a balance one credit short of the opening block', async () => {
    const collaborators = deps({
      findBalance: spy(async () => PRICE_PER_BLOCK * OPENING_BLOCKS - 1),
    });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.INSUFFICIENT_CREDIT);
  });

  it('accepts a balance exactly equal to the opening block', async () => {
    // The boundary is `>=`. Off by one here is a student who can pay being told they
    // cannot, which looks identical to a wallet bug from the outside.
    const collaborators = deps({
      findBalance: spy(async () => PRICE_PER_BLOCK * OPENING_BLOCKS),
    });

    const response = await sendOffer(input(), collaborators);

    assert.equal(response.offerId, OFFER_ID);
  });

  it('locks nobody when the student cannot pay', async () => {
    const collaborators = deps({ findBalance: spy(async () => 0) });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.INSUFFICIENT_CREDIT);

    // The brief's sharpest ordering criterion: after the lock, a broke student leaves
    // a teacher locked for sixty seconds with nothing to unlock them.
    assert.equal(collaborators.lockTeacher.calls.length, 0);
    assert.equal(collaborators.runTransaction.calls.length, 0);
  });

  it('treats a missing wallet row as zero rather than as no ceiling', async () => {
    // `findWalletBalance` answers `null`, not `0`, when there is no row — a data
    // problem rather than a poor student, but not a reason to start a free session.
    const collaborators = deps({ findBalance: spy(async () => null) });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.INSUFFICIENT_CREDIT);
  });

  it('charges the affordability check against OPENING_BLOCKS, not one block', async () => {
    // §5.1 charges the opening block immediately and makes it non-cancellable, so a
    // student who can afford one block but not two cannot start at all.
    const oneBlock = deps({ findBalance: spy(async () => PRICE_PER_BLOCK) });

    await rejectsWithCode(sendOffer(input(), oneBlock), ERROR_CODES.INSUFFICIENT_CREDIT);
  });
});

describe('sendOffer — losing the lock', () => {
  it('answers TEACHER_UNAVAILABLE when the conditional update matches nothing', async () => {
    const collaborators = deps({ lockTeacher: spy(async () => ({ locked: false })) });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.TEACHER_UNAVAILABLE);
  });

  it('writes no offer and moves no session when the lock is lost', async () => {
    const collaborators = deps({ lockTeacher: spy(async () => ({ locked: false })) });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.TEACHER_UNAVAILABLE);

    assert.equal(collaborators.writeOffer.calls.length, 0);
    assert.equal(collaborators.markOfferSent.calls.length, 0);
    assert.equal(collaborators.countOffer.calls.length, 0);
  });

  it('rolls the transaction back rather than compensating', async () => {
    const collaborators = deps({ lockTeacher: spy(async () => ({ locked: false })) });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.TEACHER_UNAVAILABLE);

    // A `catch` that set the teacher back to ONLINE by hand would be a second lock
    // implementation with worse semantics. Postgres undoes it.
    assert.ok(collaborators.runTransaction.rolledBack);
    assert.notEqual(collaborators.runTransaction.committed, true);
  });

  it('answers TEACHER_UNAVAILABLE with a 409, not a 404', async () => {
    const error = await sendOffer(
      input(),
      deps({ lockTeacher: spy(async () => ({ locked: false })) }),
    ).catch((thrown) => thrown);

    // Not a missing resource — a state the request collided with, and one that may
    // well be different a minute from now.
    assert.equal(error.statusCode, 409);
    assert.ok(error.isOperational);
  });

  it('announces nothing when the race is lost', async () => {
    const collaborators = deps({ lockTeacher: spy(async () => ({ locked: false })) });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.TEACHER_UNAVAILABLE);

    assert.equal(collaborators.announceStatus.calls.length, 0);
    assert.equal(collaborators.notifyTeacher.calls.length, 0);
  });
});

describe('sendOffer — the teacher has to exist', () => {
  it('answers TEACHER_UNAVAILABLE for a teacher id that resolves to nothing', async () => {
    // An unknown uuid, a student's id, a user with no `teacher_profiles` row. Not
    // NOT_FOUND: the server does not confirm which ids are real, and the student's
    // screen refreshes the list either way.
    const collaborators = deps({ findTeacher: spy(async () => null) });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.TEACHER_UNAVAILABLE);
    assert.equal(collaborators.runTransaction.calls.length, 0);
  });
});

describe('sendOffer — the session moved under us', () => {
  it('answers SESSION_NOT_ACTIVE when the conditional session update matches nothing', async () => {
    const collaborators = deps({ markOfferSent: spy(async () => ({ count: 0 })) });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.SESSION_NOT_ACTIVE);
  });

  it('rolls back the lock and the offer with it', async () => {
    const collaborators = deps({ markOfferSent: spy(async () => ({ count: 0 })) });

    await rejectsWithCode(sendOffer(input(), collaborators), ERROR_CODES.SESSION_NOT_ACTIVE);

    // Two Send-request presses that both passed the status check are a double-booked
    // student. The second loses, and it must not leave a teacher locked behind it.
    assert.ok(collaborators.runTransaction.rolledBack);
    assert.equal(collaborators.countOffer.calls.length, 0);
    assert.equal(collaborators.announceStatus.calls.length, 0);
    assert.equal(collaborators.notifyTeacher.calls.length, 0);
  });
});

describe('sendOffer — the notification never fails a committed offer', () => {
  it('still answers 201 when the enrichment read throws', async () => {
    const collaborators = deps({
      loadSessionView: spy(async () => {
        throw new Error('connection reset');
      }),
    });

    const response = await sendOffer(input(), collaborators);

    // An offer that is committed and answered must not become a 500 because a
    // notification could not be decorated.
    assert.equal(response.offerId, OFFER_ID);
    assert.equal(collaborators.notifyTeacher.calls.length, 1);
  });

  it('falls back to the session in hand, with a null topic label', async () => {
    const collaborators = deps({ loadSessionView: spy(async () => null) });

    await sendOffer(input(), collaborators);

    const [, payload] = collaborators.notifyTeacher.calls[0];

    // `findSessionForOffer` selects topic *ids* and no names, so the label degrades to
    // null — which the contract types and 5.7 renders. The brief survives, because it
    // is on the row either read returns.
    assert.equal(payload.topicLabel, null);
    assert.ok(payload.brief.length > 0);
  });
});

describe('toOfferResponse — the student’s shape', () => {
  const offer = {
    id: OFFER_ID,
    status: 'PENDING',
    expiresAt: new Date('2026-08-17T09:00:00.000Z'),
  };

  it('emits exactly the six contract keys', () => {
    const response = toOfferResponse({
      offer,
      sessionId: SESSION_ID,
      teacher: teacher(),
      pricePerBlock: PRICE_PER_BLOCK,
    });

    assert.deepEqual(Object.keys(response).sort(), [
      'expiresAt',
      'offerId',
      'pricePerBlock',
      'sessionId',
      'status',
      'teacher',
    ]);
  });

  it('leaks no counter and no teacher status', () => {
    const { teacher: card } = toOfferResponse({
      offer,
      sessionId: SESSION_ID,
      teacher: teacher(),
      pricePerBlock: PRICE_PER_BLOCK,
    });

    // `offersReceived`, `offersAccepted` and `status` are on the row this receives.
    // Explicit construction is what keeps them off the wire when a migration lands.
    assert.equal(card.status, undefined);
    assert.equal(card.offersReceived, undefined);
    assert.equal(card.userId, undefined);
  });

  it('serializes expiresAt as an ISO string, not a Date', () => {
    // The contract says ISO 8601 because the countdown recomputes from an absolute
    // instant on every tick rather than from a duration seeded once.
    const response = toOfferResponse({
      offer,
      sessionId: SESSION_ID,
      teacher: teacher(),
      pricePerBlock: PRICE_PER_BLOCK,
    });

    assert.equal(response.expiresAt, '2026-08-17T09:00:00.000Z');
  });

  it('reports the price it was handed, not the one on the teacher row', () => {
    // The value the transaction actually wrote to `sessions.price_per_block`. Reaching
    // for `teacher.pricePerBlock` here would be a second reading of the snapshot.
    const response = toOfferResponse({
      offer,
      sessionId: SESSION_ID,
      teacher: teacher({ pricePerBlock: 99 }),
      pricePerBlock: PRICE_PER_BLOCK,
    });

    assert.equal(response.pricePerBlock, PRICE_PER_BLOCK);
  });
});

describe('toIncomingOffer — the teacher’s shape', () => {
  const offer = { id: OFFER_ID, expiresAt: new Date('2026-08-17T09:00:00.000Z') };

  const question = (overrides = {}) => ({
    teacherBrief: 'Stuck on the chain rule.',
    howToStart: 'Name the outer function before differentiating anything.',
    estimatedLevel: 5,
    declaredLevel: 4,
    topic: { nameHe: 'חשבון דיפרנציאלי' },
    subtopic: { nameHe: 'כלל השרשרת' },
    ...overrides,
  });

  const build = (overrides = {}) =>
    toIncomingOffer({
      offer,
      sessionId: SESSION_ID,
      question: question(),
      pricePerBlock: PRICE_PER_BLOCK,
      feeRate: 0,
      ...overrides,
    });

  it('emits exactly the eight contract keys', () => {
    assert.deepEqual(Object.keys(build()).sort(), [
      'brief',
      'expectedEarning',
      'expiresAt',
      'howToStart',
      'level',
      'offerId',
      'sessionId',
      'topicLabel',
    ]);
  });

  it('carries the opening move beside the brief, and null when there is none', () => {
    // The modal renders the two together inside E5's sixty seconds, so they travel in
    // one payload. `null` is the fallback's answer and it must survive the trip — a
    // modal that cannot tell "no opening move" from "an empty one" renders a heading
    // over nothing.
    assert.equal(build().howToStart, 'Name the outer function before differentiating anything.');
    assert.equal(build({ question: question({ howToStart: null }) }).howToStart, null);
    assert.equal(build({ question: null }).howToStart, null);
  });

  it('prefers the subtopic label over the parent topic', () => {
    // The more specific true thing: a teacher deciding whether to take a question is
    // better served by "the chain rule" than by "calculus".
    assert.equal(build().topicLabel, 'כלל השרשרת');
  });

  it('falls back to the parent topic, then to null', () => {
    assert.equal(build({ question: question({ subtopic: null }) }).topicLabel, 'חשבון דיפרנציאלי');

    // `null`, never `''`. The contract types it `string | null`, and an empty string is
    // a label that renders as an empty chip — the sentinel topic is a legal question.
    assert.equal(build({ question: question({ subtopic: null, topic: null }) }).topicLabel, null);
  });

  it('prefers the classifier’s level over the student’s declaration', () => {
    assert.equal(build().level, 5);
    assert.equal(build({ question: question({ estimatedLevel: null }) }).level, 4);
    assert.equal(
      build({ question: question({ estimatedLevel: null, declaredLevel: null }) }).level,
      null,
    );
  });

  it('nets the opening block against the commission rate', () => {
    // Imported, never typed: a test that wrote 0.15 would pass for the wrong reason
    // the day §5.3 is tuned. The gross is `OPENING_BLOCKS` worth because that is what
    // accepting the offer actually guarantees the teacher.
    const gross = PRICE_PER_BLOCK * OPENING_BLOCKS;

    assert.equal(build({ feeRate: 0 }).expectedEarning, gross);
    assert.equal(
      build({ feeRate: PLATFORM_FEE_PCT }).expectedEarning,
      gross * (1 - PLATFORM_FEE_PCT),
    );
  });

  it('does not round the earning into whole credits', () => {
    // `commission.js` answers a rate and leaves the arithmetic to whoever owns a
    // balance. E7 rounds when it moves money; a serializer that rounded first would be
    // a second answer to "what did I earn".
    const earning = build({ pricePerBlock: 15, feeRate: PLATFORM_FEE_PCT }).expectedEarning;

    assert.equal(earning, 15 * OPENING_BLOCKS * (1 - PLATFORM_FEE_PCT));
  });
});

describe('the expectedEarning gap — closed in 5.6, and pinned the other way', () => {
  /**
   * **This block asserted a known defect until 5.6, deliberately.** `platformFeeRate`
   * needs the teacher's start date; `TEACHER_VIEW` excludes it by design and no read
   * reachable from 5.3 returned it, so the fallback read as "joined just now", the
   * new-teacher exemption answered `0` for everybody and the payload carried the
   * gross. It was written to fail the day a read carried `created_at`, and it did.
   *
   * `findTeacherForNotification` is that read. The assertions run the other way now,
   * and they are why the epic README's ninth gap is closed rather than moved.
   *
   * Every test here pins the clock to `FIXED_NOW` — see that constant for why an
   * unpinned one answers differently before and after 14:00.
   */
  it('nets the commission for an established teacher', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });

    const collaborators = deps();

    await sendOffer(input(), collaborators);

    const [, payload] = collaborators.notifyTeacher.calls[0];

    assert.equal(
      payload.expectedEarning,
      PRICE_PER_BLOCK * OPENING_BLOCKS * (1 - PLATFORM_FEE_PCT),
    );
  });

  it('pays a teacher created yesterday the full amount', async (t) => {
    // §5.3's supply incentive: no commission in the first `NEW_TEACHER_FEE_DAYS`, and
    // the brief's acceptance criterion names this teacher by age.
    t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });

    const collaborators = deps({
      loadTeacherContact: spy(async () => teacherContact({ createdAt: JOINED_YESTERDAY })),
    });

    await sendOffer(input(), collaborators);

    const [, payload] = collaborators.notifyTeacher.calls[0];

    assert.equal(payload.expectedEarning, PRICE_PER_BLOCK * OPENING_BLOCKS);
  });

  it('pays the full amount during the low-demand window', async (t) => {
    // The second free case, and the one that made the first version of this block
    // pass for the wrong reason. An established teacher, inside `LOW_DEMAND_HOURS`.
    t.mock.timers.enable({ apis: ['Date'], now: LOW_DEMAND_NOW });

    const collaborators = deps();

    await sendOffer(input(), collaborators);

    const [, payload] = collaborators.notifyTeacher.calls[0];

    assert.equal(payload.expectedEarning, PRICE_PER_BLOCK * OPENING_BLOCKS);
  });

  it('falls back to the gross when the contact read fails, rather than throwing', async (t) => {
    // Both directions of wrong are available and the fallback picks one on purpose: a
    // teacher quoted too much on a notification the platform failed to enrich is a
    // smaller wrong than one quoted too little. The offer is committed by this point
    // either way, so what must not happen is a rejection.
    t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });

    const collaborators = deps({
      loadTeacherContact: spy(async () => {
        throw new Error('connection terminated');
      }),
    });

    const response = await sendOffer(input(), collaborators);

    assert.equal(response.offerId, OFFER_ID);

    const [, payload] = collaborators.notifyTeacher.calls[0];

    assert.equal(payload.expectedEarning, PRICE_PER_BLOCK * OPENING_BLOCKS);
  });
});

describe('the offer email — PR 5.6, and what the request path must not wait for', () => {
  it('sends the socket payload itself, so the inbox and the modal cannot disagree', async () => {
    const collaborators = deps();

    await sendOffer(input(), collaborators);

    const [[, emitted]] = collaborators.notifyTeacher.calls;
    const [[{ to, teacherName, offer }]] = collaborators.emailTeacher.calls;

    assert.equal(offer, emitted);
    assert.equal(to, 'dana@demo.tutornow.il');
    assert.equal(teacherName, 'Dana Levi');
  });

  it('does not await the send', async () => {
    // Rule 2 of the brief: a student's 201 does not wait on an email provider. A send
    // that never settles must not delay the response, so the assertion is that
    // `sendOffer` resolves while this promise is still pending.
    let released;
    const collaborators = deps({
      emailTeacher: spy(
        () =>
          new Promise((resolve) => {
            released = resolve;
          }),
      ),
    });

    const response = await sendOffer(input(), collaborators);

    assert.equal(response.offerId, OFFER_ID);
    assert.equal(collaborators.emailTeacher.calls.length, 1);

    released();
  });

  it('answers with the offer when the send rejects, and handles the rejection', async () => {
    // `sendOfferEmail` swallows its own failures by contract. This is the belt and
    // braces for the day a later edit breaks that contract: an unhandled rejection
    // would take the process down, with a committed offer behind it.
    const collaborators = deps({
      emailTeacher: spy(async () => {
        throw new Error('resend is unreachable');
      }),
    });

    const response = await sendOffer(input(), collaborators);

    assert.equal(response.offerId, OFFER_ID);
  });

  it('is not called when the transaction rolled back', async () => {
    // Same rule as every other announcement here: an offer that does not exist is not
    // announced, and a teacher is not emailed about a request nobody can accept.
    const collaborators = deps({ lockTeacher: spy(async () => ({ locked: false })) });

    await assert.rejects(() => sendOffer(input(), collaborators));

    assert.equal(collaborators.emailTeacher.calls.length, 0);
    assert.equal(collaborators.loadTeacherContact.calls.length, 0);
  });
});
