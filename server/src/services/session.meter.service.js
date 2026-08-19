import { BLOCK_MINUTES, EXTENSION_BLOCKS } from '#config/constants/index.js';
import { prisma } from '#config/db.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import {
  extendSession,
  findSessionForMeter,
  findSessionForView,
  recordBlock,
} from '#repositories/session.repository.js';
import { chargeStudent } from '#services/wallet.service.js';
import { emitSessionExtended } from '#sockets/events.js';
import { AppError } from '#utils/AppError.js';

/**
 * `POST /sessions/:id/extend` — one more block. PR 6.5, MVP.md §5.1 and §12.
 *
 * ## The order inside the transaction is the design
 *
 * ```
 *   read  the session as the caller has it        ← unlocked, before BEGIN
 *   BEGIN
 *     1. findSessionForMeter(sessionId, tx)       SELECT … FOR UPDATE OF s
 *     2. the caller is this session's student     else NOT_FOUND
 *     3. status === 'ACTIVE'                      else SESSION_NOT_ACTIVE
 *     4. totalCharged + amount <= budgetCap       else BUDGET_CAP_REACHED, 402
 *     5. chargeStudent(amount)                    else INSUFFICIENT_CREDIT, 402
 *     6. extendSession(expectedEndsAt)            count 0 => SESSION_NOT_ACTIVE
 *     7. recordBlock(blocksUsed + 1)
 *   COMMIT
 *     8. session:extended to the session's room   ← after, never inside
 * ```
 *
 * **The cap is checked before the charge and its failure writes nothing.** A cap
 * enforced after the debit is a refund path, and a refund path is a second ledger
 * operation to get right for a rule that is one comparison.
 *
 * **`assertTransition` is not called.** This is `ACTIVE` → `ACTIVE`, which is not an edge
 * in `session.state.js` — the guard is the status check in step 3 and the `where` in step
 * 6, and inventing a self-edge would weaken a table whose value is that every entry is a
 * real transition.
 *
 * ## Why there is a read before the transaction
 *
 * `extendSession` matches on `ends_at` **as the caller read it**, and that guard is what
 * makes a double-tapped button buy one block instead of two. It only works if the
 * expected value comes from *outside* the transaction: `findSessionForMeter` is
 * `SELECT … FOR UPDATE`, so a second request blocks on the lock, wakes after the first
 * commits, and reads the `ends_at` the first one just wrote — matching its own
 * expectation and buying a second block. Two taps, two blocks, and every sequential test
 * still passing.
 *
 * So the value the `where` matches on is read before `BEGIN`, which is the instant the
 * *caller* has: both taps of a double tap carry the same one, the first moves the column,
 * and the second matches zero rows and is answered `SESSION_NOT_ACTIVE`. **It is not
 * retried.** A retry is the second block the guard exists to refuse.
 *
 * This is E5's teacher lock in a different column, and it is the one place in this file
 * where the reasoning is not obvious from the code. `findSessionForView` is reused for
 * the read rather than adding an eighth read to a frozen repository; it is one indexed
 * `SELECT` on a screen that presses this button at most once every five minutes.
 *
 * ## Everything the caller could lie about comes from a row
 *
 * The body is empty and `sessionByIdSchema` is `.strict()`, so the path id and the
 * token's user are the whole of the request. The price is the session's snapshot, the
 * cap is the session's column, and the quantity is `EXTENSION_BLOCKS` — a quantity in the
 * body is a way to overrun the budget cap in one request.
 */
const defaultDeps = {
  runTransaction: (fn) => prisma.$transaction(fn),
  loadSession: findSessionForView,
  lockSession: findSessionForMeter,
  chargeCredits: chargeStudent,
  extend: extendSession,
  saveBlock: recordBlock,
  notifyExtended: emitSessionExtended,
};

/** One extension in milliseconds. The constants, never `5` and never `60_000`. */
const EXTENSION_MS = EXTENSION_BLOCKS * BLOCK_MINUTES * 60 * 1000;

