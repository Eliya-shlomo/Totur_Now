import { env } from '#config/env.js';
import { logger } from '#utils/logger.js';

/**
 * Temporary boot stub. PR 0.4 replaces this with the Express app and a real HTTP
 * server, at which point the keep-alive below goes away.
 *
 * env.js has already validated the environment by the time this line runs — an
 * invalid config exits before we get here, with a message naming the variable.
 */
logger.info('TutorNow server — config loaded (PR 0.3)', {
  node: process.version,
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  corsOrigins: env.corsOrigins,
});
logger.info('No Express yet — that is PR 0.4');

// Keep the process alive so `npm run dev` does not exit and take concurrently
// with it. Removed in PR 0.4 when a real server starts listening.
setInterval(() => {}, 1 << 30);
