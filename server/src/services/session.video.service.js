import { ERROR_CODES } from '#config/errors/codes.js';
import { findSessionForVideo } from '#repositories/session.repository.js';
import { attachSessionVideo } from '#services/session.activate.service.js';
import { AppError } from '#utils/AppError.js';
import { logger } from '#utils/logger.js';

/**
 * *May this person join this call, and which room is it?* — PR 6.4, and the epic's
 * security boundary. `OWNERSHIP.md` §2.1's third function.
 *
 * ## Why a file with `video` in its name is DEV-B's
 *
 * Because it reads the `sessions` table, and the video layer may not. The seam is not
 * "everything with the word video in it belongs to C" — it is "the provider SDK and
 * nothing else". A helper that answers *may this person join* is a session-authorisation
 * question wearing a video name, and 6.1's `video.service.js` is left with what it can
 * answer alone: given a room name, a user id and a display name, mint a token.
 *
 * **This is the replacement for the two endpoints 6.1 deleted, and the difference is the
 * whole point.** `POST /video/access` took a room name from the request *body* and minted
 * a token for it behind nothing but `authenticate`: any logged-in stranger who had seen a
 * room name could walk into a lesson, and pick the name on their tile on the way in. This
 * takes a **session id** and asks the database whether the caller is in it.
 *
 * ## Three checks, one read, one answer
 *
 * 1. the session exists
 * 2. its status is `ACTIVE`
 * 3. `userId` is its `student_id` or its `teacher_id`
 *
 * **Every failure is `NOT_FOUND`. Never `FORBIDDEN`, and never a different message per
 * cause.** A `403` on a session id confirms the session is real, and uuids appear in
 * URLs, logs and screenshots. `GET /sessions/:id` already made this call in 5.4, and the
 * two must not disagree — a `404` from one beside a `403` from here is an oracle built
 * out of two individually correct decisions.
 *
 * The three causes are distinguishable in the **log**, at `warn`, with the caller's id,
 * and nowhere else. That is what makes the brief's manual run possible: three warn lines
 * for three different causes, all of which were one response over the wire.
 *
 * **`ACTIVE` is an allowlist and not `!== 'ENDED'`.** `PENDING`, `OFFER_SENT`,
 * `CANCELLED`, `NO_SHOW` and `RATED` all fail closed. An `ENDED` session's participants
 * still read `GET /sessions/:id` — they need the summary and the rating screen — but
 * nobody gets a fresh meeting token for a lesson that is over.
 */
const defaultDeps = {
  loadSession: findSessionForVideo,
  repairRoom: attachSessionVideo,
};

/**
 * The room this caller may join, and the name they join it under.
 *
 * **`userName` comes from the row and from nothing else.** It is what goes on the tile,
 * and it is read in the same query as the participation check — both participants' names
 * come back and this picks the caller's, so there is one place that decides whose name
 * this is. Nothing on the request can influence it.
 *
 * **No token here, and no `roomUrl` reaching any other payload.** This returns what
 * `createSessionVideoAccess` needs and the controller mints per call; `toSessionState`
 * (6.3) deliberately carries `hasVideo` as a boolean instead, because a URL is a join
 * capability and a session payload that carried it would make every reload a reusable
 * invitation.
 *
 * @param {string} sessionId a uuid, already shape-checked by `sessionByIdSchema`
 * @param {string} userId the caller, from `req.user.id`
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{roomName: string, roomUrl: string, userName: string}>}
 */
export async function getSessionVideoContext(sessionId, userId, deps = defaultDeps) {
  const collaborators = { ...defaultDeps, ...deps };
  const session = await collaborators.loadSession(sessionId);

  // Three `warn` lines, three causes, and one `AppError.notFound('Session')` under all
  // of them. The messages below are the operator's; the caller reads the same sentence
  // whichever branch they took.
  if (!session) {
    logger.warn('Video requested for a session that does not exist', { sessionId, userId });

    throw notFound();
  }

  if (session.status !== 'ACTIVE') {
    logger.warn('Video requested for a session that is not active', {
      sessionId,
      userId,
      status: session.status,
    });

    throw notFound();
  }

  const isStudent = session.studentId === userId;
  const isTeacher = session.teacherId === userId;

  if (!isStudent && !isTeacher) {
    logger.warn('Video requested by somebody who is not in the session', { sessionId, userId });

    throw notFound();
  }

  // The caller's own row, picked from the read that just proved they are in this
  // session. `users.full_name` is `NOT NULL` and both relations are `onDelete: Restrict`,
  // so a participant always has a name — and a second query keyed by `req.user.id` would
  // be a second place that decides whose name goes on the tile.
  const userName = (isStudent ? session.student : session.teacher).fullName;

  // The ordinary path: 6.3 minted the room after its commit and both columns are set.
  if (session.videoRoomName && session.videoRoomUrl) {
    return { roomName: session.videoRoomName, roomUrl: session.videoRoomUrl, userName };
  }

  return repairSessionVideo({ sessionId, userId, userName, collaborators });
}

/**
 * 6.3's degraded case, repaired on the first join — **once, and only when the columns
 * are null.**
 *
 * A Daily outage at accept time leaves an `ACTIVE` session with no room: `activateAcceptedOffer`
 * logs it and answers `200` anyway, because an accept that 500s because a video provider
 * is down is a worse product than a session with no camera. So the outage costs nothing
 * permanent as long as it has ended by the time somebody presses join.
 *
 * **`attachSessionVideo` is 6.3's, called rather than reimplemented**, and it was
 * exported for this. It creates the room and persists it through `setSessionVideoRoom`,
 * whose `where` matches on `video_room_name IS NULL` — so two participants pressing join
 * in the same second create at most one *persisted* room, and the loser's is litter that
 * expires in 24 hours. It resolves to a boolean and never rejects.
 *
 * **The boolean is not read, and that is deliberate.** `false` means either "somebody
 * else minted it first" or "Daily failed again", and this path treats them identically:
 * re-read the row and believe it. The winner's room is the answer for both callers, and
 * a branch on the boolean would be this function deciding something the row already
 * knows.
 *
 * Still null after that is the one genuine `EXTERNAL_SERVICE_ERROR` (502) on this
 * endpoint — 6.3 could swallow the failure because nothing was waiting on a camera, and
 * here the caller asked for a call and cannot have one. 6.7's screen renders everything
 * else.
 */
async function repairSessionVideo({ sessionId, userId, userName, collaborators }) {
  logger.warn('Video requested for an active session with no room; creating one now', {
    sessionId,
    userId,
  });

  await collaborators.repairRoom(sessionId);

  const repaired = await collaborators.loadSession(sessionId);

  if (!repaired?.videoRoomName || !repaired?.videoRoomUrl) {
    throw new AppError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Video is not available right now.');
  }

  return { roomName: repaired.videoRoomName, roomUrl: repaired.videoRoomUrl, userName };
}

/**
 * The one failure this file has. Written once so that no later edit can give a cause its
 * own status, code or sentence — which is the defect 6.4's review checklist opens with.
 */
function notFound() {
  return AppError.notFound('Session');
}
