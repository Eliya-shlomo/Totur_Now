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

// ── the call itself (PR 3.3) ─────────────────────────────────────────────────

/**
 * The model classification runs on.
 *
 * **This is a latency decision, and it is the human's to change.** §8.1 sets a hard
 * 8-second budget above, and §4.1 promises the student "2–4 seconds" — which rules
 * out a reasoning-heavy configuration on this path, whatever it would do for
 * accuracy. Haiku 4.5 is the fastest current model, it supports vision (the student's
 * question is usually the photograph), and it supports the structured outputs this
 * epic validates against.
 *
 * If 3.8's verification shows classification *accuracy* is the problem rather than
 * latency, `claude-sonnet-5` is the next step up: one constant, no other change. Do
 * that here rather than in a service file, so the reason travels with the value.
 */
export const LLM_MODEL = 'claude-haiku-4-5';

/**
 * Ceiling on what one classification may write back.
 *
 * The answer is a title, a two-sentence brief and one sentence for the student —
 * generous at this size, and generous is the point: a cap that truncates mid-JSON
 * turns a good classification into a parse failure and a fallback. It is a latency
 * bound as much as a cost one, because output tokens are what the student waits for.
 */
export const LLM_MAX_OUTPUT_TOKENS = 1024;

/**
 * Images per classification call — **the same three the student may upload.**
 *
 * Re-exported rather than declared, exactly as `constants/question.js` re-exports
 * `UNCLASSIFIED_TOPIC_ID` and for the same reason: `MAX_ATTACHMENTS` is already this
 * number, and the two can never legitimately differ — an image the student uploaded
 * but the prompt dropped is an image the classifier was blamed for not seeing. One
 * binding under two names keeps the barrel's `export *` conflict-free and leaves
 * exactly one `3` in the codebase.
 *
 * The *input text* bound is not restated here either: the prompt is fed whatever
 * `POST /questions` accepted, which `RAW_TEXT_MAX_LENGTH` already bounds at the
 * validator.
 */
export { MAX_ATTACHMENTS as MAX_IMAGES } from './question.js';
