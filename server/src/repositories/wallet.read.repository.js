import { DEFAULT_PAGE_SIZE } from '#config/constants/index.js';
import { prisma } from '#config/db.js';

/**
 * The money reads — PR 7.2, MVP.md §12 "Wallet". `wallets` and `wallet_transactions`,
 * for a caller asking about their own.
 *
 * ## Why this is not in `wallet.repository.js`
 *
 * That file is defined by an invariant rather than by a table: **every statement in it
 * takes the caller's `tx` and none of them opens one**, so that a charge and the state
 * change it pays for commit together or not at all. It has no `prisma` import at all,
 * and `wallet.service.test.js` asserts that — a caller with no transaction cannot use
 * any of it, by construction.
 *
 * A paged read needs the opposite of that. It has no caller-supplied transaction, it
 * wants its own connection, and page-plus-count is `prisma.$transaction([…])` — the
 * read-only batch form `findTeacherPage` uses. Putting these two functions in that file
 * would break the assertion and, more to the point, the property the assertion protects.
 *
 * So: **6.5's file writes money and takes a transaction; this one answers questions and
 * opens its own.** The same split `wallet.service.js` and `wallet.view.service.js` make
 * one layer up, and the same split `teacher.repository.js` and
 * `teacher.presence.repository.js` already make in this directory.
 *
 * ## Nothing here writes, and there is no branch that could
 *
 * No `create`, no `update`, no `delete`, no `$queryRaw`. `wallet_transactions` is
 * append-only and the append lives in the other file; a repository that could both read
 * the ledger and touch it is a repository where one careless call ends the audit.
 */

/**
 * The columns a ledger row is allowed to leave the database in.
 *
 * **`note` is not here, and its absence is the point.** `appendWalletTransaction`'s
 * contract calls it operator-facing text that never reaches a client — English strings
 * chosen for a log reader, like `'Session earning'` — and this endpoint is the first
 * thing in the project that could put one on a screen by accident. `toWalletTransaction`
 * in `#utils/walletView.js` excludes it a second time, and the two together mean a row
 * would have to be leaked deliberately.
 *
 * `TEACHER_VIEW`'s rule, for the same reason: one shared `select`, so every read of this
 * table is structurally unable to disagree about which columns exist, and a column added
 * to `wallet_transactions` in a later epic is invisible until a human adds it below.
 */
const LEDGER_VIEW = {
  id: true,
  type: true,
  amount: true,
  balanceAfter: true,
  sessionId: true,
  createdAt: true,
};

/**
 * One wallet row, or `null`.
 *
 * `null` is a data problem and not a poor student — every registered user gets a wallet
 * in the same transaction as their account (`createUserWithProfile`), so its absence
 * means the row was lost. `lockWalletBalance` keeps the same contract for the same
 * reason, and `wallet.view.service.js` is where that becomes a 500.
 *
 * **Unlocked, deliberately.** This is a read for a screen, not a read a decision is made
 * against. The only balance that may be spent from is the one `SELECT … FOR UPDATE`
 * returns inside a transaction, which is the other file's job.
 *
 * @param {string} userId
 * @returns {Promise<{balance: number, updatedAt: Date}|null>}
 */
export async function findWalletByUserId(userId) {
  return prisma.wallet.findUnique({
    where: { userId },
    select: { balance: true, updatedAt: true },
  });
}

/**
 * A page of one user's ledger, newest first, plus the unpaged count.
 *
 * **Scoped to `userId` in the `where`, never by a filter applied afterwards.** The
 * caller is always `req.user.id` — there is no route that names a user — so this is the
 * only place the scoping could go missing, and a page assembled first and filtered
 * second would be one refactor away from returning somebody else's charges.
 *
 * Ordered by `created_at` descending with `id` as the tiebreak. The ledger is written
 * inside transactions and two rows in one transaction share an instant to the
 * microsecond — 6.6 credits a teacher in the same commit that refunds nothing, and 7.3
 * will write one row per top-up — so an order on the timestamp alone is not total, and a
 * non-total order makes page 2 able to repeat a row from page 1.
 *
 * `total` is the whole ledger for this user, not the page: a client that hit the
 * `MAX_PAGE_SIZE` ceiling can tell that it did.
 *
 * One `$transaction`, the read-only array form — the two statements see the same
 * snapshot, so a row written between them cannot make `total` disagree with the page it
 * describes. `findTeacherPage` does this identically.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {number} [params.skip]
 * @param {number} [params.take]
 * @returns {Promise<{transactions: object[], total: number}>}
 */
export async function findWalletTransactionPage({ userId, skip = 0, take = DEFAULT_PAGE_SIZE }) {
  const where = { userId };

  const [transactions, total] = await prisma.$transaction([
    prisma.walletTransaction.findMany({
      where,
      select: LEDGER_VIEW,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    }),
    prisma.walletTransaction.count({ where }),
  ]);

  return { transactions, total };
}
