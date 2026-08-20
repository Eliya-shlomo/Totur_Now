import { TOPUP_PACKAGES } from '#config/constants/index.js';
import { prisma } from '#config/db.js';
import { findLatestWalletTransaction } from '#repositories/wallet.repository.js';
import { topUpWallet } from '#services/wallet.service.js';
import { emitWalletUpdated } from '#sockets/events.js';
import { AppError } from '#utils/AppError.js';
import { logger } from '#utils/logger.js';

/**
 * `POST /wallet/topup` — PR 7.3, MVP.md §5.4 and §12.
 *
 * **The only way credit enters this system.** Everything else in the product spends:
 * `chargeStudent` moves it to a teacher, `refundSession` moves it back, `creditTeacher`
 * pays it out of a session's gross. This is the one operation that raises the total, and
 * §21's payment provider is what will eventually sit in front of it.
 *
 * ## The transaction, and why it is three lines
 *
 * ```
 *   BEGIN
 *     1. topUpWallet(amount)      lock, credit, one TOPUP row   (wallet.service.js)
 *     2. findLatestWalletTransaction   the id of the row step 1 wrote
 *   COMMIT
 *     3. wallet:updated to user:{userId}    ← after, never inside
 * ```
 *
 * **Step 2 is a read-back and not a design I would choose twice.** `applyWalletDelta`
 * returns a balance and discards the ledger row, and the contract's `transactionId`
 * needs the row's id — changing what that function returns is an edit to
 * `wallet.service.js`, which §17.5 makes human-written and this PR may not open. The
 * read is safe because step 1 holds the wallet's `FOR UPDATE` lock for the length of
 * the transaction, so no other wallet operation for this user can commit in between and
 * "newest" cannot mean somebody else's row. **If that function ever stops locking first,
 * this read stops being correct** — which is a good reason for the lock never to move.
 *
 * ## The amount is read from the constant, never from the body
 *
 * The validator has already checked that `packageId` is a member of `TOPUP_PACKAGES`.
 * This service looks it up in that array again rather than passing the number through,
 * so the value that reaches money comes from `constants/money.js` and not from the
 * request. One line, and it is the difference between an allowlist and a transcription:
 * a later refactor that loses the validator would still not be able to credit 137.
 *
 * ## The emit is outside the transaction
 *
 * 6.3's room creation, 6.5's `session:extended` and 6.6's `session:ended` all made this
 * call. An emit inside the transaction tells a client about a balance that may still roll
 * back, and there is no second event to take it back with. The client is also told by the
 * response — 7.5 trusts the POST and treats the socket as the thing that keeps *other*
 * tabs current — so a dropped frame costs nothing.
 */

/** Every collaborator through the last argument, 3.3's idiom. */
const defaultDeps = {
  runTransaction: (fn) => prisma.$transaction(fn),
  creditWallet: topUpWallet,
  loadLatestRow: findLatestWalletTransaction,
  notifyWallet: emitWalletUpdated,
};

/**
 * Credit one package to the caller's wallet.
 *
 * @param {object} params
 * @param {string} params.userId from the verified token, never from the body
 * @param {number} params.packageId a member of `TOPUP_PACKAGES`
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<import('@tutor/shared').TopUpResponse>}
 */
export async function topUpBalance({ userId, packageId }, deps = defaultDeps) {
  const { runTransaction, creditWallet, loadLatestRow, notifyWallet } = {
    ...defaultDeps,
    ...deps,
  };

  // The allowlist, applied a second time and against the constant. The validator has
  // already refused anything else, so reaching this branch means the two disagree — and
  // the answer a client sees is the same one the validator would have given.
  const amount = TOPUP_PACKAGES.find((credits) => credits === packageId);

  if (amount === undefined) {
    logger.error('Top-up reached the service with a package the validator should have refused', {
      userId,
      packageId,
    });

    throw AppError.validation('Pick one of the top-up packages.');
  }

  const { balanceAfter, transactionId } = await runTransaction(async (tx) => {
    const { balanceAfter: credited } = await creditWallet(
      { userId, amount, note: `Top-up of ${amount} credits` },
      tx,
    );

    // Correct only under step 1's lock — see the header. `null` is unreachable: the
    // append two statements ago is this transaction's own write.
    const row = await loadLatestRow(userId, tx);

    if (!row) {
      logger.error('Top-up found no ledger row it had just written', { userId, amount });

      throw AppError.internal();
    }

    return { balanceAfter: credited, transactionId: row.id };
  });

  notifyWallet(userId, { balance: balanceAfter });

  logger.info('Wallet topped up', { userId, amount, balanceAfter });

  return { balance: balanceAfter, credited: amount, transactionId };
}
