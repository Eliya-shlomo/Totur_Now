import { AUTO_AWAY_MINUTES } from '#config/constants/index.js';

/**
 * The write debounce behind `last_seen_at`, and nothing else. PR 5.2.
 *
 * **A separate file from `presence.service.js` for one reason: it can be tested.**
 * `npm test` is bare `node --test` with no database and no fixtures, so a test that
 * imports the service imports the repository and therefore `PrismaClient`. The
 * decision this file makes — *write now, or skip this beat* — is the only part of the
 * feature with branches worth asserting, and it depends on nothing but a clock. Split
 * out, it is a unit test with zero setup; left in the service, it is untestable
 * without the database the suite deliberately does not have.
 *
 * The state is module-level and process-local, exactly like the platform-averages
 * cache in `matching.averages.service.js`. That means a restart writes one extra row
 * per teacher and a second instance would keep its own map — both harmless, because
 * the map only ever suppresses a write that would have been redundant, and losing it
 * fails in the direction of writing more often rather than less.
 */

/**
 * How long a teacher's `last_seen_at` is allowed to stand before the next beat writes
 * it again — half the auto-away window.
 *
 * **Derived, never typed.** The relationship to `AUTO_AWAY_MINUTES` is the whole
 * argument for the debounce being safe, and a literal `30` here would go on saying 30
 * the day somebody tunes the window to 20 — at which point a teacher who is sitting
 * there gets swept offline. Halving is this PR's policy rather than a product number,
 * which is why it lives here and not in `constants/session.js` (E5 opens that file in
 * 5.1 only).
 *
 * The arithmetic: the column is never more than half the window behind reality, 5.5's
 * sweep asks whether it is a full window old, so an active teacher is never swept and
 * a teacher who left is swept between one and one-and-a-half windows later. Being late
 * to mark somebody away is the harmless direction; being early logs out a teacher who
 * is sitting at their desk.
 */
export const PRESENCE_WRITE_INTERVAL_MS = (AUTO_AWAY_MINUTES / 2) * 60 * 1000;

/**
 * `teacherId → the instant their row was last written`, in epoch milliseconds.
 *
 * **Keyed per teacher, and that is the point of the map.** A single module-level
 * timestamp would let one busy teacher's beat suppress every other teacher's write,
 * and the failure would be invisible: every heartbeat still arrives, every handler
 * still runs, and one arbitrary teacher's `last_seen_at` is the only one moving.
 *
 * Nothing evicts. The keys are teachers who have connected since the process started
 * — fifteen on this platform, and an entry is two words — and an eviction on
 * disconnect would only cost one extra write on the next connect while adding a
 * lifecycle to get wrong. `resetPresenceDebounce` exists for tests and for nobody
 * else.
 */
const lastWrittenAt = new Map();

/**
 * Whether this beat earns a database write — and, if it does, records that it did.
 *
 * **Claiming and recording are one call on purpose.** Two functions, a `shouldWrite`
 * and a `markWritten`, would let a caller ask and then forget to answer, which is a
 * teacher whose row is written on every single beat with nothing anywhere saying so.
 * Node is single-threaded and there is no await between the read and the write below,
 * so a claim cannot be granted twice for the same interval.
 *
 * It returns `true` for a teacher it has never seen, so the first beat after a connect
 * or a restart always writes.
 *
 * `force` is for activity that is not a beat: connecting the socket, and changing
 * status through `PATCH /teachers/me`. Both are unambiguously a teacher being present,
 * both happen at most a handful of times an hour, and a teacher who just did something
 * and is then swept offline is the bug this whole file exists to prevent. It still
 * records the instant, so a forced write resets the interval rather than sitting
 * outside it.
 *
 * @param {string} teacherId `teacher_profiles.user_id`
 * @param {object} [options]
 * @param {number} [options.now] epoch ms; injected so tests need no timers
 * @param {boolean} [options.force] write regardless of the interval
 * @returns {boolean} `true` when the caller should write `last_seen_at`
 */
export function claimLastSeenWrite(teacherId, { now = Date.now(), force = false } = {}) {
  const written = lastWrittenAt.get(teacherId);

  if (!force && written !== undefined && now - written < PRESENCE_WRITE_INTERVAL_MS) {
    return false;
  }

  lastWrittenAt.set(teacherId, now);

  return true;
}

/**
 * Forgets every claim. **For tests**, so that one case cannot decide another's answer.
 *
 * The same escape hatch `clearPlatformAveragesCache` is, and it is here for the same
 * reason: module-level state that no test can reset is module-level state that makes
 * the suite order-dependent.
 */
export function resetPresenceDebounce() {
  lastWrittenAt.clear();
}
