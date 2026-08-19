import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

/**
 * **The whole lifecycle, in one walk, against the real database.** PR 6.8, MVP.md §11.3
 * and §15.3.
 *
 * ## Why this file exists when 6.3–6.6 each have their own suite
 *
 * Those suites stub every collaborator and assert one transaction at a time, which is
 * what catches arithmetic. What they cannot catch is the **seam between** them: a session
 * that charges correctly, extends correctly and ends correctly, and still finishes with
 * `total_charged` disagreeing with the sum of its `session_blocks` — because two
 * individually correct transactions wrote the same column from different reads. Nothing
 * that stubs the database can see that. One file that walks the whole thing and asserts
 * the ledger at the end is the only thing that looks at all four together.
 *
 * ## The three rules this suite is written under, and each is a way suites die
 *
 * **Daily is never called.** The stub goes in at the `video.service` boundary —
 * `createSessionVideo`, through the deps argument every service in this epic takes — and
 * not at `fetch`. Patching `fetch` globally would silence every other outbound call in
 * the process and would still be testing the provider's client rather than this epic's
 * seam. A suite that needs an API key is a suite that fails in CI and gets disabled.
 *
 * **Clocks are injected, never waited on.** The meter is minutes long and the grace is
 * thirty seconds; a test that slept through either is a test somebody skips. `ends_at` is
 * moved directly and the jobs are handed the instant they sweep against, which is exactly
 * what those jobs do in production — both take their window as an argument precisely so
 * that nothing has to wait for a clock.
 *
 * **It skips when no database answers, and that is deliberate.** `npm test` passes today
 * on a fresh clone with nothing running, and a suite that broke that would be the first
 * thing somebody deleted. The probe is one TCP connection to the host and port in
 * `DATABASE_URL`; when it does not answer, this file reports as skipped rather than as
 * red. Recorded as a gap in the epic README, because "green" and "green with the E2E
 * suite skipped" are not the same statement.
 *
 * ## What it does not assert
 *
 * **The socket frames are captured at the emitter, not at a connected client.** Every
 * emit in this epic already arrives through an injected `notify*` collaborator — that is
 * how 6.3 through 6.6 assert them — and `socket.io-client` is a `client` workspace
 * dependency. Standing up a server and a client here would test Socket.IO's delivery, not
 * this epic's decisions about what is emitted and when. Recorded as a gap.
 *
 * **The token mint is the controller's one line and is not on this walk.** This asserts
 * that `getSessionVideoContext` answers each participant with the room and *their own*
 * name and refuses a third party; `session.video.test.js` reads the handler for the mint
 * itself, which needs the provider.
 */

// ── the environment, in the order that makes the real one win ──────────────────────
//
// `config/env.js` calls `dotenv.config()` at import time and dotenv does not overwrite a
// variable that is already set. So the repo-root `.env` is read *first*, here, and the
// fallbacks below fill only what it did not supply — the other way round, an `??=` dummy
// would take precedence over the real `DATABASE_URL` and this suite would spend its life
// talking to a host that does not exist.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: resolve(REPO_ROOT, '.env') });

// **Assigned, not defaulted.** The `.env` just read says `development`, and a test process
// is a test process whatever the file it borrowed its database URL from says.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

/** What `.env` actually supplied. Empty is one of the two ways this suite skips. */
const configured = process.env.DATABASE_URL ?? '';

// The placeholder every other suite in this directory sets, applied only when there was
// no real one: the imports below reach `config/env.js`, which validates `DATABASE_URL` as
// a URL and calls `process.exit(1)` when it cannot — and a test run that exits during
// module evaluation reports nothing at all, which is worse than red.
process.env.DATABASE_URL ||= 'postgresql://unused:unused@localhost:5433/unused';

const reachable = Boolean(configured) && (await databaseAnswers(configured));

const skip = reachable
  ? false
  : 'no database answered on DATABASE_URL — run `npm run db:up && npm run db:migrate`';

