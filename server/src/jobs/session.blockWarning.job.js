import { BLOCK_MINUTES, EXTENSION_BLOCKS, WARNING_SECONDS } from '#config/constants/index.js';
import { findSessionsDueForWarning, findWalletBalance } from '#repositories/session.repository.js';
import { emitBlockWarning } from '#sockets/events.js';
import { logger } from '#utils/logger.js';

/**
 * Block Warning — the third of §13's four background jobs, on the `CRON_TICK_SECONDS`
 * tick. PR 6.5, MVP.md §5.1 and §13.
 *
 * A session whose current block ends within `WARNING_SECONDS` gets one
 * `session:block_warning` in both participants' tabs, and 6.7 raises the extend modal on
 * it. Without it the meter simply stops: the student is asked for nothing, the session
 * auto-ends thirty seconds later, and neither person had a chance to decide.
 *
 * ## The server decides all four numbers, and that is the point of the payload
 *
 * `extensionPrice`, `balanceAfter`, `canAfford` and `withinCap` are computed here from
 * the row and the wallet, never on the client. A screen that works out affordability
 * works it out differently from the endpoint that enforces it, and the disagreement shows
 * up as an **Extend** button that is enabled and then 402s — the worst possible place to
 * be wrong, because the student has already decided to spend.
 *
 * The two predicates are the extend endpoint's two, in the same order:
 * `balance >= price` and `total_charged + price <= budget_cap`.
 *
 * ## Idempotence is `ends_at`, held in memory, with no column behind it
 *
 * The sweep runs every ten seconds and the warning window is sixty, so the naive version
 * sends six modals per block. What makes it one is a `Map` from session to the `ends_at`
 * it was last warned about: a second tick inside the same window finds the same instant
 * and says nothing, and an *extended* session has a new `ends_at` and is warned again —
 * which is exactly right, because it has bought another block and will need the question
 * again.
 *
 * **A restart re-warns once.** That is a duplicate modal and not a duplicate charge, and
 * it is the cheapest failure available: the honest alternative is a `warned_at` column,
 * which is a second migration in an epic that promised one. If E7 or E10 needs durable
 * warning state it can have the column then, with a reason.
 *
 * The map is pruned on every tick — entries whose block has already ended are gone — so
 * a process that runs for a month holds one entry per *live* session rather than one per
 * session it has ever seen.
 *
 * ## Timeliness, not correctness
 *
 * Render's free plan sleeps the instance and `node-cron` runs in-process, so on a
 * sleeping server this does not run at all. E5's ruling and it holds: `GET /sessions/:id`
 * evaluates `ends_at` on every read, so a session past its deadline reads as over whether
 * or not anything swept it. A missed warning costs a modal, never a charge.
 *
 * Collaborators through the argument, 5.3's idiom, so the job runs in the suite with no
 * database and no socket server.
 */
const defaultDeps = {
  findDue: findSessionsDueForWarning,
  loadBalance: findWalletBalance,
  notifyWarning: emitBlockWarning,
};

/**
 * The last `ends_at` each session was warned about, as epoch milliseconds.
 *
 * Module state, deliberately: it is per-process and it is allowed to be, because
 * forgetting it costs one extra modal. Nothing else in the server reads this map, and
 * `resetBlockWarnings` exists for the tests rather than for production.
 */
const warned = new Map();

/** Test seam — the map is process-wide and a suite that shared it would be order-dependent. */
export function resetBlockWarnings() {
  warned.clear();
}

/**
 * One tick's worth of warnings.
 *
 * ```
 *   1. findSessionsDueForWarning(now, now + WARNING_SECONDS)
 *   2. drop the ones already warned at this exact `ends_at`
 *   3. one wallet read each, then session:block_warning to the session's room
 * ```
 *
 * **Nothing here writes.** A warning is an emit; the money moves only when the student
 * presses the button, through `POST /sessions/:id/extend` and its transaction.
 *
 * Never throws, for the scheduler's sake — a rejection here would take the next tick with
 * it, and a job whose failure mode is "the meter stops asking" is one this epic cannot
 * afford.
 *
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{warned: number}>}
 */
export async function runBlockWarning(deps = defaultDeps) {
  const { findDue, loadBalance, notifyWarning } = { ...defaultDeps, ...deps };

  try {
    const now = new Date();

    prune(now);

    const due = await findDue(now, new Date(now.getTime() + WARNING_SECONDS * 1000));

    // Silent on an empty tick — 5.5's arithmetic: a line per tick is 8,640 a day, and a
    // log nobody reads is a log that hides the one line that mattered.
    if (due.length === 0) return { warned: 0 };

    let sent = 0;

    for (const session of due) {
      if (warned.get(session.id) === session.endsAt.getTime()) continue;

      // One read per session actually being warned, and only for sessions that clear the
      // idempotence check above — not one per session per tick.
      const balance = (await loadBalance(session.studentId)) ?? 0;
      const extensionPrice = EXTENSION_BLOCKS * session.pricePerBlock;

      notifyWarning(session.id, {
        secondsLeft: Math.max(0, Math.round((session.endsAt.getTime() - now.getTime()) / 1000)),
        extensionPrice,
        // What the balance *would* be, which is what the modal shows beside the price.
        // Negative is possible and is not clamped: `canAfford` is the decision and a
        // number that lied about how short they are would be worse than a minus sign.
        balanceAfter: balance - extensionPrice,
        canAfford: balance >= extensionPrice,
        withinCap: session.totalCharged + extensionPrice <= session.budgetCap,
      });

      warned.set(session.id, session.endsAt.getTime());
      sent += 1;
    }

    if (sent === 0) return { warned: 0 };

    logger.info('Block warnings sent', { count: sent, blockMinutes: BLOCK_MINUTES });

    return { warned: sent };
  } catch (error) {
    logger.error('Block warning sweep failed', { message: error?.message, stack: error?.stack });

    return { warned: 0 };
  }
}

/**
 * Forgets sessions whose warned block has already ended.
 *
 * Without it the map grows by one entry per session for the life of the process. With it
 * the entry survives exactly as long as the block it is about — which is the whole window
 * in which a second warning could be sent.
 */
function prune(now) {
  for (const [sessionId, endsAt] of warned) {
    if (endsAt <= now.getTime()) warned.delete(sessionId);
  }
}
