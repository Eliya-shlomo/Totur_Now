import { NEUTRAL_PLATFORM_AVERAGES, PLATFORM_AVERAGES_CACHE_MS } from '#config/constants/index.js';
import { aggregatePlatformAverages } from '#repositories/matching.repository.js';

/**
 * What the average teacher on this platform looks like. MVP.md §9.3 and §9.4 — DEV-B's
 * half of E4, beside `matching.scoring.js` (docs/epics/E4-matching/README.md → "The
 * split").
 *
 * One exported value and one exported escape hatch:
 *
 *   getPlatformAverages()        -> Promise<{rating, resolveRate, acceptRate}>
 *   clearPlatformAveragesCache() -> void
 *
 * These three numbers are the prior every smoothed component in 4.6 is measured
 * against. They rank nobody by themselves — a prior is constant across candidates, so
 * it changes what a score *is* and never who is above whom on its own.
 *
 * **The sums are a query and the ratios are a decision, which is why they are in
 * different files.** `aggregatePlatformAverages()` in the frozen repository returns the
 * six sums; `sum(resolved_count) / sum(sessions_count)` is arithmetic over them, but
 * "and when nobody has ever had a session, the platform's resolve rate is 0.5" is a
 * product rule. Hiding that under a function whose name promises an aggregate would
 * leave 4.6's tests no way to reach the empty-platform branch without an empty
 * database. No new query is written here, and the repository is not opened: it already
 * has the one this file needs, written in 4.1 before either track started.
 *
 * **Every zero denominator falls back by name.** `NEUTRAL_PLATFORM_AVERAGES` from
 * `constants/matching.js`, never an inline `|| 0` — a zero prior would push every rated
 * teacher above every unrated one and look like the algorithm working. The three fall
 * back independently, because a platform that has ratings but has never sent an offer
 * is a real state on day one and its real rating should survive it.
 */

/**
 * The two real collaborators, replaced wholesale in tests.
 *
 * The idiom `classification.service.js` established in 3.3 and
 * `matching.candidates.service.js` carried into 4.2. Here it buys the two properties
 * §9.4 is actually about, and neither is observable any other way: *the second call
 * inside the window does not reach the database* is a fact about a query that did not
 * happen, and a suite running against real Postgres can see the same numbers twice
 * without ever seeing that only one statement produced them.
 *
 * `now` is injected for the same reason and not for tidiness. The window is five
 * minutes; a test that proved expiry by waiting would add five minutes to `npm test`,
 * and one that proved it by reaching into the cache would be asserting the
 * implementation rather than the behaviour.
 */
const defaultDeps = { aggregate: aggregatePlatformAverages, now: () => Date.now() };

/**
 * `{ expiresAt, pending }`, or `null`. Module-level, process-local, and deliberately
 * both — see the header on `getPlatformAverages`.
 */
let cache = null;

/**
 * The three platform averages, at most once every `PLATFORM_AVERAGES_CACHE_MS`.
 *
 * **The cache holds the promise, not the resolved value, and that is a choice.** This
 * aggregate scans every teacher on every match request — including every press of the
 * price control, which re-calls the endpoint by design — so the callers that matter
 * arrive together. A value cache is only populated once the first call has *finished*,
 * which means two concurrent cold callers each fire their own aggregate and the
 * stampede the cache exists to prevent happens exactly when the platform is busiest.
 * Caching the promise collapses them into one query and one resolution.
 *
 * **A rejected promise is evicted rather than served.** The whole point of caching a
 * promise is that later callers await the same one; without the eviction a single
 * dropped connection would be answered — as a rejection — to every match request for
 * the next five minutes. The guard is `cache === entry` so that a `clearPlatformAveragesCache()`
 * or a later refresh in between is not undone by an older call's failure.
 *
 * **Five minutes of staleness is invisible and zero would be expensive.** §9.4 sets the
 * window. A platform average moves by a few thousandths per session, and it is a
 * *prior* — its entire job is to be the number a teacher with no history is compared
 * against. What it is not is invisible during verification: a value changed in `psql`
 * does not appear until the window closes, on a server that may also have cold-started
 * and thrown the cache away. `clearPlatformAveragesCache()` below is the way out for
 * tests and for a node one-liner, and 4.8's checklist restarts the server rather than
 * waiting. There is deliberately **no query parameter and no env var** to bypass it —
 * that would be a production surface for a development problem.
 *
 * The expiry comparison is `now() < expiresAt`, so an entry stamped at exactly its
 * deadline is a miss. Stated because it is the boundary the test asserts on both sides
 * of, not because one millisecond of a five-minute window matters.
 *
 * @param {typeof defaultDeps} [deps]  test seam only — see `defaultDeps`
 * @returns {Promise<{rating: number, resolveRate: number, acceptRate: number}>}
 *   `rating` on the 1–`MAX_STARS` scale, the two rates on 0–1
 */
export async function getPlatformAverages(deps = {}) {
  const { aggregate, now } = { ...defaultDeps, ...deps };

  if (cache !== null && now() < cache.expiresAt) return cache.pending;

  const entry = {
    expiresAt: now() + PLATFORM_AVERAGES_CACHE_MS,
    pending: computeAverages(aggregate),
  };

  cache = entry;

  try {
    return await entry.pending;
  } catch (error) {
    if (cache === entry) cache = null;
    throw error;
  }
}

/**
 * Forget the cached averages, so the next call reads the database again.
 *
 * For tests and for the `node --input-type=module` one-liner in 4.3's manual test. It
 * is exported rather than reached through a bypass flag because a test that cannot
 * clear this cache cannot assert anything about it twice in one process, and the
 * alternative — a knob on the endpoint — would ship a development convenience to
 * production.
 */
export function clearPlatformAveragesCache() {
  cache = null;
}

/**
 * The six sums, divided. §9.4's table, in the order it lists them.
 *
 * Separate from the caching above so that the arithmetic is readable without the
 * bookkeeping around it, and so the cache stores one shape whatever the sums were.
 */
async function computeAverages(aggregate) {
  const sums = await aggregate();

  return {
    rating: ratio(sums.ratingSum, sums.ratingCount, NEUTRAL_PLATFORM_AVERAGES.rating),
    resolveRate: ratio(
      sums.resolvedCount,
      sums.sessionsCount,
      NEUTRAL_PLATFORM_AVERAGES.resolveRate,
    ),
    acceptRate: ratio(
      sums.offersAccepted,
      sums.offersReceived,
      NEUTRAL_PLATFORM_AVERAGES.acceptRate,
    ),
  };
}

/**
 * One ratio, or the neutral prior when there is nothing to divide by.
 *
 * `> 0` rather than `!== 0`: the six columns are `Int @default(0)` and none of them can
 * go negative, so a negative denominator is a data corruption and not a rate — and
 * `-3 / -7` is a perfectly finite number that would rank teachers against a lie. The
 * empty table reaches here as `0` and not as `null`, because the repository coalesces
 * `_sum`'s nulls itself and says so: the only question left for this file is whether a
 * denominator is zero, never also whether it exists.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @param {number} neutral  the `NEUTRAL_PLATFORM_AVERAGES` member for this ratio
 * @returns {number}
 */
function ratio(numerator, denominator, neutral) {
  return denominator > 0 ? numerator / denominator : neutral;
}
