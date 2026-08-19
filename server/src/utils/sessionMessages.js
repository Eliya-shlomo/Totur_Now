/**
 * What "this session is not in that state" means, in words — PR 6.8, MVP.md §15.3.
 *
 * **One code, six situations, six sentences.** `SESSION_NOT_ACTIVE` is thrown by six
 * endpoints and 409 is right for every one of them, so `shared/errorCodes.js` is not
 * touched: a seventh code would be a contract change in a frozen file for a distinction
 * the *status* already carries. What was wrong was the message — one string for six
 * outcomes, which left the client rendering "this session is no longer running" to a
 * student whose credits had just been refunded.
 *
 * **A file of its own because two services throw these.** `session.meter.service.js`
 * refuses an extension and `session.end.service.js` refuses an end, a no-show and a
 * rating, and the same terminal states mean the same things to both. A copy in each is
 * two wordings for one situation, and the day they drift is the day the same session
 * reads as refunded on one screen and finished on the other.
 *
 * **Nothing here decides anything.** No status, no code, no destination — the client maps
 * the code and the state it re-fetches to a screen (`client/src/utils/sessionErrors.js`),
 * because where a person should be sent is a product decision and this is a sentence.
 */

/**
 * The sentence for a session that is in `status` when the caller wanted it in another.
 *
 * The three terminal states are the ones a real person reaches — by pressing a button on
 * a screen that was true a second ago, or by having two tabs open. Everything else falls
 * back to the general refusal, because `PENDING`, `OFFER_SENT` and `CANCELLED` are not
 * states any of these endpoints can be reached from by a screen that was ever correct.
 *
 * @param {string} status the value read under the lock
 * @returns {string} safe to show the user — `errorHandler` passes an operational message
 *   through unchanged
 */
export function notActiveMessage(status) {
  switch (status) {
    case 'ENDED':
    case 'RATED':
      return 'This session has already finished.';

    // The money went back and the session is closed. Telling this student their session
    // "is no longer running" is true and useless — the thing they want to know is that
    // they were refunded.
    case 'NO_SHOW':
      return 'This session was refunded.';

    default:
      return 'This session is no longer running.';
  }
}
