/**
 * Error codes — the single source for client and server.
 *
 * The server throws `AppError` with one of these. The client's axios interceptor
 * (PR 0.6) switches on the same values. Two drifting lists would be a silent bug,
 * which is why this lives in `shared/` rather than in either workspace.
 *
 * APPEND-ONLY, alphabetical within each group (docs/OWNERSHIP.md §2).
 * Adding a code is a one-line change; renaming one breaks both sides at once.
 *
 * Base list: MVP.md §12.
 */
export const ERROR_CODES = {
  // ── validation and request shape ──────────────────────────────────────────
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // ── authentication and authorization ──────────────────────────────────────
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED', // access token past exp — the client refreshes
  TOKEN_INVALID: 'TOKEN_INVALID', // malformed or tampered — the client logs out
  UNAUTHORIZED: 'UNAUTHORIZED',

  // ── resources ─────────────────────────────────────────────────────────────
  NOT_FOUND: 'NOT_FOUND',

  // ── matching and offers ───────────────────────────────────────────────────
  NO_AVAILABLE_TEACHERS: 'NO_AVAILABLE_TEACHERS',
  OFFER_EXPIRED: 'OFFER_EXPIRED',
  TEACHER_UNAVAILABLE: 'TEACHER_UNAVAILABLE',

  // ── sessions ──────────────────────────────────────────────────────────────
  SESSION_NOT_ACTIVE: 'SESSION_NOT_ACTIVE',

  // ── money ─────────────────────────────────────────────────────────────────
  BUDGET_CAP_REACHED: 'BUDGET_CAP_REACHED',
  INSUFFICIENT_CREDIT: 'INSUFFICIENT_CREDIT',

  // ── external services ─────────────────────────────────────────────────────
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  LLM_FAILED: 'LLM_FAILED',

  // ── catch-all ─────────────────────────────────────────────────────────────
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED', // route exists, handler is still a stub
  RATE_LIMITED: 'RATE_LIMITED',
};

/**
 * Default HTTP status per code. Lets a thrower say
 * `new AppError(ERROR_CODES.TEACHER_UNAVAILABLE, '...')` without repeating 409
 * at every call site — the status is a property of the code, not of the moment.
 */
export const ERROR_STATUS = {
  [ERROR_CODES.VALIDATION_ERROR]: 400,

  [ERROR_CODES.UNAUTHORIZED]: 401,
  [ERROR_CODES.TOKEN_EXPIRED]: 401,
  [ERROR_CODES.TOKEN_INVALID]: 401,
  [ERROR_CODES.FORBIDDEN]: 403,

  [ERROR_CODES.NOT_FOUND]: 404,

  // 409 rather than 404: none of these are a missing resource. They are a state the
  // request collided with, and one that may well be different a minute from now.
  [ERROR_CODES.TEACHER_UNAVAILABLE]: 409,
  [ERROR_CODES.OFFER_EXPIRED]: 409,
  [ERROR_CODES.SESSION_NOT_ACTIVE]: 409,
  [ERROR_CODES.NO_AVAILABLE_TEACHERS]: 409,

  [ERROR_CODES.INSUFFICIENT_CREDIT]: 402,
  [ERROR_CODES.BUDGET_CAP_REACHED]: 402,

  [ERROR_CODES.RATE_LIMITED]: 429,

  [ERROR_CODES.LLM_FAILED]: 502,
  [ERROR_CODES.EXTERNAL_SERVICE_ERROR]: 502,

  [ERROR_CODES.NOT_IMPLEMENTED]: 501,
  [ERROR_CODES.INTERNAL_ERROR]: 500,
};
