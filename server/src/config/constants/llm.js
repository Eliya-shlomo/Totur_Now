/**
 * LLM layer. MVP.md §8, appendix.
 *
 * The guiding rule from §8.1: classification never blocks matching. Every value
 * here exists to bound how long, and how badly, the LLM can fail before the flow
 * continues without it.
 */

/** Hard timeout on the classification call. Past this we fall back. */
export const LLM_TIMEOUT_MS = 8000;

/** Below this confidence we treat the classification as failed (§8.1). */
export const MIN_CONFIDENCE = 0.5;

// The entrance exam constants lived here until the 8/11 revision. The exam is out
// of MVP (§6.1), so classification is the only LLM call left — one prompt, one
// timeout, one fallback. See MVP.md §21 for the shape it takes if it returns.
