import { z } from 'zod';

import {
  MATH_LEVELS,
  MAX_ATTACHMENTS,
  RAW_TEXT_MAX_LENGTH,
  RAW_TEXT_MIN_LENGTH,
} from '#config/constants/index.js';

/**
 * Zod schema for the capture surface — `POST /questions`. PR 3.4, replacing 3.1's stub.
 *
 * `question.routes.js` is frozen and already imports the name below, so the export is
 * a contract the way 2.1's four were: the body changed in this PR, the name did not.
 *
 * Every bound is read from `constants/question.js` and none is written as a literal.
 * The same numbers are enforced by 3.2's Multer configuration and by 3.3's prompt, and
 * a bound retyped in any of those places is the class of defect E2 shipped three of.
 *
 * `attachmentIds` is validated for **shape** here and for **ownership** in the
 * service, through `findBindableAttachmentIds`. A uuid that parses is not a uuid the
 * caller may attach, and a schema cannot know the difference.
 *
 * **`POST /questions/attachments` has no schema and is not missing one.** Its body is
 * a multipart file, not JSON: the size cap, the MIME allowlist and the field name are
 * enforced by 3.2's Multer configuration, which reads the same three constants this
 * file would have. A Zod schema in front of it would either duplicate those bounds or
 * assert nothing.
 */

/**
 * `POST /questions` — the `CreateQuestionRequest` half of the contract freeze.
 *
 * `.strict()` on all three halves, the posture E1's validators set and E2's query
 * schemas kept: an unknown key is a client that believes it is sending something this
 * endpoint reads, and a `201` is how that typo survives to production.
 */
export const createQuestionSchema = z.object({
  body: z
    .object({
      /**
       * Trimmed before it is measured, so a body of four spaces is the empty string
       * it actually is rather than a question of length 4. The trimmed value is what
       * reaches the column, and on the fallback path §8.1 copies `raw_text` into
       * `teacher_brief` — a teacher should not be reading padding.
       */
      rawText: z
        .string({ required_error: 'Write something about the question.' })
        .trim()
        .min(RAW_TEXT_MIN_LENGTH, 'Write something about the question.')
        .max(RAW_TEXT_MAX_LENGTH, `Keep it under ${RAW_TEXT_MAX_LENGTH} characters.`),

      /**
       * Optional, because §4.1's form asks for the level and does not insist. Absent
       * means the classifier guesses, which is what `estimatedLevel` answers.
       */
      declaredLevel: z
        .number()
        .int()
        .refine((value) => MATH_LEVELS.includes(value), {
          message: `Level must be one of ${MATH_LEVELS.join(', ')}.`,
        })
        .optional(),

      /**
       * Ids from `POST /questions/attachments`, uploaded before the question existed.
       *
       * `uuid()` because `question_attachments.id` is `@db.Uuid` and Postgres raises
       * `22P02` on a malformed one rather than returning no rows. Caught here, a typo
       * is a `VALIDATION_ERROR` naming the field; uncaught, it is a 500 for what is
       * plainly a bad request — the same reason `questionByIdSchema` parses `:id`.
       */
      attachmentIds: z
        .array(z.string().uuid('That is not a valid attachment id.'))
        .max(MAX_ATTACHMENTS, `At most ${MAX_ATTACHMENTS} images per question.`)
        .optional(),
    })
    .strict(),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
});
