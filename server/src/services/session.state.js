import { ERROR_CODES } from '#config/errors/codes.js';
import { AppError } from '#utils/AppError.js';

/**
 * The session state machine — `MVP.md` §10's diagram as one enforced table, and the
 * one function that decides every status change in E6.
 *
 * **This file is pure.** No Prisma import, no `tx`, no clock, no `req`. That is not
 * tidiness: it is what makes the 49-pair test in `server/tests/session.state.test.js`
 * possible, and a table that is exhaustively tested is the only kind worth having.
 * The rules live here; the behaviour lives in the four `session.*.service.js` files
 * that call this. §18 asked for one `session.service.js` and the epic README overrules
 * it on sight — five PRs opening one file is five PRs in one `git log`, which is this
 * project's only reviewer.
 *
 * **Nothing outside a repository function writes `sessions.status`, and every service
 * that moves a session calls `assertTransition` first.** `CONVENTIONS.md`'s fourth
 * iron rule, and `sessions.prisma` says the same thing at the top of the model.
 *
 * **`CANCELLED` has no inbound edge and that is recorded rather than fixed.** §12 has
 * no cancel endpoint, so no code path in E6 can produce it. Leaving the enum value
 * unreachable is honest; inventing a transition for it would be a state nothing sets
 * and every reader has to handle.
 *
 * **`NO_SHOW` is terminal and is not rated.** Rating somebody who never arrived
 * produces a review row about nothing, and `resolved_count` would take the hit. The
 * refund is the outcome — 6.6.
 */

/**
 * Every legal edge, and the whole of it. Six pairs.
 *
 * | From | To | Trigger | Owner |
 * |---|---|---|---|
 * | `PENDING` | `OFFER_SENT` | student sends an offer | 5.3 |
 * | `OFFER_SENT` | `PENDING` | reject, or expiry | 5.4 / 5.5 |
 * | `OFFER_SENT` | `ACTIVE` | teacher accepts | 6.3 |
 * | `ACTIVE` | `ENDED` | either side ends, no extension, no credit, budget cap, auto-end | 6.5, 6.6 |
 * | `ACTIVE` | `NO_SHOW` | student reports within `NO_SHOW_WINDOW_SEC` | 6.6 |
 * | `ENDED` | `RATED` | review written | 6.6 |
 *
 * Frozen, and every key present — including the three terminal states with empty
 * arrays. An absent key and an empty array are the same refusal here, but only the
 * empty array says the state was considered. It is also what lets the test iterate the
 * keys rather than a list it maintains separately, which would be a second table.
 *
 * **The guards are not here.** "Offer still `PENDING` and unexpired", "`blocks_used`
 * is the opening block", "one review per session" are conditions about a *row*, and
 * they belong in the transaction that holds it. This table answers only whether the
 * edge exists at all; a guard that lived here would be a rule with no row to check.
 */
export const TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(['OFFER_SENT']),
  OFFER_SENT: Object.freeze(['ACTIVE', 'PENDING']),
  ACTIVE: Object.freeze(['ENDED', 'NO_SHOW']),
  ENDED: Object.freeze(['RATED']),
  RATED: Object.freeze([]),
  NO_SHOW: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

/**
 * Refuses a status change the table does not contain.
 *
 * ## How to call it, and it is the whole guarantee
 *
 * **Inside the transaction, after the row is locked, against the value that lock just
 * read.** Never against a status fetched earlier in the request, and never outside the
 * transaction that performs the write.
 *
 * ```js
 * await prisma.$transaction(async (tx) => {
 *   const session = await findSessionForMeter(sessionId, tx);   // SELECT … FOR UPDATE
 *   assertTransition(session.status, 'ENDED');                  // against what the lock read
 *   const { count } = await endSession({ … }, tx);              // conditional on ACTIVE
 *   if (count === 0) throw …                                    // somebody else won
 * });
 * ```
 *
 * Read-then-decide-then-write with a gap in the middle is two concurrent requests both
 * seeing `ACTIVE`, both passing this assert, and both charging. The lock closes the
 * gap; this function only refuses the edges that were never legal in the first place.
 *
 * **It is not a substitute for the repository's conditional write, and the repository's
 * conditional write is not a substitute for it.** They answer two different questions:
 * this one says "`RATED` does not come after `ACTIVE`", and the `updateMany`'s `count`
 * says "somebody moved this row between your read and your write". Either alone leaves
 * one of the two failures silent.
 *
 * @param {string} from the status just read under the lock — `sessions.status`
 * @param {string} to   the status about to be written
 * @returns {void}
 * @throws {AppError} `SESSION_NOT_ACTIVE` (409) when the edge is not in `TRANSITIONS`
 */
export function assertTransition(from, to) {
  // `Object.hasOwn` and not a bare `TRANSITIONS[from]`. The table is an object literal,
  // so it inherits from `Object.prototype`, and `TRANSITIONS['constructor']` is a
  // function rather than `undefined` — `?.includes` on it throws `TypeError`, which
  // reaches the client as a 500 for a status this machine already refuses. `from` comes
  // off a database column and cannot be `'constructor'` today; that is an argument for
  // the guard being cheap, not for leaving it out.
  const edges = Object.hasOwn(TRANSITIONS, from) ? TRANSITIONS[from] : null;

  if (edges?.includes(to)) return;

  // One message for every illegal pair, and it says nothing about which pair.
  //
  // **No `details`.** `errorHandler` puts `details` in the response body, so a
  // `{ from, to }` there would tell whoever holds a session's uuid exactly what state
  // it is in — the leak `GET /sessions/:id` refuses to produce with its 404 and 6.4
  // refuses again. The caller has both statuses in hand and logs them if it wants
  // them; this function's job is to refuse, not to explain over the wire.
  throw new AppError(
    ERROR_CODES.SESSION_NOT_ACTIVE,
    'This session is no longer in a state that allows that.',
  );
}
