import { z } from 'zod';

/**
 * Zod schemas for the classification surface — `GET /questions/:id` and
 * `PATCH /questions/:id/classification`.
 *
 * **Filled in by PR 3.5 (DEV-B), which owns this file.** `question.routes.js` is
 * frozen after this PR and already imports both names.
 *
 * `questionByIdSchema` is finished — the id is the whole input and it does not grow.
 * `classificationOverrideSchema` is not: it currently rejects every body, which is
 * correct while the controller behind it throws `NOT_IMPLEMENTED` and wrong the
 * moment 3.5 lands.
 *
 * What 3.5 replaces the second one's body with, from the epic's contract freeze
 * (`ClassificationOverrideRequest`) and §7/§9.2:
 *
 *   topicId        required, integer ≥ 0 — UNCLASSIFIED_TOPIC_ID is a legal answer
 *   subtopicId     required, nullable — `null` is the student saying "none of these"
 *   estimatedLevel optional, one of MATH_LEVELS
 *
 * Both ids are sent together and neither is optional. §9.2 scores the leaf at 1.0 and
 * the parent at 0.3, so a subtopic arriving without its parent would hand the
 * matching engine half a row. That the pair actually exists in `topics`, and that the
 * leaf really is a child of the parent, is a database question and belongs in 3.5's
 * service — a schema can only check that two numbers arrived.
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
 * `PATCH /questions/:id/classification`. The params are final; the body is a
 * placeholder.
 *
 * `.strict()` on an empty body rejects every payload until 3.5 defines one, for the
 * same reason as `createQuestionSchema` — a client must not be told its override was
 * accepted by an endpoint that has never read one.
 */
export const classificationOverrideSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({ id: z.string().uuid('That is not a valid question id.') }).strict(),
  query: z.object({}).strict(),
});
