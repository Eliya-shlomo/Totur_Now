import { Router } from 'express';

import { getPricing, getTopics } from '#controllers/public.controller.js';
import { validate } from '#middlewares/validate.js';
import { noQuerySchema } from '#validators/public.validator.js';
import { asyncHandler } from '#utils/asyncHandler.js';

/**
 * `/api/v1/public` — MVP.md §12 "Public". No authentication, by design and
 * permanently: these are the two things a visitor has to be able to read before
 * deciding whether to register.
 *
 * No auth middleware is applied rather than one applied loosely. An "optional
 * auth" wrapper here would mean a public response could vary by user, which is
 * the one thing a cacheable public response must never do.
 *
 * `/public/teachers/online` and `/public/teachers/:id` (§12) belong to E8 and are
 * appended below when they land.
 */
export const publicRoutes = Router();

publicRoutes.get('/topics', validate(noQuerySchema), asyncHandler(getTopics));

publicRoutes.get('/pricing', validate(noQuerySchema), asyncHandler(getPricing));
