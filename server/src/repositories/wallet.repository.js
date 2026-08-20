/**
 * The three statements every balance change is made of — PR 6.5, MVP.md §11.3-B.
 *
 * **Every function here takes a `tx` and none of them opens one.** That is not a style
 * rule: the charge and the state change it pays for are one transaction or they are a
 * bug. A session that goes `ACTIVE` and then fails to charge is free tutoring, and a
 * charge that lands against a session that failed to start is theft. There is no
 * `prisma` import in this file for exactly that reason — a caller that has no
 * transaction cannot use any of this.
 *
 * **Nothing here decides anything.** No assert, no `>=`, no error. The guard lives in
 * `wallet.service.js`, one caller up, where the lock and the assert and the write and
 * the ledger row are four steps in one function that can be read top to bottom. A
 * repository that refused a debit would be a second place the rule lives, free to
 * disagree with the first.
 *
 * `wallet_transactions` is append-only. There is no update and no delete in this file
 * and there is not going to be one: `balance_after` on every row is what makes
 * reconciliation a `GROUP BY` rather than a fold, and one `UPDATE` against that table
 * is the end of the audit.
 *
 * Amounts are integers, in credits. Money is never a float anywhere in this system.
 */

/**
 * `SELECT balance … FOR UPDATE` — **step 1 of all three operations, before the number
 * is used for anything.**
 *
 * Raw SQL because Prisma's query API has no row lock, the same reason
 * `findSessionForMeter` is raw. Without the lock a charge is
 * read-then-decide-then-write with a gap in the middle: two concurrent debits both read
 * the same balance, both pass the assert, and both write — and the second one is money
 * that never existed. Under READ COMMITTED the second transaction blocks here until the
 * first commits, then reads the balance the first left behind.
 *
 * A plain `SELECT` passes every sequential test in the suite and loses money under two
 * clients. That sentence is in 6.5's review checklist and this is the line it means.
 *
 * Returns `null` for a user with no wallet row, the contract every read in this
 * codebase keeps. Every registered user has one — `createUserWithProfile` writes it in
 * the same transaction as the user — so the caller treats `null` as a data problem
 * rather than as a poor student.
 *
 * @param {string} userId
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<number|null>} credits, or `null` when there is no wallet
 */
export async function lockWalletBalance(userId, tx) {
  const rows = await tx.$queryRaw`
    SELECT balance
      FROM wallets
     WHERE user_id = ${userId}::uuid
       FOR UPDATE
  `;

  return rows[0]?.balance ?? null;
}

/**
 * Step 3 — `UPDATE wallets SET balance = balance + $delta`.
 *
 * **The delta is applied by the database, not by the caller.** `{ increment }` compiles
 * to `balance = balance + $1`, so the statement is correct even in the world where the
 * lock above was somehow not held; a write of a value computed in JavaScript would
 * silently overwrite a concurrent change with a stale total. The service still computes
 * `balanceAfter` for the ledger row, and the two agreeing is what the row lock
 * guarantees.
 *
 * Negative for a debit, positive for a credit. `CHECK (balance >= 0)` sits on the table
 * underneath this and is the **second** line of defence — the service's assert is the
 * first. If the CHECK ever fires it is a bug report and not control flow: it means the
 * assert was skipped or the lock was not held.
 *
 * `updated_at` is written explicitly because the column has a `@default(now())` and no
 * `@updatedAt`, so nothing sets it on an update by itself.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {number} params.delta credits, signed, integer
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{count: number}>} `0` means there was no wallet to move
 */
export async function addToWalletBalance({ userId, delta }, tx) {
  return tx.wallet.updateMany({
    where: { userId },
    data: { balance: { increment: delta }, updatedAt: new Date() },
  });
}

/**
 * Step 4 — one row in the ledger, **inserted and never touched again.**
 *
 * `amount` is signed the same way the delta is: negative is money leaving the wallet,
 * positive is money arriving. `balance_after` is the balance this row produced, so
 * §11.3's reconciliation query — every wallet's balance equals the sum of its
 * transactions — is one `GROUP BY`, and a fold over the whole history is never needed
 * to answer "what happened to my credits".
 *
 * `sessionId` is nullable in the schema because E7's top-ups belong to no session.
 * Everything E6 writes carries one, which is what makes "show me every credit this
 * lesson moved" a `WHERE` rather than a search through notes. E7's `topUpWallet` is the
 * first caller to pass `null`, and it passes it explicitly — see PR 7.1.
 *
 * `note` is operator-facing text and never reaches a client. Nothing renders it in E6.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {'SESSION_CHARGE'|'TEACHER_EARNING'|'REFUND'|'TOPUP'} params.type §11.2's `tx_type`
 * @param {number} params.amount       signed, integer
 * @param {number} params.balanceAfter the balance this row produced
 * @param {string|null} params.sessionId
 * @param {string|null} params.note
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<object>} the created row
 */
export async function appendWalletTransaction(
  { userId, type, amount, balanceAfter, sessionId = null, note = null },
  tx,
) {
  return tx.walletTransaction.create({
    data: { userId, type, amount, balanceAfter, sessionId, note },
  });
}
