import {
  LLM_MAX_OUTPUT_TOKENS,
  LLM_MODEL,
  LLM_THINKING_LEVEL,
  LLM_TIMEOUT_MS,
  MIN_CONFIDENCE,
  UNCLASSIFIED_TOPIC_ID,
} from '#config/constants/index.js';
import { geminiClient, isGeminiConfigured } from '#config/gemini.js';
import { buildMessages, isPromptReady } from '#services/llm.prompt.js';
import { getTopicTree } from '#services/topic.service.js';
import { logger } from '#utils/logger.js';
import {
  CLASSIFICATION_OUTPUT_SCHEMA,
  classificationSchema,
} from '#validators/classification.schema.js';

/**
 * What a question is about. MVP.md §8.1, and the seam between E3's two tracks
 * (docs/epics/E3-question-intake/README.md → "The internal seam").
 *
 * One exported function, frozen before either track started:
 *
 *   classifyQuestion({ rawText, imageUrls, declaredLevel }) -> Promise<Classification>
 *
 * PR 3.1 shipped this file as the fallback body alone so that 3.4 could be built and
 * merged against a real signature. **PR 3.3 put the LLM call in front of it and kept
 * everything below as the `catch`** — the §8.1 path that runs when the model fails,
 * times out or comes back under the confidence floor. 3.4's diff did not change when
 * this landed; the same function simply started returning real topics.
 *
 * The vendor is Gemini (`config/gemini.js`), which is a deviation from the epic's
 * documented choice of Anthropic and is recorded in the README's deviations table. It
 * reached this file as a different request shape and nothing else: the contract, the
 * validation, the taxonomy check, the timeout and the fallback are all vendor-agnostic,
 * which is the payoff for `classifyQuestion` having been frozen before either existed.
 *
 * Four properties this file has and must keep:
 *
 * **It never throws and never returns null.** Every input resolves to a
 * `Classification`, including an empty text, a 10k-character one and twenty images.
 * "Classification never blocks matching" is only true if the caller has nothing to
 * catch — `POST /questions` answers 201 on this path exactly as on the happy one, and
 * the caller commits the student's question *before* calling here, so an exception
 * would strand a row. That is an acceptance criterion, not a style preference: there
 * is exactly one `try` below and it wraps everything, including the taxonomy read.
 *
 * **It knows no database.** No client import, no repository import, no `questions`
 * table. `getTopicTree()` is E1's service and is called, not reimplemented; the row
 * this classification describes is written by whoever called us.
 *
 * **It reads no request.** No request or response object reaches here — this is a
 * service (CONVENTIONS.md → Server layering), and the timeout lives here rather than in
 * a controller for the same reason.
 *
 * **It logs no student text.** The raw text is a person's homework. Fallback log lines
 * carry a reason, an elapsed time and a word count — the numbers 3.8's retro counts —
 * and never the words themselves, at any level. Errors are logged by `message` only,
 * because an SDK error object carries the request that produced it, and that request
 * carries the API key.
 */

/**
 * The real collaborators, replaced wholesale in tests.
 *
 * `classifyQuestion`'s public signature is the frozen one-argument seam; `deps` is a
 * second, optional argument that no caller passes and every test does. It exists
 * because the five failure modes §8.1 cares about — a throw, a timeout, a parse
 * failure, a schema failure, an id the taxonomy does not have — are unreachable from a
 * unit test otherwise, and `node --test`'s module mocking needs a flag on the root
 * `npm test` script that this PR is not allowed to touch.
 *
 * A test that overrides `createMessage` and forgets `loadTaxonomy` reaches the real
 * repository and fails on a missing database — which still produces the fallback, and
 * would pass for the wrong reason. `server/tests/classification.test.js` injects both,
 * every time.
 */
const defaultDeps = {
  loadTaxonomy: getTopicTree,
  createMessage: (params, options) => geminiClient.interactions.create(params, options),
  timeoutMs: LLM_TIMEOUT_MS,
  // The two guards are injected rather than read directly, and for the same reason:
  // both short-circuit before the schema, the taxonomy and the confidence floor, so a
  // test that could not override them would pass without ever reaching the code it
  // names. `promptReady` would otherwise change meaning on the commit that writes the
  // prose, and `configured` would depend on whether the developer running `npm test`
  // happens to have a key in their `.env` — a suite whose result varies by machine.
  // Injecting them also makes the two guards testable in their own right.
  promptReady: isPromptReady,
  configured: isGeminiConfigured,
};

