import { Router } from 'express';

import { getMatches } from '#controllers/matching.controller.js';
import { authenticate } from '#middlewares/authenticate.js';
import { authorize } from '#middlewares/authorize.js';
import { validate } from '#middlewares/validate.js';
import { asyncHandler } from '#utils/asyncHandler.js';
import { matchesSchema } from '#validators/matching.schema.js';

/**
 * The matching endpoint, mounted at `/api/v1/questions` — MVP.md §12.
 *
 * **This file is frozen after PR 4.1.** The route below is in its final shape:
 * middleware, validator, controller, all wired, against a controller that throws
 * `NOT_IMPLEMENTED` until 4.5 fills it in. A middleware added in 4.5 would be an edit
 * to a frozen file, which is the failure this PR exists to prevent.
 *
 * **Why a second router rather than a line in `question.routes.js`.** That file is
 * frozen after 3.1 and E4 does not unfreeze it. Two routers mount on `/questions`
 * (see `routes/index.js`), and Express walks them in order: `GET /:id` in the first
 * matches a single segment, so `/questions/<uuid>/matches` falls through it and into
 * this one. The URL is §12's, E3's frozen file stays shut, and E4 gets a router it
 * owns and can freeze on its own terms. That is the posture this epic takes
 * everywhere: **E4 reads E2's and E3's tables through E4's own files.**
 *
 * **No rate limiter, deliberately.** `strictLimiter` is on `POST /questions` because
 * that route spends money on a Vision call. This one runs two indexed queries and
 * some arithmetic, and `globalLimiter` in `app.js` already covers it. A strict limit
 * here would throttle the price control, which is *designed* to be pressed
 * repeatedly — §12's "re-callable = show me more teachers".
 */
export const matchingRoutes = Router();

/**
 * 4.5 — DEV-A. The ranked pool for one question: 200 `MatchesResponse`, and 200 with
 * a `reason` when the pool is empty for either of its two reasons.
 *
 * `authorize('student')` and not a shared audience: a teacher reaches a question
 * through the offer they were matched with (E5), never through this route.
 *
 * `validate` is on it from the start rather than added with the body in 4.5.
 * `questions.id` is `@db.Uuid` and Postgres raises `22P02` on a malformed one instead
 * of returning no rows, so an uncaught typo in the URL is a 500 for what is plainly a
 * bad request — and `?priceBand=D` must be refused rather than silently ignored.
 */
matchingRoutes.get(
  '/:id/matches',
  authenticate,
  authorize('student'),
  validate(matchesSchema),
  asyncHandler(getMatches),
);
