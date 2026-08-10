/**
 * Server-side access to the shared error codes.
 *
 * Re-export only — `shared/errorCodes.js` is the single source (docs/CONVENTIONS.md).
 * Never define a code here: the client switches on the same values, and two lists
 * drifting apart is a bug nothing catches.
 */
export { ERROR_CODES, ERROR_STATUS } from '@tutor/shared';
