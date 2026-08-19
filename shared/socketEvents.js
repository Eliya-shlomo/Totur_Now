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

  // The header above is E5's and four of the five names it says are unappended are
  // appended here. That paragraph is not edited, deliberately: this file is
  // APPEND-ONLY (docs/OWNERSHIP.md §2) and 6.2's acceptance criteria say the diff
  // shows additions only. It was right when it was written — the rule it states is
  // "added by the epic that emits them", and this is that epic.
  //
  // Six names, and §13's catalogue is complete except `wallet:updated`, which stays
  // E7's: E6 has no wallet screen to update, and the session screen learns its
  // balance from `session:extended`, which it is already listening to.
  //
  // **All five server → client names ship here and none is called until 6.5.** Same
  // property the five above kept through 5.1: one emitter each, in
  // `server/src/sockets/events.js`, and nothing else in the server calls `emit`.
  //
  // **`session:join` is the epic's one client → server event and the only place a
  // socket joins a second room.** `user:{userId}` comes from the verified handshake
  // and cannot be wrong; this one carries an id from the client, so membership is
  // checked against the database before the join and a refusal is silent. **A room
  // name is not a capability.**

  // ── E6, server → client ────────────────────────────────────────────────────
  SESSION_BLOCK_WARNING: 'session:block_warning',
  SESSION_EXTENDED: 'session:extended',
  SESSION_ENDED: 'session:ended',
  /** The other person's last socket went away mid-session. E5 README, gap 11. */
  SESSION_PARTICIPANT_LEFT: 'session:participant_left',
  /** "Still there?" at 55 minutes. §10, and the constant's first reader. */
  TEACHER_AWAY_WARNING: 'teacher:away_warning',

  // ── E6, client → server ────────────────────────────────────────────────────
  SESSION_JOIN: 'session:join',
};