/**
 * Buys one block.
 *
 * **`NOT_FOUND` for a session that is not this student's**, never `FORBIDDEN` — 3.5's
 * rule, kept by every session endpoint since 5.3, and the route's `authorize('student')`
 * only proves the caller is *a* student.
 *
 * @param {object} input
 * @param {string} input.sessionId a uuid, already shape-checked by `sessionByIdSchema`
 * @param {string} input.studentId the caller, from `req.user.id`
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<import('@tutor/shared').ExtendResponse>}
 */
export async function extendSessionBlock({ sessionId, studentId }, deps = defaultDeps) {
  const collaborators = { ...defaultDeps, ...deps };
  const { runTransaction, loadSession, lockSession, chargeCredits, extend, saveBlock } =
    collaborators;

  // The caller's view of the session, and the only thing taken from it is `ends_at` —
  // the value step 6 matches on. Every decision below is made against the locked read.
  const seen = await loadSession(sessionId);

  if (!seen || seen.studentId !== studentId) {
    throw AppError.notFound('Session');
  }

  const expectedEndsAt = seen.endsAt;

  const extended = await runTransaction(async (tx) => {
    const locked = await lockSession(sessionId, tx);

    // The row went away between the two reads. Same answer a stranger gets, because this
    // endpoint must not say which of the two happened.
    if (!locked) {
      throw AppError.notFound('Session');
    }

    if (locked.studentId !== studentId) {
      throw AppError.notFound('Session');
    }

    // An allowlist of one. A session that ended while the modal was open is over, and the
    // 409 is what the screen renders as "this session has finished".
    if (locked.status !== 'ACTIVE') {
      throw new AppError(ERROR_CODES.SESSION_NOT_ACTIVE, 'This session is no longer running.');
    }

    const amount = EXTENSION_BLOCKS * locked.pricePerBlock;
    const totalCharged = locked.totalCharged + amount;

    // **Before the charge.** §5.1's cap is the student's own ceiling on one lesson, and
    // the failure path below this line has written nothing at all.
    if (totalCharged > locked.budgetCap) {
      throw new AppError(
        ERROR_CODES.BUDGET_CAP_REACHED,
        'This session has reached the spending limit you set.',
      );
    }

    const { balanceAfter } = await chargeCredits(
      { userId: studentId, sessionId, amount, note: 'Extension block' },
      tx,
    );

    const blocksUsed = locked.blocksUsed + EXTENSION_BLOCKS;
    const endsAt = new Date(expectedEndsAt.getTime() + EXTENSION_MS);

    const { count } = await extend(
      { sessionId, expectedEndsAt, endsAt, blocksUsed, totalCharged },
      tx,
    );

    // Zero means the deadline moved between the caller's read and this write — the other
    // tap of a double tap, or the auto-end sweep taking the session while the request was
    // in flight. Both are `SESSION_NOT_ACTIVE`, both roll the charge back with the
    // transaction, and neither is retried.
    if (count === 0) {
      throw new AppError(ERROR_CODES.SESSION_NOT_ACTIVE, 'This session is no longer running.');
    }

    await saveBlock(
      {
        sessionId,
        blockNumber: blocksUsed,
        minutes: EXTENSION_BLOCKS * BLOCK_MINUTES,
        amount,
      },
      tx,
    );

    return { blocksUsed, endsAt, totalCharged, balance: balanceAfter };
  });

  // **After the commit, never inside it.** The teacher's tab learns the session grew from
  // this and from nothing else — they have no HTTP response coming — and an emit inside
  // the transaction announces a block that a rollback could still take away.
  collaborators.notifyExtended(sessionId, {
    blocksUsed: extended.blocksUsed,
    endsAt: extended.endsAt.toISOString(),
    totalCharged: extended.totalCharged,
    balance: extended.balance,
  });

  return {
    blocksUsed: extended.blocksUsed,
    endsAt: extended.endsAt.toISOString(),
    totalCharged: extended.totalCharged,
    balance: extended.balance,
  };
}
