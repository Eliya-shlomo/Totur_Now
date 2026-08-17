import { disconnectDb } from '#config/db.js';
import { env } from '#config/env.js';
import { closeSockets, initSockets } from '#sockets/index.js';
import { logger } from '#utils/logger.js';

import { app } from './app.js';

/**
 * Process entry point: start the HTTP server, and stop it properly.
 *
 * `env.js` has already validated the environment by the time this runs — an
 * invalid config exits during import, with a message naming the variable.
 */

/**
 * How long a shutdown may take before the process is killed anyway.
 *
 * Render sends SIGTERM and then SIGKILLs after roughly 30 seconds. Finishing
 * first, under our own control, is the difference between draining in-flight
 * requests and having them cut mid-response on every single deploy.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT}`, {
    nodeEnv: env.NODE_ENV,
    corsOrigins: env.corsOrigins,
  });
});

/**
 * Socket.IO on the same listener (PR 5.1).
 *
 * The same HTTP server, not a second port: a socket connection starts as an HTTP
 * request and upgrades, so it has to reach the listener Express is already on. A
 * second one would mean a second Render service, a second URL, and a second CORS
 * list to keep in step with this one.
 *
 * It authenticates every handshake and, as of this PR, emits nothing.
 */
initSockets(server);

/**
 * Graceful shutdown.
 *
 * `server.close()` stops accepting new connections and waits for in-flight
 * requests to finish; only then is it safe to drop the database pool, because
 * disconnecting first would fail the requests that are still running.
 *
 * Guarded against re-entry: Render sends SIGTERM, and a second signal arriving
 * while the first shutdown is draining must not start a second one.
 */
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`${signal} received — shutting down`);

  // If draining hangs — a socket that never closes, a query that never returns —
  // exit anyway rather than wait for the platform to SIGKILL us. `unref` so this
  // timer is not itself a reason the process stays alive.
  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out — exiting anyway');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // Sockets first, and the order is not cosmetic. `server.close()` waits for
    // in-flight connections to finish, and a WebSocket is by design a connection that
    // never finishes on its own — draining HTTP first would hang until the timeout
    // above fires, on every single deploy.
    await closeSockets();
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await disconnectDb();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { message: error?.message, stack: error?.stack });
    process.exit(1);
  }
}

// SIGTERM: Render, on every deploy. SIGINT: Ctrl-C in development.
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * A rejection or throw that escaped every handler means the process is in an
 * unknown state — `errorHandler` catches everything that happens inside a
 * request, so reaching here is by definition something it could not see. Log it
 * in full, then shut down cleanly and let the platform start a fresh instance,
 * which is more trustworthy than continuing on a corrupted one.
 */
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    message: reason?.message ?? String(reason),
    stack: reason?.stack,
  });
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { message: error?.message, stack: error?.stack });
  shutdown('uncaughtException');
});
