/**
 * Application-wide constants that belong to no single domain.
 */

/**
 * The timezone every business rule is expressed in.
 *
 * The platform serves Israel, but the server does not run there — Render runs UTC.
 * Anything that reasons about wall-clock time (commission-free hours, daily
 * reports, cron windows) must resolve through this rather than through
 * `new Date().getHours()`, which silently answers in the host's timezone and would
 * shift every rule by two or three hours once deployed.
 *
 * Timestamps stored in the database stay UTC. This is for interpretation only.
 */
export const TIMEZONE = 'Asia/Jerusalem';
