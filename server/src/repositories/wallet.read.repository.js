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

/**
 * The columns one earning row is allowed to leave the database in — PR 7.6.
 *
 * **The row is a ledger row and the breakdown hangs off it**, which is the shape the
 * whole endpoint argues for: "what I earned" is defined by `wallet_transactions`,
 * because that is the table `reconcile.mjs` sums a balance against and the table the
 * money actually moved through. `sessions` carries the rest of the arithmetic —
 * `total_charged`, `platform_fee`, `ended_at` — so it is joined *to* the earning rather
 * than queried instead of it. A read that started from `sessions` would be a second
 * answer to the same question, and the two would differ on exactly the session something
 * went wrong in, which is the session a teacher opens this screen about.
 *
 * `teacher_earning` is deliberately **not** selected off the session. The number this
 * endpoint reports is `amount` on the ledger row — what was actually credited — and
 * selecting both would invite a projection that quietly prefers the column over the
 * movement. `reconcile.mjs` invariant 4 is what checks the two agree; this file does not
 * get a vote.
 *
 * `note` is absent here for the same reason it is absent from `LEDGER_VIEW`, and one
 * reason more: this projection reaches a *teacher's* screen, and the notes on their rows
 * say `'Session earning'`.
 */
const EARNING_VIEW = {
  amount: true,
  createdAt: true,
  session: {
    select: {
      id: true,
      endedAt: true,
      totalCharged: true,
      platformFee: true,
      // Subtopic first, then topic — `offerView.js` and `sessionView.js` both label a
      // session this way, and a row reading "Integration by parts" is more use to a
      // teacher than one reading "Calculus".
      question: {
        select: {
          topic: { select: { nameHe: true } },
          subtopic: { select: { nameHe: true } },
        },
      },
    },
  },
};

/**
 * Everything with a `TEACHER_EARNING` row: **one page of them, the count, and the
 * all-time totals** — PR 7.6, MVP.md §5.3.
 *
 * ## The totals are an aggregate and never a sum over the page
 *
 * This is the single easiest thing to get wrong in this endpoint and the failure is
 * invisible on page one, where the page *is* everything. A teacher who reaches page 3
 * and watches their lifetime earnings shrink is being shown a bug that looks like a
 * pricing change. So `total`, `net`, `gross` and `fee` are all computed by the database
 * over the whole set, and the page is only the rows.
 *
 * ## Two aggregates, because the three figures do not live in one table
 *
 * `net` comes off the ledger — `_sum.amount` over this teacher's `TEACHER_EARNING`
 * rows — because that is the definition, and because it is the number
 * `reconcile.mjs` invariant 1 already reconciles the wallet balance against. Nothing
 * else may compute it.
 *
 * `gross` and `fee` are columns that exist only on `sessions`, so they are aggregated
 * there — but over **the set the ledger defines**, via `transactions: { some: … }`,
 * rather than over "this teacher's finished sessions". The two sets are the same set
 * today and they are not the same *rule*: a no-show refunds the student and credits the
 * teacher nothing, and 7.4's early-exit and platform-failure refunds do the same, so
 * those sessions have `teacher_id` set, an `ended_at`, and no earning. Aggregating by
 * `teacherId` would put money in the gross column that the teacher never saw a share of.
 *
 * If a session ever carried two `TEACHER_EARNING` rows it would be counted twice in
 * `net` and once in `gross`. That is a data bug rather than a case to handle here —
 * `reconcile.mjs` invariant 4 is where it surfaces — and the honest thing is that this
 * function would show it rather than paper over it.
 *
 * One `$transaction`, the read-only array form: four statements against one snapshot, so
 * an earning credited between them cannot make the totals disagree with the page.
 *
 * @param {object} params
 * @param {string} params.userId the teacher, from the verified token
 * @param {number} [params.skip]
 * @param {number} [params.take]
 * @returns {Promise<{earnings: object[], total: number,
 *   totals: {gross: number, fee: number, net: number}}>}
 */
export async function findTeacherEarningsPage({ userId, skip = 0, take = DEFAULT_PAGE_SIZE }) {
  const where = { userId, type: 'TEACHER_EARNING' };

  const [earnings, total, ledgerTotals, sessionTotals] = await prisma.$transaction([
    prisma.walletTransaction.findMany({
      where,
      select: EARNING_VIEW,
      // The same total order every read of this table uses. Two rows written in one
      // transaction share an instant to the microsecond, and a non-total order lets
      // page 2 repeat a row from page 1.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    }),
    prisma.walletTransaction.count({ where }),
    prisma.walletTransaction.aggregate({ where, _sum: { amount: true } }),
    prisma.session.aggregate({
      where: { transactions: { some: where } },
      _sum: { totalCharged: true, platformFee: true },
    }),
  ]);

  return {
    earnings,
    total,
    // Prisma answers `null` for a `_sum` over no rows, and a teacher who has taught
    // nothing has a real total of zero rather than an absent one. The screen renders
    // these directly, and "₪null earned" is a worse bug than any of the arithmetic
    // above.
    totals: {
      gross: sessionTotals._sum.totalCharged ?? 0,
      fee: sessionTotals._sum.platformFee ?? 0,
      net: ledgerTotals._sum.amount ?? 0,
    },
  };
}
