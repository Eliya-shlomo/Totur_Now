import { Router } from 'express';

import { getMe, patchMe } from '#controllers/teacher.me.controller.js';
import {
  getTeacherById,
  getTeacherReviews,
  listTeachers,
} from '#controllers/teacher.public.controller.js';
import { authenticate } from '#middlewares/authenticate.js';
import { authorize } from '#middlewares/authorize.js';
import { validate } from '#middlewares/validate.js';
import { asyncHandler } from '#utils/asyncHandler.js';
import { teacherMeSchema, teacherUpdateSchema } from '#validators/teacher.me.schema.js';
import {
  teacherByIdSchema,
  teacherListSchema,
  teacherReviewsSchema,
} from '#validators/teacher.public.schema.js';

/**
 * The four teacher endpoints, mounted at `/api/v1/teachers`.
 *
 * **This file is frozen after PR 2.1.** Every route below is fully wired —
 * middleware, validator, controller — against controllers that currently throw
 * `NOT_IMPLEMENTED`. Filling an endpoint in means replacing a controller body and a
 * schema that exactly one developer owns, and touching nothing shared.
 *
 * The reason is not tidiness, it is E1. `auth.routes.js` was frozen in 1.1 and never
 * conflicted once across two parallel PRs; `user.repository.js` was not frozen, both
 * PRs wrote to it, and the merge produced a file that would not parse — `main` did
 * not boot until somebody noticed (`3e05e3c`, docs/epics/E1-auth/RETRO.md). E2 runs
 * the same two tracks over one table: DEV-B owns what a teacher does to their own
 * record (2.2, 2.4), DEV-A owns what a student sees about a teacher (2.3, 2.5, 2.6).
 * After this PR neither of them opens this file or the repository behind it.
 *
 * If a later PR seems to need a change here, check first that the thing it wants is
 * not really a change to its own controller. If it genuinely is not, that is a chat
 * message before the code — not an edit.
 *
 * **Route order is load-bearing.** `/me` is declared before `/:id`: Express matches
 * top to bottom, so the reverse order sends `GET /teachers/me` into the public
 * handler with `id = 'me'`, and a student calling it would get `NOT_FOUND` where the
 * contract promises `FORBIDDEN`. Two of this PR's acceptance criteria are that
 * distinction. Never reorder these.
 *
 * The public pair carries no auth middleware at all — not even
 * `authenticateOptional`. A response a stranger can read must not vary by who is
 * reading it, and an optional-auth wrapper is how that stops being true.
 *
 * These routes are deliberately not under `/public`. `/public` is taxonomy and
 * money, cached for `PUBLIC_CACHE_SECONDS`; a teacher list changes every time
 * somebody goes online and would be served stale for the rest of the day.
 */
export const teacherRoutes = Router();

// ── the teacher's own record — DEV-B ─────────────────────────────────────────
// Declared first: `/me` must win over `/:id`.

/** 2.2 — DEV-B. `toTeacherMe` of `req.user.id`. The stepper's source of truth. */
teacherRoutes.get(
  '/me',
  authenticate,
  authorize('teacher'),
  validate(teacherMeSchema),
  asyncHandler(getMe),
);

/**
 * 2.2 — DEV-B. A partial: bio, price, level, topics, status. `topicIds` replaces
 * the whole set. No ownership parameter — the row is always `req.user.id`.
 */
teacherRoutes.patch(
  '/me',
  authenticate,
  authorize('teacher'),
  validate(teacherUpdateSchema),
  asyncHandler(patchMe),
);

// ── the public read surface — DEV-A ──────────────────────────────────────────
// No authentication, by design. A student compares teachers before registering.

/** 2.3 — DEV-A. Filtered, paged list of `TeacherCard`, plus the unpaged `total`. */
teacherRoutes.get('/', validate(teacherListSchema), asyncHandler(listTeachers));

/** 2.3 — DEV-A. One `TeacherCard`. A student's user id is `NOT_FOUND`, not a 500. */
teacherRoutes.get('/:id', validate(teacherByIdSchema), asyncHandler(getTeacherById));

/**
 * 8.3. A page of `TeacherReview`, newest first, with the unpaged `total`.
 *
 * **Declared after `/:id` and it cannot be shadowed by it.** The freeze note above is
 * about `/me` versus `/:id`, which are both one segment; this path is two, so Express
 * never matches it against the route above. Order is not load-bearing here and the file
 * stays in its declared shape.
 *
 * No auth, like the two public reads above — and the response carries no student in any
 * form, which is `toTeacherReview`'s job and is asserted in `teacher.reviews.test.js`.
 */
teacherRoutes.get('/:id/reviews', validate(teacherReviewsSchema), asyncHandler(getTeacherReviews));
