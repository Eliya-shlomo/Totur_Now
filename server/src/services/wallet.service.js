import { ERROR_CODES } from '#config/errors/codes.js';
import {
  addToWalletBalance,
  appendWalletTransaction,
  lockWalletBalance,
} from '#repositories/wallet.repository.js';
import { AppError } from '#utils/AppError.js';
import { logger } from '#utils/logger.js';

/**
 * Money. **Four operations and no fifth.** PR 6.5 and 7.1, MVP.md §11.3-B and §17.5.
 *
 * ## Why this file exists in E6 and not in E7
 *
 * §18 wrote E6 as depending on an E7 that nobody has started, and the two alternatives
 * were both worse: block the epic, or write a throwaway charge inside the session
 * service that E7 would later have to find and delete. Three functions with a row lock
 * and a ledger append is not a smaller thing than E7 would have written — it is the
 * *same* thing, written when the first caller needed it. **E7 builds top-up, the ledger
 * endpoint and the wallet screen on top of this service. It does not get a second one.**
 *
 * ## Why the fourth arrived in E7 and could not have arrived in E6
 *
 * The paragraph above said three and no fourth, and it was right for the length of E6:
 * **no code anywhere put credit into this system.** Every balance in the database came
 * from a seed, and the three operations between them only moved money that was already
 * there — a student's credit to a teacher, and back again on a refund. A `TOPUP` value
 * sat unused in §11.2's enum from PR 0.2 onwards for exactly that reason.
 *
 * `topUpWallet` is E7's answer and it is the **entry point**, in the arithmetic sense:
 * the one operation that increases the total credit in the system rather than moving it
 * between two wallets. There is no fifth waiting behind it. `PAYOUT` and `PROMO` are the
 * other two enum values nothing writes, and both are §21's phases rather than this MVP's
 * — a diff that adds either is a diff that has to make §17.5's argument again.
 *
 * ## The four steps, and they are the same four every time
 *
 * ```
 *   1. SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE   -- the lock, first
 *   2. assert           (balance >= amount for a debit; nothing for a credit)
 *   3. UPDATE wallets SET balance = balance + $delta
 *   4. INSERT INTO wallet_transactions (type, amount, balance_after, session_id, note)
 * ```
 *
 * They are written once, in `applyWalletDelta`, and the four exported functions are
 * each a name, a sign and a `tx_type` over it. Four copies of four steps is four places
 * for the lock to go missing from, and the one it goes missing from is the one nobody
 * reads again.
 *
 * **Step 1 is a lock and it is first.** A plain `SELECT` passes every test in
 * `wallet.service.test.js` and loses money the first time two clients arrive together:
 * both read the same balance, both pass step 2, and the second write is credit that was
 * never bought. Under READ COMMITTED the second transaction blocks in step 1 until the
 * first commits.
 *
 * **`CHECK (balance >= 0)` is the second line of defence, not the first.** Step 2 is the
 * first. If the CHECK ever fires, that is a bug report — it means an assert was skipped
 * or a lock was not held — and it arrives as a 500 rather than as a 402, which is the
 * correct way round for a thing that should be impossible.
 *
 * ## Every function takes a `tx` and none opens one
 *
 * `prisma.$transaction` does not appear in this file. The charge and the state change it
 * pays for commit together or not at all: a session that goes `ACTIVE` and then fails to
 * charge is free tutoring, and a charge against a session that failed to start is theft.
 * A nested transaction here would be a charge that commits when its session did not.
 *
 * ## Amounts are positive integers, in credits
 *
 * The **caller** says what happened — charge, credit, refund — and this file decides the
 * sign. A signed amount at the call site is one `-` away from a refund that debits, and
 * that mistake is invisible in review. Money is never a float anywhere in this system,
 * and a non-integer amount is a programming error rather than a user error: it fails as
 * an internal error, loudly, before anything is written.
 */

/** The ledger row a debit writes. §11.2's `tx_type`. */
const CHARGE = 'SESSION_CHARGE';

/** The ledger row a teacher's earning writes, at termination — 6.6. */
const EARNING = 'TEACHER_EARNING';

/** The ledger row a refund writes — a no-show, 6.6, and §5.5's other two in 7.4. */
const REFUND = 'REFUND';

