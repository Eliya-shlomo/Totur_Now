import { z } from 'zod';

import {
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  HOW_TO_START_MAX_LENGTH,
  MATH_LEVELS,
  TITLE_MAX_LENGTH,
} from '#config/constants/index.js';

/**
 * The shape of the model's answer. PR 3.3, MVP.md §8.1.
 *
 * Two artifacts describing one object, and they are not redundant:
 *
 * **`CLASSIFICATION_OUTPUT_SCHEMA`** goes to Gemini as `response_format.schema` and
 * constrains what the model is *able* to emit. §8.1 writes `response_format:
 * json_object`; this is the schema-shaped version of that guardrail, and it stops the
 * failure mode prose parsing has — a model that answers with a paragraph, or with JSON
 * wrapped in a code fence.
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
 * Gemini's structured output accepts a subset of JSON Schema, and the subset is the
 * thing to know before you learn it from a 400: `properties`, `required`,
 * `additionalProperties`, `enum` (on strings *and* integers), and `minimum`/`maximum`
 * on numbers are in; string lengths are not. So:
 *
 * - `difficulty` and `estimated_level` are enums generated from the constants,
 * - `confidence` carries its 0–1 range here **and** in Zod,
 * - `TITLE_MAX_LENGTH` is enforced in Zod alone. It is a column width
 *   (`questions.title` is VARCHAR(160)), so something has to hold it before the row is
 *   written, and the wire schema cannot,
 * - `HOW_TO_START_MAX_LENGTH` likewise, and for the opposite reason: that column is
 *   unbounded text, and the bound exists to catch an answer that solved the exercise
 *   instead of opening it. Same missing feature in the subset, different motive.
 *
 * `required` is derived from the property names rather than listed twice.
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
  how_to_start: { type: 'string' },
  student_confirmation: { type: 'string' },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
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
 *
 * `how_to_start` is required here and non-nullable on the wire, like everything else:
 * a model with no opening move to offer answers with a low `confidence` and the
 * service turns that into the §8.1 fallback, where the field is null. The row's column
 * is nullable because the fallback writes null into it; the *answer* never may be.
 */
export const classificationSchema = z
  .object({
    title: z.string().trim().min(1).max(TITLE_MAX_LENGTH),
    topic_id: z.number().int().nonnegative(),
    subtopic_id: z.number().int().nonnegative(),
    difficulty: oneOf(DIFFICULTY_VALUES),
    estimated_level: oneOf(MATH_LEVELS),
    teacher_brief: z.string().trim().min(1),
    how_to_start: z.string().trim().min(1).max(HOW_TO_START_MAX_LENGTH),
    student_confirmation: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();
