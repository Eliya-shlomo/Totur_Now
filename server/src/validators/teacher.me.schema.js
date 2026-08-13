import { z } from 'zod';

/**
 * Zod schemas for the teacher's own record — `GET` and `PATCH /teachers/me`.
 *
 * **Stubs. Filled in by PR 2.2 (DEV-B), which owns this file.** `teacher.routes.js`
 * is frozen after 2.1 and already imports both names, so the two exports are a
 * contract the way `auth.session.schema.js`'s four were in E1: the bodies change,
 * the names do not.
 *
 * `teacherMeSchema` is finished — a `GET` whose credential is the bearer token has
 * no input, today or later. `teacherUpdateSchema` is not: it currently rejects every
 * body, which is correct while the controller behind it throws `NOT_IMPLEMENTED`
 * and wrong the moment 2.2 lands.
 *
 * What 2.2 replaces it with, from the epic's contract freeze and MVP.md §5.2/§6.1 —
 * every bound read from `constants/`, none of them written as a literal:
 *
 *   bio            trimmed, max 500, `null` clears it
 *   pricePerBlock  integer within MIN_PRICE_PER_BLOCK–MAX_PRICE_PER_BLOCK
 *   levelMax       one of TEACHING_LEVELS
 *   topicIds       non-empty, leaf ids only — `findLeafTopicIds` in the repository
 *   status         OFFLINE | ONLINE only; the other two are the matching engine's
 *
 * All optional, because the stepper saves one step at a time — but an empty body is
 * a `VALIDATION_ERROR` rather than a no-op success, since it only ever means a
 * client bug.
 */

/** `GET /teachers/me`. No input; the credential is the bearer token. */
export const teacherMeSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
});

/**
 * `PATCH /teachers/me`. A placeholder shape, not the contract.
 *
 * `.strict()` on an empty body means every request fails validation before reaching
 * the stub controller. That is the honest answer while the endpoint does nothing:
 * accepting a partial and then throwing `NOT_IMPLEMENTED` would tell a client its
 * payload was fine when nothing has ever read it.
 */
export const teacherUpdateSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
});
