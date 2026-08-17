import { touchLastSeenAt } from '#repositories/teacher.presence.repository.js';
import { emitTeacherStatus } from '#sockets/events.js';
import { logger } from '#utils/logger.js';

import { claimLastSeenWrite } from './presence.debounce.js';

/**
 * Presence — what "this teacher is here" means, and who is told about it. PR 5.2.
 *
 * Two exported functions and one property they share: **neither ever throws into its
 * caller.** One is called from a socket event handler, which has no request to fail
 * and no client waiting for an answer; the other is called from a controller *after*
 * the response has gone out, where a rejection would be an unhandled one on a request
 * that already succeeded. Both log and return.
 *
 * The debounce decision lives next door in `presence.debounce.js` so that it can be
 * tested without a database — see that file's header.
 *
 * **Nothing here reads `last_seen_at` to make a decision** (docs/epics/E5-offers-realtime/PR-5.2-presence-heartbeat.md,
 * review checklist). The column has one reader, 5.5's sweep, and two readers of a
 * freshness rule drift apart quietly.
 */

/**
 * Records that a teacher is present, writing `last_seen_at` at most once per
 * `PRESENCE_WRITE_INTERVAL_MS`.
 *
 * Three callers, and the third is why `force` exists:
 *
 * - **every heartbeat**, debounced — one `UPDATE` per teacher per beat is write
 *   amplification the free-tier database does not need, for a column whose entire job
 *   is to answer "has this teacher been gone an hour";
 * - **connecting the socket**, forced — otherwise a teacher who opens the dashboard is
 *   only present once the first interval has elapsed;
 * - **changing status through `PATCH /teachers/me`**, forced, from
 *   `publishTeacherStatus` below.
 *
 * Awaiting it is optional and mostly pointless: the callers are fire-and-forget and
 * the failure is already logged here. It stays `async` so that a future caller inside
 * a transaction can await it rather than discovering it cannot.
 *
 * @param {string} teacherId `teacher_profiles.user_id`
 * @param {object} [options]
 * @param {boolean} [options.force] skip the debounce — activity that is not a beat
 * @returns {Promise<void>}
 */
export async function recordTeacherActivity(teacherId, { force = false } = {}) {
  const now = Date.now();

  if (!claimLastSeenWrite(teacherId, { now, force })) return;

  try {
    await touchLastSeenAt(teacherId, new Date(now));
  } catch (error) {
    // A beat that did not land is not worth failing anything over — the next one is
    // along in an interval, and the sweep is late rather than wrong in the meantime.
    // Logged at `warn` rather than `error` because the write is recoverable by
    // definition; a run of these means the database is unwell, which shows up in
    // louder places first.
    logger.warn('last_seen_at write failed', { teacherId, message: error?.message });
  }
}

/**
 * Announces that a teacher's availability changed, and counts the change as activity.
 *
 * **The one caller in this PR is the toggle path** — `PATCH /teachers/me`, from
 * `teacher.me.controller.js`, after the response has been written. 5.3 (lock taken),
 * 5.4 (lock released) and 5.5 (swept away) each call the same function from their own
 * service, so that the event has one shape and one emitter however the status moved.
 *
 * **Not `async`, and that is deliberate.** A controller that had to `await` this would
 * either delay a response that is already correct or, forgetting the `await`, leave an
 * unhandled rejection on a 200. It returns immediately; the write it schedules reports
 * its own failures.
 *
 * The status is passed in rather than re-read. The caller has just written it and
 * holds the row it wrote — a second read here could only disagree with the response
 * the client is holding.
 *
 * @param {string} teacherId `teacher_profiles.user_id`
 * @param {string} status the value now in the column — a `TeacherStatus`
 * @returns {void}
 */
export function publishTeacherStatus(teacherId, status) {
  emitTeacherStatus(teacherId, { teacherId, status });

  // A teacher who just set their own availability is present by any reading, and a
  // teacher who is then swept offline sixty minutes later without having gone
  // anywhere is the bug this PR exists to prevent. `void` rather than a floating
  // promise: `recordTeacherActivity` handles its own failures and there is nothing
  // here to await.
  void recordTeacherActivity(teacherId, { force: true });
}
