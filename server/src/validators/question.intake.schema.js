import { z } from 'zod';

/**
 * Zod schema for the capture surface — `POST /questions`.
 *
 * **A stub. Filled in by PR 3.4 (DEV-A), which owns this file.**
 * `question.routes.js` is frozen after this PR and already imports the name below,
 * so the export is a contract the way 2.1's four were: the body changes, the name
 * does not.
 *
 * What 3.4 replaces it with, from the epic's contract freeze (`CreateQuestionRequest`)
 * — every bound read from `constants/question.js`, none of them written as a literal:
 *
 *   rawText        trimmed, RAW_TEXT_MIN_LENGTH–RAW_TEXT_MAX_LENGTH, required
 *   declaredLevel  optional, one of MATH_LEVELS (3 | 4 | 5)
 *   attachmentIds  optional, uuids, at most MAX_ATTACHMENTS
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
 * `POST /questions`. A placeholder shape, not the contract.
 *
 * `.strict()` on an empty body means every request carrying a payload fails
 * validation before reaching the stub controller. That is the honest answer while the
 * endpoint does nothing — accepting a question and then throwing `NOT_IMPLEMENTED`
 * would tell a client its payload was fine when nothing has ever read it. An empty
 * `POST` still reaches the controller and answers `NOT_IMPLEMENTED`, which is what
 * this PR's manual test checks.
 */
export const createQuestionSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
});
