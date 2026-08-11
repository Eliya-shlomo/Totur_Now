import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { env } from '#config/env.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { errorHandler } from '#middlewares/errorHandler.js';
import { notFound } from '#middlewares/notFound.js';
import { globalLimiter } from '#middlewares/rateLimit.js';
import { requestLogger } from '#middlewares/requestLogger.js';
import { healthRoutes } from '#routes/health.routes.js';
import { apiRoutes } from '#routes/index.js';
import { AppError } from '#utils/AppError.js';

/**
 * The Express application. MVP.md §12 for the paths, §15.5 for the security posture.
 *
 * **This file is frozen after PR 0.4** (OWNERSHIP.md §2). It mounts exactly one
 * feature router — the registry in `routes/index.js` — so that ten days of route
 * work by two developers touch an append-only list instead of the one file both
 * of them would otherwise be editing every day. If a later PR seems to need a
 * change here, the thing it wants almost always belongs in a router.
 *
 * Middleware order below is not cosmetic; each position is commented where it
 * matters. Nothing gets appended after `errorHandler`.
 */
const app = express();

/**
 * The largest JSON body any endpoint legitimately receives.
 *
 * Question images do not pass through here — they go to
 * `POST /api/v1/questions/:id/attachments` as multipart in E3 and are streamed to
 * Cloudinary, with their own file type and size limits on the multer instance
 * (§15.5). What actually arrives as JSON is credentials, question text, price
 * updates and review comments: kilobytes. The limit is a denial-of-service floor,
 * so it is set to the smallest number that cannot inconvenience a real request.
 */
const JSON_BODY_LIMIT = '100kb';

/**
 * Render terminates TLS at its proxy and forwards with `X-Forwarded-For`. Without
 * this, `req.ip` is the proxy for every request and the rate limiter buckets the
 * entire internet into one counter.
 *
 * `1`, not `true`: trusting all hops would let a client prepend its own
 * `X-Forwarded-For` entry and choose which IP it is limited as. One hop is what
 * actually sits in front of us. Off in development, where there is no proxy and a
 * spoofable header would only make local debugging lie.
 */
if (env.isProduction) {
  app.set('trust proxy', 1);
}

// Security headers first — they should apply to every response below, including
// the error ones.
app.use(helmet());

/**
 * CORS with an explicit whitelist from `CORS_ORIGINS` (parsed in `config/env.js`).
 *
 * Requests with no `Origin` are allowed. `Origin` is set by the browser, so its
 * absence means the caller is not one: curl, Render's health checker,
 * server-to-server. Rejecting them would break the deploy health check and every
 * curl in the manual test, and would buy nothing — CORS is enforced by the
 * browser, so anything outside a browser can set whatever `Origin` it likes.
 * What CORS prevents is `evil.com`'s JavaScript calling this API with a logged-in
 * user's cookies attached; who the caller *is* stays the job of the auth
 * middleware in E1.
 *
 * `credentials: true` because the refresh token lives in an httpOnly cookie
 * (§15.5) and the browser will not send it cross-origin otherwise.
 */
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Surfaces through `errorHandler` as a 403 in the standard error shape,
      // rather than as the opaque browser-side failure a bare rejection gives.
      callback(new AppError(ERROR_CODES.FORBIDDEN, `Origin ${origin} is not allowed.`));
    },
    credentials: true,
  }),
);

app.use(requestLogger);

/**
 * Health sits above the body parsers and above the rate limiter, deliberately.
 *
 * It takes no body, and Render polls it continuously — counted against
 * `globalLimiter` those polls would eventually exhaust the window and the
 * platform would start reading 429s as an unhealthy instance.
 *
 * It is also the one route not registered through `routes/index.js`, because it
 * is infrastructure rather than API and must not move when the version does.
 */
app.use('/health', healthRoutes);

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(cookieParser());

// The blanket backstop. The strict limiter is exported from the same file and
// applied by the auth and question routers to their own routes.
app.use('/api/v1', globalLimiter, apiRoutes);

// Unmatched path → NOT_FOUND in the standard shape, never Express's HTML page.
app.use(notFound);

// Last. Always last. Everything above reaches the client through this.
app.use(errorHandler);

export { app };
