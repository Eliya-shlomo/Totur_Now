import assert from 'node:assert/strict';

import { BLOCK_MINUTES, OFFER_STATUS, OPENING_BLOCKS } from '#config/constants/index.js';
import { prisma } from '#config/db.js';

/**
 * PR 5.4's manual test, run by a machine — `POST /offers/:id/accept`,
 * `POST /offers/:id/reject` and `GET /sessions/:id` against a real Postgres and a
 * real server.
 *
 * **This is not a unit test and it is deliberately outside `npm test`.** The suite in
 * `offer.respond.test.js` injects every collaborator and touches no database, which is
 * what lets it assert the calls that did not happen — and is also why it cannot see the
 * thing 5.4 most needs seen. `releaseTeacherLock`'s `where` on `OFFER_LOCKED` is
 * invisible to a suite that runs one request at a time: dropping the predicate leaves
 * every unit test green and puts an offline teacher back in E4's candidate pool. Check
 * A below is the only automated thing in this repository that can tell the difference,
 * because it is the only one with a real row to set `OFFLINE` first.
 *
 * The file name has no `.test.js` in it on purpose: `npm test` globs
 * `server/tests/**\/*.test.js`, and a test that needs a database and a listening
 * server would turn a green suite red on any machine that has neither.
 *
 * ## Running it
 *
 * ```
 * npm run db:up && npm run db:seed        # a known world
 * npm run dev:server                      # in its own terminal
 * node server/tests/manual/verify-5.4.js  # from the repo root
 * ```
 *
 * `API_URL` overrides the base if the server is not on port 3000.
 *
 * **It writes rows.** Every check resets the two demo sessions, their offers and
 * `rejected_by` before it runs, and the run ends by putting the world back — but this
 * is a development database and `npm run db:seed` is the honest reset. Never point it
 * at anything else; it logs in as seeded accounts with the seeded password, which
 * exists nowhere but a demo.
 *
 * **If login answers 429**, the strict limiter has counted ten attempts from this IP in
 * fifteen minutes. It lives in memory, so restarting the server clears it.
 *
 * ## What each check is for
 *
 * A is the one that matters — the conditional release, invisible to `npm test`.
 * B and C are `rejected_by`, which has never held a non-empty array in this product's
 * life until 5.4. D is E4's 4.2 filter running against real data for the first time.
 * E is the epic README's gap 6: expiry asserted in code, and a late answer tidying up
 * after a cron that was asleep. F is the boundary — an accept that charges nothing.
 * G is the row-level authorisation, including the leak a `FORBIDDEN` would be.
 */

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const PASSWORD = 'TutorNow!2026';

const AVI = 'avi.student@demo.tutornow.il';
const NOYA = 'noya.student@demo.tutornow.il';
const IDO = 'ido.student@demo.tutornow.il';
const DANA = 'dana.k@demo.tutornow.il';

/** Everything discovered during setup, so the checks read as steps rather than lookups. */
const world = {};

/** One HTTP call, with the envelope already unwrapped. */
async function api(method, path, token, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await response.json().catch(() => null);

  return { status: response.status, json, data: json?.data, code: json?.error?.code };
}

async function login(email) {
  const { status, data, json } = await api('POST', '/auth/login', null, {
    email,
    password: PASSWORD,
  });

  assert.equal(status, 200, `login failed for ${email}: ${JSON.stringify(json)}`);

  return data.accessToken;
}

/** Sends one offer and returns the created row's id. Fails loudly, with the body. */
async function sendOffer(sessionId, studentToken) {
  const { status, data, json } = await api('POST', `/sessions/${sessionId}/offer`, studentToken, {
    teacherId: world.teacherId,
  });

  assert.equal(status, 201, `send offer failed: ${JSON.stringify(json)}`);

  return data.offerId;
}

/**
 * A known world before every check, so no check inherits another's rows.
 *
 * Offers are deleted rather than expired, the same call the seed makes: a leftover row
 * pointing at a session that has been reset is the fixture that makes the next run lie.
 */
async function resetWorld() {
  const sessionIds = [world.aviSessionId, world.noyaSessionId];
  const questionIds = [world.aviQuestionId, world.noyaQuestionId];

  await prisma.offer.deleteMany({ where: { sessionId: { in: sessionIds } } });

  await prisma.session.updateMany({
    where: { id: { in: sessionIds } },
    data: {
      status: 'PENDING',
      teacherId: null,
      pricePerBlock: null,
      startedAt: null,
      endsAt: null,
      blocksUsed: 0,
      totalCharged: 0,
    },
  });

  await prisma.question.updateMany({
    where: { id: { in: questionIds } },
    data: { rejectedBy: [] },
  });

  await prisma.teacherProfile.update({
    where: { userId: world.teacherId },
    data: { status: 'ONLINE' },
  });

  // Balances are captured at set-up and put back here, because check C tops one up.
  // The script is the only thing in this repository that writes `wallets` outside the
  // seed — E7 owns every real balance movement, and a fixture is not one.
  for (const [userId, balance] of Object.entries(world.balances)) {
    await prisma.wallet.update({ where: { userId }, data: { balance } });
  }
}

