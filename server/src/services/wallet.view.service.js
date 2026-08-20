import { FIRST_PAGE } from '#config/constants/index.js';
import {
  findWalletByUserId,
  findWalletTransactionPage,
} from '#repositories/wallet.read.repository.js';
import { AppError } from '#utils/AppError.js';
import { logger } from '#utils/logger.js';
import { toWalletResponse, toWalletTransaction } from '#utils/walletView.js';

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
