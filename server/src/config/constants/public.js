/**
 * The public, unauthenticated surface. MVP.md §12 "Public", §18/E10.
 */

/**
 * How long a browser or CDN may reuse a public response.
 *
 * Five minutes is chosen against the cost of being wrong in each direction. Both
 * public payloads change only on a deploy — the taxonomy on a seed run, pricing
 * on an edit to `money.js` — so a stale window costs nothing but a briefly old
 * marketing page. A shorter window would buy freshness nobody can perceive and
 * spend a Render dyno on serving the same JSON to every landing-page visit.
 */
export const PUBLIC_CACHE_SECONDS = 300;