/**
 * Classify one question.
 *
 * `imageUrls` are Cloudinary URLs from `POST /questions/attachments`, uploaded before
 * the question row existed — which is why the upload endpoint comes first in the epic
 * and why an image bound after creation would be one the model never saw.
 *
 * `declaredLevel` is the student's claim (3, 4 or 5) or null. It is an input here and
 * is never the answer: `estimatedLevel` in the return value is the model's own
 * judgement, and §9.1 matches on that one.
 *
 * @param {object} input
 * @param {string} input.rawText          what the student typed
 * @param {string[]} [input.imageUrls]    stored image URLs, may be empty
 * @param {number|null} [input.declaredLevel]  3 | 4 | 5, or null
 * @param {object} [deps]                 test seam only — see `defaultDeps`
 * @returns {Promise<import('@tutor/shared').Classification>} never rejects, never null
 */
export async function classifyQuestion(input = {}, deps = {}) {
  const { rawText, imageUrls = [], declaredLevel = null } = input ?? {};
  const { loadTaxonomy, createMessage, timeoutMs, promptReady, configured } = {
    ...defaultDeps,
    ...deps,
  };
  const startedAt = Date.now();

  /** One exit for every way this can fail, so every failure is counted the same way. */
  const fallback = (reason) => {
    logger.warn('Classification fell back', {
      reason,
      elapsedMs: Date.now() - startedAt,
      // The shape of the input, never the input. A word count tells 3.8 whether the
      // fallbacks cluster on short questions; the words would tell it someone's homework.
      wordCount: countWords(rawText),
      imageCount: Array.isArray(imageUrls) ? imageUrls.length : 0,
    });

    return fallbackClassification(rawText);
  };

  try {
    if (!configured) return fallback('GEMINI_API_KEY is not configured');
    if (!promptReady) return fallback('llm.prompt.js still holds its placeholder');

    const topicTree = await loadTaxonomy();
    const { systemInstruction, input } = buildMessages({
      rawText,
      imageUrls,
      declaredLevel,
      topicTree,
    });

    const response = await callWithTimeout(
      createMessage,
      {
        model: LLM_MODEL,
        system_instruction: systemInstruction,
        input,
        // The §8.1 guardrail, in the form this API actually has.
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: CLASSIFICATION_OUTPUT_SCHEMA,
        },
        generation_config: {
          max_output_tokens: LLM_MAX_OUTPUT_TOKENS,
          thinking_level: LLM_THINKING_LEVEL,
        },
      },
      timeoutMs,
    );

    const parsed = classificationSchema.safeParse(readJson(response));

    if (!parsed.success) return fallback('the response did not match the schema');

    const answer = parsed.data;

    if (!isKnownPair(answer, topicTree)) return fallback('the ids are not in the taxonomy');
    if (answer.confidence < MIN_CONFIDENCE) return fallback('confidence below the floor');

    return {
      title: answer.title,
      topicId: answer.topic_id,
      subtopicId: answer.subtopic_id,
      difficulty: answer.difficulty,
      estimatedLevel: answer.estimated_level,
      teacherBrief: answer.teacher_brief,
      studentConfirmation: answer.student_confirmation,
      confidence: answer.confidence,
      classificationOk: true,
    };
  } catch (error) {
    // Everything lands here: a refused request, a dead database, a timeout, malformed
    // JSON, and whatever the next SDK version invents. `message` only — see the header.
    return fallback(error?.message ?? 'unknown error');
  }
}

