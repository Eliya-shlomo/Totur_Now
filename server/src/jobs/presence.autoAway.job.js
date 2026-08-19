import { AUTO_AWAY_MINUTES, AUTO_AWAY_WARNING_MINUTES } from '#config/constants/index.js';
import {
  findTeachersDueForAwayWarning,
  sweepIdleTeachers,
} from '#repositories/teacher.presence.repository.js';
import { emitTeacherAwayWarning, emitTeacherStatus } from '#sockets/events.js';
import { logger } from '#utils/logger.js';

/**
 * Auto-away — the second of §13's four background jobs, on the `CRON_TICK_SECONDS`
 * tick. PR 5.5, MVP.md §10, §13.
 *
 * A teacher who is `ONLINE` and whose `last_seen_at` is older than
 * `AUTO_AWAY_MINUTES` goes `OFFLINE`, and every connected client is told. E4's first
 * hard filter is `status = 'ONLINE'`, so without this job a teacher who closed the
 * tab without toggling themselves off stays in the candidate pool forever — and every
 * offer sent to them expires sixty seconds later, having cost a student a minute and
 * a place in their own list.
 *
 * ## The predicate is the job. Everything else here is plumbing
 *
 * `status = 'ONLINE'` and `last_seen_at IS NOT NULL` both live in the repository's
 * `where`, and the reasoning for each is in `teacher.presence.repository.js` beside
 * the query. In one line each: an `OFFER_LOCKED` teacher is reading a modal and a
 * stale beat is expected, an `IN_SESSION` teacher is teaching, and a teacher who has
 * never connected is new rather than idle.
 *
 * ## The threshold is computed here and passed in
 *
 * The repository is handed an instant, never a duration, for the reason every other
 * repository in this codebase is: a query that read the clock would be deciding how
 * long a teacher may be quiet, and that number is `AUTO_AWAY_MINUTES` in
 * `constants/session.js` where the product can see it. **Neither `60` nor a minute in
 * milliseconds is typed anywhere below.**
 *
 * ## `emitTeacherStatus` directly, not `publishTeacherStatus`
 *
 * The service wrapper also calls `recordTeacherActivity(force: true)`, which writes
 * `last_seen_at = now`. For every other caller that is true — somebody just toggled a
 * pill, accepted an offer, opened a socket. Here it would be a lie of exactly the kind
 * this job is built to detect: stamping the column for a teacher whose silence is the
 * entire reason they are being swept, and doing it in the one job that reads it.
 *
 * ## `AUTO_AWAY_WARNING_MINUTES`, and the one thing 6.5 reopened this file for
 *
 * 5.5 shipped without the 55-minute "still there?" prompt and said why: the blocker was
 * never the query, it was that `SOCKET_EVENTS` had no name carrying "you are still
 * `ONLINE` and we are asking", and appending one is a contract change rather than a job.
 * 6.2 appended the E6 block anyway, so `teacher:away_warning` cost one line — and what is
 * left is a predicate and an emit.
 *
 * **That is the whole of 6.5's change to this file, and the 60-minute sweep below it is
 * untouched.** The reopen is argued in 6.5's brief and in the epic README rather than
 * discovered in the diff.
 *
 * The warning is bounded on both sides — older than `AUTO_AWAY_WARNING_MINUTES`, newer
 * than `AUTO_AWAY_MINUTES` — so the tick that takes a teacher `OFFLINE` does not also ask
 * them whether they are there. And it is idempotent against `last_seen_at` held in
 * memory, for the block warning's reason exactly: a ten-second tick across a five-minute
 * window is thirty prompts, and what makes it one is remembering the beat that was warned
 * about. A restart re-asks once, which is a toast and not a state change.
 *
 * Collaborators through the second argument, 5.3's idiom, so `jobs.test.js` runs with
 * no database.
 */
const defaultDeps = {
  sweepIdle: sweepIdleTeachers,
  announceStatus: emitTeacherStatus,
  findDueForWarning: findTeachersDueForAwayWarning,
  warnIdle: emitTeacherAwayWarning,
};

/** `AUTO_AWAY_MINUTES` as milliseconds. The constant, never the number. */
const AUTO_AWAY_MS = AUTO_AWAY_MINUTES * 60 * 1000;

/** `AUTO_AWAY_WARNING_MINUTES` as milliseconds. Unread since E0 until 6.5. */
const AUTO_AWAY_WARNING_MS = AUTO_AWAY_WARNING_MINUTES * 60 * 1000;

