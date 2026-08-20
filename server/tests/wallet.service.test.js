import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The wallet — PR 6.5, MVP.md §11.3-B, and **the file §17.5 says an agent may not write
 * unassisted but may test.** This is that test.
 *
 * **What a test can prove here and what it cannot, said first.** Every assertion below is
 * about *order* and *arithmetic*: that the lock is taken before the balance is used, that
 * a refused debit wrote neither the balance nor the ledger, that the ledger row's sign and
 * `balance_after` are what reconciliation will read. **Whether the lock is a real lock is
 * invisible from here** — these tests run one operation at a time, and a sequential suite
 * cannot tell `SELECT … FOR UPDATE` from a plain `SELECT`. That half is the brief's manual
 * run: two `curl` extends in the same command, one ledger row.
 *
 * The four steps arrive through the third argument, 3.3's idiom, so the whole file runs
 * with no database, no transaction and no money.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { ERROR_CODES } = await import('#config/errors/codes.js');
const { chargeStudent, creditTeacher, refundSession, topUpWallet } =
  await import('#services/wallet.service.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

const BALANCE = 96;

/** The transaction client. A sentinel, so "did this statement get the `tx`" is assertable. */
const TX = Object.freeze({ transactionClient: true });

/** Records every call in order, across all three collaborators. */
function recorder() {
  const calls = [];

  const spy = (name, implementation = () => undefined) => {
    const fn = (...args) => {
      calls.push({ name, args });

      return implementation(...args);
    };

    // A getter, not a snapshot: the array is filled as the calls happen, and a value
    // computed at creation time is always empty.
    Object.defineProperty(fn, 'calls', {
      get: () => calls.filter((call) => call.name === name),
    });

    return fn;
  };

  return { calls, spy };
}

/** The three statements, each answering the way the repository does. */
function deps({ balance = BALANCE, moved = 1 } = {}) {
  const { calls, spy } = recorder();

  return {
    calls,
    lockBalance: spy('lock', async () => balance),
    moveBalance: spy('move', async () => ({ count: moved })),
    appendLedger: spy('ledger', async () => ({ id: 'ledger-row' })),
  };
}

/** The names of the statements that ran, in the order they ran. */
const order = (collaborators) => collaborators.calls.map((call) => call.name);

/** The error a call threw, or `null`. */
async function thrownBy(promise) {
  try {
    await promise;

    return null;
  } catch (error) {
    return error;
  }
}

describe('the four steps, in order', () => {
  it('locks, then moves, then appends — and the lock is first', async () => {
    const collaborators = deps();

    await chargeStudent(
      { userId: STUDENT_ID, sessionId: SESSION_ID, amount: 20 },
      TX,
      collaborators,
    );

    // The order is the guarantee. A balance read after the update, or a ledger row
    // written before it, is a different function with the same name.
    assert.deepEqual(order(collaborators), ['lock', 'move', 'ledger']);
  });

  it('hands every statement the caller’s tx and opens none of its own', async () => {
    const collaborators = deps();

    await chargeStudent(
      { userId: STUDENT_ID, sessionId: SESSION_ID, amount: 20 },
      TX,
      collaborators,
    );

    for (const call of collaborators.calls) {
      assert.equal(call.args.at(-1), TX);
    }
  });
});

describe('chargeStudent — the only debit in the system', () => {
  it('moves the balance down and writes a negative SESSION_CHARGE row', async () => {
    const collaborators = deps();

    const { balanceAfter } = await chargeStudent(
      { userId: STUDENT_ID, sessionId: SESSION_ID, amount: 20, note: 'Opening block' },
      TX,
      collaborators,
    );

    const [move] = collaborators.moveBalance.calls;
    const [ledger] = collaborators.appendLedger.calls;

    assert.equal(balanceAfter, BALANCE - 20);
    assert.deepEqual(move.args[0], { userId: STUDENT_ID, delta: -20 });

    // Signed like the delta, so §11.3's reconciliation is a SUM and not a fold with a
    // sign lookup per row.
    assert.equal(ledger.args[0].type, 'SESSION_CHARGE');
    assert.equal(ledger.args[0].amount, -20);
    assert.equal(ledger.args[0].balanceAfter, BALANCE - 20);
    assert.equal(ledger.args[0].sessionId, SESSION_ID);
    assert.equal(ledger.args[0].note, 'Opening block');
  });

  it('refuses a balance that will not cover it, and writes nothing at all', async () => {
    const collaborators = deps({ balance: 19 });

    const error = await thrownBy(
      chargeStudent({ userId: STUDENT_ID, sessionId: SESSION_ID, amount: 20 }, TX, collaborators),
    );

    assert.equal(error.code, ERROR_CODES.INSUFFICIENT_CREDIT);
    assert.equal(error.statusCode, 402);

    // The assert is step 2 for this exact reason: nothing after it ran.
    assert.deepEqual(order(collaborators), ['lock']);
  });

  it('allows a balance exactly equal to the amount — the boundary is >=', async () => {
    const collaborators = deps({ balance: 20 });

    const { balanceAfter } = await chargeStudent(
      { userId: STUDENT_ID, sessionId: SESSION_ID, amount: 20 },
      TX,
      collaborators,
    );

    assert.equal(balanceAfter, 0);
  });

  it('asserts against the locked read, never against a balance read earlier', async () => {
    let reads = 0;
    const collaborators = deps();

    collaborators.lockBalance = (...args) => {
      reads += 1;
      collaborators.calls.push({ name: 'lock', args });

      return Promise.resolve(BALANCE);
    };

    await chargeStudent(
      { userId: STUDENT_ID, sessionId: SESSION_ID, amount: 20 },
      TX,
      collaborators,
    );

    // One read, and it is the one the decision was made against. A second read would be a
    // second answer to "what is the balance" inside one transaction.
    assert.equal(reads, 1);
  });
});

describe('creditTeacher and refundSession — the two credits', () => {
  it('credits the teacher upward with a TEACHER_EARNING row', async () => {
    const collaborators = deps({ balance: 5 });

    const { balanceAfter } = await creditTeacher(
      { userId: TEACHER_ID, sessionId: SESSION_ID, amount: 17 },
      TX,
      collaborators,
    );

    const [ledger] = collaborators.appendLedger.calls;

    assert.equal(balanceAfter, 22);
    assert.equal(ledger.args[0].type, 'TEACHER_EARNING');
    assert.equal(ledger.args[0].amount, 17);
    assert.equal(ledger.args[0].balanceAfter, 22);
  });

  it('refunds upward with a REFUND row, leaving the charge where it is', async () => {
    const collaborators = deps({ balance: 76 });

    const { balanceAfter } = await refundSession(
      { userId: STUDENT_ID, sessionId: SESSION_ID, amount: 20 },
      TX,
      collaborators,
    );

    const [ledger] = collaborators.appendLedger.calls;

    // A refund is an append, not a reversal: the SESSION_CHARGE row stays and these two
    // sum to zero, which is the honest description of what happened.
    assert.equal(balanceAfter, 96);
    assert.equal(ledger.args[0].type, 'REFUND');
    assert.equal(ledger.args[0].amount, 20);
  });

  it('never refuses a credit on affordability — there is nothing to assert', async () => {
    const collaborators = deps({ balance: 0 });

    const { balanceAfter } = await creditTeacher(
      { userId: TEACHER_ID, sessionId: SESSION_ID, amount: 3 },
      TX,
      collaborators,
    );

    assert.equal(balanceAfter, 3);
    assert.deepEqual(order(collaborators), ['lock', 'move', 'ledger']);
  });
});

describe('topUpWallet — the fourth operation, and the only credit from outside', () => {
  it('moves the balance up and writes a positive TOPUP row', async () => {
    const collaborators = deps({ balance: 6 });

    const { balanceAfter } = await topUpWallet(
      { userId: STUDENT_ID, amount: 50, note: 'Package 50' },
      TX,
      collaborators,
    );

    const [move] = collaborators.moveBalance.calls;
    const [ledger] = collaborators.appendLedger.calls;

    assert.equal(balanceAfter, 56);
    assert.deepEqual(move.args[0], { userId: STUDENT_ID, delta: 50 });

    assert.equal(ledger.args[0].type, 'TOPUP');
    assert.equal(ledger.args[0].amount, 50);
    assert.equal(ledger.args[0].balanceAfter, 56);
    assert.equal(ledger.args[0].note, 'Package 50');
  });

  /**
   * `null`, not `undefined`, and the difference is the point. The column is nullable
   * because a top-up belongs to no session, and the repository defaults it — so an
   * explicit `null` at the call site is the operation saying "there is no session here",
   * while an absent key is the operation having forgotten one. The first is a decision
   * and the second is indistinguishable from a bug in every future reader.
   */
  it('belongs to no session, and says so rather than omitting it', async () => {
    const collaborators = deps();

    await topUpWallet({ userId: STUDENT_ID, amount: 100 }, TX, collaborators);

    const [ledger] = collaborators.appendLedger.calls;

    assert.equal(ledger.args[0].sessionId, null);
  });

  it('takes the same four steps in the same order, and the lock is still first', async () => {
    const collaborators = deps();

    await topUpWallet({ userId: STUDENT_ID, amount: 50 }, TX, collaborators);

    // Not because a credit can fail on affordability — it cannot. Because `balance_after`
    // on the row is a number read before somebody else's concurrent debit committed
    // unless the read was locked, and invariant 1 of `reconcile.mjs` sums `amount` rather
    // than `balance_after`, so nothing downstream would ever catch it.
    assert.deepEqual(order(collaborators), ['lock', 'move', 'ledger']);
  });

  it('hands every statement the caller’s tx and opens none of its own', async () => {
    const collaborators = deps();

    await topUpWallet({ userId: STUDENT_ID, amount: 50 }, TX, collaborators);

    for (const call of collaborators.calls) {
      assert.equal(call.args.at(-1), TX);
    }
  });

  it('takes no affordability branch — an empty wallet tops up like any other', async () => {
    const collaborators = deps({ balance: 0 });

    const { balanceAfter } = await topUpWallet(
      { userId: STUDENT_ID, amount: 200 },
      TX,
      collaborators,
    );

    assert.equal(balanceAfter, 200);
    assert.deepEqual(order(collaborators), ['lock', 'move', 'ledger']);
  });

  /**
   * The allowlist that stops a client naming its own amount is 7.3's validator, one layer
   * up. What this file keeps is the guard the other three already apply: an amount that is
   * not a positive integer is a programming error, and it fails before step 1 rather than
   * rounding its way into the ledger and taking reconciliation with it.
   */
  it('refuses a non-integer, zero or negative amount before it reads anything', async () => {
    const collaborators = deps();

    for (const amount of [12.5, 0, -50]) {
      const error = await thrownBy(topUpWallet({ userId: STUDENT_ID, amount }, TX, collaborators));

      assert.equal(error.code, ERROR_CODES.INTERNAL_ERROR);
    }

    assert.deepEqual(order(collaborators), []);
  });

  it('treats a missing wallet row as a bug here too', async () => {
    const collaborators = deps({ balance: null });

    const error = await thrownBy(
      topUpWallet({ userId: STUDENT_ID, amount: 50 }, TX, collaborators),
    );

    assert.equal(error.code, ERROR_CODES.INTERNAL_ERROR);
    assert.deepEqual(order(collaborators), ['lock']);
  });
});

describe('what is a bug rather than a user error', () => {
  /**
   * All three answer `INTERNAL_ERROR` and not a 402. A student told to top up an account
   * that does not exist, or told they are short when the amount was a float, is a student
   * chasing somebody else's bug — and the 500 is what puts it in the log where it belongs.
   */
  it('refuses a non-integer amount before it reads anything', async () => {
    const collaborators = deps();

    const error = await thrownBy(
      chargeStudent({ userId: STUDENT_ID, sessionId: SESSION_ID, amount: 12.5 }, TX, collaborators),
    );

    assert.equal(error.code, ERROR_CODES.INTERNAL_ERROR);
    assert.deepEqual(order(collaborators), []);
  });

  it('refuses a zero or negative amount — the caller says what happened, not the sign', async () => {
    const collaborators = deps();

    for (const amount of [0, -20]) {
      const error = await thrownBy(
        refundSession({ userId: STUDENT_ID, sessionId: SESSION_ID, amount }, TX, collaborators),
      );

      assert.equal(error.code, ERROR_CODES.INTERNAL_ERROR);
    }

    assert.deepEqual(order(collaborators), []);
  });

  it('treats a missing wallet row as a bug, not as a poor student', async () => {
    const collaborators = deps({ balance: null });

    const error = await thrownBy(
      chargeStudent({ userId: STUDENT_ID, sessionId: SESSION_ID, amount: 20 }, TX, collaborators),
    );

    assert.equal(error.code, ERROR_CODES.INTERNAL_ERROR);
    assert.deepEqual(order(collaborators), ['lock']);
  });

  it('writes no ledger row when the balance did not move', async () => {
    const collaborators = deps({ moved: 0 });

    const error = await thrownBy(
      chargeStudent({ userId: STUDENT_ID, sessionId: SESSION_ID, amount: 20 }, TX, collaborators),
    );

    // A ledger row for a balance that did not move is exactly what reconciliation is
    // built to catch, and writing one here would be this file causing it.
    assert.equal(error.code, ERROR_CODES.INTERNAL_ERROR);
    assert.deepEqual(order(collaborators), ['lock', 'move']);
  });
});

const serviceSource = await readFile(
  fileURLToPath(new URL('../src/services/wallet.service.js', import.meta.url)),
  'utf8',
);

const repositorySource = await readFile(
  fileURLToPath(new URL('../src/repositories/wallet.repository.js', import.meta.url)),
  'utf8',
);

/** The code, with the prose stripped — both files argue about `$transaction` in comments. */
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the properties a call cannot demonstrate', () => {
  it('opens no transaction of its own — every operation takes the caller’s', () => {
    // A nested transaction here is a charge that commits when its session did not.
    assert.equal(/\$transaction/.test(withoutComments(serviceSource)), false);
    assert.equal(/\$transaction/.test(withoutComments(repositorySource)), false);
    assert.equal(/from '#config\/db\.js'/.test(withoutComments(repositorySource)), false);
  });

  it('locks the row it is about to spend from', () => {
    // The one assertion in this file about the SQL itself. A plain SELECT passes every
    // test above and loses money the first time two clients arrive together.
    assert.match(repositorySource, /SELECT balance[\s\S]*FOR UPDATE/);
  });

  it('never updates or deletes the ledger', () => {
    // One UPDATE against wallet_transactions is the end of the audit.
    assert.equal(
      /walletTransaction\.(update|delete|upsert)/.test(withoutComments(repositorySource)),
      false,
    );
    assert.equal(/walletTransaction/.test(withoutComments(serviceSource)), false);
  });

  /**
   * **Four, and the fourth is the last.** The header said three until E7, and the reason
   * it could was that nothing put credit into the system — every balance in the database
   * came from a seed. `topUpWallet` is the entry point; there is no fifth operation
   * waiting, and a diff that adds one is a diff that needs §17.5's argument made again.
   */
  it('exports four operations and no fifth', () => {
    const exported = [...serviceSource.matchAll(/^export (?:async )?function (\w+)/gm)].map(
      (match) => match[1],
    );

    assert.deepEqual(exported.sort(), [
      'chargeStudent',
      'creditTeacher',
      'refundSession',
      'topUpWallet',
    ]);
  });
});
