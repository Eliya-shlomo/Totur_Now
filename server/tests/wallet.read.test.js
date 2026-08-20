import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The wallet's read surface — PR 7.2, `GET /wallet` and `GET /wallet/transactions`.
 *
 * **Three things are worth protecting here and only one of them is arithmetic.**
 *
 * The arithmetic is the paging: `skip` is `(page - 1) * pageSize`, and an off-by-one
 * there returns page 2 to somebody who asked for page 1 and is invisible on a seeded
 * database where every ledger fits on one page.
 *
 * The second is `note`. `appendWalletTransaction`'s contract calls it operator-facing
 * text that never reaches a client, and this is the first endpoint in the project that
 * could put one on a screen. Two independent defences — the repository's `select` and
 * the view's explicit construction — and the assertions below check both, because a
 * single check would pass while one of the two quietly stopped mattering.
 *
 * The third is layering, and it is checked by reading source text rather than by calling
 * anything: the controller must not import `prisma`, and this read path must not import
 * `wallet.service.js`. Neither property has a return value, and both are the ones that
 * make `/wallet` the mount where a balance could change outside §17.5's file.
 *
 * Every collaborator arrives through the last argument, 3.3's idiom, so the whole file
 * runs with no database.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { ERROR_CODES } = await import('#config/errors/codes.js');