/**
 * The `last_seen_at` each teacher was last warned about, as epoch milliseconds.
 *
 * Per-process and allowed to be: forgetting it costs one extra prompt after a restart,
 * and the alternative is a column for a toast.
 */
const warned = new Map();

/** Test seam — module state shared across a suite is order-dependence waiting to happen. */
export function resetAwayWarnings() {
  warned.clear();
}

/**
 * One tick's worth of auto-away. Called by the scheduler, and directly by the tests.
 *
 * ```
 *   1. sweepIdleTeachers(now - AUTO_AWAY_MINUTES)  -> ids, or [] and done silently
 *   2. teacher:status OFFLINE, one per id
 * ```
 *
 * **Idempotent because the sweep is conditional.** The `updateMany`'s `where` carries
 * `status = 'ONLINE'`, so a tick overlapping the previous one finds those rows already
 * `OFFLINE` and returns nothing to announce. Two ticks in the same second leave the
 * same end state as one.
 *
 * Never throws, for the scheduler's sake: a rejection here would take the next tick
 * with it, and a job whose failure mode is "presence stops sweeping, silently" is the
 * one this epic can least afford.
 *
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{swept: number}>} how many teachers this tick moved
 */
export async function runAutoAway(deps = defaultDeps) {
  const { sweepIdle, announceStatus } = { ...defaultDeps, ...deps };

  try {
    // Before the sweep, and against the same instant: a teacher who has crossed the
    // 60-minute line is going `OFFLINE` on this tick, and the window's lower bound is
    // what keeps them out of the prompt.
    await warnIdleTeachers(deps);

    const teacherIds = await sweepIdle(new Date(Date.now() - AUTO_AWAY_MS));

    // Silent on an empty tick — the acceptance criterion, and the arithmetic behind it
    // is in `offer.expiry.job.js`: at a ten-second tick, a line per tick is 8,640 a day
    // and a log nobody reads is a log that hides the one line that mattered.
    if (teacherIds.length === 0) return { swept: 0 };

    for (const teacherId of teacherIds) {
      announceStatus(teacherId, { teacherId, status: 'OFFLINE' });
    }

    logger.info('Auto-away swept idle teachers', { count: teacherIds.length });

    return { swept: teacherIds.length };
  } catch (error) {
    logger.error('Auto-away sweep failed', { message: error?.message, stack: error?.stack });

    return { swept: 0 };
  }
}

/**
 * "Still there?" — one `teacher:away_warning` per quiet stretch, addressed to the teacher.
 *
 * Addressed to them rather than broadcast: it is about that teacher's idleness, and a
 * student has no business being told the person they might pick looks asleep.
 *
 * Its failures are swallowed here rather than in `runAutoAway`, so that a warning query
 * that fails cannot stop the sweep that follows it. The sweep is the one with a state
 * change behind it; this one is a prompt.
 *
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{warned: number}>}
 */
async function warnIdleTeachers(deps) {
  const { findDueForWarning, warnIdle } = { ...defaultDeps, ...deps };

  try {
    const now = Date.now();

    prune(now);

    const due = await findDueForWarning(
      new Date(now - AUTO_AWAY_MS),
      new Date(now - AUTO_AWAY_WARNING_MS),
    );

    if (due.length === 0) return { warned: 0 };

    let sent = 0;

    for (const teacher of due) {
      const lastSeen = teacher.lastSeenAt.getTime();

      // Warned about this same beat already. They have not moved since, and asking again
      // every ten seconds is how a prompt becomes noise.
      if (warned.get(teacher.userId) === lastSeen) continue;

      warnIdle(teacher.userId, {
        minutesUntilAway: AUTO_AWAY_MINUTES - AUTO_AWAY_WARNING_MINUTES,
      });

      warned.set(teacher.userId, lastSeen);
      sent += 1;
    }

    if (sent > 0) logger.info('Away warnings sent', { count: sent });

    return { warned: sent };
  } catch (error) {
    logger.error('Away warning sweep failed', { message: error?.message, stack: error?.stack });

    return { warned: 0 };
  }
}

/** Forgets teachers whose warned beat is already past the away line — they are being swept. */
function prune(now) {
  for (const [teacherId, lastSeen] of warned) {
    if (lastSeen <= now - AUTO_AWAY_MS) warned.delete(teacherId);
  }
}
