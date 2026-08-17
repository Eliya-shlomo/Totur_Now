import { Router } from 'express';

import { acceptOffer, rejectOffer } from '#controllers/offer.controller.js';
import { authenticate } from '#middlewares/authenticate.js';
import { authorize } from '#middlewares/authorize.js';
import { validate } from '#middlewares/validate.js';
import { asyncHandler } from '#utils/asyncHandler.js';
import { offerByIdSchema } from '#validators/offer.schema.js';

/**
 * The teacher's answers, mounted at `/api/v1/offers` — MVP.md §12.
 *
 * **This file is frozen after PR 5.1**, on the same terms as `session.routes.js`
 * beside it: both routes final, against controllers 5.4 fills in.
 *
 * **A second router rather than two more lines in `session.routes.js`.** §12 puts the
 * offer under `/sessions/:id/offer` and the responses under `/offers/:id/*`, which
 * are two mounts, so they are two routers appended to `routes/index.js`. Nesting
 * these under `/sessions` would mean inventing a URL the spec does not have, and the
 * ids are not even the same kind — one is a session, these are offers.
 *
 * **No rate limiter on either.** A strict limit on `accept` would throttle the one
 * action the product most needs to be instant: the teacher has sixty seconds, and a
 * 429 inside that window loses the session for a reason that has nothing to do with
 * either person. `globalLimiter` in `app.js` covers them.
 */
export const offerRoutes = Router();

/**
 * 5.4 — accept. Moves state and **charges nothing, creates nothing**: Zoom is E6 and
 * `wallet.service.js` is E7. See the controller for the four steps and the two named
 * absences.
 *
 * `authorize('teacher')` on both routes below. The student who sent the offer cannot
 * accept it on the teacher's behalf, and this is the gate that says so — the row-level
 * question of *which* teacher is the service's, since the token's role only proves
 * they are one.
 */
offerRoutes.post(
  '/:id/accept',
  authenticate,
  authorize('teacher'),
  validate(offerByIdSchema),
  asyncHandler(acceptOffer),
);

/** 5.4 — reject. Releases the lock and appends to the question's `rejected_by`. */
offerRoutes.post(
  '/:id/reject',
  authenticate,
  authorize('teacher'),
  validate(offerByIdSchema),
  asyncHandler(rejectOffer),
);
