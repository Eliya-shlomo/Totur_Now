import { env } from '#config/env.js';

/**
 * The two lifetimes that surround a video call. PR 6.1, `OWNERSHIP.md` §2.1.
 *
 * Carried from `dev-c/daily-video` with two changes: the TTLs were literals and are
 * now `env` with those same literals as defaults, and the provider's REST base URL
 * moved out of this file into `services/video.daily.service.js`. The URL left because
 * the rule it belongs to (`OWNERSHIP.md` §2.1, rule 2) is written as a grep for the
 * provider's hostname, and one search has to return one file — a constant sitting in
 * `config/` made it return two, which is one more than the day the provider is
 * swapped can afford.
 *
 * What is left is provider-agnostic on purpose: two durations in seconds. Nothing
 * here reads the database and nothing here calls anyone.
 */

/**
 * How long a created room survives — 24 hours.
 *
 * A safety net, not the meter: `sessions.ends_at` ends a session, Daily does not.
 * The room has to outlast any session including every extension it might buy, so
 * the number is far larger than a lesson; it exists only so that an abandoned room
 * does not live for ever on the account.
 */
export const VIDEO_ROOM_TTL_SECONDS = env.VIDEO_ROOM_TTL_SECONDS ?? 24 * 60 * 60;

/**
 * How long a minted meeting token survives — 1 hour.
 *
 * Short, because it is per-caller, it is minted again on every join, and it is the
 * only thing standing between a leaked room URL and a stranger in the lesson.
 */
export const VIDEO_TOKEN_TTL_SECONDS = env.VIDEO_TOKEN_TTL_SECONDS ?? 60 * 60;
