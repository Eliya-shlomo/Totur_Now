import { Router } from 'express';

import { ATTACHMENT_FIELD_NAME } from '#config/constants/index.js';
import {
  getQuestion,
  patchQuestionClassification,
} from '#controllers/question.classify.controller.js';
import { createQuestion, uploadAttachment } from '#controllers/question.intake.controller.js';
import { authenticate } from '#middlewares/authenticate.js';
import { authorize } from '#middlewares/authorize.js';
import { makeStrictLimiter } from '#middlewares/rateLimit.js';
import { upload } from '#middlewares/upload.js';
import { validate } from '#middlewares/validate.js';
import { asyncHandler } from '#utils/asyncHandler.js';
import {
  classificationOverrideSchema,
  questionByIdSchema,
} from '#validators/question.classify.schema.js';
import { createQuestionSchema } from '#validators/question.intake.schema.js';

/**
 * The four question endpoints, mounted at `/api/v1/questions`.
 *
 * **This file is frozen after PR 3.1.** Every route below is fully wired —
 * middleware, validator, controller — against controllers that currently throw
 * `NOT_IMPLEMENTED`. Filling an endpoint in means replacing a controller body and a
 * schema that exactly one developer owns, and touching nothing shared.
 *
 * The reason is E1 and it has been re-proved twice since. `auth.routes.js` was frozen
 * in 1.1 and never conflicted across two parallel PRs; `user.repository.js` was not
 * frozen, both PRs wrote to it, and the merge produced a file that would not parse —
 * `main` did not boot until somebody noticed (`3e05e3c`). E2 froze the router and the
 * repository and neither track opened them once. E3 runs two tracks over `questions`:
 * DEV-A captures (3.2, 3.4), DEV-B classifies (3.3, 3.5). Both call this router's
 * handlers; neither edits this file.
 *
 * **Every middleware a route will ever need is already on it.** A middleware added by
 * 3.2 or 3.5 is an edit to a frozen file, which is the failure this PR exists to
 * prevent — so `upload.single(...)` is here while it is still a pass-through
 * (`middlewares/upload.js`), and the rate limiter is here before anything expensive
 * runs behind it.
 *
 * **The rate limiter is on `POST /questions` and nowhere else.** It has been exported
 * and deliberately unwired since PR 0.4, and its own header comment names question
 * creation as the route it was waiting for. That route is the only one in this
 * codebase that spends money per call: classification is a Vision request to
 * Anthropic, and a logged-in student can loop it. `authorize('student')` stops a
 * stranger, not a bored one.
 *
 * **Route order is not load-bearing here, unlike `teacher.routes.js`.** There is no
 * literal path that could be captured by `/:id` — `/attachments` is declared on
 * `POST` and `/:id` only on `GET`, so the two never compete. It is declared first
 * anyway, so the file does not read as an exception to the rule next door.
 *
 * All four routes are `authorize('student')`. A teacher reads a question through the
 * offer they were matched with (E4/E5), never through this router, so there is no
 * shared-audience route here and no reason for one.
 */
export const questionRoutes = Router();

/**
 * This router's own budget for `POST /questions`, **not the shared `strictLimiter`.**
 *
 * One instance used to guard login, register and question creation at once, so the
 * three shared a counter: a few sign-ins during a test run spent the questions a
 * student was allowed to ask, and the ask screen answered 429 having made one request.
 * Same window and same production number (§15.5) — what changes is that the count is
 * about this endpoint, which is what a rate limit is supposed to mean.
 */
const askLimiter = makeStrictLimiter();

// ── capture — DEV-A ─────────────────────────────────────────────────────────

/**
 * 3.2 — DEV-A. One image, uploaded **before** the question exists, answered as an
 * `Attachment` whose `questionId` is still null.
 *
 * §12 writes this as `POST /questions/:id/attachments`, which cannot work in this
 * epic: classification is a Vision call *inside* `POST /questions`, so an image bound
 * afterwards is one the model never saw. `question_attachments.question_id` is
 * nullable, which is what makes the reversed order legal.
 *
 * No `validate(...)`, and that is deliberate rather than an omission: the body is a
 * multipart file, and its size, type and field name are enforced by the Multer
 * configuration 3.2 puts behind `upload` — from the same constants a schema here
 * would have had to read. See `validators/question.intake.schema.js`.
 */
questionRoutes.post(
  '/attachments',
  authenticate,
  authorize('student'),
  upload.single(ATTACHMENT_FIELD_NAME),
  asyncHandler(uploadAttachment),
);

/**
 * 3.4 — DEV-A. Create, classify, and a `PENDING` session, in that order. 201 with a
 * `QuestionResponse`.
 *
 * `askLimiter` runs before `validate`, so a client hammering the endpoint with
 * malformed bodies is still counted and still stopped. It runs after `authenticate`
 * on purpose: the limit is per address, and a 401 should not consume the budget of a
 * student sharing a school's network.
 *
 * The fallback path answers 201 too. `classificationOk: false` is a field in the
 * payload, not an error response (§8.1).
 */
questionRoutes.post(
  '/',
  authenticate,
  authorize('student'),
  askLimiter,
  validate(createQuestionSchema),
  asyncHandler(createQuestion),
);

// ── classification — DEV-B ──────────────────────────────────────────────────

/**
 * 3.5 — DEV-B. One `QuestionResponse`, in the same shape `POST /questions` answers.
 *
 * The recovery path as much as a read: a client whose create request timed out on a
 * cold instance finds its question here, because the row was committed before the
 * classifier ran. Another student's question is `NOT_FOUND`, never `FORBIDDEN`.
 */
questionRoutes.get(
  '/:id',
  authenticate,
  authorize('student'),
  validate(questionByIdSchema),
  asyncHandler(getQuestion),
);

/**
 * 3.5 — DEV-B. The student correcting the model (§8.1): `topicId` and `subtopicId`
 * together, `estimatedLevel` optionally. Returns the question in the shape `GET`
 * returns.
 *
 * No rate limiter. This endpoint writes three columns and calls nothing external —
 * the reason the limiter exists next door is the Anthropic call, which this route
 * does not make.
 */
questionRoutes.patch(
  '/:id/classification',
  authenticate,
  authorize('student'),
  validate(classificationOverrideSchema),
  asyncHandler(patchQuestionClassification),
);
