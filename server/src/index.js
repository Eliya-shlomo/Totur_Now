import { disconnectDb } from '#config/db.js';
import { env } from '#config/env.js';
import { startJobs, stopJobs } from '#jobs/index.js';
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
 * Background jobs on the `CRON_TICK_SECONDS` tick (PR 5.5).
 *
 * After `listen` rather than before it: Render's health check hits the listener, and a
 * boot that swept first would delay the thing the platform is actually waiting for.
 *
 * Two of MVP.md §13's four jobs — offer expiry and auto-away. The other two read
 * `ends_at` as a live billing deadline and belong to E6, which is the epic that makes
 * that clock tick.
 *
 * **It is a sweeper, not the source of truth.** Render's free plan spins the instance
 * down after ~15 minutes without a request and `node-cron` runs in-process, so these
 * jobs do not run on a sleeping server. 5.4 evaluates expiry on every read for that
 * reason; this makes the watched case timely.
 */
startJobs();

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
    // **The scheduler before anything else.** A sweep still running when the pool
    // closes throws `Cannot use PrismaClient after $disconnect` on every deploy, in
    // the shutdown log, where it is indistinguishable from a real failure. `stopJobs`
    // also awaits the tick in flight, so this line is a guarantee rather than a hope.
    await stopJobs();

    // Sockets next, and the order is not cosmetic. `server.close()` waits for
    // in-flight connections to finish, and a WebSocket is by design a connection that
    // never finishes on its own — draining HTTP first would hang until the timeout
    // above fires, on every single deploy.
    await closeSockets();
    await closeListener();
    await disconnectDb();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { message: error?.message, stack: error?.stack });
    process.exit(1);
  }
}

/**
 * Closes the HTTP listener, tolerating the case where it is already closed.
 *
 * **Socket.IO closes this listener as part of `closeSockets()`.** `io.close()` shuts
 * down the HTTP server it was attached to, not only the socket layer — so by the time
 * the line above returns, the listener the process started is usually already down and
 * `server.close()` answers `ERR_SERVER_NOT_RUNNING`. That was logged as
 * `Error during shutdown` on every clean SIGTERM, with a stack, immediately before the
 * exit code that says everything went fine. A shutdown log that cries wolf on every
 * deploy is a shutdown log nobody reads on the deploy that goes wrong.
 *
 * Both halves are needed and neither is redundant. `server.listening` skips the call
 * in the ordinary case; the `code` check covers the close that happened between the
 * check and the call, which `closeSockets()` starts and does not synchronously finish.
 * Every other error still rejects and still reaches the handler above — a listener
 * that genuinely failed to drain is a real failure and stays loud.
 *
 * The ordering it depends on is `closeSockets()` first, which has its own reason next
 * to it: draining HTTP ahead of the WebSockets would hang until the force-exit fires.
 */
function closeListener() {
  if (!server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') return resolve();

      reject(error);
    });
  });
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
