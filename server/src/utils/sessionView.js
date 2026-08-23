/**
 * The one shape a session leaves the server in once it is `ACTIVE` — `SessionState`
 * in `shared/api.d.ts`. PR 6.3, MVP.md §12 and §14.3.
 *
 * **One shape, two fillings, and the fillings differ by exactly two fields.** The
 * student sees their `balance` and the teacher sees their `teacherEarning`; each sees
 * `null` where the other's number is. `role` tells the client which side it got, and
 * 6.7 renders one screen from it rather than two.
 *
 * **The forbidden field is `null` and the key is always present.** A renderer cannot
 * tell an absent key from a forbidden one, and `SessionState` types both fields
 * `number | null` for that reason. This is the opposite call to `offer:accepted`,
 * where 5.4 omits the room URL entirely — and the difference is that there the absence
 * is permanent and here it is per-caller.
 *
 * **No room URL and no token, on either side.** `hasVideo` is a boolean and that is
 * the whole of what this payload says about video. The URL is a join capability; it
 * leaves the server through `GET /sessions/:id/video` (6.4), once, beside a token
 * minted for one caller and expiring in an hour. A session payload that carried the
 * URL would make every reload of this screen a reusable invitation.
 *
 * **This file is pure.** No Prisma import, no clock, no `req`, and nothing here reads
 * a second row — the balance arrives as an argument because it lives in `wallets` and
 * a serializer that fetched it would be a repository. That is what lets the whole
 * shape be asserted with no database, which is where the two role-only fields are
 * actually checked.
 *
 * `brief`, `topicLabel` and `level` are derived exactly as `offerView.js` derives them,
 * including the subtopic-over-topic preference and the estimate-over-declaration order.
 * The same question must not describe itself differently either side of an accept.
 */

/**
 * The session, shaped for whoever is asking.
 *
 * `blocksUsed`, `totalCharged` and `teacherEarning` are read off the row rather than
 * computed. **At 6.3 all three are `0` and that is not a billing bug** — the opening
 * block is charged by 6.5, inside the activation transaction, and the teacher is
 * credited by 6.6 at the end. A serializer that derived the earning from a commission
 * rate would be a second answer to "what did I make", free to disagree with the column
 * E7's ledger reconciles against.
 *
 * `counterpart` degrades to `null` rather than throwing when the other participant's
 * row is missing. `onDelete: Restrict` on both relations means it cannot be, so this is
 * a guard against a shape that never arrives rather than a case with a product meaning
 * — and a 500 in its place would take down a live session's screen over a row nobody
 * can delete.
 *
 * @param {object} params
 * @param {object} params.session a `findSessionForView` row, at `ACTIVE` or past it
 * @param {'student'|'teacher'} params.role which side is asking
 * @param {number|null} params.balance the student's credits; ignored for the teacher
 * @returns {import('@tutor/shared').SessionState}
 */
export function toSessionState({ session, role, balance = null }) {
  const isStudent = role === 'student';
  const counterpart = isStudent ? session.teacher : session.student;

  return {
    sessionId: session.id,
    status: session.status,
    role,

    counterpart: counterpart
      ? {
          userId: counterpart.id,
          fullName: counterpart.fullName,
          avatarUrl: counterpart.avatarUrl ?? null,
        }
      : null,

    brief: session.question?.teacherBrief ?? '',
    topicLabel: session.question?.subtopic?.nameEn ?? session.question?.topic?.nameEn ?? null,
    level: session.question?.estimatedLevel ?? session.question?.declaredLevel ?? null,

    pricePerBlock: session.pricePerBlock ?? 0,
    blocksUsed: session.blocksUsed ?? 0,
    totalCharged: session.totalCharged ?? 0,
    budgetCap: session.budgetCap ?? 0,

    // The two role-only fields. Always both keys, always one of them null.
    balance: isStudent ? (balance ?? null) : null,
    teacherEarning: isStudent ? null : (session.teacherEarning ?? 0),

    startedAt: toIso(session.startedAt),
    endsAt: toIso(session.endsAt),
    endedAt: toIso(session.endedAt),
    endReason: session.endReason ?? null,

    // The name, never the URL. `video_room_name` is null when 6.3's `fetch` failed and
    // 6.4's first join is what repairs it, so this boolean is allowed to be `false` on
    // a perfectly healthy `ACTIVE` session.
    hasVideo: session.videoRoomName != null,

    // `RATED` is reached by exactly one write — 6.6's review — and `reviews.session_id`
    // is `UNIQUE`, so the status is the review's existence. A second read of `reviews`
    // to answer the same question would be a second source of truth for it.
    isRated: session.status === 'RATED',
  };
}

/** ISO 8601 UTC, or `null`. Every instant on the wire is absolute — 5.8's lesson. */
function toIso(value) {
  return value ? value.toISOString() : null;
}