const teacherRow = () =>
  prisma.teacherProfile.findUnique({
    where: { userId: world.teacherId },
    select: { status: true, offersReceived: true, offersAccepted: true },
  });

const sessionRow = (id) =>
  prisma.session.findUnique({
    where: { id },
    select: {
      status: true,
      teacherId: true,
      pricePerBlock: true,
      startedAt: true,
      endsAt: true,
      blocksUsed: true,
      totalCharged: true,
    },
  });

const rejectedBy = async (id) =>
  (await prisma.question.findUnique({ where: { id }, select: { rejectedBy: true } })).rejectedBy;

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

/**
 * A — **the conditional release.** The brief's step 6, and the only thing here that
 * `npm test` cannot do.
 *
 * The teacher closes their laptop while the offer is open, so they are `OFFLINE` while
 * still holding it. Rejecting must leave them `OFFLINE`: an unconditional write of
 * `ONLINE` puts them back in E4's pool without them touching anything, and the next
 * student sends an offer to somebody who is not there. Both versions pass every
 * sequential test ever written, which is the whole reason for this file.
 */
check('A — a teacher who went OFFLINE stays OFFLINE after rejecting', async () => {
  await resetWorld();

  const offerId = await sendOffer(world.aviSessionId, world.aviToken);

  await prisma.teacherProfile.update({
    where: { userId: world.teacherId },
    data: { status: 'OFFLINE' },
  });

  const { status } = await api('POST', `/offers/${offerId}/reject`, world.danaToken);

  assert.equal(status, 200);

  const teacher = await teacherRow();

  assert.equal(
    teacher.status,
    'OFFLINE',
    'the release overwrote a teacher who had already moved on — the WHERE on OFFER_LOCKED is gone',
  );

  // The rest of the reject still has to have landed. A release that refused is not a
  // transaction that failed.
  const session = await sessionRow(world.aviSessionId);

  assert.equal(session.status, 'PENDING');
  assert.equal(session.teacherId, null);
  assert.equal(session.pricePerBlock, null);
});

/** B — `rejected_by` gets the first non-empty array in this product's life. */
check('B — a reject appends the teacher to questions.rejected_by and releases them', async () => {
  await resetWorld();

  const offerId = await sendOffer(world.aviSessionId, world.aviToken);
  const { status, data } = await api('POST', `/offers/${offerId}/reject`, world.danaToken);

  assert.equal(status, 200);
  assert.equal(data.status, OFFER_STATUS.REJECTED);

  assert.deepEqual(await rejectedBy(world.aviQuestionId), [world.teacherId]);
  assert.equal((await teacherRow()).status, 'ONLINE');
});

/**
 * C — two rejections, two questions, neither array losing its entry.
 *
 * Sequential, because a teacher must be `ONLINE` to be locked and so a question can
 * only carry one live offer at a time. The read-append-write is inside the transaction
 * for the case E6 makes reachable, not for this one.
 */
check('C — two rejections against two questions both land', async () => {
  await resetWorld();

  // The second demo student is seeded below the opening block for this teacher — 24
  // credits against 16 x OPENING_BLOCKS — so the offer would be refused with
  // `INSUFFICIENT_CREDIT` before it ever reached a rejection. Topped up to exactly what
  // 5.3's affordability read asks for, and put back by the next `resetWorld`.
  const { pricePerBlock } = await prisma.teacherProfile.findUnique({
    where: { userId: world.teacherId },
    select: { pricePerBlock: true },
  });

  await prisma.wallet.update({
    where: { userId: world.noyaId },
    data: { balance: pricePerBlock * OPENING_BLOCKS },
  });

  const first = await sendOffer(world.aviSessionId, world.aviToken);
  await api('POST', `/offers/${first}/reject`, world.danaToken);

  const second = await sendOffer(world.noyaSessionId, world.noyaToken);
  await api('POST', `/offers/${second}/reject`, world.danaToken);

  assert.deepEqual(await rejectedBy(world.aviQuestionId), [world.teacherId]);
  assert.deepEqual(await rejectedBy(world.noyaQuestionId), [world.teacherId]);
});

