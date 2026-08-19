import { ERROR_CODES } from '@tutor/shared';

/**
 * Where a session sends the person looking at it, and what a refused mutation says —
 * **one table, not six catch blocks.** PR 6.8, MVP.md §15.3.
 *
 * ## The problem this file exists for
 *
 * Six endpoints throw `SESSION_NOT_ACTIVE` and 409 is right for all six, so the code
 * cannot tell them apart and `shared/errorCodes.js` is not opened to make it — a seventh
 * code would be a contract change in a frozen file for a distinction the *status* already
 * carries. What tells them apart is the pair: **the code, and the state the screen
 * re-fetched after the refusal.** An `ENDED` session finished; a `NO_SHOW` one was
 * refunded; one that comes back still `ACTIVE` was never refused for its state at all —
 * somebody else's press moved `ends_at` first.
 *
 * **Six handlers is six places for the recovery to drift**, and the drift is invisible:
 * every one of them looks right on its own, and the day two of them disagree the same
 * session reads as refunded on one screen and finished on the other. So the mapping is a
 * table, in a file with no React in it, and the screen's three `catch` blocks are one call
 * each.
 *
 * ## Two exports and they answer two halves of one question
 *
 * `destinationFor` is *where a session belongs* — it is asked on every state change, not
 * only after a failure, and `SessionRoom` routes its terminal states through it. That is
 * the point: if the error path and the ordinary path computed the destination separately,
 * a student whose end button lost a race would land somewhere a student whose socket
 * heard `session:ended` would not.
 *
 * `resolveSessionError` is *what to say*, and it takes the action because the same code
 * and the same state mean two different things depending on which button was pressed. An
 * `ENDED` session refusing **Extend** is "the session ended while you were deciding" — a
 * race against the auto-end sweep that a real person hits by pressing the button as the
 * clock runs out. The same `ENDED` refusing **End** is "this has already finished",
 * because somebody else ended it and there was no race to lose.
 *
 * **Nothing here fetches anything.** The caller re-reads the session and passes what came
 * back, so this file is pure and the screen decides when a re-read is worth doing.
 */

/** Which button was pressed. The third key of the table below. */
export const SESSION_ACTIONS = Object.freeze({
  EXTEND: 'extend',
  END: 'end',
  NO_SHOW: 'no-show',
});

/**
 * Where a session in this state belongs, or `null` for "stay in the room".
 *
 * **The one authority on this question**, called by the screen's terminal-state effect
 * and by `resolveSessionError` below, so a person who arrives at a terminal state by
 * pressing a button and a person who arrives by hearing `session:ended` land in the same
 * place.
 *
 * The rules are §10's and 6.6's, unchanged by this PR:
 *
 * - **`NO_SHOW` skips the rating entirely.** Nobody rates somebody who never arrived, the
 *   credit is already back, and the next useful thing is another teacher.
 * - **A student cannot leave an `ENDED` session without rating it.** §10 makes it
 *   mandatory and it is the only edge out of `ENDED`.
 * - **A teacher leaves as soon as it is not `ACTIVE`.** They have no rating to give and
 *   the money is settled; their next screen is the dashboard that decides whether they
 *   are available again.
 * - A student whose session is already `RATED` has nothing left to do and is not moved —
 *   the review screen owns where they go once it has been submitted.
 *
 * @param {{status: string, role: 'student'|'teacher', isRated: boolean}|null} session the
 *   payload as last read from `GET /sessions/:id` — never a guess, never a local patch
 * @param {string} sessionId
 * @returns {string|null} a route, or `null` when the room is still the right screen
 */
export function destinationFor(session, sessionId) {
  if (!session || session.status === 'ACTIVE') return null;

  if (session.status === 'NO_SHOW') return MATCH_LIST;

  if (session.role === 'student') {
    return session.status === 'ENDED' && !session.isRated
      ? `/app/session/${sessionId}/review`
      : null;
  }

  return TEACHER_HOME;
}

/**
 * What a refused mutation says, and where it leaves the person who pressed the button.
 *
 * **`message: null` means say nothing at all**, and it is the one outcome on this table
 * that is not a failure: a double-tapped **Extend** loses the conditional update on
 * `ends_at`, the server answers 409, and the block the *first* tap bought is already on
 * the row the caller just re-read. The student pressed once as far as they know. A toast
 * there would be the screen apologising for having worked.
 *
 * Everything else carries a sentence. Where the sentence comes from is the interesting
 * part:
 *
 * - **The three terminal states are worded here**, because the destination is decided
 *   here and the words have to agree with it. "This session was refunded" beside a
 *   redirect to the rating screen is two halves of one answer disagreeing.
 * - **Everything else is the server's own message, passed through.** `errorHandler`
 *   ships operational messages unchanged, and the two that matter on this screen are
 *   already specific: the no-show window closing names the end button as the remedy, and
 *   the two 402s say whether it was the balance or the cap. Restating them here would be
 *   a second wording of a rule this file does not own.
 *
 * @param {object} input
 * @param {string} input.action one of `SESSION_ACTIONS`
 * @param {{code: string, message: string, is: (code: string) => boolean}} input.failure
 *   the `ApiError` from the mutation
 * @param {object|null} input.session the session **as re-read after the failure**, not as
 *   the screen had it — the whole table turns on that being fresh
 * @param {string} input.sessionId
 * @returns {{message: string|null, destination: string|null}}
 */
export function resolveSessionError({ action, failure, session, sessionId }) {
  const destination = destinationFor(session, sessionId);

  // Every other code on this screen is about this request rather than about the session:
  // the two 402s (the balance moved, the cap refused it), a 404, a dead network. The
  // server's sentence is the specific one and the room is still the right screen.
  if (!failure?.is?.(ERROR_CODES.SESSION_NOT_ACTIVE)) {
    return { message: failure?.message ?? GENERIC, destination: null };
  }

  const wording = TERMINAL_WORDING[session?.status];

  // The session is still `ACTIVE` — or could not be re-read, which this treats the same
  // way, because a message about a state nobody could confirm is a guess. Three requests
  // reach here and only one of them is silent.
  if (!wording) {
    return {
      message: action === SESSION_ACTIONS.EXTEND ? null : (failure.message ?? GENERIC),
      destination,
    };
  }

  return { message: wording[action] ?? wording.default, destination };
}

/** 6.7's route for a student with nothing left to do on this session. */
const MATCH_LIST = '/app';

/** The teacher's dashboard, which is also where they become available again. */
const TEACHER_HOME = '/teach';

/** When the server sent nothing usable. `client.js` normally guarantees a message. */
const GENERIC = 'Something went wrong. Please try again.';

/**
 * The three terminal states, and the one place where **which button was pressed** changes
 * the sentence.
 *
 * `ENDED` under `extend` is the race the brief calls out as the one a real person
 * actually hits: the warning modal is open, the student is deciding, and the auto-end
 * sweep fires at `ends_at + GRACE_SECONDS` while they are reading it. Nothing went wrong
 * and nothing was charged — the clock simply won — and telling them the session "has
 * already finished" describes the outcome while hiding the cause.
 *
 * `RATED` has no per-action wording: whatever was pressed, there is nothing left to do.
 */
const TERMINAL_WORDING = Object.freeze({
  ENDED: {
    [SESSION_ACTIONS.EXTEND]: 'The session ended while you were deciding.',
    default: 'This session has already finished.',
  },
  RATED: { default: 'This session has already finished.' },
  NO_SHOW: { default: 'This session was refunded.' },
});
