import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The teacher's earnings — PR 7.6, `GET /wallet/earnings`.
 *
 * **Three things are worth protecting here and the first one is not arithmetic this
 * file can do.**
 *
 * `totals` is all-time. It is the single easiest thing in this endpoint to get wrong,
 * because folding the returned page produces exactly the right answer on page one and a
 * shrinking lifetime figure on page three — a bug that looks to a teacher like a pricing
 * change. It cannot be caught by a seeded database where every earning fits on one page,
 * so the fixtures below deliberately return totals that disagree with the page.
 *
 * The second is which number `teacherEarning` is. It exists twice — as `amount` on the
 * `TEACHER_EARNING` ledger row, and as `sessions.teacher_earning` — written to both
 * places in one transaction by 6.6. The projection must report the ledger's, because the
 * ledger is what the teacher's balance is made of, so the fixture gives the two
 * different values and asserts which one survives.
 *
 * The third is the fee, and it is checked by reading source text: §5.3's rate lives in
 * `utils/commission.js` and is resolved at `started_at`. Nothing on this path may
 * recompute it, and `PLATFORM_FEE_PCT` must not reach the client bundle.
 *
 * Every collaborator arrives through the last argument, 3.3's idiom, so the whole file
 * runs with no database.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { ERROR_CODES } = await import('#config/errors/codes.js');
const { DEFAULT_PAGE_SIZE } = await import('#config/constants/index.js');
const { getTeacherEarnings } = await import('#services/wallet.view.service.js');
const { toEarningRecord } = await import('#utils/walletView.js');

const TEACHER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

const UPDATED_AT = new Date('2026-08-20T09:04:00.000Z');
const ENDED_AT = new Date('2026-08-20T18:40:00.000Z');
const CREDITED_AT = new Date('2026-08-20T18:40:00.000Z');

/**
 * One earning as the repository hands it over.
 *
 * **`session.teacherEarning` is 99 and the ledger's `amount` is 34, deliberately.** They
 * are the same number in production and a fixture where they agree cannot tell a
 * projection that reads the ledger from one that reads the column. `note` is on it for
 * the same reason 7.2's fixture carries one: the `select` would not fetch it, so its
 * presence here is what makes the exclusion demonstrable rather than incidental.
 */
const earningRow = (over = {}) => ({
  amount: 34,
  createdAt: CREDITED_AT,
  note: 'Session earning',
  session: {
    id: SESSION_ID,
    endedAt: ENDED_AT,
    totalCharged: 40,
    platformFee: 6,
    teacherEarning: 99,
    question: {
      topic: { nameHe: 'חשבון אינפיניטסימלי' },
      subtopic: { nameHe: 'אינטגרציה בחלקים' },
    },
    ...over.session,
  },
  ...over,
});

/** The wallet read and the earnings read, recording what they were asked for. */
function deps({
  wallet = { balance: 512, updatedAt: UPDATED_AT },
  earnings,
  total,
  totals = { gross: 4000, fee: 600, net: 3400 },
} = {}) {
  const rows = earnings ?? [earningRow()];
  const calls = [];

  return {
    calls,
    loadWallet: async (userId) => {
      calls.push({ name: 'wallet', userId });

      return wallet;
    },
    loadEarnings: async (args) => {
      calls.push({ name: 'earnings', args });

      return { earnings: rows, total: total ?? rows.length, totals };
    },
  };
}

async function thrownBy(promise) {
  try {
    await promise;

    return null;
  } catch (error) {
    return error;
  }
}

const page = (over = {}) => ({
  userId: TEACHER_ID,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  ...over,
});