const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = await import('#config/constants/index.js');
const { getWallet, getWalletTransactions } = await import('#services/wallet.view.service.js');
const { walletSchema, walletTransactionsSchema } = await import('#validators/wallet.schema.js');
const { toWalletTransaction } = await import('#utils/walletView.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

const UPDATED_AT = new Date('2026-08-20T09:04:00.000Z');
const CREATED_AT = new Date('2026-08-20T09:16:00.000Z');

/**
 * A ledger row as the repository hands it over — **with a `note` on it**, deliberately.
 * The repository's `select` would not fetch one, so a fixture without a note could not
 * tell a working projection from a lucky one.
 */
const ledgerRow = (over = {}) => ({
  id: 'row-1',
  type: 'SESSION_CHARGE',
  amount: -20,
  balanceAfter: 76,
  sessionId: SESSION_ID,
  createdAt: CREATED_AT,
  note: 'Opening block',
  ...over,
});

/** The two reads, recording what they were asked for. */
function deps({ wallet = { balance: 96, updatedAt: UPDATED_AT }, transactions, total } = {}) {
  const rows = transactions ?? [ledgerRow()];
  const calls = [];

  return {
    calls,
    loadWallet: async (userId) => {
      calls.push({ name: 'wallet', userId });

      return wallet;
    },
    loadTransactions: async (args) => {
      calls.push({ name: 'transactions', args });

      return { transactions: rows, total: total ?? rows.length };
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

/** What `validate()` would hand the controller for a given query string. */
const parseQuery = (query) => walletTransactionsSchema.parse({ body: {}, params: {}, query }).query;

describe('GET /wallet — credits and nothing else', () => {
  it('answers the balance and updatedAt, and exactly those two fields', async () => {
    const collaborators = deps();

    const result = await getWallet(STUDENT_ID, collaborators);

    assert.deepEqual(Object.keys(result).sort(), ['balance', 'updatedAt']);
    assert.equal(result.balance, 96);
    assert.equal(result.updatedAt, UPDATED_AT.toISOString());
  });

  /**
   * §12 describes this endpoint as "Balance + ≈ X minutes" and it cannot answer that:
   * minutes need a teacher's price and there is no teacher here. `lib/credits.js` owns
   * the translation. A server-side `minutes` would be a second rounding of the same
   * figure, shown beside the first on the same screen.
   */
  it('does not invent minutes', async () => {
    const result = await getWallet(STUDENT_ID, deps());

    assert.equal('minutes' in result, false);
    assert.equal('approxMinutes' in result, false);
  });

  it('reads the caller and nobody else', async () => {
    const collaborators = deps();

    await getWallet(STUDENT_ID, collaborators);

    assert.deepEqual(collaborators.calls, [{ name: 'wallet', userId: STUDENT_ID }]);
  });

  /**
   * Every registered user gets a wallet in the same transaction as their account, so a
   * missing row is a lost row. `{ balance: 0 }` would show a plausible screen over a data
   * problem and send somebody to top up an account that does not exist —
   * `wallet.service.js` takes exactly this position when a charge finds no wallet.
   */
  it('treats a missing wallet row as a bug, not as an empty balance', async () => {
    const error = await thrownBy(getWallet(STUDENT_ID, deps({ wallet: null })));

    assert.equal(error.code, ERROR_CODES.INTERNAL_ERROR);
    assert.equal(error.statusCode, 500);
  });
});

describe('GET /wallet/transactions — the ledger, and what it leaves behind', () => {
  it('never puts `note` on the wire, from the view', () => {
    const record = toWalletTransaction(ledgerRow());

    assert.equal('note' in record, false);
    assert.deepEqual(Object.keys(record).sort(), [
      'amount',
      'balanceAfter',
      'createdAt',
      'id',
      'sessionId',
      'type',
    ]);
  });

  it('never puts `note` on the wire, from the service either', async () => {
    const { transactions } = await getWalletTransactions(
      { userId: STUDENT_ID, page: 1, pageSize: DEFAULT_PAGE_SIZE },
      deps(),
    );

    for (const row of transactions) {
      assert.equal('note' in row, false);
    }
  });

  it('keeps the sign — negative is money leaving the wallet', async () => {
    const { transactions } = await getWalletTransactions(
      { userId: STUDENT_ID, page: 1, pageSize: DEFAULT_PAGE_SIZE },
      deps(),
    );

    assert.equal(transactions[0].amount, -20);
    assert.equal(transactions[0].balanceAfter, 76);
    assert.equal(transactions[0].createdAt, CREATED_AT.toISOString());
  });

  it('carries a null sessionId through rather than dropping the key', async () => {
    const { transactions } = await getWalletTransactions(
      { userId: STUDENT_ID, page: 1, pageSize: DEFAULT_PAGE_SIZE },
      deps({ transactions: [ledgerRow({ type: 'TOPUP', amount: 50, sessionId: null })] }),
    );

    assert.equal('sessionId' in transactions[0], true);
    assert.equal(transactions[0].sessionId, null);
  });

  it('scopes the read to the caller', async () => {
    const collaborators = deps();

    await getWalletTransactions(
      { userId: STUDENT_ID, page: 1, pageSize: DEFAULT_PAGE_SIZE },
      collaborators,
    );

    assert.equal(collaborators.calls[0].args.userId, STUDENT_ID);
  });

  it('reports the unpaged total, so a client that hit the ceiling can tell', async () => {
    const { transactions, total } = await getWalletTransactions(
      { userId: STUDENT_ID, page: 1, pageSize: 1 },
      deps({ transactions: [ledgerRow()], total: 137 }),
    );

    assert.equal(transactions.length, 1);
    assert.equal(total, 137);
  });
});

describe('paging — the arithmetic a seeded database cannot catch', () => {
  it('turns page 1 into skip 0', async () => {
    const collaborators = deps();

    await getWalletTransactions({ userId: STUDENT_ID, page: 1, pageSize: 20 }, collaborators);

    assert.deepEqual(collaborators.calls[0].args, { userId: STUDENT_ID, skip: 0, take: 20 });
  });

  it('turns page 3 of 20 into skip 40', async () => {
    const collaborators = deps();

    await getWalletTransactions({ userId: STUDENT_ID, page: 3, pageSize: 20 }, collaborators);

    assert.deepEqual(collaborators.calls[0].args, { userId: STUDENT_ID, skip: 40, take: 20 });
  });

  it('defaults to page 1 and DEFAULT_PAGE_SIZE when the query says nothing', () => {
    assert.deepEqual(parseQuery({}), { page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  /**
   * Capped, not rejected. A client cannot know our ceiling before it asks, so asking for
   * 1000 returns `MAX_PAGE_SIZE` rows — `constants/pagination.js` argues this, and a 400
   * would turn one over-eager parameter into a blank screen.
   */
  it('caps an over-eager pageSize instead of refusing it', () => {
    assert.equal(parseQuery({ pageSize: '1000' }).pageSize, MAX_PAGE_SIZE);
  });

  /**
   * And the asymmetry: `?page=0` is not a request that can be honoured smaller, it is a
   * request for a page that does not exist. Answering it with page 1 would make a client's
   * paging bug look like a working screen.
   */
  it('refuses a page below the first one', () => {
    for (const page of ['0', '-1']) {
      assert.throws(() => parseQuery({ page }));
    }
  });

  it('refuses a query parameter nobody implemented', () => {
    // A silently ignored filter is worse than a rejected one: it looks like the data is
    // wrong. `?userId=` is the one that matters — a 400 rather than a parameter nothing
    // reads.
    assert.throws(() => parseQuery({ type: 'TOPUP' }));
    assert.throws(() => parseQuery({ userId: STUDENT_ID }));
  });

  it('takes no input at all on GET /wallet', () => {
    assert.doesNotThrow(() => walletSchema.parse({ body: {}, params: {}, query: {} }));
    assert.throws(() => walletSchema.parse({ body: {}, params: {}, query: { page: '2' } }));
  });
});

const controllerSource = await readFile(
  fileURLToPath(new URL('../src/controllers/wallet.controller.js', import.meta.url)),
  'utf8',
);

const viewServiceSource = await readFile(
  fileURLToPath(new URL('../src/services/wallet.view.service.js', import.meta.url)),
  'utf8',
);

const readRepositorySource = await readFile(
  fileURLToPath(new URL('../src/repositories/wallet.read.repository.js', import.meta.url)),
  'utf8',
);

const routesSource = await readFile(
  fileURLToPath(new URL('../src/routes/wallet.routes.js', import.meta.url)),
  'utf8',
);

/** The code, with the prose stripped — every file here argues about these names. */
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the properties a call cannot demonstrate', () => {
  it('keeps prisma out of the controller', () => {
    // `/wallet` is the mount where a controller reaching past the service would be a
    // balance change outside wallet.service.js — §17.4's one standing money rule.
    assert.equal(/prisma/.test(withoutComments(controllerSource)), false);
  });

  it('never lets the read path reach the money path', () => {
    assert.equal(/wallet\.service\.js/.test(withoutComments(viewServiceSource)), false);
    assert.equal(/wallet\.repository\.js/.test(withoutComments(viewServiceSource)), false);
    assert.equal(/wallet\.service\.js/.test(withoutComments(readRepositorySource)), false);
  });

  it('writes nothing, and has no statement that could', () => {
    // wallet_transactions is append-only and the append lives in the other repository.
    assert.equal(
      /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/.test(
        withoutComments(readRepositorySource),
      ),
      false,
    );
    assert.equal(/\$queryRaw|\$executeRaw/.test(withoutComments(readRepositorySource)), false);
  });

  it('does not select the operator-facing note', () => {
    // The first of the two defences. The view is the second, asserted above.
    assert.equal(/note/.test(withoutComments(readRepositorySource)), false);
  });

  it('orders by a total order, so page 2 cannot repeat page 1', () => {
    // Two ledger rows written in one transaction share an instant to the microsecond, so
    // created_at alone is not total.
    assert.match(readRepositorySource, /orderBy:\s*\[\s*\{\s*createdAt:\s*'desc'\s*\}/);
  });

  it('authenticates every route, and role-gates exactly the one that needs it', () => {
    const code = withoutComments(routesSource);
    const routes = [...code.matchAll(/walletRoutes\.\w+\(/g)];

    // A count against a count rather than against a literal, so a router that grows a
    // route without authenticating it fails while one that grows a route correctly does
    // not. `authenticate,` with the comma is the middleware position, which the import
    // line does not match.
    assert.ok(routes.length >= 2);
    assert.equal((code.match(/authenticate,/g) ?? []).length, routes.length);
  });

  /**
   * **This assertion used to read "`/authorize/` must not appear", and 7.6 is the PR it
   * was written for.** 7.2 left the tripwire deliberately: a wallet is per-user rather
   * than per-role, teachers hold a balance and are credited into it at the end of every
   * session, and a gate on `GET /wallet` would lock half the account holders out of their
   * own money. `/earnings` is the one exception, because `EarningsResponse` is a
   * fee-and-net breakdown of sessions taught and is meaningless for a student.
   *
   * So it is rewritten to the rule rather than relaxed: **one gate, on `/earnings`, and it
   * says `teacher`.** A later PR that gates `GET /wallet` still fails here, which is the
   * property the original was protecting — "at most one gate, anywhere" would not have
   * caught it.
   */
  it('gates /earnings on teacher, and gates nothing else', () => {
    const code = withoutComments(routesSource);
    const gates = [...code.matchAll(/authorize\(([^)]*)\)/g)];

    assert.equal(gates.length, 1);
    assert.equal(gates[0][1].replaceAll(/['\s]/g, ''), 'teacher');

    // The gate and the path are asserted together, so moving one without the other fails.
    assert.match(
      code,
      /walletRoutes\.get\(\s*'\/earnings',\s*authenticate,\s*authorize\('teacher'\)/,
    );
  });

  it('names no user in any path', () => {
    // The caller is the token. An :id under this mount moves the authorisation question
    // to whoever typed the URL.
    assert.equal(/:id|:userId/.test(withoutComments(routesSource)), false);
  });
});
