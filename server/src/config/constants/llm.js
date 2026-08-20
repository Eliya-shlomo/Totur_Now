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
 * **Resolved against `models.list()` on this project's key, and measured (PR 6a.1).**
 * The value below is unchanged, but it was never *verified* before: PR 3.3 wrote it,
 * and the request it rode in never reached a server, so three epics passed without
 * anything confirming the id was real. It is. What the account offers at this tier,
 * and why the rest lost:
 *
 * - `gemini-3.5-flash-lite` — chosen. Version `3.5-flash-lite-07-2026`, the newest
 *   Flash-Lite. `generateContent`, vision and structured output, measured at 1.7s
 *   wall time on a text-only classification — inside §4.1's promise, not merely
 *   inside `LLM_TIMEOUT_MS`.
 * - `gemini-3.1-flash-lite`, `gemini-2.5-flash-lite` — earlier Lites, same tier and
 *   nothing to gain from pinning an older one.
 * - `gemini-flash-lite-latest` — an alias that moves underneath us. 6a.3's bench
 *   scores *a model*; a floating id makes last month's score describe nothing.
 * - `gemini-3.5-flash`, `gemini-3.7-flash` — both real, both the non-Lite tier, and
 *   both slower. `gemini-3.7-flash` stays the accuracy step up if 6a.3's bench shows
 *   accuracy rather than latency is what fails: one constant, no other change. Do it
 *   here rather than in a service file, so the reason travels with the value.
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
 * list of 43 subtopics rather than a problem to solve. `MINIMAL` is the cheaper step
 * down and `MEDIUM` the accuracy step up — both are one word, here, with the budget
 * they have to fit in written directly above them.
 *
 * Uppercase because the SDK's `ThinkingLevel` enum is
 * (`MINIMAL | LOW | MEDIUM | HIGH`), and the string is passed straight through.
 */
export const LLM_THINKING_LEVEL = 'LOW';

/**
 * Ceiling on what one classification may write back.
 *
 * The answer is a title, a two-sentence brief and one sentence for the student —
 * generous at this size, and generous is the point: a cap that truncates mid-JSON
 * turns a good classification into a parse failure and a fallback. It is a latency
 * bound as much as a cost one, because output tokens are what the student waits for.
 *
 * Doubled in 6a.1, ahead of the field that needs it: 6a.4 adds `how_to_start` as a
 * ninth output field, and Hebrew tokenizes worse than English — the two together are
 * exactly the truncation the paragraph above argues against. Raising it here keeps
 * 6a.4 to the prose §17.5 reserves for a human.
 */
export const LLM_MAX_OUTPUT_TOKENS = 2048;

/**
 * The shortest per-request deadline Gemini will accept, in milliseconds.
 *
 * Not a knob. The API rejects `httpOptions.timeout` below this outright —
 * `400 INVALID_ARGUMENT: Manually set deadline 8s is too short. Minimum allowed
 * deadline is 10s` — which means `LLM_TIMEOUT_MS` cannot be handed to the vendor as
 * written, and a request that tried would fail every classification before a token
 * was generated. `callWithTimeout` clamps to this floor and lets the race enforce
 * §8.1's actual 8-second bound; see the double-bound comment there for why both exist.
 */
export const GEMINI_MIN_DEADLINE_MS = 10000;

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