describe('GET /wallet/earnings — the response', () => {
  it('answers balance, earnings, total and totals, and exactly those four', async () => {
    const result = await getTeacherEarnings(page(), deps());

    assert.deepEqual(Object.keys(result).sort(), ['balance', 'earnings', 'total', 'totals']);
  });

  /**
   * §14.1 puts the wallet figure on this screen beside the lifetime net, and two reads of
   * the same number are two numbers that can disagree. `getTeacherEarnings` goes through
   * `getWallet`, so there is one answer and one place that decides what a missing row
   * means.
   */
  it('takes the balance from the same read GET /wallet answers with', async () => {
    const collaborators = deps();

    const result = await getTeacherEarnings(page(), collaborators);

    assert.equal(result.balance, 512);
    assert.deepEqual(collaborators.calls.map((call) => call.name).sort(), ['earnings', 'wallet']);
    assert.equal(collaborators.calls.find((call) => call.name === 'wallet').userId, TEACHER_ID);
  });

  it('inherits the missing-wallet 500 rather than answering a balance of zero', async () => {
    const error = await thrownBy(getTeacherEarnings(page(), deps({ wallet: null })));

    assert.equal(error.code, ERROR_CODES.INTERNAL_ERROR);
    assert.equal(error.statusCode, 500);
  });

  it('scopes the read to the caller', async () => {
    const collaborators = deps();

    await getTeacherEarnings(page(), collaborators);

    assert.equal(
      collaborators.calls.find((call) => call.name === 'earnings').args.userId,
      TEACHER_ID,
    );
  });

  /**
   * Most teachers, on the day they onboard. Three zeroes and an empty array, not a 404 —
   * a teacher who has taught nothing has really earned nothing.
   */
  it('answers an empty page and three zeroes for a teacher who has taught nothing', async () => {
    const result = await getTeacherEarnings(
      page(),
      deps({ earnings: [], total: 0, totals: { gross: 0, fee: 0, net: 0 } }),
    );

    assert.deepEqual(result.earnings, []);
    assert.equal(result.total, 0);
    assert.deepEqual(result.totals, { gross: 0, fee: 0, net: 0 });
  });
});

describe('totals — all-time, and never a fold over the page', () => {
  /**
   * The fixture returns one row worth 34 and totals worth 3400. A service that summed the
   * page would answer 34 here and would look perfectly correct on any database where the
   * whole history fits on one page — which is every database anybody tests against.
   */
  it('reports the aggregate it was given, not the sum of the rows it returned', async () => {
    const result = await getTeacherEarnings(page(), deps());

    assert.deepEqual(result.totals, { gross: 4000, fee: 600, net: 3400 });
    assert.notEqual(result.totals.net, result.earnings[0].teacherEarning);
  });

  it('does not change when the page does', async () => {
    const first = await getTeacherEarnings(page({ page: 1, pageSize: 1 }), deps({ total: 137 }));
    const third = await getTeacherEarnings(page({ page: 3, pageSize: 1 }), deps({ total: 137 }));

    assert.deepEqual(first.totals, third.totals);
    assert.equal(first.total, 137);
    assert.equal(third.total, 137);
  });

  it('turns page 3 of 20 into skip 40, like every other paged read here', async () => {
    const collaborators = deps();

    await getTeacherEarnings(page({ page: 3, pageSize: 20 }), collaborators);

    assert.deepEqual(collaborators.calls.find((call) => call.name === 'earnings').args, {
      userId: TEACHER_ID,
      skip: 40,
      take: 20,
    });
  });
});

