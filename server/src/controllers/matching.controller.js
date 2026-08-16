import { AppError } from '#utils/AppError.js';

/**
 * Matching — which teachers this student is shown, and in what order.
 * DEV-A's half of E4 (docs/epics/E4-matching/README.md → "The split").
 *
 * **A stub. Filled in by PR 4.5, which owns this file.** Written here, in the
 * blocking PR, so that 4.5 replaces one function body and never opens the frozen
 * router: a controller created by the PR that fills it in is a controller the router
 * had to be edited to reach. 2.1 and 3.1 both made this call.
 *
 * DEV-B ships no controller in this epic, so both this file and the validator beside
 * it are DEV-A's. That is not an oversight in the split — DEV-B's server work is a
 * pure function and a cached aggregate, and both sit below the controller layer.
 *
 * The handler will call one service function and write the envelope, nothing else
 * (`CONVENTIONS.md` → Server layering). It imports no database client, and the
 * service it calls takes no `req`.
 */

/**
 * `GET /questions/:id/matches?priceBand=A|B|C` — 200 `MatchesResponse`.
 *
 * 4.5's service does six things, in this order:
 *
 *   1. `findQuestionForMatching(id)`; missing, or another student's, is `NOT_FOUND`
 *      and never `FORBIDDEN` — `FORBIDDEN` would confirm the id exists (3.5's rule)
 *   2. session not `PENDING` → `SESSION_NOT_ACTIVE`, 409. Once an offer is out, a
 *      fresh list is a way to double-book a student
 *   3. `findWalletBalance`, then the ceilings and the pool (4.2's candidates service)
 *   4. `getPlatformAverages()` (4.3) and `findPositiveHistoryTeacherIds(studentId)`
 *   5. `rankCandidates(candidates, averages)`, then the first `MATCH_COUNT`
 *   6. serialize through `#utils/matchView.js` — **`score` is dropped here and
 *      reaches no payload** (§14.2: the student sees an order, not grades)
 *
 * **Both empty pools are 200 with a `reason`, never a thrown error.**
 * `NO_AVAILABLE_TEACHERS` is in `shared/errorCodes.js` and this endpoint never
 * throws it, exactly as E3 never threw `LLM_FAILED`: §9.4's own pseudocode returns a
 * reason, an empty list is a state every list in this codebase already renders, and
 * a 409 would show an error for the product working as designed.
 */
export async function getMatches() {
  throw AppError.notImplemented('GET /questions/:id/matches');
}
