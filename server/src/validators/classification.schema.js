import { z } from 'zod';

import {
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  MATH_LEVELS,
  TITLE_MAX_LENGTH,
} from '#config/constants/index.js';

/**
 * The shape of the model's answer. PR 3.3, MVP.md §8.1.
 *
 * Two artifacts describing one object, and they are not redundant:
 *
 * **`CLASSIFICATION_OUTPUT_SCHEMA`** goes to Anthropic as `output_config.format` and
 * constrains what the model is *able* to emit. §8.1 writes `response_format:
 * json_object`, which is not a parameter this API has; this is the guardrail that line
 * was asking for. It stops the failure mode prose parsing has — a model that answers
 * with a paragraph, or with JSON wrapped in a code fence.
 *
 * **`classificationSchema`** re-checks the same object on our side, after it arrives.
 * A vendor-side guarantee we cannot inspect is not a guarantee we can build a
 * transaction on, and it cannot express half of what we need anyway (see the
 * constraints note below). Belt and braces, for one call, once per question.
 *
 * Neither layer can check that `subtopic_id` is a row in `topics` — that is a question
 * about our database, and `classification.service.js` answers it against
 * `getTopicTree()` before trusting any id. E2 shipped three contracts that disagreed
 * with each other; an id that validates here and fails a foreign key forty
 * milliseconds later in DEV-A's transaction is the same defect, moved.
 *
 * **No field descriptions live in this file.** What `teacher_brief` should *say* is
 * prompt text, it is human-written (`MVP.md` §17.5), and it belongs in
 * `services/llm.prompt.js` with the rest of the instructions. This file describes the
 * container, not the content.
 */

/** `[1, 2, 3, 4, 5]` — §8.1's difficulty, from its bounds rather than retyped. */
const DIFFICULTY_VALUES = Array.from(
  { length: DIFFICULTY_MAX - DIFFICULTY_MIN + 1 },
  (_, offset) => DIFFICULTY_MIN + offset,
);

/**
 * The wire schema, sent with every request.
 *
 * Three constraints of the structured-outputs feature shape this object, and each one
 * is a trap if you learn it from a 400 instead of from here:
 *
 * 1. **Numeric ranges are not supported** — no `minimum`, `maximum`, `multipleOf`. So
 *    `difficulty` and `estimated_level` are enums built from the constants, and
 *    `confidence` (0–1) is a bare number here and bounded in Zod below.
 * 2. **String lengths are not supported** — no `maxLength`, so `TITLE_MAX_LENGTH` is
 *    enforced in Zod only. It is a column width (`questions.title` is VARCHAR(160)),
 *    so something has to enforce it before the row is written.
 * 3. **Every object needs `additionalProperties: false` and a complete `required`.**
 *    Hence `required` is derived from the property names rather than listed twice.
 *
 * Nothing is nullable. A model that cannot decide does not answer `null` — it answers
 * with a low `confidence`, and the service turns that into the §8.1 fallback. One way
 * to say "I could not classify this", not two.
 */
const CLASSIFICATION_PROPERTIES = {
  title: { type: 'string' },
  topic_id: { type: 'integer' },
  subtopic_id: { type: 'integer' },
  difficulty: { type: 'integer', enum: DIFFICULTY_VALUES },
  estimated_level: { type: 'integer', enum: [...MATH_LEVELS] },
  teacher_brief: { type: 'string' },
  student_confirmation: { type: 'string' },
  confidence: { type: 'number' },
};

export const CLASSIFICATION_OUTPUT_SCHEMA = {
  type: 'object',
  properties: CLASSIFICATION_PROPERTIES,
  required: Object.keys(CLASSIFICATION_PROPERTIES),
  additionalProperties: false,
};

/** A closed set of numbers, without pretending Zod's literal unions read well. */
const oneOf = (values) =>
  z
    .number()
    .int()
    .refine((value) => values.includes(value));

/**
 * The same object, re-validated after it arrives.
 *
 * `.strict()` rather than stripping: an unknown key means the model answered a schema
 * that is not the one we sent, and quietly dropping it would hide exactly the drift
 * this layer exists to catch.
 *
 * The strings are trimmed and required non-empty. A `teacher_brief` of `"   "`
 * satisfies `type: string` on the wire and is a failed classification here — a teacher
 * opening a blank brief is worse than the fallback, which at least shows the student's
 * own words.
 */
export const classificationSchema = z
  .object({
    title: z.string().trim().min(1).max(TITLE_MAX_LENGTH),
    topic_id: z.number().int().nonnegative(),
    subtopic_id: z.number().int().nonnegative(),
    difficulty: oneOf(DIFFICULTY_VALUES),
    estimated_level: oneOf(MATH_LEVELS),
    teacher_brief: z.string().trim().min(1),
    student_confirmation: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();
