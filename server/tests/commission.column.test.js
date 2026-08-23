import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

/**
 * **§5.3's free month, measured from the right column.** PR 7.9, MVP.md §5.3.
 *
 * `platformFeeRate` has been correct since E5 and its `teacherCreatedAt` parameter says
 * in its own doc comment which column callers must pass: `teacher_profiles.created_at`,
 * the day somebody became a teacher, not `users.created_at`, the day the account was
 * registered. Two of the three call sites disagreed with it, and 7.8's twenty-operation
 * pass found both — F1, the settlement, joining `users`; F2, the accept modal, passing a
 * hardcoded `new Date()`.
 *
 * ## Why six epics of green tests never saw either
 *
 * **Every existing test injects the date.** `commission.js` is a pure function, so a
 * suite that hands it a `Date` exercises the arithmetic and can say nothing at all about
 * which column the SQL selected — and the arithmetic was never wrong. The whole defect
 * lives in the two lines that choose what to pass, and only a fixture where the two
 * timestamps genuinely differ can see them.
 *
 * **The seed cannot produce that fixture.** `prisma/seed` writes the user and the
 * profile in one transaction, so all sixteen demo teachers have the two dates
 * milliseconds apart. So does `createTeacher` in `e2e.session.lifecycle.test.js`, which
 * moves both together by design. Nobody builds a teacher whose account is old and whose
 * profile is new by accident — that teacher is E2's onboarding path, a student who
 * signed up months ago and onboarded as a teacher last week, and they are exactly who
 * §5.3's incentive is for and exactly who was charged 15% from their first lesson.
 *
 * So this file builds that fixture deliberately, and the two halves are tested where
 * each defect is:
 *
 * - **F1 is a repository test against real Postgres**, because the bug is in a `SELECT`.
 *   Stubbing anything here would test the stub. It skips when no database answers, the
 *   same probe and the same reason as `e2e.session.lifecycle.test.js`: `npm test` passes
 *   on a fresh clone and a suite that broke that is a suite somebody deletes.
 * - **F2 is a service test with stubbed collaborators**, because the bug is a hardcoded
 *   argument, and what has to be asserted is that the read now *happens*. A green run of
 *   the earning arithmetic alone would not distinguish the fix from the defect between
 *   06:00 and 14:00, when §5.3's other free window makes both answer the gross.
 *
 * **Both halves fail on `main`.** That is the point of the file.
 */

// ── environment, in the order that makes the real one win ──────────────────────────
//
// `config/env.js` calls `dotenv.config()` at import time and dotenv never overwrites a
// variable that is already set, so the repo-root `.env` is read here first and the
// fallbacks below fill only what it did not supply. The other way round, the dummy URL
// would win and the F1 half would spend its life talking to a host that does not exist.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: resolve(REPO_ROOT, '.env') });

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

/** What `.env` actually supplied. Empty is one of the two ways the F1 half skips. */
const configured = process.env.DATABASE_URL ?? '';

process.env.DATABASE_URL ||= 'postgresql://unused:unused@localhost:5433/unused';

/**
 * One TCP connection to the host and port in `DATABASE_URL`. Copied in shape from
 * `e2e.session.lifecycle.test.js` rather than shared, because a helper module imported
 * by two suites is a third place `npm test` can fail to resolve.
 */
function databaseAnswers(url, timeoutMs = 1500) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return Promise.resolve(false);
  }

  return new Promise((resolvePromise) => {
    const socket = createConnection({
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
    });

    const settle = (answered) => {
      socket.destroy();
      resolvePromise(answered);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.once('timeout', () => settle(false));
  });
}

const reachable = Boolean(configured) && (await databaseAnswers(configured));

const skip = reachable
  ? false
  : 'no database answered on DATABASE_URL — run `npm run db:up && npm run db:migrate`';

// Claimed through `config/db.js`'s own `globalThis` cache rather than around it, and
// with the query log off: that file asks for `['warn', 'error', 'query']` outside
// production, which is several hundred lines of SQL around one suite's output.
if (reachable) {
  const { PrismaClient } = await import('@prisma/client');

  globalThis.prisma ??= new PrismaClient({ log: ['warn', 'error'] });
}

const { NEW_TEACHER_FEE_DAYS, OFFER_STATUS, OPENING_BLOCKS, PLATFORM_FEE_PCT } =
  await import('#config/constants/index.js');
const { prisma } = await import('#config/db.js');
const { findSessionForMeter } = await import('#repositories/session.repository.js');
const { getSessionView } = await import('#services/session.view.service.js');
const { platformFeeRate } = await import('#utils/commission.js');
const { isLowDemandHour } = await import('#utils/time.js');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Comfortably outside `NEW_TEACHER_FEE_DAYS`, and comfortably inside it. */
const OLD_DAYS = NEW_TEACHER_FEE_DAYS * 2;
const NEW_DAYS = 5;

const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);

