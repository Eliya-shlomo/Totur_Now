import { getQuestionMatches } from '#services/matching.service.js';

/**
 * Matching — which teachers this student is shown, and in what order.
 * DEV-A's half of E4 (docs/epics/E4-matching/README.md → "The split").
 *
 * **Written as a stub in PR 4.1 and filled in by 4.5, which owns this file.** It was
 * created in the blocking PR so that 4.5 replaced one function body and never opened
 * the frozen router: a controller created by the PR that fills it in is a controller
 * the router had to be edited to reach. 2.1 and 3.1 both made this call, and 4.5's
 * diff touches no file 4.1 froze.
 *
 * DEV-B ships no controller in this epic, so both this file and the validator beside
 * it are DEV-A's. That is not an oversight in the split — DEV-B's server work is a
 * pure function and a cached aggregate, and both sit below the controller layer.
 *
 * The handler calls one service function and writes the envelope, nothing else
 * (`CONVENTIONS.md` → Server layering). It imports no database client, and the
 * service it calls takes no `req`.
 */

/**
 * `GET /questions/:id/matches?priceBand=A|B|C` — 200 `MatchesResponse`.
 *
 * `matching.service.js` does six things, in this order:
 *
 *   1. `findQuestionForMatching(id)`; missing, or another student's, is `NOT_FOUND`
 *      and never `FORBIDDEN` — `FORBIDDEN` would confirm the id exists (3.5's rule)
 *   2. session not `PENDING` → `SESSION_NOT_ACTIVE`, 409. Once an offer is out, a
 *      fresh list is a way to double-book a student
 *   3. `findWalletBalance`, then the ceilings and the pool (4.2's candidates service)
 *   4. `getPlatformAverages()` (4.3) and `findPositiveHistoryTeacherIds(studentId)`
 *   5. `rankCandidates(candidates, averages)`, then the first `MATCH_COUNT`
 *   6. serialize through `#utils/matchView.js` — **`score` is dropped there and
 *      reaches no payload** (§14.2: the student sees an order, not grades)
 *
 * **Both empty pools are 200 with a `reason`, never a thrown error.**
 * `NO_AVAILABLE_TEACHERS` is in `shared/errorCodes.js` and this endpoint never
 * throws it, exactly as E3 never threw `LLM_FAILED`: §9.4's own pseudocode returns a
 * reason, an empty list is a state every list in this codebase already renders, and a
 * 409 would show an error for the product working as designed.
 *
 * Every argument below comes from somewhere the client cannot forge or invent.
 * `req.user.id` is the token's, never a body's — `matchesSchema` is `.strict()` and
 * an empty body could not carry one anyway. `req.query.priceBand` is `undefined` when
 * the student has not touched the filter, and that is the value `bandCeiling` already
 * answers `MAX_PRICE_PER_BLOCK` for, so absent means no ceiling with no default
 * written here.
 */
export async function getMatches(req, res) {
  const matches = await getQuestionMatches({
    questionId: req.params.id,
    studentId: req.user.id,
    priceBand: req.query.priceBand,
  });

  res.json({ success: true, data: matches });
}