/**
 * The one client, **claimed through `config/db.js`'s own cache rather than around it.**
 *
 * That file keeps its instance on `globalThis` for anything that is not production — it
 * exists so `node --watch` cannot leak a pool per reload — and putting a client there
 * first is therefore the supported way to decide what this process's client looks like.
 * The one thing changed is the log: `config/db.js` asks for `['warn', 'error', 'query']`
 * outside production, which is a line of SQL per statement and several hundred lines of
 * noise around one suite's output. It is not a file this PR may open, and this needs no
 * change to it.
 *
 * `@prisma/client` imported directly in a test rather than through a repository is the
 * other half of the trade, and it is the same one every fixture in this file makes:
 * arranging rows is not a layering decision, and the services under test still reach the
 * database only through their own repositories.
 */
if (reachable) {
  const { PrismaClient } = await import('@prisma/client');

  globalThis.prisma ??= new PrismaClient({ log: ['warn', 'error'] });
}

// Dynamic, and after the environment is settled, for the reason every suite in this
// directory does it: these modules read `process.env` at import time.
const {
  BLOCK_MINUTES,
  EXTENSION_BLOCKS,
  GRACE_SECONDS,
  OFFER_STATUS,
  OPENING_BLOCKS,
  WARNING_SECONDS,
} = await import('#config/constants/index.js');
const { ERROR_CODES } = await import('#config/errors/codes.js');
const { prisma } = await import('#config/db.js');
const { acceptOffer } = await import('#services/offer.respond.service.js');
const { extendSessionBlock } = await import('#services/session.meter.service.js');
const { reportSessionNoShow, terminateSession } = await import('#services/session.end.service.js');
const { submitSessionReview } = await import('#services/session.review.service.js');
const { getSessionVideoContext } = await import('#services/session.video.service.js');
const { runAutoEnd } = await import('#jobs/session.autoEnd.job.js');
const { runBlockWarning, resetBlockWarnings } = await import('#jobs/session.blockWarning.job.js');
const { findSessionsDueForAutoEnd, findSessionsDueForWarning } =
  await import('#repositories/session.repository.js');
const { AppError } = await import('#utils/AppError.js');
const { platformFeeRate } = await import('#utils/commission.js');

/** The teacher's price. Every expected amount below is derived from it and the constants. */
const PRICE_PER_BLOCK = 10;

/** The opening block plus two extensions, exactly. The third extension is the refusal. */
const BUDGET_CAP = (OPENING_BLOCKS + 2 * EXTENSION_BLOCKS) * PRICE_PER_BLOCK;

/** Enough that nothing on this walk is ever refused for affordability. */
const STARTING_BALANCE = 500;

/**
 * The teacher's account age, so §5.3's fee is resolved rather than waived.
 *
 * `NEW_TEACHER_FEE_DAYS` waives commission for a teacher's first month, so a fixture
 * created a second ago earns 100% and the split this walk exists to check would never
 * run. The expected fee is still computed with `platformFeeRate` rather than typed —
 * §5.3's other free window is a time of day, and a suite that hard-coded 15% would go red
 * every morning between six and two.
 */
const TEACHER_AGE_DAYS = 90;