/** D — 4.2's exclusion filter, running against real data for the first time. */
check('D — matching stops offering the rejecter, and offers them again when cleared', async () => {
  await resetWorld();

  const before = await api('GET', `/questions/${world.aviQuestionId}/matches`, world.aviToken);
  const listed = (payload) =>
    payload.data.teachers.some((match) => match.teacher.id === world.teacherId);

  assert.equal(before.status, 200);
  assert.equal(
    listed(before),
    true,
    'the teacher is not a candidate even before rejecting — re-seed, this check cannot mean anything',
  );

  const offerId = await sendOffer(world.aviSessionId, world.aviToken);
  await api('POST', `/offers/${offerId}/reject`, world.danaToken);

  const after = await api('GET', `/questions/${world.aviQuestionId}/matches`, world.aviToken);

  assert.equal(listed(after), false, 'a teacher who declined is still being offered');

  await prisma.question.update({
    where: { id: world.aviQuestionId },
    data: { rejectedBy: [] },
  });

  const cleared = await api('GET', `/questions/${world.aviQuestionId}/matches`, world.aviToken);

  assert.equal(listed(cleared), true, 'clearing the array did not bring the teacher back');
});

/**
 * E — a late accept, on a row whose `status` column still reads `PENDING`.
 *
 * The cron may have been asleep — Render's free plan spins the instance down — so the
 * column is the sweeper's opinion and `expires_at` is the fact. The same call that
 * discovers the expiry must also tidy up, or it leaves a locked teacher behind.
 */
check('E — accepting an expired offer is 409 and sweeps the world tidy', async () => {
  await resetWorld();

  const offerId = await sendOffer(world.aviSessionId, world.aviToken);

  await prisma.offer.update({
    where: { id: offerId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });

  const before = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { status: true },
  });

  assert.equal(
    before.status,
    OFFER_STATUS.PENDING,
    'the column must still read PENDING for this to mean anything',
  );

  const { status, code } = await api('POST', `/offers/${offerId}/accept`, world.danaToken);

  assert.equal(status, 409);
  assert.equal(code, 'OFFER_EXPIRED');

  const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: { status: true } });
  const session = await sessionRow(world.aviSessionId);

  assert.equal(offer.status, OFFER_STATUS.EXPIRED);
  assert.equal(
    session.status,
    'PENDING',
    'the question is stuck at OFFER_SENT — no Send request will ever be accepted again',
  );
  assert.equal((await teacherRow()).status, 'ONLINE', 'the late accept left the teacher locked');
});

