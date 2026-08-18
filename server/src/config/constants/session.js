/**
 * Session timing and lifecycle. MVP.md §5.1, §10, appendix.
 *
 * A literal number with meaning anywhere else in the codebase is a failed review.
 */

/** Base billing unit. Everything is a multiple of this. */
export const BLOCK_MINUTES = 5;

/** Opening block is 10 minutes — charged immediately, non-cancellable. */
export const OPENING_BLOCKS = 2;

/** Each extension buys one more block. */
export const EXTENSION_BLOCKS = 1;

/** How long before a block ends the student is asked to extend. */
export const WARNING_SECONDS = 60;

/** After the block ends with no answer, the session still has this long. */
export const GRACE_SECONDS = 30;

/** An offer a teacher has not answered within this window expires. */
export const OFFER_TTL_SECONDS = 60;

/**
 * How long a teacher's last socket may stay gone before they are taken offline.
 *
 * Short enough that a student is not offered somebody who closed their laptop, long
 * enough to survive the two events that look identical from the server: a page reload
 * and a tunnel. A reload reconnects in well under a second; a teacher who is actually
 * gone waits this out and drops off every match list.
 *
 * This is not §10's auto-away and does not replace it. That sweep answers "the tab is
 * open and nobody has touched it for an hour"; this answers "there is no tab".
 */
export const PRESENCE_DISCONNECT_GRACE_SECONDS = 15;

/** ONLINE teachers idle this long are flipped OFFLINE. */
export const AUTO_AWAY_MINUTES = 60;

/** "Still there?" modal fires this long before auto-away. MVP.md §10. */
export const AUTO_AWAY_WARNING_MINUTES = 55;

/** A student may report a teacher no-show only within this window from start. */
export const NO_SHOW_WINDOW_SEC = 60;

/** Background jobs tick at this interval. MVP.md §13. */
export const CRON_TICK_SECONDS = 10;

/**
 * The four values `offers.status` takes. Appended in PR 5.1, and the only edit E5
 * makes to this file.
 *
 * A frozen object rather than a Prisma enum, because the column is a `VarChar(20)`
 * and stays one — see docs/epics/E5-offers-realtime/README.md, gap 1: making it an
 * enum costs a migration and buys no behaviour. That decision is exactly why the
 * values need a home. `SessionStatus` and `TeacherStatus` are enums, so Prisma's
 * generated types keep those two honest; nothing keeps a string column honest except
 * this object, read by the Zod schema on the way in and by the repository on the way
 * out.
 *
 * No PR in E5 writes any of these four as a literal anywhere else.
 */
export const OFFER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
});
