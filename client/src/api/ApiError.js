import { ERROR_CODES } from '@tutor/shared';

/**
 * The client-side mirror of the server's `AppError`. MVP.md §15.3.
 *
 * Everything that leaves `client.js` as a rejection is one of these, so a caller
 * never has to know whether the failure was an HTTP envelope, a dead network, or
 * a proxy returning HTML. One `catch (err)` shape for the whole app.
 *
 * `code` always comes from `@tutor/shared` — the same list the server throws from.
 * Compare with `err.is(ERROR_CODES.X)`, never with a string literal.
 */
export class ApiError extends Error {
  /**
   * @param {string} code      one of ERROR_CODES
   * @param {string} message   safe to show the user — the server already sanitised it
   * @param {*} [details]      field-level detail, e.g. `{ email: 'Already in use.' }`
   * @param {number|null} [status] HTTP status, or null when there was no response
   */
  constructor(code, message, details = null, status = null) {
    super(message);

    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }

  /** `err.is(ERROR_CODES.TOKEN_EXPIRED)` — keeps code comparison off string literals. */
  is(code) {
    return this.code === code;
  }

  /**
   * The server answered in the agreed shape. `message` is already user-facing:
   * the error handler replaces the message of any non-operational error before it
   * ever reaches us.
   */
  static fromEnvelope(envelope, status) {
    return new ApiError(
      envelope.code ?? ERROR_CODES.INTERNAL_ERROR,
      envelope.message ?? 'Something went wrong. Please try again.',
      envelope.details ?? null,
      status,
    );
  }

  /**
   * No response at all — server down, DNS failure, timeout, CORS preflight refused.
   * The axios message for these ("Network Error", "timeout of 15000ms exceeded") is
   * not something a user should read, so it is replaced rather than passed through.
   */
  static network() {
    return new ApiError(
      ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      'Cannot reach the server. Check your connection and try again.',
      null,
      null,
    );
  }

  /**
   * A response arrived but not in our shape — a proxy error page, a gateway
   * timeout, anything that never reached the Express error handler.
   */
  static malformed(status = null) {
    return new ApiError(
      ERROR_CODES.INTERNAL_ERROR,
      'The server returned an unexpected response. Please try again.',
      null,
      status,
    );
  }
}
