import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

/**
 * **The other branch: the teacher who never arrived.** PR 6.8, MVP.md §5.1, §10 and §11.3.
 *
 * `e2e.session.lifecycle.test.js` walks the path where everything works. This one walks
 * the path where the money goes back, and it is a separate file rather than a describe
 * block in that one for the reason the brief gives: the two end in different terminal
 * states with different arithmetic, and a suite that has to remember which of two
 * sessions it is talking about is a suite whose failures are hard to read.
 *
 * Three sessions, because there are three answers and each needs its own row:
 *
 * | session | what happens |
 * |---|---|
 * | A | reported inside the window — refunded in full, `NO_SHOW`, and never rated |
 * | B | reported after the window — refused, with the sentence that names the remedy |
 * | C | reported after an extension — refused by the second guard, whatever the clock says |
 *
 * **The refund is the whole of `total_charged` with no fee taken out of it**, and the
 * teacher is credited nothing: a refund net of commission is the platform keeping money
 * for a lesson that did not happen. `sessions_count` does not move and `no_show_count`
 * does, because E4's smoothing divides one aggregate by another and a lesson nobody taught
 * belongs in neither.
 *
 * The same three rules as its sibling: Daily is stubbed at the `video.service` boundary,
 * `started_at` is moved rather than waited on, and the whole file skips when no database
 * answers. All three are argued at length in that file's header.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: resolve(REPO_ROOT, '.env') });

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

/** What `.env` actually supplied. Empty is one of the two ways this suite skips. */
const configured = process.env.DATABASE_URL ?? '';

process.env.DATABASE_URL ||= 'postgresql://unused:unused@localhost:5433/unused';

const reachable = Boolean(configured) && (await databaseAnswers(configured));

const skip = reachable
  ? false
  : 'no database answered on DATABASE_URL — run `npm run db:up && npm run db:migrate`';

// The quiet client, claimed through `config/db.js`'s own `globalThis` cache. Its sibling
// file's header has the argument; the short version is that the alternative is a line of
// SQL per statement around one suite's output.
if (reachable) {
  const { PrismaClient } = await import('@prisma/client');

  globalThis.prisma ??= new PrismaClient({ log: ['warn', 'error'] });
}

const { BLOCK_MINUTES, EXTENSION_BLOCKS, NO_SHOW_WINDOW_SEC, OFFER_STATUS, OPENING_BLOCKS } =
  await import('#config/constants/index.js');
const { ERROR_CODES } = await import('#config/errors/codes.js');
const { prisma } = await import('#config/db.js');
const { acceptOffer } = await import('#services/offer.respond.service.js');
const { extendSessionBlock } = await import('#services/session.meter.service.js');
const { reportSessionNoShow, terminateSession } = await import('#services/session.end.service.js');
const { submitSessionReview } = await import('#services/session.review.service.js');

const PRICE_PER_BLOCK = 10;
const BUDGET_CAP = (OPENING_BLOCKS + 2 * EXTENSION_BLOCKS) * PRICE_PER_BLOCK;
const STARTING_BALANCE = 500;
const OPENING_CHARGE = OPENING_BLOCKS * PRICE_PER_BLOCK;

