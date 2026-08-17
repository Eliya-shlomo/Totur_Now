/**
 * Socket.IO event names — the single source for client and server.
 *
 * Here for the reason `errorCodes.js` is here: the client switches on the same
 * strings the server emits, and two drifting lists is a silent bug that no type
 * checker in this repo would catch. A renamed event that only one side learns about
 * produces a screen that never updates and no error anywhere.
 *
 * APPEND-ONLY (docs/OWNERSHIP.md §2). The order below is the one in the epic
 * README's contract freeze, copied verbatim rather than re-sorted — the freeze is
 * what both sides agreed to, and a list that gets tidied is a list that gets edited.
 *
 * **Six names, and MVP.md §13 lists eleven.** The other five —
 * `session:block_warning`, `session:extended`, `session:ended`, `session:join` and
 * `wallet:updated` — belong to subsystems that do not exist: three to E6's meter and
 * one to E7's wallet. E5 appends none of them, because a catalogue of names nothing
 * emits stops being a catalogue you can trust. They are added by the epic that emits
 * them, in the PR that emits them.
 *
 * Every server → client name below has exactly one emitter, in
 * `server/src/sockets/events.js`. Nothing else in the server calls `emit`.
 */
export const SOCKET_EVENTS = {
  // ── server → client ─────────────────────────────────────────────────────────
  /** A teacher's incoming offer. Payload: `IncomingOffer` (shared/api.d.ts). */
  OFFER_NEW: 'offer:new',
  /** Nobody answered in time. Sent to both sides. Payload: `{ offerId, sessionId }`. */
  OFFER_EXPIRED: 'offer:expired',
  /** The student's offer was accepted. Payload: `{ offerId, sessionId }`. */
  OFFER_ACCEPTED: 'offer:accepted',
  /** The teacher declined. Payload: `{ offerId, sessionId }`. */
  OFFER_REJECTED: 'offer:rejected',
  /** A teacher's availability changed. Payload: `{ teacherId, status }`. */
  TEACHER_STATUS: 'teacher:status',

  // ── client → server ─────────────────────────────────────────────────────────
  /** The teacher's tab saying it is still there. Consumed by PR 5.2. */
  TEACHER_HEARTBEAT: 'teacher:heartbeat',
};
