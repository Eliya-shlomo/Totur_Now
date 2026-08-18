import { AUTO_AWAY_MINUTES } from '#config/constants/index.js';
import { sweepIdleTeachers } from '#repositories/teacher.presence.repository.js';
import { emitTeacherStatus } from '#sockets/events.js';
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
 * ## `AUTO_AWAY_WARNING_MINUTES` is not implemented here
 *
 * The epic README's gap 8 was amended to say 5.5 owns both numbers — the 55-minute
 * "Still there?" prompt as well as the 60-minute sweep. PR-5.5's own brief scopes two
 * jobs and mentions neither the constant nor a warning, and `SOCKET_EVENTS` is
 * append-only with no name that carries "you are still `ONLINE` and we are asking".
 * The two documents disagree; **the brief wins, the constant stays unused, and the
 * conflict is in this PR's description** rather than resolved by inventing an event.
 *
 * Collaborators through the second argument, 5.3's idiom, so `jobs.test.js` runs with
 * no database.
 */
const defaultDeps = {
  sweepIdle: sweepIdleTeachers,
  announceStatus: emitTeacherStatus,
};

/** `AUTO_AWAY_MINUTES` as milliseconds. The constant, never the number. */
const AUTO_AWAY_MS = AUTO_AWAY_MINUTES * 60 * 1000;

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
