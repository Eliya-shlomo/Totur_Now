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

/** ONLINE teachers idle this long are flipped OFFLINE. */
export const AUTO_AWAY_MINUTES = 60;

/** "Still there?" modal fires this long before auto-away. MVP.md §10. */
export const AUTO_AWAY_WARNING_MINUTES = 55;

/** A student may report a teacher no-show only within this window from start. */
export const NO_SHOW_WINDOW_SEC = 60;

/** Background jobs tick at this interval. MVP.md §13. */
export const CRON_TICK_SECONDS = 10;