/** E2 — the other half of the same rule: an expired reject is a no-op success. */
check('E2 — rejecting an expired offer is 200, not 409', async () => {
  await resetWorld();

  const offerId = await sendOffer(world.aviSessionId, world.aviToken);

  await prisma.offer.update({
    where: { id: offerId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });

  const { status, data } = await api('POST', `/offers/${offerId}/reject`, world.danaToken);

  assert.equal(status, 200, 'a dismissed modal must not look broken');
  assert.equal(data.status, OFFER_STATUS.EXPIRED);

  // Nothing was rejected, so nothing goes in the array. The clock declined, not a person.
  assert.deepEqual(await rejectedBy(world.aviQuestionId), []);
});

/** F — the accept path, and the boundary: **E5 charges nothing.** */
check('F — an accept moves three rows, charges nothing, and cannot happen twice', async () => {
  await resetWorld();

  const before = await teacherRow();
  const offerId = await sendOffer(world.aviSessionId, world.aviToken);

  const { status, data } = await api('POST', `/offers/${offerId}/accept`, world.danaToken);

  assert.equal(status, 200);
  assert.equal(data.sessionId, world.aviSessionId);

  const session = await sessionRow(world.aviSessionId);

  assert.equal(session.status, 'ACTIVE');
  assert.equal(session.blocksUsed, 0, 'E5 charges nothing — the wallet is E7');
  assert.equal(session.totalCharged, 0, 'E5 charges nothing — the wallet is E7');
  assert.notEqual(session.startedAt, null);

  // From the constants, never from a literal: the day somebody tunes the appendix this
  // moves with it.
  assert.equal(
    session.endsAt.getTime() - session.startedAt.getTime(),
    OPENING_BLOCKS * BLOCK_MINUTES * 60 * 1000,
  );

  const after = await teacherRow();

  assert.equal(after.status, 'IN_SESSION');
  assert.equal(after.offersAccepted, before.offersAccepted + 1);

  const again = await api('POST', `/offers/${offerId}/accept`, world.danaToken);

  assert.equal(again.status, 409, 'a second accept must never produce a second ACTIVE session');
});

/** G — one route, two shapes, and `NOT_FOUND` for everybody else. */
check(
  'G — GET /sessions/:id answers both participants differently and nobody else at all',
  async () => {
    await resetWorld();

    await sendOffer(world.aviSessionId, world.aviToken);

    const student = await api('GET', `/sessions/${world.aviSessionId}`, world.aviToken);
    const teacher = await api('GET', `/sessions/${world.aviSessionId}`, world.danaToken);

    assert.equal(student.status, 200);
    assert.equal(teacher.status, 200);

    assert.notEqual(student.data.teacher, null, "the student's side carries the teacher card");
    assert.equal('brief' in student.data, false, "the student does not get the teacher's payload");

    assert.equal(typeof teacher.data.brief, 'string', "the teacher's side carries IncomingOffer");
    assert.equal('teacher' in teacher.data, false, 'the teacher does not get their own card back');

    const stranger = await api('GET', `/sessions/${world.aviSessionId}`, world.idoToken);

    assert.equal(stranger.status, 404, 'FORBIDDEN here would confirm the id is real');
    assert.equal(
      JSON.stringify(stranger.json).includes(world.aviSessionId),
      false,
      'the 404 body echoes the id back, which is the leak in a different envelope',
    );

    // A session the student owns but has no offer on answers with nulls rather than 404 —
    // the contract deviation written into 5.4's PR description.
    await resetWorld();

    const empty = await api('GET', `/sessions/${world.aviSessionId}`, world.aviToken);

    assert.equal(empty.status, 200);
    assert.equal(empty.data.offerId, null);
    assert.equal(empty.data.status, null);
    assert.equal(empty.data.teacher, null);
  },
);

/** G2 — the route's own gate: a student cannot answer an offer on the teacher's behalf. */
check(
  'G2 — a student calling accept is FORBIDDEN, and another teacher gets NOT_FOUND',
  async () => {
    await resetWorld();

    const offerId = await sendOffer(world.aviSessionId, world.aviToken);

    const asStudent = await api('POST', `/offers/${offerId}/accept`, world.aviToken);

    assert.equal(asStudent.status, 403, "authorize('teacher') is the gate for this one");

    const asStranger = await api('GET', `/sessions/${world.noyaSessionId}`, world.danaToken);

    assert.equal(asStranger.status, 404);
  },
);

/**
 * Discovery, done once. Everything is looked up rather than hardcoded, so a re-seeded
 * database with new uuids needs no edit here.
 */
async function setUp() {
  const [avi, noya, dana] = await Promise.all([
    prisma.user.findUnique({ where: { email: AVI }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: NOYA }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: DANA }, select: { id: true } }),
  ]);

  assert.ok(avi && noya && dana, 'the demo accounts are missing — run `npm run db:seed`');

  world.teacherId = dana.id;

  const sessionOf = async (studentId) => {
    const session = await prisma.session.findFirst({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, questionId: true },
    });

    assert.ok(session, 'a demo student has no session — run `npm run db:seed`');

    return session;
  };

  const aviSession = await sessionOf(avi.id);
  const noyaSession = await sessionOf(noya.id);

  world.aviSessionId = aviSession.id;
  world.aviQuestionId = aviSession.questionId;
  world.noyaSessionId = noyaSession.id;
  world.noyaQuestionId = noyaSession.questionId;

  world.noyaId = noya.id;

  const wallets = await prisma.wallet.findMany({
    where: { userId: { in: [avi.id, noya.id] } },
    select: { userId: true, balance: true },
  });

  assert.equal(wallets.length, 2, 'a demo student has no wallet — run `npm run db:seed`');

  world.balances = Object.fromEntries(wallets.map((w) => [w.userId, w.balance]));

  world.aviToken = await login(AVI);
  world.noyaToken = await login(NOYA);
  world.danaToken = await login(DANA);
  world.idoToken = await login(IDO);
}

async function main() {
  console.log(`\nPR 5.4 verification — ${API}\n`);

  await setUp();

  let failed = 0;

  for (const { name, fn } of checks) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${error.message.split('\n')[0]}`);
    }
  }

  // The world is left as the seed made it, so a failed run does not poison the next
  // one. `npm run db:seed` is still the honest reset.
  await resetWorld();

  console.log(
    `\n${checks.length - failed}/${checks.length} checks passed.` +
      (failed === 0
        ? ' Run it once more against a build with the OFFER_LOCKED predicate\n' +
          'removed from releaseTeacherLock — check A must fail, or it is not testing anything.\n'
        : '\n'),
  );

  await prisma.$disconnect();

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(`\nSetup failed: ${error.message}\n`);
  console.error('The server must be running (`npm run dev:server`) and the database seeded.\n');

  await prisma.$disconnect();
  process.exit(1);
});
