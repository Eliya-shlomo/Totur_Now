import { Router } from 'express';

import { getSession, sendOffer } from '#controllers/session.controller.js';
import { authenticate } from '#middlewares/authenticate.js';
import { authorize } from '#middlewares/authorize.js';
import { validate } from '#middlewares/validate.js';
import { asyncHandler } from '#utils/asyncHandler.js';
import { sendOfferSchema, sessionByIdSchema } from '#validators/session.schema.js';

/**
 * Sessions, mounted at `/api/v1/sessions` — MVP.md §12.
 *
 * **This file is frozen after PR 5.1.** Both routes below are in their final shape:
 * middleware, validator, controller, all wired, against controllers that throw
 * `NOT_IMPLEMENTED` until 5.3 and 5.4 fill them in. A middleware added in 5.3 would
 * be an edit to a frozen file, which is the failure this PR exists to prevent.
 *
 * E5 has one developer, so the freeze is no longer about a merge conflict. It is
 * about review: with one developer there is no second reader, ever, and the frozen
 * file list plus `git log --oneline -- <file>` is the only mechanism that will say a
 * later PR reopened something it had no business in.
 *
 * **A new mount rather than a second router on an existing one.** E4 needed the
 * two-routers-one-mount trick because §12 spelled matching under `/questions` and
 * 3.1's router was frozen. `/sessions` is new and shares a mount with nothing, so
 * that trick is not imported here.
 *
 * **No rate limiter, deliberately.** `strictLimiter` is for routes that spend money
 * on an external call — `POST /questions` and its Vision call. These take a row lock
 * and send an email, and `globalLimiter` in `app.js` already covers them.
 */
export const sessionRoutes = Router();

/**
 * 5.3 — the atomic teacher lock, and the one route in this epic §17.5 already
 * marked human-written.
 *
 * `authorize('student')` because a teacher reaches a session through the offer they
 * were sent, never by sending one.
 *
 * `validate` is on it from the start rather than added with the body in 5.3.
 * `sessions.id` is `@db.Uuid` and Postgres raises `22P02` on a malformed one instead
 * of returning no rows, so an uncaught typo in the URL is a 500 for what is plainly a
 * bad request — and a body carrying a price rather than a teacher must be refused
 * rather than half-read.
 */
sessionRoutes.post(
  '/:id/offer',
  authenticate,
  authorize('student'),
  validate(sendOfferSchema),
  asyncHandler(sendOffer),
);

/**
 * 5.4 — the session both sides read while an offer is out.
 *
 * **`authenticate` and no `authorize`, and that is deliberate.** The student and the
 * teacher read the same row, and which one you are decides what you may see. That is
 * an authorisation rule about a row, not about a role, and it belongs in the service
 * — the same call 3.5 made for `GET /questions/:id`. A role gate here would either
 * lock out half the participants or say nothing at all.
 */
sessionRoutes.get('/:id', authenticate, validate(sessionByIdSchema), asyncHandler(getSession));
