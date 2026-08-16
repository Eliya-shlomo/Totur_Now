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
 * accuracy. The `-lite` Flash tier is the fastest Gemini generation available, it
 * supports vision (the student's question is usually the photograph), and it supports
 * the structured outputs this epic validates against.
 *
 * If 3.8's verification shows classification *accuracy* is the problem rather than
 * latency, `gemini-3.7-flash` is the next step up: one constant, no other change. Do
 * that here rather than in a service file, so the reason travels with the value.
 *
 * **The vendor is Gemini, not Anthropic, and that is a deviation from the epic.** The
 * README's deviations table and this file's history both named `claude-haiku-4-5` on
 * the reasoning above, which still holds — what changed is which account has credit.
 * The seam is what made the swap cheap: `classifyQuestion`'s contract, the Zod layer,
 * the taxonomy check and the fallback are all vendor-agnostic, so the change reached
 * this constant, the client, the request shape and nothing else.
 */
export const LLM_MODEL = 'gemini-3.5-flash-lite';

/**
 * How much the model may deliberate before answering.
 *
 * Gemini 3.x thinks by default, which is the same latency trap the model choice above
 * avoids: §4.1 promised 2–4 seconds, and a classification is a lookup against a closed
 * list of 43 subtopics rather than a problem to solve. `minimal` is the cheaper step
 * down and `medium` the accuracy step up — both are one word, here, with the budget
 * they have to fit in written directly above them.
 */
export const LLM_THINKING_LEVEL = 'low';

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
