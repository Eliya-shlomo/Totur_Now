import { FIRST_PAGE } from '#config/constants/index.js';
import {
  findTeacherEarningsPage,
  findWalletByUserId,
  findWalletTransactionPage,
} from '#repositories/wallet.read.repository.js';
import { AppError } from '#utils/AppError.js';
import { logger } from '#utils/logger.js';
import { toEarningRecord, toWalletResponse, toWalletTransaction } from '#utils/walletView.js';

/**
 * What a wallet says about itself — `GET /wallet` and `GET /wallet/transactions`.
 * PR 7.2, MVP.md §12 "Wallet".
 *
 * ## This file reads and `wallet.service.js` writes, and they never meet
 *
 * `CONVENTIONS.md`'s layering forbids a controller touching the database, so a read
 * needs a service — and it must not be `wallet.service.js`, which `MVP.md` §17.5 makes
 * human-written and which nothing in this PR is allowed to open. E6 made the same split
 * for the same reason and gave it a name: `session.view.service.js` reads what
 * `session.*.service.js` writes.
 *
 * So the rule, in one line: **`wallet.service.js` moves money and an agent never writes
 * it; this file answers questions and never imports it.** There is no import of it
 * below and there is not going to be one — a read path that could reach a balance
 * mutation is a read path one refactor away from being a write.
 *
 * ## Nothing here is locked, and that is correct
 *
 * `lockWalletBalance` exists because a balance about to be *spent from* must not move
 * between the read and the write. Nothing here spends. A number rendered on a screen is
 * true as of the moment it was read and stops being true the instant a session charges,
 * which is why `wallet:updated` and `session:block_warning` both carry a fresh balance —
 * the screen is kept current by events, not by holding a row.
 *
 * ## The caller is always the token
 *
 * Neither function takes a user id from anywhere but `req.user.id`. There is no route
 * under `/wallet` that names a user and there must never be one: a wallet is the most
 * per-user thing in the product, and an id in the path is the whole of the
 * authorisation question answered by whoever typed the URL.
 */

/**
 * Both reads arrive through the last argument, 3.3's idiom and the one
 * `session.view.service.js` uses — which is what lets `wallet.read.test.js` assert the
 * `skip`/`take` arithmetic and the missing-wallet 500 with no database at all.
 */
const defaultDeps = {
  loadWallet: findWalletByUserId,
  loadTransactions: findWalletTransactionPage,
  loadEarnings: findTeacherEarningsPage,
};

/**
 * The caller's balance.
 *
 * **A missing wallet row is a 500, not an empty balance.** Every registered user gets
 * one in the same transaction as their account, so its absence is a lost row rather than
 * a poor student — and `wallet.service.js` already takes exactly this position when a
 * charge finds no wallet. Answering `{ balance: 0 }` would show a plausible screen over
 * a data problem and send somebody to top up an account that does not exist.
 *
 * @param {string} userId from the verified token, never from the request
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<import('@tutor/shared').WalletResponse>}
 */
export async function getWallet(userId, deps = defaultDeps) {
  const { loadWallet } = { ...defaultDeps, ...deps };

  const wallet = await loadWallet(userId);

  if (!wallet) {
    logger.error('Wallet read found no wallet row', { userId });

    throw AppError.internal();
  }

  return toWalletResponse(wallet);
}

/**
 * A page of the caller's ledger, newest first.
 *
 * **An empty ledger is an empty array and a `200`.** A brand-new student has never
 * moved money and that is a first-time state the screen renders with the top-up buttons
 * still visible — not a `404`, which would say the wallet is missing, and not the 500
 * above, which says something is broken.
 *
 * `page` and `pageSize` arrive coerced, defaulted and already capped at `MAX_PAGE_SIZE`
 * by `walletTransactionsSchema`, so this layer translates them into `skip`/`take` and
 * decides nothing. The cap is applied in the validator rather than here because a client
 * cannot know our ceiling before it asks — `constants/pagination.js` argues that at
 * length, and `total` reports the true unpaged count so a client that hit the ceiling
 * can tell.
 *
 * @param {object} params
 * @param {string} params.userId from the verified token
 * @param {number} params.page 1-based
 * @param {number} params.pageSize already capped
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<import('@tutor/shared').WalletTransactionsResponse>}
 */
export async function getWalletTransactions({ userId, page, pageSize }, deps = defaultDeps) {
  const { loadTransactions } = { ...defaultDeps, ...deps };

  const { transactions, total } = await loadTransactions({
    userId,
    skip: (page - FIRST_PAGE) * pageSize,
    take: pageSize,
  });

  return { transactions: transactions.map(toWalletTransaction), total };
}

/**
 * A teacher's earnings — `GET /wallet/earnings`. PR 7.6, MVP.md §5.3 and §14.1.
 *
 * **The balance is read through `getWallet` rather than queried again**, and that is the
 * point of the line rather than an economy. §14.1 puts the wallet figure on this screen
 * beside the lifetime net, and two reads of the same number are two numbers that can
 * disagree — including about whether a missing wallet row is a 500, which `getWallet`
 * already decides. One answer, one place, and this endpoint inherits it.
 *
 * The two reads run together. They are independent — one is the wallet row, the other is
 * the ledger and its aggregates — and a teacher on page 3 should not wait for them in
 * series. A missing wallet still rejects the whole call, which is correct: the screen has
 * a balance tile on it.
 *
 * **`totals` is all-time and arrives that way from the database.** Nothing here folds the
 * returned page, and there is deliberately no arithmetic in this function at all beyond
 * the `skip` — the review checklist for this PR calls a page-sum the easiest mistake to
 * make here, and the way to not make it is to have no addition in the layer that could.
 *
 * An empty result is `earnings: []`, `total: 0` and three zeroes — a `200` and a real
 * first-time state, which is most teachers on the day they onboard. The screen renders an
 * empty state rather than a table of zeros; that is its decision and not this one's.
 *
 * The role gate is on the route (`authorize('teacher')`) and not repeated here. A student
 * never reaches this function, and a second check in the service would be a second place
 * the rule lives — `wallet.routes.js` says why `/earnings` is the one route on that router
 * that carries one.
 *
 * @param {object} params
 * @param {string} params.userId the teacher, from the verified token
 * @param {number} params.page 1-based
 * @param {number} params.pageSize already capped
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<import('@tutor/shared').EarningsResponse>}
 */
export async function getTeacherEarnings({ userId, page, pageSize }, deps = defaultDeps) {
  const { loadEarnings } = { ...defaultDeps, ...deps };

  const [{ balance }, { earnings, total, totals }] = await Promise.all([
    getWallet(userId, deps),
    loadEarnings({ userId, skip: (page - FIRST_PAGE) * pageSize, take: pageSize }),
  ]);

  return { balance, earnings: earnings.map(toEarningRecord), total, totals };
}