/** The ledger row a top-up writes — 7.1. The only credit that comes from outside. */
const TOPUP = 'TOPUP';

/**
 * Every collaborator arrives through the third argument, 3.3's idiom — which is what
 * lets `wallet.service.test.js` assert the *order* of the four steps, and assert that a
 * refused debit wrote neither of the last two, with no database at all.
 */
const defaultDeps = {
  lockBalance: lockWalletBalance,
  moveBalance: addToWalletBalance,
  appendLedger: appendWalletTransaction,
};

/**
 * A student pays for a block. **The only debit in the system.**
 *
 * `INSUFFICIENT_CREDIT` (402) when the balance will not cover it — checked under the
 * lock, against the balance the lock returned, never against one read earlier in the
 * request. E5 already asserts affordability at offer time as a read; this is the write,
 * and the balance is allowed to have moved in between.
 *
 * @param {object} params
 * @param {string} params.userId the student
 * @param {string} params.sessionId
 * @param {number} params.amount credits, **positive**
 * @param {string} [params.note] operator-facing; never rendered
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{balanceAfter: number}>}
 */
export async function chargeStudent({ userId, sessionId, amount, note }, tx, deps = defaultDeps) {
  return applyWalletDelta(
    { userId, sessionId, amount, note, type: CHARGE, isDebit: true },
    tx,
    deps,
  );
}

/**
 * The teacher is paid, once, at the end of a session — 6.6, net of §5.3's fee.
 *
 * **Not per block, and that is a ledger decision rather than a product one.** A session
 * refunded as a no-show would otherwise have to claw back credit the teacher already
 * held, and clawing back is the one operation an append-only ledger cannot express
 * honestly. Credit once, at termination, for the blocks actually consumed.
 *
 * No assert. A credit cannot fail on affordability, and the platform's own balance is
 * not modelled — §11.3 has one wallet per user and the fee is a column on the session.
 *
 * @param {object} params
 * @param {string} params.userId the teacher
 * @param {string} params.sessionId
 * @param {number} params.amount credits, **positive**, already net of the fee
 * @param {string} [params.note]
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{balanceAfter: number}>}
 */
export async function creditTeacher({ userId, sessionId, amount, note }, tx, deps = defaultDeps) {
  return applyWalletDelta(
    { userId, sessionId, amount, note, type: EARNING, isDebit: false },
    tx,
    deps,
  );
}

/**
 * The student's credit comes back — a teacher who never arrived, 6.6.
 *
 * **A refund is an append, not a reversal.** The `SESSION_CHARGE` row stays exactly
 * where it is and a `REFUND` row is written beside it, because the charge *happened* and
 * a ledger that edits its own history is a ledger nobody can reconcile. The two rows sum
 * to zero, which is the honest description of what took place.
 *
 * @param {object} params
 * @param {string} params.userId the student
 * @param {string} params.sessionId
 * @param {number} params.amount credits, **positive** — what is being given back
 * @param {string} [params.note]
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{balanceAfter: number}>}
 */
export async function refundSession({ userId, sessionId, amount, note }, tx, deps = defaultDeps) {
  return applyWalletDelta(
    { userId, sessionId, amount, note, type: REFUND, isDebit: false },
    tx,
    deps,
  );
}

/**
 * Credit arrives from outside the system — PR 7.1, MVP.md §5.4 and §12's
 * `POST /wallet/topup`.
 *
 * **The only operation here that is not a transfer.** The other three move credit
 * between two wallets or put it back where it came from; the total in the system is the
 * same before and after each of them. This one raises it, which is why it is the
 * operation §21's payment provider eventually sits behind and why it is the one worth
 * being strict about.
 *
 * **The amount is not this file's to validate beyond arithmetic.** A top-up is only ever
 * one of §5.4's packages, and the allowlist that enforces that is 7.3's validator, one
 * layer up, where every other request-shape rule in this codebase lives. What survives
 * here is the guard the other three already apply — a non-integer or non-positive amount
 * is a programming error and fails before step 1. Restating the package list here would
 * be a second copy of `TOPUP_PACKAGES` for the first one to drift from.
 *
 * **`sessionId` is `null`, explicitly, and not omitted.** The column is nullable exactly
 * for this operation, and `appendWalletTransaction` would default it — but an absent key
 * reads as a caller that forgot one, and a written `null` reads as the operation saying
 * there is no session. `wallet.service.test.js` asserts the distinction, because it is
 * the only ledger row in the system with no lesson behind it and that is a fact worth
 * being deliberate about.
 *
 * No assert. A credit cannot fail on affordability, the same reason `creditTeacher` has
 * none — but the lock in step 1 is taken all the same. It is not there to protect the
 * decision, which there isn't one of; it is there so `balance_after` on the row is a
 * number no concurrent debit can have moved between the read and the write. Invariant 1
 * of `scripts/reconcile.mjs` sums `amount` rather than `balance_after`, so a wrong
 * `balance_after` is a row that reconciles perfectly and still lies to whoever reads the
 * ledger screen.
 *
 * @param {object} params
 * @param {string} params.userId whoever is topping up — a teacher may, and 7.2 says why
 * @param {number} params.amount credits, **positive**, one of `TOPUP_PACKAGES`
 * @param {string} [params.note] operator-facing; never rendered
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{balanceAfter: number}>}
 */