describe('E2E — the teacher never arrived, against the real database', { skip }, () => {
  const world = { studentId: null, teacherId: null };

  /** Every session this file creates, for the cleanup and for the ledger walk. */
  const sessions = [];

  const emitted = [];
  const record = (event) => (sessionId, payload) => emitted.push({ event, sessionId, payload });

  const acceptDeps = {
    createRoom: async (sessionId) => ({
      roomName: `e2e-${sessionId.slice(0, 8)}`,
      roomUrl: `https://example.invalid/e2e-${sessionId.slice(0, 8)}`,
    }),
    announceStatus: () => {},
    notifyAccepted: record('offer:accepted'),
  };

  /** The three sessions, filled as each test reaches its own. */
  const walk = { refunded: null, late: null, extended: null };

  before(async () => {
    world.studentId = await createStudent();
    world.teacherId = await createTeacher();
  });

  after(async () => {
    await teardown();
    await prisma.$disconnect();
  });

  // ── A — reported inside the window ───────────────────────────────────────────────

  it('refunds the whole charge, marks NO_SHOW, and credits the teacher nothing', async () => {
    walk.refunded = await acceptOne();

    const charged = await balanceOf(world.studentId);

    assert.equal(charged, STARTING_BALANCE - OPENING_CHARGE, 'the opening block was taken');

    const teacherBefore = await balanceOf(world.teacherId);

    const result = await reportSessionNoShow(
      { sessionId: walk.refunded, studentId: world.studentId },
      { notifyEnded: record('session:ended') },
    );

    assert.equal(result.status, 'NO_SHOW');
    assert.equal(result.endReason, 'teacher_no_show');
    assert.equal(result.balance, STARTING_BALANCE, 'every credit back, in one refund');

    const session = await readSession(walk.refunded);

    assert.equal(session.status, 'NO_SHOW');

    // **No fee on a refunded lesson**, both columns explicitly zero: §5.3's split never
    // ran, and a commission on a session that did not happen is the platform charging for
    // nothing.
    assert.equal(session.platformFee, 0);
    assert.equal(session.teacherEarning, 0);

    assert.equal(await balanceOf(world.teacherId), teacherBefore, 'the teacher was paid nothing');

    // A refund is an append, never a reversal: the `SESSION_CHARGE` row stays exactly
    // where it is and a `REFUND` row is written beside it. The two sum to zero, which is
    // the honest description of what took place.
    const rows = await prisma.walletTransaction.findMany({
      where: { sessionId: walk.refunded },
      orderBy: { createdAt: 'asc' },
      select: { type: true, amount: true },
    });

    assert.deepEqual(rows, [
      { type: 'SESSION_CHARGE', amount: -OPENING_CHARGE },
      { type: 'REFUND', amount: OPENING_CHARGE },
    ]);

    const profile = await profileOf();

    // Nobody taught anything, so the denominator E4's smoothing divides by does not move.
    assert.equal(profile.sessionsCount, 0);
    assert.equal(profile.noShowCount, 1);
    assert.equal(profile.status, 'ONLINE', 'released, and available again');

    assert.ok(
      emitted.some((frame) => frame.event === 'session:ended' && frame.sessionId === walk.refunded),
      'both sides were told, after the commit',
    );
  });

  it('refuses everything a refunded session could still be asked to do, and says it was refunded', async () => {
    const sessionId = walk.refunded;

    // §10 draws no arrow out of `NO_SHOW`. A review about somebody who never arrived is a
    // row about nothing, and it would take `resolved_count` down with it.
    await assert.rejects(
      () => submitSessionReview({ sessionId, studentId: world.studentId, isResolved: false }),
      (error) => error.code === ERROR_CODES.SESSION_NOT_ACTIVE,
    );

    // The two stale screens, and the sentence is the one the money justifies: "no longer
    // running" is true and useless to a student whose credits have just come back.
    await assert.rejects(
      () => extendSessionBlock({ sessionId, studentId: world.studentId }),
      (error) =>
        error.code === ERROR_CODES.SESSION_NOT_ACTIVE &&
        error.message === 'This session was refunded.',
    );

    await assert.rejects(
      () => terminateSession({ sessionId, endReason: 'student_ended', actorId: world.teacherId }),
      (error) =>
        error.code === ERROR_CODES.SESSION_NOT_ACTIVE &&
        error.message === 'This session was refunded.',
    );

    const reviews = await prisma.review.count({ where: { sessionId } });

    assert.equal(reviews, 0);
    assert.equal(await balanceOf(world.studentId), STARTING_BALANCE, 'and nothing moved again');
  });

  // ── B — reported after the window ────────────────────────────────────────────────

  it('refuses a report past the window, and names the remedy instead of stopping at "no"', async () => {
    walk.late = await acceptOne();

    // The clock, injected: `started_at` is moved back rather than the suite sitting out
    // the window. The service compares it against its own `new Date()`, which is what a
    // late press does in production.
    await prisma.session.update({
      where: { id: walk.late },
      data: { startedAt: new Date(Date.now() - 2 * NO_SHOW_WINDOW_SEC * 1000) },
    });

    await assert.rejects(
      () => reportSessionNoShow({ sessionId: walk.late, studentId: world.studentId }),
      (error) =>
        error.code === ERROR_CODES.SESSION_NOT_ACTIVE &&
        error.message === 'The no-show window has closed — you can end the session instead.',
    );

    const refused = await readSession(walk.late);

    assert.equal(refused.status, 'ACTIVE', 'nothing was written by the refusal');
    assert.equal(await balanceOf(world.studentId), STARTING_BALANCE - OPENING_CHARGE);

    // **The remedy the message names, taken.** It charges — that is the product's answer
    // to a teacher who vanished after the window, and 6.9 records it as a gap rather than
    // pretending otherwise.
    const ended = await terminateSession(
      { sessionId: walk.late, endReason: 'student_ended', actorId: world.studentId },
      { notifyEnded: record('session:ended') },
    );

    assert.equal(ended.status, 'ENDED');

    const session = await readSession(walk.late);

    assert.equal(session.platformFee + session.teacherEarning, session.totalCharged);
    assert.equal(
      await balanceOf(world.studentId),
      STARTING_BALANCE - OPENING_CHARGE,
      'the end charges nothing further — the blocks were paid for as they ran',
    );
  });

  // ── C — reported after an extension ──────────────────────────────────────────────

  it('refuses a report on a session that has already run past its first block', async () => {
    walk.extended = await acceptOne();

    await extendSessionBlock(
      { sessionId: walk.extended, studentId: world.studentId },
      { notifyExtended: record('session:extended') },
    );

    // Inside the window by the clock — this session started a moment ago — and refused
    // anyway. A session somebody extended was not a no-show, whatever the clock says, and
    // the window above makes this guard nearly unreachable rather than unnecessary.
    await assert.rejects(
      () => reportSessionNoShow({ sessionId: walk.extended, studentId: world.studentId }),
      (error) =>
        error.code === ERROR_CODES.SESSION_NOT_ACTIVE &&
        error.message === 'This session has already run past its first block.',
    );

    const session = await readSession(walk.extended);

    assert.equal(session.status, 'ACTIVE');
    assert.equal(session.blocksUsed, OPENING_BLOCKS + EXTENSION_BLOCKS);

    await terminateSession(
      { sessionId: walk.extended, endReason: 'student_ended', actorId: world.studentId },
      { notifyEnded: record('session:ended') },
    );

    assert.equal((await readSession(walk.extended)).status, 'ENDED');
  });

  // ── reconciliation — §11.3, and the last assertion in this file ──────────────────

  it('reconciles: every balance equals the sum of its ledger, and every session equals its blocks', async () => {
    for (const userId of [world.studentId, world.teacherId]) {
      const balance = await balanceOf(userId);
      const ledger = await prisma.walletTransaction.aggregate({
        where: { userId },
        _sum: { amount: true },
      });

      // The fixtures seed a balance with no `TOPUP` row behind it — E7 owns that endpoint
      // — so the opening balance is the constant rather than a sum. Everything after it is
      // the ledger's.
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
        _sum: { amount: true },
      });

      assert.equal(
        session.totalCharged,
        blocks._sum.amount ?? 0,
        `session ${sessionId}: total_charged disagrees with the sum of its blocks`,
      );

      assert.equal(
        session.platformFee + session.teacherEarning,
        session.totalCharged - refunded(session),
      );

      const debits = await prisma.walletTransaction.aggregate({
        where: { sessionId, type: 'SESSION_CHARGE' },
        _sum: { amount: true },
      });

      assert.equal(
        -(debits._sum.amount ?? 0),
        session.totalCharged,
        `session ${sessionId}: the debits disagree with what it says it charged`,
      );
    }
  });

  // ── the fixture ──────────────────────────────────────────────────────────────────

  /**
   * What the split has to add up to on a refunded session: nothing.
   *
   * `platform_fee + teacher_earning === total_charged` holds for every session that ran,
   * and a `NO_SHOW` deliberately breaks it — both columns are zero while `total_charged`
   * still records what was taken and given back. The ledger is where that session
   * balances, which is the row above this one.
   */
  function refunded(session) {
    return session.status === 'NO_SHOW' ? session.totalCharged : 0;
  }

  /** A question, a session, an offer, and the accept — E5's output, which this starts from. */
  async function acceptOne() {
    await prisma.teacherProfile.update({
      where: { userId: world.teacherId },
      data: { status: 'OFFER_LOCKED' },
    });

    const question = await prisma.question.create({
      data: {
        studentId: world.studentId,
        rawText: 'A question whose teacher does not turn up.',
        declaredLevel: 4,
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

    await acceptOffer({ offerId: offer.id, teacherId: world.teacherId }, acceptDeps);

    // The refund path is refused by `blocks_used` as well as by the clock, so the walk
    // must be sure the opening block landed before it reports anything.
    const started = await readSession(session.id);

    assert.equal(started.status, 'ACTIVE');
    assert.equal(started.blocksUsed, OPENING_BLOCKS);
    assert.equal(
      started.endsAt.getTime() - started.startedAt.getTime(),
      OPENING_BLOCKS * BLOCK_MINUTES * 60 * 1000,
    );

    return session.id;
  }

  async function createStudent() {
    const user = await prisma.user.create({
      data: {
        email: `e2e-noshow-student-${Date.now()}@example.invalid`,
        passwordHash: 'not-a-real-hash',
        fullName: 'E2E Student',
        role: 'student',
        wallet: { create: { balance: STARTING_BALANCE } },
      },
    });

    return user.id;
  }

  async function createTeacher() {
    const user = await prisma.user.create({
      data: {
        email: `e2e-noshow-teacher-${Date.now()}@example.invalid`,
        passwordHash: 'not-a-real-hash',
        fullName: 'E2E Teacher',
        role: 'teacher',
        wallet: { create: { balance: STARTING_BALANCE } },
        teacherProfile: {
          create: { pricePerBlock: PRICE_PER_BLOCK, status: 'OFFLINE', levelMax: 5 },
        },
      },
    });

    return user.id;
  }

  function readSession(sessionId) {
    return prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        status: true,
        blocksUsed: true,
        totalCharged: true,
        platformFee: true,
        teacherEarning: true,
        startedAt: true,
        endsAt: true,
        endReason: true,
      },
    });
  }

  async function balanceOf(userId) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    return wallet.balance;
  }

  function profileOf() {
    return prisma.teacherProfile.findUnique({ where: { userId: world.teacherId } });
  }

  /** In foreign-key order, so `npm test` twice on one database is green twice. */
  async function teardown() {
    const userIds = [world.studentId, world.teacherId].filter(Boolean);

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
 * Whether anything is listening where `DATABASE_URL` points — one TCP connection, one
 * second, and no Prisma client. The argument for the shape of this is on
 * `e2e.session.lifecycle.test.js`; it is repeated rather than shared because a helper
 * module would be a third file in a two-file allowlist, and this one has no state.
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
