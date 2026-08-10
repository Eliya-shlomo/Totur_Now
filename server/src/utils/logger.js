import { env } from '#config/env.js';

/**
 * Minimal structured logger.
 *
 * Deliberately not pino or winston: the only consumer for now is the error handler,
 * and Render captures stdout regardless. Swapping this for a real logger later means
 * changing one file, because nothing calls `console` directly.
 *
 * In production it emits one JSON object per line, which is what log aggregators
 * want. In development it stays human-readable.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = env.isProduction ? LEVELS.info : LEVELS.debug;

/** Keys whose values must never reach a log line, at any nesting depth. */
const REDACT = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'apiKey',
  'secret',
]);

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, REDACT.has(k) ? '[redacted]' : redact(v, depth + 1)]),
  );
}

function emit(level, message, meta) {
  if (LEVELS[level] > threshold) return;

  const safe = meta ? redact(meta) : undefined;

  if (env.isProduction) {
    console[level === 'debug' ? 'log' : level](
      JSON.stringify({ level, time: new Date().toISOString(), message, ...safe }),
    );
    return;
  }

  const stamp = new Date().toISOString().slice(11, 19);
  console[level === 'debug' ? 'log' : level](
    `${stamp} ${level.toUpperCase().padEnd(5)} ${message}`,
    safe ?? '',
  );
}

export const logger = {
  error: (message, meta) => emit('error', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  info: (message, meta) => emit('info', message, meta),
  debug: (message, meta) => emit('debug', message, meta),
};
