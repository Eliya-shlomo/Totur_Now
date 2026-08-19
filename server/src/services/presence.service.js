import { setTeacherOffline, touchLastSeenAt } from '#repositories/teacher.presence.repository.js';
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

/**
 * Takes a teacher offline and tells everybody — the presence fix on top of 5.8.
 *
 * ## What was wrong
 *
 * `teacher_profiles.status` outlived the session that set it. A teacher went online,
 * closed the browser, and the column still said `ONLINE` — so students saw them on
 * every match list, sent them offers, and got a countdown that could only expire.
 * Nothing was broken in a way anybody could see: the list was right about the column
 * and the column was wrong about the world.
 *
 * Three moments now write it, and together they make availability mean "a tab that is
 * open and a teacher who said yes":
 *
 * - **logging out**, immediately — the clearest possible statement of leaving;
 * - **logging in**, also to `OFFLINE` — presence is a deliberate act per session, and
 *   a status inherited from a browser that was closed on Tuesday is not consent to be
 *   sent a question on Thursday;
 * - **the last socket going away**, after a grace period — which is what actually
 *   catches a closed laptop, since nobody clicks logout.
 *
 * §10's auto-away sweep stays exactly as it was. It answers a different question — a
 * teacher idle for an hour with the tab open — and this path answers "there is no tab".
 *
 * **Only from `ONLINE`.** The repository's predicate refuses to move `OFFER_LOCKED` or
 * `IN_SESSION`, because those are states the system owns: a live offer must expire on
 * its own clock, and a session a teacher walked out of is E6's problem to resolve, not
 * a status this function may quietly erase.
 *
 * Never throws, like everything else in this file, and the event is emitted **only when
 * the row actually moved** — an `OFFLINE` announcement for a teacher who was already
 * offline is a frame every connected client processes for nothing.
 *
 * @param {string} teacherId `teacher_profiles.user_id`
 * @returns {Promise<void>}
 */
export async function takeTeacherOffline(teacherId) {
  try {
    const { changed } = await setTeacherOffline(teacherId);

    if (!changed) return;

    emitTeacherStatus(teacherId, { teacherId, status: 'OFFLINE' });
    logger.info('Teacher taken offline', { teacherId });
  } catch (error) {
    // Every caller is fire-and-forget — a logout that already answered 200, a socket
    // that is already gone. A throw here would be an unhandled rejection on work
    // nobody is waiting for.
    logger.warn('Could not take teacher offline', { teacherId, message: error?.message });
  }
}
