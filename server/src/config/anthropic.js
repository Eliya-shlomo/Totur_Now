import Anthropic from '@anthropic-ai/sdk';

import { LLM_TIMEOUT_MS } from '#config/constants/index.js';
import { env } from '#config/env.js';

/**
 * The one configured Anthropic SDK in the process. PR 3.3, MVP.md §8.1.
 *
 * Same rule as `config/db.js` and `config/cloudinary.js`: exactly one file may import
 * this one — `services/classification.service.js`, which classifies, and nothing else.
 * A controller or a repository reaching for the LLM is a failed review, and the
 * acceptance criteria check it (`grep -rn "@anthropic-ai/sdk" server/src` matches this
 * file alone). The reason is not tidiness: this project has exactly one LLM call
 * (§6.1 cut the other one), and the day the model, the vendor or the auth story
 * changes, the search for "everything that talks to the LLM" has to return one file.
 *
 * `ANTHROPIC_API_KEY` is `optional()` in `config/env.js` and `requiredInProduction` —
 * a developer without a key still boots the server and still runs every test, because
 * no test here touches the network. `isAnthropicConfigured` is what turns that
 * looseness into an answer the classifier can act on.
 */

/**
 * Whether this process can classify at all.
 *
 * Checked before the call rather than discovered inside the SDK. The SDK does *not*
 * throw on a missing key — it constructs happily with `apiKey: null` and fails later,
 * at request time, with a 401 after a network round trip. On this path that round trip
 * is pure cost: §8.1's answer to "no key" is the fallback, and the student is waiting.
 * So the guard is ours, deliberately, and it is why `anthropicClient` below is `null`
 * rather than a client that can only ever 401.
 */
export const isAnthropicConfigured = Boolean(env.ANTHROPIC_API_KEY);

/**
 * The client, or `null` when unconfigured. Never construct a second one.
 *
 * **`maxRetries: 0` is load-bearing, not a preference.** The SDK's default is 2, and
 * it retries *inside* the call — which means one 8-second budget can quietly become
 * three, and `LLM_TIMEOUT_MS` would bound a single attempt while the student waits for
 * all of them. §8.1's timeout is a promise about wall-clock, so retries are off here
 * and the timeout is enforced twice in the service (per-request option **and** a race).
 * A failed call is a fallback, not something to try again with the student watching.
 *
 * `timeout` is set on the client as well as per request. It is milliseconds in this
 * SDK — the same unit `LLM_TIMEOUT_MS` is written in, which is worth stating because
 * the Python SDK takes seconds and the two get copied between each other.
 */
export const anthropicClient = isAnthropicConfigured
  ? new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      maxRetries: 0,
      timeout: LLM_TIMEOUT_MS,
    })
  : null;
