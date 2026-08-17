import { api } from '@/api/client';

/**
 * The match list — `GET /questions/:id/matches` (PR 4.5, MVP.md §12). Read by the
 * selection screen and by nothing else.
 *
 * One module per server domain, and screens call this rather than `api` directly
 * (CONVENTIONS.md → Client). The interceptor in `client.js` already unwraps
 * `{ success, data }`, so the function resolves to the payload itself and rejects
 * with an `ApiError`. No `try` block here: the screen decides what a failure looks
 * like, and swallowing it would take that decision away.
 *
 * **No timeout override, and `client.js` is not opened.** Matching is a database
 * query — the 15-second instance default is right, unlike `POST /questions`, which
 * runs a model inside the request and sets its own budget in 3.6.
 */

/**
 * The ranked pool for one question, at most `MATCH_COUNT` teachers, best first.
 *
 * **An empty list is a 200 with a `reason`, not a rejection.** `INSUFFICIENT_CREDIT`
 * and `NO_AVAILABLE_TEACHERS` are values on the payload (§9.4), so both arrive here
 * as a resolved promise and are two branches on the screen rather than two catches.
 * Only `NOT_FOUND` (someone else's question, or none) and `SESSION_NOT_ACTIVE` (409,
 * an offer is already out) reject.
 *
 * `priceBand` is dropped by axios when it is undefined rather than sent as
 * `?priceBand=undefined`, which matters because `matchesSchema` is strict and would
 * refuse the string. Absent means no band ceiling — the wallet still caps it.
 *
 * Re-callable on purpose: §12's "show me more teachers" is this same request run
 * again, because teachers go online and offline and from E5 on the pool shrinks as
 * offers are rejected. There is no offset and no page two.
 *
 * @param {string} id  the question's uuid
 * @param {object} [params]
 * @param {'A'|'B'|'C'} [params.priceBand]  a ceiling, not a bracket — MVP.md §5.2
 * @returns {Promise<import('@tutor/shared').MatchesResponse>}
 */
export function getMatches(id, params = {}) {
  return api.get(`/questions/${id}/matches`, { params });
}
