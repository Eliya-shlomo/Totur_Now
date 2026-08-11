import { logger } from '#utils/logger.js';

/**
 * One log line per finished request.
 *
 * Hand-rolled rather than morgan: it is fifteen lines, it avoids a dependency,
 * and it goes through `logger`, which means it inherits the redaction list and
 * the JSON-per-line production format instead of printing a second, differently
 * shaped stream that a log aggregator has to be taught to parse.
 *
 * The level is chosen from the status code, and that choice is load-bearing.
 * `logger` drops `debug` in production, so a successful request logs nothing
 * there — Render already records every request at its proxy, and duplicating
 * that would bury the 4xx and 5xx lines that actually need reading. In
 * development the threshold is `debug`, so everything shows.
 */
export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();

  // `finish` rather than wrapping `res.end`: it fires once the response is
  // flushed, so the duration includes the handler and the serialisation.
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';

    logger[level](`${req.method} ${req.originalUrl} ${res.statusCode}`, {
      durationMs: Math.round(durationMs),
      userId: req.user?.id,
    });
  });

  next();
}