/**
 * An instant §5.3's *other* free window does not cover.
 *
 * `LOW_DEMAND_HOURS` waives commission for a slice of every day, resolved through
 * `TIMEZONE`, so a fee assertion made at whatever time the suite happens to run is a
 * fee assertion that is right in the afternoon and vacuous in the morning. Walking
 * hours forward from now until `isLowDemandHour` says no gives a chargeable instant
 * without this file restating the window — which is the same reason `commission.js`
 * takes `at` at all.
 */
function chargeableInstant() {
  let candidate = new Date();

  for (let i = 0; i < 24 && isLowDemandHour(candidate); i += 1) {
    candidate = new Date(candidate.getTime() + 60 * 60 * 1000);
  }

  return candidate;
}

const CHARGEABLE_AT = chargeableInstant();

describe('§5.3 reads teacher_profiles.created_at — F1, the settlement', { skip }, () => {
  /** Every row this file writes, so the teardown is a list and not a `deleteMany` guess. */
  const world = { studentId: null, teachers: [], sessionIds: [], questionIds: [] };

  before(async () => {
    world.studentId = await createStudent();

    // **The fixture the seed cannot make, in both directions.** One teacher registered
    // long ago and onboarded last week — E2's onboarding path, who §5.3 owes a free
    // month. One registered last week and has been teaching for months, which is not a
    // real path today but is the assertion that the fix did not simply swap one wrong
    // column for another.
    world.teachers.push({
      label: 'onboarded recently',
      id: await createTeacher({ userDays: OLD_DAYS, profileDays: NEW_DAYS }),
      expectedRate: 0,
    });

    world.teachers.push({
      label: 'teaching for months',
      id: await createTeacher({ userDays: NEW_DAYS, profileDays: OLD_DAYS }),
      expectedRate: PLATFORM_FEE_PCT,
    });
  });

  after(async () => {
    await teardown();
    await prisma.$disconnect();
  });

  it('answers the profile date, not the account date', async () => {
    for (const teacher of world.teachers) {
      const sessionId = await createSession(teacher.id);
      const locked = await prisma.$transaction((tx) => findSessionForMeter(sessionId, tx));

      const profile = await prisma.teacherProfile.findUnique({
        where: { userId: teacher.id },
        select: { createdAt: true },
      });
      const user = await prisma.user.findUnique({
        where: { id: teacher.id },
        select: { createdAt: true },
      });

      assert.equal(
        locked.teacherCreatedAt.getTime(),
        profile.createdAt.getTime(),
        `${teacher.label}: the meter must read teacher_profiles.created_at`,
      );

      // Stated as its own assertion rather than left implicit in the one above: the
      // fixture is only a fixture if the two columns really are far apart, and a seed
      // that wrote them together would make this whole file pass against the defect.
      assert.notEqual(locked.teacherCreatedAt.getTime(), user.createdAt.getTime());
    }
  });

  it('charges the teacher who onboarded last week nothing, and the one teaching for months 15%', async () => {
    for (const teacher of world.teachers) {
      const sessionId = await createSession(teacher.id);
      const locked = await prisma.$transaction((tx) => findSessionForMeter(sessionId, tx));

      // The composition the settlement actually performs — `session.end.service.js`
      // passes exactly these two arguments, `started_at` as `at`.
      const rate = platformFeeRate({
        teacherCreatedAt: locked.teacherCreatedAt,
        at: CHARGEABLE_AT,
      });

      assert.equal(rate, teacher.expectedRate, `${teacher.label}: §5.3's rate`);
    }
  });

  // ── fixtures ──────────────────────────────────────────────────────────────────────
  //
  // `@prisma/client` reached directly from a test rather than through a repository, the
  // same trade `e2e.session.lifecycle.test.js` makes and for the same reason: arranging
  // rows is not a layering decision, and the function under test still reaches the
  // database through its own SQL.

  async function createStudent() {
    const user = await prisma.user.create({
      data: {
        email: `commission-column-student-${Date.now()}@example.invalid`,
        passwordHash: 'not-a-real-hash',
        fullName: 'Commission Column Student',
        role: 'student',
        wallet: { create: { balance: 500 } },
      },
    });

    return user.id;
  }

  /**
   * The whole point of the file: `users.created_at` and `teacher_profiles.created_at`
   * set independently, which no other fixture in this repo does.
   */
  async function createTeacher({ userDays, profileDays }) {
    const user = await prisma.user.create({
      data: {
        email: `commission-column-teacher-${userDays}-${profileDays}-${Date.now()}@example.invalid`,
        passwordHash: 'not-a-real-hash',
        fullName: 'Commission Column Teacher',
        role: 'teacher',
        createdAt: daysAgo(userDays),
        wallet: { create: { balance: 0 } },
        teacherProfile: {
          create: {
            pricePerBlock: 10,
            status: 'OFFLINE',
            levelMax: 5,
            createdAt: daysAgo(profileDays),
          },
        },
      },
    });

    return user.id;
  }

  /**
   * An `ACTIVE` session, which is the only state `findSessionForMeter` is ever called
   * on. Nothing here charges: the money paths are 6.5's and 6.6's and have their own
   * suites, and this file is about one column in one `SELECT`.
   */
  async function createSession(teacherId) {
    const question = await prisma.question.create({
      data: {
        studentId: world.studentId,
        rawText: 'A question asked so that a session exists to meter.',
        declaredLevel: 5,
      },
    });

    world.questionIds.push(question.id);

    const session = await prisma.session.create({
      data: {
        questionId: question.id,
        studentId: world.studentId,
        teacherId,
        status: 'ACTIVE',
        pricePerBlock: 10,
        budgetCap: 100,
        startedAt: CHARGEABLE_AT,
        endsAt: new Date(CHARGEABLE_AT.getTime() + 10 * 60 * 1000),
      },
    });

    world.sessionIds.push(session.id);

    return session.id;
  }

  /**
   * Deleted in dependency order and by id. `onDelete: Cascade` would take the profile
   * and the wallet with the user, but the sessions reference both participants, so they
   * go first — and a suite that left `ACTIVE` sessions behind would break
   * `scripts/reconcile.mjs`'s second invariant for whoever runs it next.
   */
  async function teardown() {
    await prisma.session.deleteMany({ where: { id: { in: world.sessionIds } } });
    await prisma.question.deleteMany({ where: { id: { in: world.questionIds } } });
    await prisma.user.deleteMany({
      where: { id: { in: [world.studentId, ...world.teachers.map((t) => t.id)] } },
    });
  }
});

