import { Router } from 'express';

import { publicRoutes } from '#routes/public.routes.js';

/**
 * The route registry — the only router `app.js` mounts, at `/api/v1`.
 *
 * APPEND-ONLY, alphabetical, one `use()` line per domain router
 * (docs/OWNERSHIP.md §2). Never reorder, never reformat, never tidy up while you
 * are in here: git merges appended lines cleanly and does not merge reordered
 * ones, and this file is edited by both developers in the same week.
 *
 * This indirection is the point of PR 0.4. `app.js` is frozen from here on, so
 * adding an endpoint is one line below and nothing else:
 *
 *   import { authRoutes } from '#routes/auth.routes.js';
 *   apiRoutes.use('/auth', authRoutes);
 *
 * An unmatched path under `/api/v1` falls through to `notFound` in `app.js` and
 * comes back as a `NOT_FOUND` in the standard error shape.
 *
 * `/health` is not here. It is mounted at the root in `app.js`, because it is an
 * infrastructure endpoint rather than a versioned API one.
 */
export const apiRoutes = Router();

// ── domain routers ──────────────────────────────────────────────────────────
// Append below, alphabetically. One line each.

apiRoutes.use('/public', publicRoutes);