describe('one earning row, as the teacher reads it', () => {
  it('reports the ledger amount as the earning, not the session column', () => {
    const record = toEarningRecord(earningRow());

    assert.equal(record.teacherEarning, 34);
    assert.notEqual(record.teacherEarning, 99);
  });

  it('carries the gross and the fee through untouched, and derives neither', () => {
    const record = toEarningRecord(earningRow());

    assert.equal(record.totalCharged, 40);
    assert.equal(record.platformFee, 6);
  });

  /**
   * §5.3 waives the commission for a teacher's first thirty days and inside the
   * low-demand window, so a `0` sits beside 15% rows on the same screen. It has to arrive
   * as a real zero rather than as an absent field — the screen labels it "no commission",
   * and it cannot label a `null`.
   */
  it('keeps a waived fee as the number zero', () => {
    const record = toEarningRecord(earningRow({ session: { platformFee: 0 } }));

    assert.equal(record.platformFee, 0);
    assert.equal('platformFee' in record, true);
  });

  it('is exactly EarningRecord, and never the operator-facing note', () => {
    const record = toEarningRecord(earningRow());

    assert.equal('note' in record, false);
    assert.deepEqual(Object.keys(record).sort(), [
      'endedAt',
      'platformFee',
      'sessionId',
      'teacherEarning',
      'topicName',
      'totalCharged',
    ]);
  });

  it('labels the row with the subtopic, then the topic, then nothing', () => {
    assert.equal(toEarningRecord(earningRow()).topicName, 'אינטגרציה בחלקים');

    assert.equal(
      toEarningRecord(earningRow({ session: { question: { topic: { nameHe: 'גיאומטריה' } } } }))
        .topicName,
      'גיאומטריה',
    );

    // A question that was never classified has neither, and the screen dates the row
    // instead. `null`, not an empty string — the contract says so.
    assert.equal(toEarningRecord(earningRow({ session: { question: null } })).topicName, null);
  });

  it('dates the row by ended_at, and falls back to when the money moved', () => {
    assert.equal(toEarningRecord(earningRow()).endedAt, ENDED_AT.toISOString());

    // `sessions.ended_at` is nullable in the schema and 6.6 writes it in the same
    // transaction that appends this row, so this is a type requirement rather than a real
    // case. A row that reached it is still better dated by the credit than by nothing.
    assert.equal(
      toEarningRecord(earningRow({ session: { endedAt: null } })).endedAt,
      CREDITED_AT.toISOString(),
    );
  });
});

const readRepositorySource = await readFile(
  fileURLToPath(new URL('../src/repositories/wallet.read.repository.js', import.meta.url)),
  'utf8',
);

const viewSource = await readFile(
  fileURLToPath(new URL('../src/utils/walletView.js', import.meta.url)),
  'utf8',
);

/** The code, with the prose stripped — every file here argues about these names. */
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the properties a call cannot demonstrate', () => {
  it('asks the database for the totals rather than adding them up in JavaScript', () => {
    const code = withoutComments(readRepositorySource);

    // Two aggregates: `_sum.amount` off the ledger for the net, and the session columns
    // for gross and fee. A `.reduce(` anywhere in this file would be the page-fold bug.
    assert.match(code, /_sum:\s*\{\s*amount:\s*true\s*\}/);
    assert.match(code, /_sum:\s*\{\s*totalCharged:\s*true,\s*platformFee:\s*true\s*\}/);
    assert.equal(/\.reduce\(/.test(code), false);
  });

  /**
   * The set is defined by the ledger — sessions that carry a `TEACHER_EARNING` row for
   * this teacher — and not by `teacherId`. A no-show and both of 7.4's refunds leave a
   * session with this teacher's id, an `ended_at` and no earning; aggregating by
   * `teacherId` would put money in the gross column they never saw a share of.
   */
  it('aggregates the sessions the ledger names, not the sessions the teacher taught', () => {
    const code = withoutComments(readRepositorySource);

    assert.match(code, /transactions:\s*\{\s*some:\s*where\s*\}/);
    assert.equal(/teacherId:/.test(code), false);
  });

  it('never selects teacher_earning off the session', () => {
    // Selecting both would invite a projection that quietly prefers the column over the
    // movement. reconcile.mjs invariant 4 is what checks they agree.
    const code = withoutComments(readRepositorySource);
    const earningView = code.slice(
      code.indexOf('EARNING_VIEW'),
      code.indexOf('findTeacherEarnings'),
    );

    assert.equal(/teacherEarning/.test(earningView), false);
  });

  it('never recomputes §5.3 on the way out', () => {
    // The rate, the thirty-day waiver and the low-demand window are commission.js's, and
    // that file's header says two implementations of §5.3 is two answers to "what did I
    // earn". The projection renders an integer.
    const code = withoutComments(viewSource);

    assert.equal(/PLATFORM_FEE|0\.15|commission/i.test(code), false);
  });

  it('still writes nothing, after gaining a third read', () => {
    const code = withoutComments(readRepositorySource);

    assert.equal(
      /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/.test(code),
      false,
    );
    assert.equal(/\$queryRaw|\$executeRaw/.test(code), false);
    assert.equal(/note/.test(code), false);
  });
});
