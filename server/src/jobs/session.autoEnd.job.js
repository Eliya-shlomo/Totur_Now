import { GRACE_SECONDS } from '#config/constants/index.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { findSessionsDueForAutoEnd } from '#repositories/session.repository.js';
import { terminateSession } from '#services/session.end.service.js';
import { logger } from '#utils/logger.js';

/**
 * Session Auto-End — the last of §13's four background jobs, on the `CRON_TICK_SECONDS`
 * tick. PR 6.5, MVP.md §5.1 and §13.
 *
 * A session still `ACTIVE` more than `GRACE_SECONDS` past its `ends_at` is over: nobody
 * extended, and the block that was paid for has run out. It is ended with
 * `end_reason = 'no_extension'` and both sides are told.
 *
 * **The grace is why this is not "past `ends_at`".** The warning goes out at T-60s and the
 * student may be reading the modal as the deadline passes; thirty seconds is the room
 * §5.1 gives them to press the button, and the extend endpoint's own `where` carries
 * `status = 'ACTIVE'` so the race between the two resolves cleanly whichever way it goes.
 *
 * ## Rewired in 6.6, and this is the whole of what changed
 *
 * 6.5 shipped this job writing `ENDED` itself, with no credit and no `sessions_count`,
 * because the termination path did not exist yet — the alternative was a meter that runs
 * past its own deadline for one PR. **6.6 wrote that path and this job now calls it.**
 * `terminateSession` is the one writer of the terminal state: it takes the lock, resolves
 * §5.3's fee at `started_at`, credits the teacher net of it, releases them, and emits.
 * Two writers of a terminal state is two arithmetics, and the one that runs less often is
 * the one that is wrong.
 *
 * What is left here is the sweep: which sessions are due, and one call each.
 *
 * ## One transaction per session, and it is the service's
 *
 * The sweep reads without a transaction — a read that opened one would hold it for the
 * whole tick — and each row it finds is passed to `terminateSession`, which opens its own.
 * Inside it the session is locked and re-read, because between the sweep and the write the
 * student may have extended or pressed **End**: `assertTransition` refuses a session that
 * is no longer `ACTIVE` and `endSession`'s `where` refuses one that moved after the lock.
 * **Exactly one of the auto-end and the end button wins**, which is what keeps a teacher
 * from being credited twice for one session.
 *
 * Timeliness, not correctness, like every other sweep here: on a sleeping Render instance
 * nothing runs, and `GET /sessions/:id` still evaluates `ends_at` on every read.
 */
const defaultDeps = {
  findDue: findSessionsDueForAutoEnd,
  endDueSession: terminateSession,
};

/** §11.2's value for "the block ran out and nobody bought another". */
const NO_EXTENSION = 'no_extension';

/**
 * One tick's worth of auto-ends.
 *
 * ```
 *   1. findSessionsDueForAutoEnd(now - GRACE_SECONDS)
 *   2. per session: terminateSession({ endReason: 'no_extension', actorId: null })
 * ```
 *
 * Never throws, for the scheduler's sake, and a session that fails is logged and left for
 * the next tick rather than taking the rest of the sweep with it.
 *
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{ended: number}>}
 */
export async function runAutoEnd(deps = defaultDeps) {
  const collaborators = { ...defaultDeps, ...deps };

  try {
    const now = new Date();
    const due = await collaborators.findDue(new Date(now.getTime() - GRACE_SECONDS * 1000));

    // Silent on an empty tick, like both sweeps beside it.
    if (due.length === 0) return { ended: 0 };

    let ended = 0;

    for (const session of due) {
      if (await endOne(session.id, collaborators)) ended += 1;
    }

    if (ended === 0) return { ended: 0 };

    logger.info('Sessions auto-ended past their grace period', { count: ended });

    return { ended };
  } catch (error) {
    logger.error('Auto-end sweep failed', { message: error?.message, stack: error?.stack });

    return { ended: 0 };
  }
}

/**
 * One session, through the one termination path.
 *
 * Returns `false` for a session somebody else ended between the sweep and the lock. That
 * is not a failure and is not logged as one — it is the student pressing **End** in the
 * same tick, and the service refusing the second writer is the design.
 *
 * Anything else is logged with the session id and swallowed, so one bad row does not stop
 * the sweep: the next tick finds it again, because nothing about it changed.
 */
async function endOne(sessionId, collaborators) {
  try {
    await collaborators.endDueSession({
      sessionId,
      endReason: NO_EXTENSION,
      // **Nobody pressed anything.** A null actor is what skips the participation check
      // inside the service — there is no participant to be — and it is what the emit
      // carries, so 6.7 says *the session ended* rather than *they ended it*.
      actorId: null,
    });

    return true;
  } catch (error) {
    // `SESSION_NOT_ACTIVE` is the ordinary case rather than a failure: the student pressed
    // **End** in the same tick, or extended after the sweep read the row. Whoever won
    // announced it, and a second `session:ended` would be two endings on one screen.
    if (error?.code === ERROR_CODES.SESSION_NOT_ACTIVE) return false;

    logger.error('Auto-end failed for one session', {
      sessionId,
      code: error?.code,
      message: error?.message,
    });

    return false;
  }
}
