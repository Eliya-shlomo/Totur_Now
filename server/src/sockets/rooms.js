/**
 * Room names. One function, and E5 uses no other room.
 *
 * A room is a string, and a string typed in two places is two rooms — one that gets
 * joined and one that gets emitted to, with no error anywhere and a screen that never
 * updates. That is the whole reason this file exists for a single template literal.
 *
 * **`session:{sessionId}` is not here, and its absence is deliberate.** MVP.md §13
 * lists it and E6 owns it, because the only events addressed to it — the block
 * warning, the extension, the end of a session — are E6's. A room nothing joins is a
 * room that will be joined wrongly later, in the same way a catalogue of event names
 * nothing emits stops being trustworthy. E6 adds the second function in the PR that
 * emits to it.
 *
 * Every socket joins exactly one room, in `auth.js`, at handshake time. There is no
 * join-later call anywhere in the epic: the room is a function of who you are, and
 * who you are is decided when the connection is authenticated.
 */

/**
 * The room every one of a user's tabs is in — the address for anything meant for a
 * person rather than a connection.
 *
 * Per user and not per socket, because a teacher with the dashboard open in two tabs
 * is one teacher, and an offer that arrived in only one of them is an offer they may
 * not see. Socket.IO delivers a room emit to every socket in it, so both tabs raise
 * the modal and both stop when the offer is answered.
 *
 * The prefix is not decoration. `user:` keeps this namespace from colliding with
 * `session:` when E6 adds it, and with a socket's own id — Socket.IO puts every
 * socket in a room named after its id, so an unprefixed uuid could in principle be
 * both a user room and a connection.
 *
 * @param {string} userId `users.id`
 * @returns {string}
 */
export function userRoom(userId) {
  return `user:${userId}`;
}
