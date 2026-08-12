import { Router } from 'express';

import { register } from '#controllers/auth.register.controller.js';
import { login, logout, me, refresh } from '#controllers/auth.session.controller.js';
import { authenticate, authenticateOptional } from '#middlewares/authenticate.js';
import { strictLimiter } from '#middlewares/rateLimit.js';
import { validate } from '#middlewares/validate.js';
import { asyncHandler } from '#utils/asyncHandler.js';
import { registerSchema } from '#validators/auth.register.schema.js';
import {
  loginSchema,
  logoutSchema,
  meSchema,
  refreshSchema,
} from '#validators/auth.session.schema.js';

/**
 * The five auth endpoints from MVP.md §12, mounted at `/api/v1/auth`.
 *
 * **This file is frozen after PR 1.1.** That is the point of the PR: 1.2 (DEV-A)
 * and 1.4 (DEV-B) are written in the same days and would otherwise both be editing
 * this router every afternoon. Every route below is fully wired — middleware,
 * validator, controller — against modules that already exist, so filling an
 * endpoint in means replacing a controller and a schema file that only one
 * developer owns, and touching nothing shared.
 *
 * If a later PR seems to need a change here, check first that the thing it wants is
 * not really a change to its own controller.
 *
 * The strict limiter (10 per 15 minutes, from `constants/auth.js`) sits on the two
 * endpoints that take credentials — §15.5. It is applied here rather than in
 * `app.js` because `app.js` is frozen and must not know route paths.
 */
export const authRoutes = Router();

// ── public ───────────────────────────────────────────────────────────────────

/** 1.2 — DEV-A. Creates user + profile + wallet in one transaction. */
authRoutes.post('/register', strictLimiter, validate(registerSchema), asyncHandler(register));

/** 1.4 — DEV-B. Returns `{ user, accessToken }` plus the refresh cookie. */
authRoutes.post('/login', strictLimiter, validate(loginSchema), asyncHandler(login));

/**
 * 1.4 — DEV-B. No `authenticate`: the credential is the refresh cookie, and the
 * whole reason this endpoint is called is that the access token has expired.
 */
authRoutes.post('/refresh', validate(refreshSchema), asyncHandler(refresh));

// ── authenticated ────────────────────────────────────────────────────────────

/**
 * 1.4 — DEV-B. Marked auth-required in §12, but with `authenticateOptional`: an
 * access token that expired while the tab was idle must not stop the refresh cookie
 * from being cleared. See `middlewares/authenticate.js` for why that is the one
 * route allowed to be lenient.
 */
authRoutes.post('/logout', authenticateOptional, validate(logoutSchema), asyncHandler(logout));

/** 1.4 — DEV-B. The client's single source of truth for the current user. */
authRoutes.get('/me', authenticate, validate(meSchema), asyncHandler(me));