export async function topUpWallet({ userId, amount, note }, tx, deps = defaultDeps) {
  return applyWalletDelta(
    { userId, sessionId: null, amount, note, type: TOPUP, isDebit: false },
    tx,
    deps,
  );
}

/**
 * The four steps. **The only place in this codebase where a balance changes.**
 *
 * Read it as four statements in order, because that order is the whole guarantee:
 *
 * 1. the lock — before the balance is used for anything, including being logged
 * 2. the assert — against the locked read, and only for a debit
 * 3. the balance — `balance + delta`, computed by the database
 * 4. the ledger — `balance_after` as computed here, which the lock makes true
 *
 * Steps 3 and 4 are two statements and cannot be one, which is why they are in a
 * transaction the caller opened: a balance that moved without a ledger row is money with
 * no history, and a ledger row with no balance move is history with no money. Neither
 * survives §11.3's reconciliation query, and that query is 6.5's real acceptance
 * criterion.
 *
 * **A missing wallet row is a 500 and not a 402.** Every registered user gets one in the
 * same transaction as their account, so its absence is a data problem — and answering
 * `INSUFFICIENT_CREDIT` would tell a student to top up an account that does not exist
 * while hiding the bug that lost it.
 */
async function applyWalletDelta({ userId, sessionId, amount, note, type, isDebit }, tx, deps) {
  const { lockBalance, moveBalance, appendLedger } = { ...defaultDeps, ...deps };

  // Not a user error at any call site: the amounts are `blocks × price_per_block`, both
  // integers off a row. A float here would round its way into the ledger and take
  // reconciliation with it, so it fails before step 1 rather than after step 3.
  if (!Number.isInteger(amount) || amount <= 0) {
    logger.error('Wallet operation refused a non-integer or non-positive amount', {
      userId,
      sessionId,
      type,
      amount,
    });

    throw AppError.internal();
  }

  // Step 1. The lock, and nothing has been decided yet.
  const balance = await lockBalance(userId, tx);

  if (balance === null) {
    logger.error('Wallet operation found no wallet row', { userId, sessionId, type });

    throw AppError.internal();
  }

  // Step 2. Against the number the lock just returned. A debit is the only operation
  // with anything to refuse, and it refuses in credits rather than in percentages —
  // §5.1's blocks are whole credits and a student either has them or does not.
  if (isDebit && balance < amount) {
    throw new AppError(ERROR_CODES.INSUFFICIENT_CREDIT, 'You do not have enough credits for this.');
  }

  const delta = isDebit ? -amount : amount;
  const balanceAfter = balance + delta;

  // Step 3.
  const { count } = await moveBalance({ userId, delta }, tx);

  // The wallet was there in step 1 and the read was locked, so this cannot be zero
  // without the row having been deleted mid-transaction — which `onDelete: Cascade`
  // from `users` makes a deleted account. Refusing here rather than writing a ledger
  // row for a balance that did not move is what keeps reconciliation true.
  if (count === 0) {
    logger.error('Wallet balance did not move under a held lock', { userId, sessionId, type });

    throw AppError.internal();
  }

  // Step 4. Signed like the delta, so the ledger sums to the balance rather than to its
  // absolute value.
  await appendLedger({ userId, type, amount: delta, balanceAfter, sessionId, note }, tx);

  return { balanceAfter };
}