/**
 * The call, bounded twice.
 *
 * `LLM_TIMEOUT_MS` is passed to the SDK **and** raced against a timer, which is not
 * belt-and-braces for its own sake: a per-request timeout bounds one attempt, and an
 * SDK that retries internally would spend that budget once per attempt while the
 * student waits for all of them. `maxRetries: 0` says the same thing to the client and
 * the race is what holds if either ever changes underneath us.
 *
 * The signal is what makes losing the race free. Without it the request the race
 * abandoned keeps running to completion — billed, and holding a socket open — so the
 * timeout would protect the student's latency and nothing else. It rides in
 * `fetchOptions` because that is where this SDK forwards options to `fetch`.
 *
 * The timer is cleared in `finally` rather than left to fire. An unreferenced 8-second
 * timer keeps the event loop alive, which is invisible in a server that never exits and
 * very visible in a test run that hangs after the last assertion passes.
 */
async function callWithTimeout(createMessage, params, timeoutMs) {
  const controller = new AbortController();
  let timer;

  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`classification timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      createMessage(params, {
        timeout: timeoutMs,
        maxRetries: 0,
        fetchOptions: { signal: controller.signal },
      }),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The model's JSON, out of the response envelope.
 *
 * Structured outputs guarantee the text parses; this still throws rather than checks,
 * because "the vendor promised" is not a thing to build a database write on, and the
 * one `catch` above turns any throw here into the fallback. `output_text` is optional
 * in the SDK's own types — a refusal or a stopped generation leaves it undefined — so
 * the type check is the real guard rather than defensive noise.
 */
function readJson(response) {
  const text = response?.output_text;

  if (typeof text !== 'string') throw new Error('the response carried no output text');

  return JSON.parse(text);
}

/**
 * Is this pair of ids actually in `topics`, and is the parent really the parent?
 *
 * The check §8.1's schema cannot make. A model that satisfies a JSON schema can still
 * answer a `subtopic_id` that no row has — and an id the taxonomy does not have is a
 * failed classification, not a foreign-key error forty milliseconds later inside
 * DEV-A's transaction. E2 shipped three contracts that disagreed with each other and
 * found all three during verification; this is the same class of defect, caught at the
 * boundary that owns it.
 *
 * The seeded "General / Unclassified" sentinel is rejected here for free and without
 * being named: it is a childless root, so it is nobody's parent, so no leaf resolves to
 * it. A model that answers "unclassified" has failed to classify, and failing to
 * classify is the fallback's job — which keeps `classificationOk: false` meaning one
 * thing rather than two.
 */
function isKnownPair({ topic_id: topicId, subtopic_id: subtopicId }, topicTree) {
  for (const topic of topicTree ?? []) {
    for (const child of topic.children ?? []) {
      if (child.id === subtopicId) return topic.id === topicId;
    }
  }

  return false;
}

/** Whitespace-separated words. Used for a log field and nothing else. */
function countWords(rawText) {
  return String(rawText ?? '')
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * The §8.1 fallback: the flow continues, the question is filed under the sentinel
 * topic, and the student is asked on the confirmation screen instead of told.
 *
 * `topicId` is the seeded "General / Unclassified" row and the one id this codebase
 * knows in advance (CONVENTIONS.md). `subtopicId` stays null rather than pointing at
 * the sentinel's children, because §9.2 scores a leaf at 1.0 — a wrong leaf is worse
 * for matching than no leaf.
 *
 * `teacherBrief` and `studentConfirmation` are both the student's own words. There is
 * no generated sentence to fall back to, and inventing one server-side would be
 * product copy in a service file; 3.7's screen reads `classificationOk: false` and
 * asks its own question around the text. `String(...)` rather than the value itself
 * because this function's whole contract is that a catastrophic input still answers:
 * an undefined `rawText` must produce a string, not a crash two layers up.
 *
 * `confidence: 0` and `classificationOk: false` are what 3.8's retro counts. Neither
 * is an error — nothing in this epic ever throws `LLM_FAILED`.
 *
 * @param {string} rawText
 * @returns {import('@tutor/shared').Classification}
 */
function fallbackClassification(rawText) {
  const text = String(rawText ?? '');

  return {
    title: null,
    topicId: UNCLASSIFIED_TOPIC_ID,
    subtopicId: null,
    difficulty: null,
    estimatedLevel: null,
    teacherBrief: text,
    studentConfirmation: text,
    confidence: 0,
    classificationOk: false,
  };
}
