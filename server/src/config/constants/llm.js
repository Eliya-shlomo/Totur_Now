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

/** Entrance exam bank size, generated once offline (§8.2). */
export const ENTRANCE_BANK_SIZE = 40;

/** Questions per entrance attempt, and the time limit (§6.1). */
export const ENTRANCE_QUESTION_COUNT = 10;
export const ENTRANCE_TIME_LIMIT_MINUTES = 20;

/**
 * Entrance score to authorized teaching level. MVP.md §6.1 — the score sets the
 * level cap rather than passing or failing outright.
 */
export const ENTRANCE_SCORE_BANDS = [
  { minScore: 90, levelMax: 5 },
  { minScore: 80, levelMax: 4 },
  { minScore: 60, levelMax: 3 },
  { minScore: 0, levelMax: 0 }, // rejected — may retry after ENTRANCE_RETRY_DAYS
];

export const ENTRANCE_RETRY_DAYS = 30;
