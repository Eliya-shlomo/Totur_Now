import { z } from 'zod';

import { MATH_LEVELS, UNCLASSIFIED_TOPIC_ID } from '#config/constants/index.js';

/**
 * Zod schemas for the classification surface — `GET /questions/:id` and
 * `PATCH /questions/:id/classification`.
 *
 * **Filled in by PR 3.5 (DEV-B), which owns this file.** `question.routes.js` is
 * frozen after this PR and already imports both names — the bodies below changed in
 * this PR, the two exported names did not.
 *
 * The override body is the contract freeze's `ClassificationOverrideRequest` and
 * §7/§9.2:
 *
 *   topicId        required, integer ≥ UNCLASSIFIED_TOPIC_ID — the sentinel is a legal answer
 *   subtopicId     required, nullable — `null` is the student saying "none of these"
 *   estimatedLevel optional, one of MATH_LEVELS
 *
 * Both ids are sent together and neither is optional. §9.2 scores the leaf at 1.0 and
 * the parent at 0.3, so a subtopic arriving without its parent would hand the
 * matching engine half a row. That the pair actually exists in `topics`, and that the
 * leaf really is a child of the parent, is a database question and belongs in
 * `question.classify.service.js` — a schema can only check that two numbers arrived.
 */

/**
 * `GET /questions/:id`, and the `:id` half of the `PATCH` below.
 *
 * The id is a `uuid` because `questions.id` is `@db.Uuid`, and Postgres raises
 * `22P02` on a malformed one rather than returning no rows. Caught here, a typo is a
 * `VALIDATION_ERROR` naming the parameter; uncaught, it is an exception that surfaces
 * as a 500 for what is plainly a bad request. `GET /teachers/:id` carries the same
 * schema for the same reason (PR 2.1).
 */
export const questionByIdSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({ id: z.string().uuid('That is not a valid question id.') }).strict(),
  query: z.object({}).strict(),
});

/**
 * `PATCH /questions/:id/classification` — the student correcting the model (§8.1).
 *
 * `.strict()` on all three halves, the posture every validator in this codebase
 * keeps: an unknown key is a client that believes it is sending something this
 * endpoint reads, and a `200` is how that typo survives to production. An empty body
 * fails here too — `topicId` and `subtopicId` are both required, so `{}` is a
 * `VALIDATION_ERROR` rather than an update that writes nothing.
 */
export const classificationOverrideSchema = z.object({
  body: z
    .object({
      /**
       * The parent. `UNCLASSIFIED_TOPIC_ID` is legal and is what "none of these"
       * writes — §8.1's fallback already stores exactly that pair, so refusing it
       * would make the student unable to restate what the machine had said.
       *
       * The floor is the sentinel rather than `1` because the sentinel *is* the
       * lowest legal id; that the number names a row, and the right kind of row, is
       * checked against the taxonomy in the service.
       */
      topicId: z
        .number({ required_error: 'Pick a topic.' })
        .int('That is not a valid topic id.')
        .min(UNCLASSIFIED_TOPIC_ID, 'That is not a valid topic id.'),

      /**
       * The leaf, or `null`. Required and nullable are different things here: the
       * client always sends the key, and its value is either a leaf the student
       * picked or an explicit "none of these". `.optional()` would make a client that
       * forgot the field indistinguishable from one that meant null.
       *
       * `0` is accepted as a second spelling of that same null — `api.d.ts` documents
       * the field as "leaf topic id, or `0` to say none of these" while typing it
       * nullable, and a client written against the comment must not get a validation
       * error for it. Normalised here, once, so the service sees one shape.
       */
      subtopicId: z
        .number({ required_error: 'Send a subtopic, or null.' })
        .int('That is not a valid subtopic id.')
        .min(UNCLASSIFIED_TOPIC_ID, 'That is not a valid subtopic id.')
        .nullable()
        .transform((value) => (value === UNCLASSIFIED_TOPIC_ID ? null : value)),

      /**
       * Optional, and the same closed set the student's declaration uses —
       * `MATH_LEVELS` from `constants/user.js`, never a range written here. Absent
       * means the student did not touch the level, and the column keeps whatever the
       * model estimated.
       */
      estimatedLevel: z
        .number()
        .int()
        .refine((value) => MATH_LEVELS.includes(value), {
          message: `Level must be one of ${MATH_LEVELS.join(', ')}.`,
        })
        .optional(),
    })
    .strict(),
  params: z.object({ id: z.string().uuid('That is not a valid question id.') }).strict(),
  query: z.object({}).strict(),
});
