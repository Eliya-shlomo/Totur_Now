import { GRACE_SECONDS } from '#config/constants/index.js';
import { prisma } from '#config/db.js';
import {
  endSession,
  findSessionForMeter,
  findSessionsDueForAutoEnd,
} from '#repositories/session.repository.js';
import { emitSessionEnded } from '#sockets/events.js';
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
 * ## What this job deliberately does not do yet
 *
 * **It ends the session. It does not pay the teacher.** 6.6 owns termination —
 * `creditTeacher` net of §5.3's fee, `platform_fee` and `teacher_earning` on the row,
 * `sessions_count` on the profile, and the teacher's presence back to `ONLINE` — and this
 * job's `endWithReason` is replaced by that path in the PR that writes it. 6.6's brief
 * says so.
 *
 * The alternative was shipping a meter that runs past its own deadline for one PR: a
 * session that charges for ten minutes and then lasts for ever. Ending it late-and-unpaid
 * is recoverable by 6.6 in a way that never ending it is not.
 *
 * ## One transaction per session, and the `where` is the guard
 *
 * The sweep reads without a transaction — a read that opened one would hold it for the
 * whole tick — and each row it finds is ended in its own. Inside, the session is locked
 * and re-read, because between the sweep and the write the student may have extended:
 * `endSession`'s `where` carries `status = 'ACTIVE'` and a `count` of `0` means somebody
 * got there first. **Exactly one of the auto-end and the end button wins**, which is what
 * keeps 6.6 from crediting a teacher twice for one session.
 *
 * Timeliness, not correctness, like every other sweep here: on a sleeping Render instance
 * nothing runs, and `GET /sessions/:id` still evaluates `ends_at` on every read.
 */
const defaultDeps = {
  runTransaction: (fn) => prisma.$transaction(fn),
  findDue: findSessionsDueForAutoEnd,
  lockSession: findSessionForMeter,
  endWithReason: endSession,
  notifyEnded: emitSessionEnded,
};

/** §11.2's value for "the block ran out and nobody bought another". */
const NO_EXTENSION = 'no_extension';

/**
 * One tick's worth of auto-ends.
 *
 * ```
 *   1. findSessionsDueForAutoEnd(now - GRACE_SECONDS)
 *   2. per session: BEGIN, lock, still ACTIVE?, endSession(ENDED, no_extension), COMMIT
 *   3. session:ended to the session's room, after each commit
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
      if (await endOne(session.id, now, collaborators)) ended += 1;
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
 * One session, in its own transaction, and the emit after it commits.
 *
 * Returns `false` for a session somebody else ended between the sweep and the lock —
 * which is not a failure and is not logged as one. It is the student pressing **End** in
 * the same tick, and the `where` refusing the second writer is the design.
 *
 * A failure here is logged with the session id and swallowed, so one bad row does not
 * stop the sweep: the next tick finds it again, because nothing about it changed.
 */
async function endOne(sessionId, endedAt, collaborators) {
  const { runTransaction, lockSession, endWithReason, notifyEnded } = collaborators;

  try {
    const closed = await runTransaction(async (tx) => {
      const locked = await lockSession(sessionId, tx);

      // Ended, rated or gone between the unlocked sweep and this lock. Nothing to do and
      // nothing to announce — whoever ended it announced it.
      if (!locked || locked.status !== 'ACTIVE') return false;

      const { count } = await endWithReason(
        { sessionId, status: 'ENDED', endReason: NO_EXTENSION, endedAt },
        tx,
      );

      return count === 1;
    });

    if (!closed) return false;

    // **After the commit.** Neither participant has an HTTP response coming — nobody
    // asked for this — so this emit is the only way either screen learns the session is
    // over. `actorId` is null because nobody ended it: the clock did.
    notifyEnded(sessionId, {
      endReason: NO_EXTENSION,
      endedAt: endedAt.toISOString(),
      actorId: null,
    });

    return true;
  } catch (error) {
    logger.error('Auto-end failed for one session', {
      sessionId,
      message: error?.message,
      stack: error?.stack,
    });

    return false;
  }
}
