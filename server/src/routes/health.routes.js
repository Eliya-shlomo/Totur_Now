import { Router } from 'express';

import { pingDb } from '#repositories/health.repository.js';
import { asyncHandler } from '#utils/asyncHandler.js';
import { logger } from '#utils/logger.js';

/**
 * `GET /health` — mounted at the root, not under `/api/v1`.
 *
 * This is an infrastructure endpoint, not part of the product API: Render polls
 * it to decide whether the instance is alive, and that contract must not move
 * when the API version does.
 *
 * The rule that shapes the whole handler: **it never fails.** A 500 here tells
 * Render the instance is dead, and Render responds by restarting it. If a
 * database blip produced a 500, every instance would restart on every blip —
 * turning a recoverable outage into a restart loop. So the database is reported
 * on, not depended on.
 */
export const healthRoutes = Router();

healthRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    let db = 'ok';

    try {
      await pingDb();
    } catch (error) {
      // Deliberately swallowed. Logged at warn so the outage is visible in the
      // logs, then reported in the body — the response still succeeds.
      db = 'down';
      logger.warn('Health check: database unreachable', { message: error?.message });
    }

    res.json({
      success: true,
      data: {
        // `status` is about this process, `db` about a dependency it can survive
        // losing. They are separate fields because they answer separate
        // questions: "should you restart me" and "am I currently degraded".
        status: 'ok',
        db,
        uptime: Math.floor(process.uptime()),
      },
    });
  }),
);
