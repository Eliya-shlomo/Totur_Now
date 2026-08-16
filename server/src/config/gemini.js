import { GoogleGenAI } from '@google/genai';

import { env } from '#config/env.js';

/**
 * The one configured Gemini SDK in the process. PR 3.3, MVP.md §8.1.
 *
 * Same rule as `config/db.js` and `config/cloudinary.js`: exactly one file may import
 * this one — `services/classification.service.js`, which classifies, and nothing else.
 * A controller or a repository reaching for the LLM is a failed review. The reason is
 * not tidiness: this project has exactly one LLM call (§6.1 cut the other one), and the
 * day the model, the vendor or the auth story changes, the search for "everything that
 * talks to the LLM" has to return one file.
 *
 * **This file replaced `config/anthropic.js`, and the swap is the argument for the
 * rule.** The epic chose Anthropic and the README's deviations table still explains
 * why; the account with credit turned out to be the Gemini one. Because the vendor was
 * confined here and to the request shape in the service, changing it did not touch the
 * `Classification` contract, the Zod validation, the taxonomy check, the fallback, or
 * any of the callers — DEV-A's `POST /questions` never learned that any of this moved.
 *
 * `GEMINI_API_KEY` is `optional()` in `config/env.js` and `requiredInProduction` — a
 * developer without a key still boots the server and still runs every test, because no
 * test here touches the network. `isGeminiConfigured` is what turns that looseness into
 * an answer the classifier can act on.
 */

/**
 * Whether this process can classify at all.
 *
 * Checked before the call rather than discovered inside the SDK, and the reasoning is
 * the same one that applied to the Anthropic client this replaced: a client built
 * without a key does not fail until request time, and on this path that round trip is
 * pure cost. §8.1's answer to "no key" is the fallback, and the student is waiting.
 * Hence `geminiClient` is `null` when unconfigured rather than a client that can only
 * ever 401.
 */
export const isGeminiConfigured = Boolean(env.GEMINI_API_KEY);

/**
 * The client, or `null` when unconfigured. Never construct a second one.
 *
 * Deliberately bare. The timeout, the abort signal and `maxRetries: 0` are per-request
 * options in this SDK, so they live at the call site in `classification.service.js`
 * next to the race that backs them up — putting half the timeout story here and half
 * there is how the two drift apart.
 */
export const geminiClient = isGeminiConfigured
  ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY })
  : null;
