import { Router } from 'express';

import {
  endSession,
  extendSession,
  getMySessions,
  getSession,
  getSessionVideo,
  reportNoShow,
  sendOffer,
  submitReview,
} from '#controllers/session.controller.js';
import { authenticate } from '#middlewares/authenticate.js';
import { authorize } from '#middlewares/authorize.js';
import { validate } from '#middlewares/validate.js';
import { asyncHandler } from '#utils/asyncHandler.js';
import {
  reviewSchema,
  sendOfferSchema,
  sessionByIdSchema,
  sessionHistorySchema,
} from '#validators/session.schema.js';

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

// ── E8 ───────────────────────────────────────────────────────────────────────
//
// **One route, and it is the only entry in this file that is not appended at the bottom.**
// Everything since 5.1 has been added in contiguous blocks at the end, which is what keeps
// the diff of a reopened frozen file readable. `/mine` cannot be: Express walks the stack
// in order, `GET /:id` below matches one segment, and a `/mine` declared after it never
// runs — `sessionByIdSchema`'s uuid check would answer `400 VALIDATION_ERROR` for a
// request that is not malformed at all, which is a failure that reads like a client bug
// for the rest of its life. `teacher.routes.js` already carries this note for `/me` before
// `/:id`; this is the same hazard on a different router.
//
// So the diff is one insertion here and nothing below it is edited or reordered. 8.4's
// review checklist says to confirm exactly that, and the ordering is the one mistake in
// this PR that produces a confusing error rather than an obvious one.

/**
 * 8.4 — the student's own finished sessions, paged.
 *
 * `authorize('student')`, and it is the first role gate on this router that is about
 * *which list you are asking for* rather than about what you may do to a session. The
 * teacher's equivalent is `GET /wallet/earnings` (7.6), which carries gross, fee and net;
 * one endpoint answering both roles would be one serializer with a role branch inside it.
 *
 * **No id in the path and no `params` in the schema.** The student is the token, so there
 * is nothing to tamper with and no ownership check to make — `studentId` is a `where` on
 * both queries rather than a comparison after the fact. `§12` spells this endpoint
 * `GET /students/me/sessions`; there is no `/students` router and never has been, and the
 * deviation is E8's README's.
 *
 * `validate` for `page` and `pageSize` — coerced, defaulted and capped there, so the
 * service never branches on "did they say".
 */
sessionRoutes.get(
  '/mine',
  authenticate,
  authorize('student'),
  validate(sessionHistorySchema),
  asyncHandler(getMySessions),
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

// ── E6 ───────────────────────────────────────────────────────────────────────
//
// **This file was frozen at 5.1 and E6 reopens it exactly once — here, in 6.2 — then
// it is frozen again.** Five routes appended in their final shape: `authenticate`,
// `authorize` where a role decides, `validate`, all wired against controllers that
// throw `NOT_IMPLEMENTED` until 6.4, 6.5 and 6.6 fill them in. A middleware added in
// 6.5 would be an edit to a frozen file, which is the failure this arrangement exists
// to prevent.
//
// Nothing above this line is edited or reordered. The diff is five contiguous blocks
// at the bottom and 6.2's review checklist says to confirm exactly that.
//
// **Three of the five carry no `authorize`, and that is the deliberate half.**
// `GET /sessions/:id` already made this call in 5.4: the student and the teacher read
// the same row, and which one you are decides what you may see. That is an
// authorisation rule about a *row*, not a role, and it belongs in the service.
//
//   /video   — both participants join the same call. A role gate would either lock out
//              half of them or say nothing at all.
//   /end     — either side may end a session. §11.2's `end_reason` has no
//              `teacher_ended` value and inventing one is a migration.
//
// The other three do carry one, because only a student can spend, report or rate.
//
// **No rate limiter, still.** `strictLimiter` is for routes that spend money on an
// external call — `POST /questions` and its Vision call. `GET /:id/video` mints a token
// against Daily, which is an external call that costs nothing and is already gated by a
// participation check on a session the caller has to be inside. `globalLimiter` in
// `app.js` covers all five.

/**
 * 6.4 — the room and a freshly minted token, and the epic's security boundary.
 *
 * `authenticate` only. See the block above: both participants join the same call.
 *
 * The token is minted per call and cached nowhere. Two people in a session get two
 * tokens and a reload gets a third — anything that stored one and handed it out again
 * would be the `POST /video/access` endpoint 6.1 deleted, wearing a different name.
 */
sessionRoutes.get(
  '/:id/video',
  authenticate,
  validate(sessionByIdSchema),
  asyncHandler(getSessionVideo),
);

/**
 * 6.5 — one more block on the meter.
 *
 * `authorize('student')`, because only a student can spend.
 *
 * `validate` with the same schema as the reads, and that is the point of it here: the
 * body must be **empty**. One block — `EXTENSION_BLOCKS` — is the only thing an
 * extension can buy, and a quantity in the body is a way to overrun the budget cap in
 * one request. `.strict()` refuses it at the door rather than in the service.
 */
sessionRoutes.post(
  '/:id/extend',
  authenticate,
  authorize('student'),
  validate(sessionByIdSchema),
  asyncHandler(extendSession),
);

/**
 * 6.6 — either side stops the session.
 *
 * `authenticate` and no `authorize`. See the block above: the column records why the
 * session is over, not who was holding the mouse.
 */
sessionRoutes.post('/:id/end', authenticate, validate(sessionByIdSchema), asyncHandler(endSession));

/**
 * 6.6 — the teacher never arrived, and the student wants their credit back.
 *
 * `authorize('student')`. A teacher cannot report their own absence, and nobody else is
 * in the session.
 *
 * The window is `NO_SHOW_WINDOW_SEC` from `started_at` and it is enforced in the
 * service, against `started_at` as read under the lock — not here, because a route
 * cannot see a row.
 */
sessionRoutes.post(
  '/:id/report-no-show',
  authenticate,
  authorize('student'),
  validate(sessionByIdSchema),
  asyncHandler(reportNoShow),
);

/**
 * 6.6 — the rating, and the only way an `ENDED` session reaches a terminal state.
 *
 * `authorize('student')`. The student rates the teacher; §10 has no arrow the other
 * way.
 *
 * The one route in this block with a body, and `reviewSchema` is the only new schema
 * 6.2 writes. `isResolved` is required — it is §6.2's core KPI — and `stars` and
 * `comment` are what a student volunteers.
 */
sessionRoutes.post(
  '/:id/review',
  authenticate,
  authorize('student'),
  validate(reviewSchema),
  asyncHandler(submitReview),
);
