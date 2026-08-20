import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `POST /wallet/topup` — PR 7.3, MVP.md §5.4 and §12.
 *
 * **This endpoint gives money away, so read the refusals first.** It is a mock and it
 * credits immediately (§18's word; §21 puts a real provider in Phase 2), which makes the
 * allowlist and the rate limiter the only two things between it and an infinite-money
 * URL. Both are asserted below, and the allowlist is asserted twice — once at the
 * validator and once at the service — because the service looks the package up again
 * rather than transcribing the body, and a test that only checked the validator would
 * pass while that second defence quietly stopped existing.
 *
 * The other property worth a test is ordering: `wallet:updated` must be emitted **after**
 * the transaction commits. 6.3, 6.5 and 6.6 all made that call, and getting it wrong
 * tells a client about a balance that then rolls back — with no second event to take it
 * back with. The suite proves it by failing the transaction and asserting nothing was
 * emitted, which is the only way a sequential test can see an ordering.
 *
 * Every collaborator arrives through the last argument, so nothing here opens a
 * transaction, reaches a database or touches a socket.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { ERROR_CODES } = await import('#config/errors/codes.js');
const { TOPUP_PACKAGES } = await import('#config/constants/index.js');
const { topUpBalance } = await import('#services/wallet.topup.service.js');
const { walletTopUpSchema } = await import('#validators/wallet.schema.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '55555555-5555-4555-8555-555555555555';

/** The transaction client, a sentinel — "did the credit get the `tx`" is assertable. */
const TX = Object.freeze({ transactionClient: true });

/**
 * The four collaborators, recording every call in one ordered list so that "the emit
 * happened after the commit" is a fact about an array rather than about a timer.
 */
function deps({ balanceAfter = 150, row = { id: ROW_ID }, failInside = null } = {}) {
  const calls = [];

  return {
    calls,
    runTransaction: async (fn) => {
      calls.push({ name: 'begin' });

      const result = await fn(TX);

      calls.push({ name: 'commit' });

      return result;
    },
    creditWallet: async (params, tx) => {
      calls.push({ name: 'credit', params, tx });

      if (failInside) throw failInside;

      return { balanceAfter };
    },
    loadLatestRow: async (userId, tx) => {
      calls.push({ name: 'readBack', userId, tx });

      return row;
    },
    notifyWallet: (userId, payload) => {
      calls.push({ name: 'emit', userId, payload });
    },
  };
}

const order = (collaborators) => collaborators.calls.map((call) => call.name);

async function thrownBy(promise) {
  try {
    await promise;

    return null;
  } catch (error) {
    return error;
  }
}

/** What `validate()` would do with a given body. */
const parseBody = (body) => walletTopUpSchema.parse({ body, params: {}, query: {} }).body;

describe('the allowlist — at the validator', () => {
  it('accepts every package §5.4 declares, and nothing else', () => {
    for (const credits of TOPUP_PACKAGES) {
      assert.equal(parseBody({ packageId: credits }).packageId, credits);
    }
  });

  /**
   * A `min/max` pair would accept 137. Membership of `TOPUP_PACKAGES` is the rule, and it
   * is written against the constant so adding a package is one edit to
   * `constants/money.js`.
   */
  it('refuses an amount that is merely plausible', () => {
    for (const packageId of [137, 51, 199, 1, 1000, 0, -50]) {
      assert.throws(() => parseBody({ packageId }));
    }
  });

  it('refuses a body that names credits instead of a package', () => {
    // `{ amount: 999 }` must not be a request that half-works.
    assert.throws(() => parseBody({ amount: 50 }));
    assert.throws(() => parseBody({ packageId: TOPUP_PACKAGES[0], amount: 999 }));
    assert.throws(() => parseBody({ packageId: TOPUP_PACKAGES[0], userId: STUDENT_ID }));
  });

  /**
   * A query string has no types and `teacherListSchema` coerces for that reason. A JSON
   * body does, and `"50"` where a number belongs is a client bug worth a 400 — money is
   * the wrong place to be helpful about types.
   */
  it('does not coerce a string body value', () => {
    assert.throws(() => parseBody({ packageId: String(TOPUP_PACKAGES[0]) }));
  });

  it('refuses a non-integer', () => {
    assert.throws(() => parseBody({ packageId: 50.5 }));
  });
});

describe('the allowlist — at the service, a second time', () => {
  /**
   * The service looks the package up in `TOPUP_PACKAGES` rather than passing the body's
   * number through, so the value that reaches money comes from the constant. A later
   * refactor that lost the validator would still not be able to credit 137.
   */
  it('credits the amount from the constant, not the number it was handed', async () => {
    const collaborators = deps();

    await topUpBalance({ userId: STUDENT_ID, packageId: TOPUP_PACKAGES[1] }, collaborators);

    const [credit] = collaborators.calls.filter((call) => call.name === 'credit');

    assert.equal(credit.params.amount, TOPUP_PACKAGES[1]);
    assert.equal(TOPUP_PACKAGES.includes(credit.params.amount), true);
  });

  it('refuses a package the validator would have refused, and writes nothing', async () => {
    const collaborators = deps();

    const error = await thrownBy(
      topUpBalance({ userId: STUDENT_ID, packageId: 137 }, collaborators),
    );

    assert.equal(error.code, ERROR_CODES.VALIDATION_ERROR);
    assert.equal(error.statusCode, 400);
    assert.deepEqual(order(collaborators), []);
  });
});

describe('the transaction, and the emit that follows it', () => {
  it('credits, reads the row back, commits, then emits — in that order', async () => {
    const collaborators = deps();

    await topUpBalance({ userId: STUDENT_ID, packageId: TOPUP_PACKAGES[0] }, collaborators);

    assert.deepEqual(order(collaborators), ['begin', 'credit', 'readBack', 'commit', 'emit']);
  });

  it('hands the credit and the read-back the same transaction', async () => {
    const collaborators = deps();

    await topUpBalance({ userId: STUDENT_ID, packageId: TOPUP_PACKAGES[0] }, collaborators);

    for (const call of collaborators.calls.filter((c) => c.tx !== undefined)) {
      assert.equal(call.tx, TX);
    }
  });

  /**
   * The only way a sequential suite can see an ordering: fail inside, and assert that the
   * thing which was supposed to come after did not happen. An emit before the commit
   * tells a client about a balance that then rolls back, and there is no second event to
   * take it back with.
   */
  it('emits nothing when the transaction fails', async () => {
    const boom = new Error('rolled back');
    const collaborators = deps({ failInside: boom });

    const error = await thrownBy(
      topUpBalance({ userId: STUDENT_ID, packageId: TOPUP_PACKAGES[0] }, collaborators),
    );

    assert.equal(error, boom);
    assert.equal(
      collaborators.calls.some((call) => call.name === 'emit'),
      false,
    );
  });

  it('sends the absolute balance to the caller and to nobody else', async () => {
    const collaborators = deps({ balanceAfter: 150 });

    await topUpBalance({ userId: STUDENT_ID, packageId: TOPUP_PACKAGES[0] }, collaborators);

    const [emit] = collaborators.calls.filter((call) => call.name === 'emit');

    // The balance, never a delta: a client adding a delta to a number it was holding
    // drifts the first time it misses a frame.
    assert.equal(emit.userId, STUDENT_ID);
    assert.deepEqual(emit.payload, { balance: 150 });
  });
});

describe('the response', () => {
  it('echoes what was credited, so the confirmation cannot disagree', async () => {
    const result = await topUpBalance(
      { userId: STUDENT_ID, packageId: TOPUP_PACKAGES[2] },
      deps({ balanceAfter: 200 }),
    );

    assert.deepEqual(result, {
      balance: 200,
      credited: TOPUP_PACKAGES[2],
      transactionId: ROW_ID,
    });
  });

  it('treats a missing read-back as a bug — it just wrote that row', async () => {
    const collaborators = deps({ row: null });

    const error = await thrownBy(
      topUpBalance({ userId: STUDENT_ID, packageId: TOPUP_PACKAGES[0] }, collaborators),
    );

    assert.equal(error.code, ERROR_CODES.INTERNAL_ERROR);
    assert.equal(
      collaborators.calls.some((call) => call.name === 'emit'),
      false,
    );
  });

  it('never lets the caller name whose wallet is credited', async () => {
    const collaborators = deps();

    await topUpBalance({ userId: STUDENT_ID, packageId: TOPUP_PACKAGES[0] }, collaborators);

    const [credit] = collaborators.calls.filter((call) => call.name === 'credit');

    assert.equal(credit.params.userId, STUDENT_ID);
  });
});

const routesSource = await readFile(
  fileURLToPath(new URL('../src/routes/wallet.routes.js', import.meta.url)),
  'utf8',
);

const controllerSource = await readFile(
  fileURLToPath(new URL('../src/controllers/wallet.controller.js', import.meta.url)),
  'utf8',
);

const serviceSource = await readFile(
  fileURLToPath(new URL('../src/services/wallet.topup.service.js', import.meta.url)),
  'utf8',
);

const socketEventsSource = await readFile(
  fileURLToPath(new URL('../../shared/socketEvents.js', import.meta.url)),
  'utf8',
);

const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the properties a call cannot demonstrate', () => {
  it('rate-limits the top-up with its own instance', () => {
    // Not the shared `strictLimiter`, which is the two frozen auth routes' counter —
    // `question.routes.js` wrote down why a shared counter is the wrong meaning.
    const code = withoutComments(routesSource);

    assert.match(code, /makeStrictLimiter\(\)/);
    assert.equal(/strictLimiter[^(]/.test(code.replace(/makeStrictLimiter/g, '')), false);
    assert.match(code, /topUpLimiter/);
  });

  it('reads no request object below the controller', () => {
    // Layering rule 2: a service that transcribes `req.body` is one refactor away from
    // being the only check on the amount.
    assert.equal(/\breq\b/.test(withoutComments(serviceSource)), false);
  });

  it('keeps prisma out of the controller', () => {
    assert.equal(/prisma/.test(withoutComments(controllerSource)), false);
  });

  it('answers 201, because it created a ledger row', () => {
    assert.match(withoutComments(controllerSource), /status\(201\)/);
  });

  it('appended the event name rather than rewriting the paragraph above it', () => {
    // shared/socketEvents.js is APPEND-ONLY. E6 appended five names under a paragraph
    // saying they were unappended, and said why rather than editing it.
    assert.match(socketEventsSource, /WALLET_UPDATED: 'wallet:updated'/);
    // The line wraps, so match the sentence rather than the phrase straddling it.
    assert.match(socketEventsSource, /E6 has no wallet screen to update/);
  });
});
