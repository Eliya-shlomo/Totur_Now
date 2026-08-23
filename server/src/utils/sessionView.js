import { UNCLASSIFIED_TOPIC_ID } from '#config/constants/index.js';

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

// ── E8 ───────────────────────────────────────────────────────────────────────

/**
 * One finished session, from the student's side — `SessionHistoryRecord`, PR 8.4.
 *
 * **A second serializer in this file rather than a widened `toSessionState`.** The live
 * shape is one session read by two roles at the same moment; this one is a list of rows
 * that are already over, read by exactly one of those roles. They agree on four fields
 * and disagree on everything the screen is for: no counterpart, no clock, no balance, no
 * `hasVideo`, and a `review` that `SessionState` answers with a boolean.
 *
 * **`review` is `null` on an `ENDED` row and that is the actionable state, not an empty
 * one.** §10 makes the rating the only edge out of `ENDED`, so a session that has one is
 * finished and a session that does not is a screen the student closed. The client links
 * that row back to `/app/session/:id/review`; a serializer that flattened the absence
 * into `stars: null` would make an unrated session indistinguishable from one rated
 * without stars, which is the most common rating in the product.
 *
 * **`stars` stays `null` and is never coerced**, for the reason `toTeacherReview` states
 * and `session.review.service.js` spends a paragraph on: `isResolved` is the only
 * required field on a review (§6.2), so a `?? 0` here would turn "no opinion" into the
 * harshest rating a student can give — on their own receipt this time.
 *
 * **No minutes.** They are `blocksUsed × block.minutes` and `client/src/lib/credits.js`
 * owns that translation for the whole product, from the `block.minutes` that
 * `GET /public/pricing` derives from the same constant the wallet charges against. A
 * server-computed minute figure would be a second rounding of a number the client already
 * renders, shown next to the first. E7 ruled on this for `GET /wallet` and the ruling
 * holds.
 *
 * **No money beyond `totalCharged`, and it is read off the column.** Not summed from
 * `session_blocks` and not read back out of `wallet_transactions`: `reconcile.mjs`
 * invariant 2 already checks those two agree, and a third computation of the same number
 * is 7.9's shape — one rule, three call sites, two of them wrong.
 *
 * Pure, like everything else in this file: no Prisma, no clock, no `req`.
 *
 * @param {object} session a `findStudentSessionPage` row
 * @returns {import('@tutor/shared').SessionHistoryRecord}
 */
export function toSessionHistoryRecord(session) {
  const question = session.question;

  return {
    sessionId: session.id,
    status: session.status,
    endedAt: toIso(session.endedAt),

    // `onDelete: Restrict` on the relation is what makes the teacher present rather than
    // merely likely — but the column is nullable, and a history row is a receipt: a name
    // that came back missing degrades to an empty string here rather than taking the
    // whole list down over one row nobody can delete.
    teacher: { id: session.teacher?.id ?? '', fullName: session.teacher?.fullName ?? '' },

    topicLabel: topicLabelOf(question?.subtopic) ?? topicLabelOf(question?.topic) ?? null,
    questionTitle: question?.title ?? null,

    blocksUsed: session.blocksUsed ?? 0,
    totalCharged: session.totalCharged ?? 0,

    review: session.review
      ? { stars: session.review.stars ?? null, isResolved: session.review.isResolved }
      : null,
  };
}

/**
 * One topic's label, or `null` when there is nothing worth labelling.
 *
 * **The sentinel is excluded by id, and it has to be excluded at all because it is a real
 * row with a real name.** `topics` id `0` is seeded as "General / Unclassified" (§8.1's
 * fallback), so a plain name chain answers that label for every question the classifier
 * could not place — a chip on a history row reading *general / unclassified* says less
 * than no chip at all. The comparison is written against the constant rather than as
 * `if (topic.id)`, because a real topic id is never zero and a reader of the truthiness
 * check cannot tell that.
 *
 * English first, Hebrew as the fallback — `topicName()` on the client states the rule and
 * every label-resolving serializer on the server follows it, so a taxonomy row seeded
 * without an English name renders as something rather than as nothing.
 *
 * **`teacherView.js` carries the same eight lines and this is deliberately not an
 * import.** That file is 8.3's and is not on this PR's allowlist, and a third home for
 * the rule — a shared `topicLabel.js` — is a file this PR was not given either. Both
 * copies name the other, which is the arrangement `PARENT_TOPIC_WEIGHT` already has: two
 * implementations of one rule is one more than the repo wants, and the next person to
 * change one should know there are two. Unifying them is filed in E8's retro, not
 * smuggled in here.
 */
function topicLabelOf(topic) {
  if (!topic || topic.id === UNCLASSIFIED_TOPIC_ID) return null;

  return topic.nameEn || topic.nameHe;
}