describe('§5.3 reaches the accept modal — F2, expectedEarning', () => {
  const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
  const TEACHER_ID = '44444444-4444-4444-8444-444444444444';
  const SESSION_ID = '33333333-3333-4333-8333-333333333333';
  const OFFER_ID = '66666666-6666-4666-8666-666666666666';
  const PRICE_PER_BLOCK = 12;

  function spy(implementation = () => undefined) {
    const fn = (...args) => {
      fn.calls.push(args);

      return implementation(...args);
    };

    fn.calls = [];

    return fn;
  }

  const sessionRow = () => ({
    id: SESSION_ID,
    status: 'OFFER_SENT',
    studentId: STUDENT_ID,
    teacherId: TEACHER_ID,
    pricePerBlock: PRICE_PER_BLOCK,
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
  });

  /** `findTeacherForNotification`'s shape — the profile's date and the user's contact. */
  const contactRow = (createdAt) => ({
    createdAt,
    user: { fullName: 'Dana Levi', email: 'dana@example.invalid' },
  });

  it('reads the teacher profile rather than assuming the teacher joined just now', async () => {
    const loadTeacherContact = spy(async () => contactRow(daysAgo(OLD_DAYS)));

    await getSessionView(
      { sessionId: SESSION_ID, userId: TEACHER_ID },
      { loadSession: async () => sessionRow(), loadTeacherContact },
    );

    // **The assertion that fails on `main` at every hour of the day.** Before 7.9 the
    // fee rate came from a hardcoded `new Date()` and no read of the teacher happened
    // at all — and between 06:00 and 14:00 the earning itself is the gross either way,
    // because §5.3's low-demand window waives the fee for everybody. So the call is what
    // is asserted first, and the arithmetic second.
    assert.equal(loadTeacherContact.calls.length, 1);
    assert.deepEqual(loadTeacherContact.calls[0], [TEACHER_ID]);
  });

  it('quotes the same number §5.3 will settle at — the net, not the gross', async () => {
    const teacherCreatedAt = daysAgo(OLD_DAYS);

    const view = await getSessionView(
      { sessionId: SESSION_ID, userId: TEACHER_ID },
      {
        loadSession: async () => sessionRow(),
        loadTeacherContact: async () => contactRow(teacherCreatedAt),
      },
    );

    // Computed, never typed. §5.3's second free window is a time of day, so a suite that
    // hard-coded 15% would go red every morning between six and two — E5's lesson, and
    // `e2e.session.lifecycle.test.js` states it the same way.
    const expected = PRICE_PER_BLOCK * OPENING_BLOCKS * (1 - platformFeeRate({ teacherCreatedAt }));

    assert.equal(view.expectedEarning, expected);
  });

  it('falls back to now when the profile read answers nothing, quoting more rather than less', async () => {
    const view = await getSessionView(
      { sessionId: SESSION_ID, userId: TEACHER_ID },
      { loadSession: async () => sessionRow(), loadTeacherContact: async () => null },
    );

    // 5.6's fallback, kept deliberately: a teacher shown 15% too much on a payload the
    // platform failed to enrich is a smaller wrong than one shown 15% too little, and
    // the settlement charges from the row either way.
    assert.equal(view.expectedEarning, PRICE_PER_BLOCK * OPENING_BLOCKS);
  });

  it('never reads a teacher profile for the student', async () => {
    const loadTeacherContact = spy(async () => contactRow(daysAgo(OLD_DAYS)));

    await getSessionView(
      { sessionId: SESSION_ID, userId: STUDENT_ID },
      {
        loadSession: async () => sessionRow(),
        loadTeacher: async () => null,
        loadTeacherContact,
      },
    );

    // `OfferResponse` has no `expectedEarning`. A read on the student's branch would be
    // a query whose result is thrown away, on the screen that polls while a countdown
    // runs.
    assert.equal(loadTeacherContact.calls.length, 0);
  });
});
