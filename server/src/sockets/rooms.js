/**
 * Room names. One function, and E5 uses no other room.
 *
 * A room is a string, and a string typed in two places is two rooms — one that gets
 * joined and one that gets emitted to, with no error anywhere and a screen that never
 * updates. That is the whole reason this file exists for a single template literal.
 *
 * **`session:{sessionId}` is here as of PR 6.2**, and the paragraph this replaces
 * predicted it: E6 owns it, because the only events addressed to it — the block
 * warning, the extension, the end of a session — are E6's, and the rule was that the
 * function arrives in the PR that emits to it. That is this one. `events.js` gains its
 * five emitters in the same diff.
 *
 * **The two rooms are not the same kind of thing, and that difference is the whole
 * security question in the socket layer.** `user:{userId}` is *assigned*, in `auth.js`,
 * at handshake time, from a verified identity — it cannot be wrong. `session:{id}` is
 * *joined*, on request, carrying an id the client chose. So `handlers.session.js`
 * checks participation against the database before joining and refuses silently.
 *
 * **A room name is not a capability.** A uuid appears in URLs, logs and screenshots,
 * and being able to name a room must not be the same as being allowed into it.
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

/**
 * The room both participants of one session are in — the address for the block
 * warning, the extension, the end, and the other side walking out.
 *
 * **Per session and not per user, because these five events are about a session and
 * both people need them at the same instant.** The alternative is two `emitToUser`
 * calls per event with the ids fetched first, which is one query per emit and two
 * chances to send to one side and not the other — and 6.5's warning is the moment a
 * student decides whether to spend, so a teacher whose clock disagrees is watching a
 * different session.
 *
 * The `session:` prefix keeps this namespace off `user:`'s, and off a socket's own id:
 * Socket.IO puts every socket in a room named after its id, so an unprefixed uuid could
 * in principle be both a session room and a connection.
 *
 * **Nothing is in this room unless it asked and was checked.** `handlers.session.js` is
 * the only caller of `socket.join` for it, and `events.js` the only caller that emits
 * to it.
 *
 * @param {string} sessionId `sessions.id`
 * @returns {string}
 */
export function sessionRoom(sessionId) {
  return `session:${sessionId}`;
}