describe('E2E — a session from accept to rated, against the real database', { skip }, () => {
  /** The fixture ids, filled by `before` and torn down by `after`. */
  const world = { studentId: null, teacherId: null, strangerId: null };

  /** Every session this file creates, so the cleanup and the ledger walk both know them. */
  const sessions = [];

  /** What the services emitted, in order. The socket layer's assertions come from here. */
  const emitted = [];

  const record = (event) => (sessionId, payload) => emitted.push({ event, sessionId, payload });

  /**
   * The Daily stub — **the one seam this suite replaces**, and it is a function rather
   * than a network mock because 6.1 made it one.
   */
  const createRoom = async (sessionId) => ({
    roomName: `e2e-${sessionId.slice(0, 8)}`,
    roomUrl: `https://example.invalid/e2e-${sessionId.slice(0, 8)}`,
  });

  /** The collaborators the accept path takes, with nothing that reaches the network. */
  const acceptDeps = {
    createRoom,
    announceStatus: (teacherId, status) =>
      emitted.push({ event: 'teacher:status', teacherId, status }),
    notifyAccepted: record('offer:accepted'),
  };

  before(async () => {
    world.studentId = await createStudent('student');
    world.strangerId = await createStudent('stranger');
    world.teacherId = await createTeacher();
  });

  // Registered here and run last whatever the order of the tests below — which is what
  // lets the reconciliation assertion be the final `it` in the file and still find its
  // rows. A suite that cleaned up in the middle would be asserting an empty ledger.
  after(async () => {
    await teardown();
    await prisma.$disconnect();
  });

  // ── 1. the accept ────────────────────────────────────────────────────────────────

  it('accepts the offer: ACTIVE, the opening block charged, the room persisted', async () => {
    const { sessionId, offerId } = await seedOfferSentSession();

    const accepted = await acceptOffer({ offerId, teacherId: world.teacherId }, acceptDeps);

    assert.equal(accepted.sessionId, sessionId);
    assert.equal(accepted.status, 'ACTIVE');

    // The room is minted after the commit and is not awaited by the endpoint, so the walk
    // waits for the columns rather than for the response.
    await settleVideo(sessionId);

    const session = await readSession(sessionId);

    assert.equal(session.status, 'ACTIVE');
    assert.equal(session.blocksUsed, OPENING_BLOCKS);
    assert.equal(session.totalCharged, OPENING_BLOCKS * PRICE_PER_BLOCK);
    assert.ok(session.videoRoomName, 'the room name was persisted');
    assert.ok(session.videoRoomUrl, 'the room URL was persisted');

    // `ends_at` is the opening block's length from `started_at`, computed from the
    // constants rather than from a literal, so tuning the appendix moves this with it.
    assert.equal(
      session.endsAt.getTime() - session.startedAt.getTime(),
      OPENING_BLOCKS * BLOCK_MINUTES * 60 * 1000,
    );

    assert.equal(
      await balanceOf(world.studentId),
      STARTING_BALANCE - OPENING_BLOCKS * PRICE_PER_BLOCK,
    );
    assert.equal(await teacherStatus(), 'IN_SESSION');

    const blocks = await prisma.sessionBlock.findMany({ where: { sessionId } });

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].blockNumber, 1);
    assert.equal(blocks[0].minutes, OPENING_BLOCKS * BLOCK_MINUTES);
  });

  // ── 2. the room, per participant ─────────────────────────────────────────────────

  it('answers each participant with the room and their own name, and a third party with nothing', async () => {
    const sessionId = current();

    const forStudent = await getSessionVideoContext(sessionId, world.studentId);
    const forTeacher = await getSessionVideoContext(sessionId, world.teacherId);

    assert.equal(forStudent.roomUrl, forTeacher.roomUrl, 'one room, two callers');
    assert.equal(forStudent.userName, 'E2E Student');
    assert.equal(forTeacher.userName, 'E2E Teacher');

    // A stranger gets what a missing session gets. `FORBIDDEN` would confirm the id is
    // real, and the ids are in URLs and logs.
    await assert.rejects(
      () => getSessionVideoContext(sessionId, world.strangerId),
      (error) => error.code === ERROR_CODES.NOT_FOUND,
    );
  });

  // ── 3. the warning at the boundary ───────────────────────────────────────────────

  it('warns at the block boundary, with the four numbers the modal renders', async () => {
    const sessionId = current();

    // The clock, injected: the block is moved to end inside `WARNING_SECONDS` rather than
    // waited out. This is the same row the sweep reads in production.
    const endsAt = new Date(Date.now() + (WARNING_SECONDS - 30) * 1000);

    await prisma.session.update({ where: { id: sessionId }, data: { endsAt } });

    const now = new Date();
    const due = await findSessionsDueForWarning(
      now,
      new Date(now.getTime() + WARNING_SECONDS * 1000),
    );

    assert.ok(
      due.some((row) => row.id === sessionId),
      'the real query finds this session inside the warning window',
    );

    const warnings = [];

    resetBlockWarnings();

    // **The sweep is scoped to this suite's rows.** The query above is the real one and is
    // asserted as such; the job is then run against that answer filtered to the fixture,
    // because a developer's own half-finished sessions are in this database and a test
    // that emitted into them would be a test with side effects on somebody's afternoon.
    await runBlockWarning({
      findDue: async (from, to) => (await findSessionsDueForWarning(from, to)).filter(mine),
      notifyWarning: (id, payload) => warnings.push({ id, payload }),
    });

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].id, sessionId);
    assert.equal(warnings[0].payload.extensionPrice, EXTENSION_BLOCKS * PRICE_PER_BLOCK);
    assert.equal(warnings[0].payload.canAfford, true);
    assert.equal(warnings[0].payload.withinCap, true);
  });

  // ── 4. the double tap ────────────────────────────────────────────────────────────

  it('charges one block for a double-tapped extend, and refuses the second with the race message', async () => {
    const sessionId = current();

    const before = await readSession(sessionId);
    const ledgerBefore = await ledgerCount(world.studentId);

    // Two requests in flight at once, both carrying the `ends_at` the caller read — which
    // is the whole reason `session.meter.service.js` takes that read *before* `BEGIN`.
    // Under the lock alone the second would wake up, read the value the first just wrote,
    // match its own expectation and buy a second block.
    const [first, second] = await Promise.allSettled([
      extendSessionBlock(
        { sessionId, studentId: world.studentId },
        { notifyExtended: record('session:extended') },
      ),
      extendSessionBlock(
        { sessionId, studentId: world.studentId },
        { notifyExtended: record('session:extended') },
      ),
    ]);

    const outcomes = [first, second];
    const won = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const lost = outcomes.filter((outcome) => outcome.status === 'rejected');

    assert.equal(won.length, 1, 'exactly one tap bought a block');
    assert.equal(lost.length, 1);
    assert.equal(lost[0].reason.code, ERROR_CODES.SESSION_NOT_ACTIVE);

    // The sentence is about the race rather than about the state, because the row is still
    // `ACTIVE` — 6.8's client re-reads on this and shows the block that did land, with no
    // error at all.
    assert.equal(lost[0].reason.message, 'The session moved on while you were deciding.');

    const after = await readSession(sessionId);

    assert.equal(after.blocksUsed, before.blocksUsed + EXTENSION_BLOCKS);
    assert.equal(after.totalCharged, before.totalCharged + EXTENSION_BLOCKS * PRICE_PER_BLOCK);
    assert.equal(
      after.endsAt.getTime(),
      before.endsAt.getTime() + EXTENSION_BLOCKS * BLOCK_MINUTES * 60 * 1000,
    );

    // One charge, one ledger row. The loser's transaction rolled its debit back with it.
    assert.equal(await ledgerCount(world.studentId), ledgerBefore + 1);
  });

  // ── 5. the cap ───────────────────────────────────────────────────────────────────

  it('extends up to the budget cap and refuses the block that would pass it, writing nothing', async () => {
    const sessionId = current();

    const toTheCap = await extendSessionBlock(
      { sessionId, studentId: world.studentId },
      { notifyExtended: record('session:extended') },
    );

    assert.equal(toTheCap.totalCharged, BUDGET_CAP, 'the cap is reachable, not one block short');

    const atTheCap = await readSession(sessionId);
    const ledgerAtCap = await ledgerCount(world.studentId);

    await assert.rejects(
      () =>
        extendSessionBlock(
          { sessionId, studentId: world.studentId },
          { notifyExtended: record('session:extended') },
        ),
      (error) => error.code === ERROR_CODES.BUDGET_CAP_REACHED,
    );

    const afterRefusal = await readSession(sessionId);

    // **The cap is checked before the charge**, so the refusal path has written nothing at
    // all — no balance move, no ledger row, no block, and `ends_at` where it was.
    assert.equal(afterRefusal.totalCharged, atTheCap.totalCharged);
    assert.equal(afterRefusal.blocksUsed, atTheCap.blocksUsed);
    assert.equal(afterRefusal.endsAt.getTime(), atTheCap.endsAt.getTime());
    assert.equal(await ledgerCount(world.studentId), ledgerAtCap);

    const blocks = await prisma.sessionBlock.count({ where: { sessionId } });

    assert.equal(blocks, atTheCap.blocksUsed - OPENING_BLOCKS + 1, 'one row per block bought');
  });

  // ── 6. the auto-end sweep ────────────────────────────────────────────────────────

  it('auto-ends past ends_at + GRACE_SECONDS, and pays the teacher net of the fee', async () => {
    const sessionId = current();

    // The clock again: `ends_at` is moved to one second beyond the grace rather than the
    // suite sitting through five minutes and thirty seconds.
    const past = new Date(Date.now() - (GRACE_SECONDS + 1) * 1000);

    await prisma.session.update({ where: { id: sessionId }, data: { endsAt: past } });

    const due = await findSessionsDueForAutoEnd(new Date(Date.now() - GRACE_SECONDS * 1000));

    assert.ok(
      due.some((row) => row.id === sessionId),
      'the real query finds this session past its grace',
    );

    const charged = (await readSession(sessionId)).totalCharged;
    const teacherBefore = await balanceOf(world.teacherId);

    const { ended } = await runAutoEnd({
      findDue: async (deadline) => (await findSessionsDueForAutoEnd(deadline)).filter(mine),
      endDueSession: (input) => terminateSession(input, { notifyEnded: record('session:ended') }),
    });

    assert.equal(ended, 1);

    const session = await readSession(sessionId);

    assert.equal(session.status, 'ENDED');
    assert.equal(session.endReason, 'no_extension');

    // §5.3 is imported, never restated: the rate is resolved at `started_at`, because a
    // session that begins at 13:55 and ends at 14:05 must not become chargeable halfway
    // through — and because the free hours would otherwise make this assertion depend on
    // what time the suite was run.
    const rate = platformFeeRate({
      teacherCreatedAt: session.teacherCreatedAt,
      at: session.startedAt,
    });

    assert.equal(session.platformFee, Math.round(charged * rate));

    // The acceptance criterion the reconciliation query cannot express: the two columns
    // sum to the gross **to the credit**, because the earning is the remainder of one
    // rounding rather than a second one.
    assert.equal(session.platformFee + session.teacherEarning, charged);

    assert.equal(await balanceOf(world.teacherId), teacherBefore + session.teacherEarning);
    assert.equal(await teacherStatus(), 'ONLINE', 'released, and back in the candidate pool');

    const profile = await prisma.teacherProfile.findUnique({ where: { userId: world.teacherId } });

    assert.equal(profile.sessionsCount, 1);
    assert.equal(profile.noShowCount, 0);

    assert.ok(
      emitted.some((frame) => frame.event === 'session:ended' && frame.sessionId === sessionId),
      'both sides were told, after the commit',
    );
  });

  // ── 7. the six ways a session is "not active" — the two an ENDED session gives ──

  it('tells an ENDED session apart in words, and credits nobody a second time', async () => {
    const sessionId = current();

    const teacherBefore = await balanceOf(world.teacherId);
    const ledgerBefore = await ledgerCount(world.teacherId);

    // The student's stale screen pressing **Extend** as the sweep fired. One code, and a
    // sentence that says which not-active it is.
    await assert.rejects(
      () => extendSessionBlock({ sessionId, studentId: world.studentId }),
      (error) =>
        error.code === ERROR_CODES.SESSION_NOT_ACTIVE &&
        error.message === 'This session has already finished.',
    );

    // The other participant's stale screen pressing **End**.
    await assert.rejects(
      () => terminateSession({ sessionId, endReason: 'student_ended', actorId: world.teacherId }),
      (error) =>
        error.code === ERROR_CODES.SESSION_NOT_ACTIVE &&
        error.message === 'This session has already finished.',
    );

    // A no-show report on a session that is already over.
    await assert.rejects(
      () => reportSessionNoShow({ sessionId, studentId: world.studentId }),
      (error) =>
        error.code === ERROR_CODES.SESSION_NOT_ACTIVE &&
        error.message === 'This session has already finished.',
    );

    assert.equal(await balanceOf(world.teacherId), teacherBefore, 'no second credit');
    assert.equal(await ledgerCount(world.teacherId), ledgerBefore, 'and no second ledger row');
  });

  // ── 8. the rating ────────────────────────────────────────────────────────────────

  it('rates the session: RATED, the aggregates moved, and no second review', async () => {
    const sessionId = current();

    const before = await prisma.teacherProfile.findUnique({ where: { userId: world.teacherId } });

    await submitSessionReview({
      sessionId,
      studentId: world.studentId,
      isResolved: true,
      stars: 5,
    });

    const session = await readSession(sessionId);

    assert.equal(session.status, 'RATED');

    const after = await prisma.teacherProfile.findUnique({ where: { userId: world.teacherId } });

    assert.equal(after.resolvedCount, before.resolvedCount + 1);
    assert.equal(after.ratingSum, before.ratingSum + 5);
    assert.equal(after.ratingCount, before.ratingCount + 1);

    // The double-tapped submit. `reviews.session_id` is `UNIQUE` and the `ENDED → RATED`
    // edge is gone, so both guards refuse it and neither is a 500.
    await assert.rejects(
      () =>
        submitSessionReview({ sessionId, studentId: world.studentId, isResolved: true, stars: 1 }),
      (error) => error.code === ERROR_CODES.SESSION_NOT_ACTIVE,
    );

    const reviews = await prisma.review.count({ where: { sessionId } });

    assert.equal(reviews, 1);
  });

  // ── 9. the same walk with no video at all ────────────────────────────────────────

  it('runs the whole flow with the video provider unavailable, and nothing else changes', async () => {
    const { sessionId, offerId } = await seedOfferSentSession();

    // `createRoom` throwing an `AppError` is what an unset `DAILY_API_KEY` looks like
    // from here — 6.1 turned the raw `Error` into one so that 6.3's accept path could
    // recognise it and answer 200 anyway.
    await acceptOffer(
      { offerId, teacherId: world.teacherId },
      {
        ...acceptDeps,
        createRoom: async () => {
          throw new AppError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Video is not configured.');
        },
      },
    );

    await settleVideo(sessionId, { expectRoom: false });

    const started = await readSession(sessionId);

    assert.equal(started.status, 'ACTIVE', 'the accept succeeded with no room');
    assert.equal(started.videoRoomName, null);
    assert.equal(
      started.totalCharged,
      OPENING_BLOCKS * PRICE_PER_BLOCK,
      'and the charge still landed',
    );

    // The meter, the end and the rating all run exactly as they did above — the missing
    // camera is not on any of their paths, which is the whole claim 6.3's degradation
    // makes and the one this walk exists to pin.
    await extendSessionBlock(
      { sessionId, studentId: world.studentId },
      { notifyExtended: record('session:extended') },
    );

    await terminateSession(
      { sessionId, endReason: 'student_ended', actorId: world.studentId },
      { notifyEnded: record('session:ended') },
    );

    await submitSessionReview({
      sessionId,
      studentId: world.studentId,
      isResolved: false,
    });

    const finished = await readSession(sessionId);

    assert.equal(finished.status, 'RATED');
    assert.equal(finished.platformFee + finished.teacherEarning, finished.totalCharged);

    // A review with no stars moves `resolved_count` by nothing and every average by
    // nothing — the one line 6.6's service is careful about, seen from the outside.
    const profile = await prisma.teacherProfile.findUnique({ where: { userId: world.teacherId } });

    assert.equal(profile.ratingCount, 1, 'the unrated review did not become a zero-star one');
  });

  // ── 10. reconciliation — §11.3, and the last assertion in this file ──────────────

  it('reconciles: every balance equals the sum of its ledger, and every session equals its blocks', async () => {
    for (const userId of [world.studentId, world.teacherId, world.strangerId]) {
      const balance = await balanceOf(userId);
      const ledger = await prisma.walletTransaction.aggregate({
        where: { userId },
        _sum: { amount: true },
      });

      assert.equal(
        balance,
        STARTING_BALANCE + (ledger._sum.amount ?? 0),
        `wallet ${userId} disagrees with its ledger`,
      );
    }

    for (const sessionId of sessions) {
      const session = await readSession(sessionId);
      const blocks = await prisma.sessionBlock.aggregate({
        where: { sessionId },
        _sum: { amount: true, minutes: true },
      });

      assert.equal(
        session.totalCharged,
        blocks._sum.amount ?? 0,
        `session ${sessionId}: total_charged disagrees with the sum of its blocks`,
      );

      assert.equal(session.platformFee + session.teacherEarning, session.totalCharged);

      const charges = await prisma.walletTransaction.aggregate({
        where: { sessionId, type: 'SESSION_CHARGE' },
        _sum: { amount: true },
      });

      assert.equal(
        -(charges._sum.amount ?? 0),
        session.totalCharged,
        `session ${sessionId}: the debits disagree with what it says it charged`,
      );
    }
  });

  // ── the fixture, and the walk's small conveniences ───────────────────────────────

  /** The session the walk is currently on — always the most recent one seeded. */
  function current() {
    return sessions.at(-1);
  }

  /** Whether a swept row is this suite's. See the note on scoping in the warning test. */
  function mine(row) {
    return sessions.includes(row.id);
  }

  async function createStudent(label) {
    const user = await prisma.user.create({
      data: {
        email: `e2e-lifecycle-${label}-${Date.now()}@example.invalid`,
        passwordHash: 'not-a-real-hash',
        fullName: label === 'student' ? 'E2E Student' : 'E2E Stranger',
        role: 'student',
        wallet: { create: { balance: STARTING_BALANCE } },
      },
    });

    return user.id;
  }

  async function createTeacher() {
    const createdAt = new Date(Date.now() - TEACHER_AGE_DAYS * 24 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        email: `e2e-lifecycle-teacher-${Date.now()}@example.invalid`,
        passwordHash: 'not-a-real-hash',
        fullName: 'E2E Teacher',
        role: 'teacher',
        createdAt,
        wallet: { create: { balance: STARTING_BALANCE } },
        teacherProfile: {
          create: { pricePerBlock: PRICE_PER_BLOCK, status: 'OFFLINE', levelMax: 5, createdAt },
        },
      },
    });

    return user.id;
  }

  /**
   * A question, a session at `OFFER_SENT` and the offer on it — E5's output, which this
   * suite starts from rather than re-testing.
   *
   * The teacher is put back to `OFFER_LOCKED` because that is the state an accept is
   * reached from: `setTeacherInSession`'s `where` says so, and a fixture that skipped it
   * would make the second walk fail for a reason that has nothing to do with sessions.
   */
  async function seedOfferSentSession() {
    await prisma.teacherProfile.update({
      where: { userId: world.teacherId },
      data: { status: 'OFFER_LOCKED' },
    });

    const question = await prisma.question.create({
      data: {
        studentId: world.studentId,
        rawText: 'An end-to-end question, asked by a fixture.',
        declaredLevel: 5,
      },
    });

    const session = await prisma.session.create({
      data: {
        questionId: question.id,
        studentId: world.studentId,
        teacherId: world.teacherId,
        status: 'OFFER_SENT',
        pricePerBlock: PRICE_PER_BLOCK,
        budgetCap: BUDGET_CAP,
      },
    });

    const offer = await prisma.offer.create({
      data: {
        sessionId: session.id,
        teacherId: world.teacherId,
        status: OFFER_STATUS.PENDING,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    sessions.push(session.id);

    return { sessionId: session.id, offerId: offer.id };
  }

  /**
   * Waits for the room write that the accept deliberately does not await.
   *
   * The endpoint answers before Daily does — that is the point of 6.3's step 7 — so the
   * walk polls the two columns rather than sleeping a fixed amount. `expectRoom: false` is
   * the degraded case, where the columns stay null and there is nothing to wait for beyond
   * the write that was never going to happen.
   */
  async function settleVideo(sessionId, { expectRoom = true } = {}) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const session = await readSession(sessionId);

      if (!expectRoom || session.videoRoomName) return;

      await new Promise((done) => setTimeout(done, 20));
    }

    assert.fail('the video columns were never written');
  }

  function readSession(sessionId) {
    return prisma.session
      .findUnique({
        where: { id: sessionId },
        select: {
          status: true,
          blocksUsed: true,
          totalCharged: true,
          budgetCap: true,
          platformFee: true,
          teacherEarning: true,
          startedAt: true,
          endsAt: true,
          endedAt: true,
          endReason: true,
          videoRoomName: true,
          videoRoomUrl: true,
          teacher: { select: { createdAt: true } },
        },
      })
      .then((row) => (row ? { ...row, teacherCreatedAt: row.teacher.createdAt } : row));
  }

  async function balanceOf(userId) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    return wallet.balance;
  }

  function ledgerCount(userId) {
    return prisma.walletTransaction.count({ where: { userId } });
  }

  async function teacherStatus() {
    const profile = await prisma.teacherProfile.findUnique({ where: { userId: world.teacherId } });

    return profile.status;
  }

  /**
   * Everything this file created, in foreign-key order.
   *
   * **The suite cleans up after itself**, which is the brief's "`npm test` twice in a row
   * on the same database, both green". `wallet_transactions.session_id` is
   * `onDelete: Restrict`, so the ledger goes before the sessions it points at, and the
   * users go last because three tables still reference them.
   */
  async function teardown() {
    const userIds = [world.studentId, world.teacherId, world.strangerId].filter(Boolean);

    if (userIds.length === 0) return;

    await prisma.review.deleteMany({ where: { sessionId: { in: sessions } } });
    await prisma.sessionBlock.deleteMany({ where: { sessionId: { in: sessions } } });
    await prisma.walletTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.offer.deleteMany({ where: { sessionId: { in: sessions } } });
    await prisma.session.deleteMany({ where: { id: { in: sessions } } });
    await prisma.question.deleteMany({ where: { studentId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.teacherProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});

/**
 * Whether anything is listening where `DATABASE_URL` points — **one TCP connection, one
 * second, and no Prisma client.**
 *
 * A `SELECT 1` through Prisma would be the obvious probe and is the wrong one: the client
 * is constructed at import time, its connection failure takes the pool's timeout to
 * surface, and a suite whose skip decision costs ten seconds is one somebody notices. A
 * socket that refuses immediately is the same answer for free.
 *
 * It answers "something is listening", not "the schema is migrated". A database that is up
 * and un-migrated fails loudly, which is right — the epic README's setup steps are two
 * commands and a red suite is how somebody finds out they skipped one.
 */
function databaseAnswers(url) {
  let target;

  try {
    target = new URL(url);
  } catch {
    return Promise.resolve(false);
  }

  return new Promise((answer) => {
    const socket = createConnection({
      host: target.hostname,
      port: Number(target.port || 5432),
      timeout: 1000,
    });

    const settle = (reachable) => {
      socket.destroy();
      answer(reachable);
    };

    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}
