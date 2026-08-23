import { DEFAULT_PAGE_SIZE } from '#config/constants/index.js';
import { prisma } from '#config/db.js';

/**
 * Every read and every state transition E5 makes on `sessions`, plus the two
 * conditional updates on `teacher_profiles` that are the lock — MVP.md §11.3, §12.
 *
 * **This file is frozen after PR 5.1**, with two deliberate gaps: `lockTeacherForOffer`
 * and `releaseTeacherLock` are declared, documented and empty, and 5.3 and 5.4
 * respectively fill in one `updateMany` each. That is 4.1's `findCandidates`-without-a-
 * `where` arrangement, verbatim, and it exists so that the four lines that decide the
 * epic get their own diff instead of being buried in an L-sized one.
 *
 * Nothing else here is unfinished, and nothing else in the epic may open this file.
 * A query discovered missing mid-5.4 is a frozen file being reopened, which is the
 * failure the freeze exists to prevent — if something is genuinely absent, that is a
 * note in the epic README and its own small PR, never an edit in passing.
 *
 * **That happened twice, and both are recorded rather than hidden.** 5.4 added
 * `setSessionPending` here: this file wrote sessions forwards only, §10's diagram has
 * an arrow back, and a reject had no writer to make it — which left a rejected
 * session stuck at `OFFER_SENT`, where 5.3's `PENDING` assertion refuses every future
 * **Send request** and the student's question is unanswerable for good. The note is
 * the epic README's tenth gap and the PR is 5.4 rather than a separate one, because
 * the diff is the same either way and this epic has one developer. It is the only
 * function 5.4 added, beside `releaseTeacherLock`'s body, which was 5.4's by the
 * freeze. `git log --oneline -- server/src/repositories/session.repository.js` now
 * names three PRs, and that is the mechanism working rather than failing.
 *
 * The second is `findTeacherForNotification`, added by 5.6 and documented at the
 * function. The epic README's ninth gap called it before either PR was written —
 * `expectedEarning` had no backing read — so unlike the first it is a reopen that was
 * planned in writing, which is the difference between the mechanism working and the
 * freeze quietly eroding.
 *
 * Three rules everything here follows:
 *
 * **Nothing outside `session.*.service.js` writes `status`.** CONVENTIONS.md's fourth
 * iron rule, and `sessions.prisma` says the same thing at the top of the model. The
 * writers below take their arguments already decided; none of them contains a product
 * rule about when a transition is legal.
 *
 * **Every writer takes a `tx`.** Each of these runs inside a transaction that is
 * already holding a row — the offer's, or the teacher's — and a write that quietly
 * used the global client would commit outside it. The parameter is required rather
 * than defaulted to `prisma` for that reason: an omitted transaction should be a
 * missing argument, not a silent second connection.
 *
 * **This file has its own `findWalletBalance`.** `matching.repository.js` has one
 * too, and E5 does not import it. That file is E4's and frozen since 4.2; a
 * cross-epic import to save eight lines is how a frozen file acquires callers it
 * cannot see.
 *
 * **Two functions here are not in 5.1's brief, and were added while implementing it.**
 * `incrementOffersReceived` and `setTeacherInSession` — the brief's own review
 * checklist says to read the function list against the epic README before freezing,
 * because "a missing query is discovered mid-5.4, in a file that is by then frozen".
 * Reading it turned up that nothing anywhere in this codebase writes
 * `offers_received`, `offers_accepted`, or the `IN_SESSION` status: the seed sets the
 * two counters as fixtures, `matching.scoring.js` reads them as §9.2's acceptance
 * rate, and E5 is the first writer of all three. Without these, 5.3 has no way to
 * count an offer, 5.4 has no way to finish its fourth step, and every teacher's
 * acceptance rate stays permanently at the platform prior — a defect that would pass
 * every test it has, which is the same shape as E4's inverted ranking. The gap is
 * written into the PR description rather than left in a comment.
 */

/**
 * The session behind a **Send request** — `POST /sessions/:id/offer` (5.3).
 *
 * **Not `QUESTION_VIEW`, and not E4's `MATCHING_QUESTION_VIEW` either.** 3.1 refuses
 * to select `rejectedBy` into a student-facing payload, 4.1 refuses to reuse a
 * serializer's select for a matching read, and this is the third consumer wanting a
 * third shape: what 5.3 needs to write an offer and what 5.6's email needs to render
 * it. The three shapes are allowed to diverge; that is the point of having three.
 *
 * The question's fields ride along on the same statement rather than in a second
 * read. E2's N+1 lesson, and this one runs on the hot path of the epic's only
 * transaction.
 *
 * Ownership is not filtered here, the same call 3.1 and 4.1 both made: the caller
 * compares `studentId` and answers `NOT_FOUND` for a stranger's session rather than
 * `FORBIDDEN`, because `FORBIDDEN` would confirm the id exists. A `where` on the
 * student would make those two cases indistinguishable from a missing row.
 *
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function findSessionForOffer(sessionId) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      studentId: true,
      questionId: true,
      question: {
        select: {
          teacherBrief: true,
          howToStart: true,
          topicId: true,
          subtopicId: true,
          estimatedLevel: true,
          declaredLevel: true,
        },
      },
    },
  });
}

/**
 * What `GET /sessions/:id` answers with, for both sides (5.4).
 *
 * One select for two audiences, and the branch is the service's. The row carries
 * everything either side may see; 5.4 decides which fields reach the student's
 * payload and which reach the teacher's `IncomingOffer`, because *what you may see*
 * is a product rule and a repository that split it in two would be answering it.
 *
 * `offers` is narrowed to the most recent one. A session collects a row per attempt
 * — reject, pick another teacher, reject again — and every consumer of this read
 * means the current one. `take: 1` on `createdAt desc` rather than a `status` filter,
 * because an expired offer is still the one the screen has to explain.
 *
 * `topic` comes back with its name so `IncomingOffer.topicLabel` needs no second
 * query. It is nullable in the schema and null on the sentinel path, which is a legal
 * question and not an error.
 *
 * ## Widened in 6.3, and it is this file's fourth entry in `git log` — deliberately
 *
 * From 6.3 this same read also answers `SessionState` for a session at `ACTIVE` or
 * past it, and the 5.4 select could not: the contract asks for `blocksUsed`,
 * `totalCharged`, `budgetCap`, `endedAt`, `endReason`, whether a room exists, and the
 * counterpart's name and avatar, and none of those was here. **Nothing is removed and
 * nothing is reordered** — every 5.4 consumer reads exactly what it read before, and
 * the columns below it are additions.
 *
 * The alternative was a second read beside this one, which is the arrangement 3.1, 4.1
 * and 5.1 each chose when two consumers wanted genuinely different *shapes*. These two
 * want the same row at two points in its life, which is one shape read twice; a second
 * `select` would be a second place to remember a column the day one is added. The
 * reopen is in 6.3's PR description and in the epic README's gap list, which is the
 * header's own procedure rather than an edit in passing.
 *
 * **`videoRoomUrl` is deliberately not selected and `videoRoomName` is.** The name
 * answers `SessionState.hasVideo`, a boolean; the URL is a join capability and leaves
 * the server through `GET /sessions/:id/video` alone, beside a token minted for one
 * caller. A row that carried the URL into this serializer would be one `...session`
 * away from publishing it.
 *
 * **`student` and `teacher` are selected as rows, not just as ids.** `SessionState`'s
 * `counterpart` is whichever of the two is not the caller, so both come back and the
 * service picks. `onDelete: Restrict` on both relations is what makes the chosen one
 * present rather than merely likely.
 *
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function findSessionForView(sessionId) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      studentId: true,
      teacherId: true,
      questionId: true,
      pricePerBlock: true,
      startedAt: true,
      endsAt: true,
      budgetCap: true,
      blocksUsed: true,
      totalCharged: true,
      teacherEarning: true,
      videoRoomName: true,
      endedAt: true,
      endReason: true,
      student: { select: { id: true, fullName: true, avatarUrl: true } },
      teacher: { select: { id: true, fullName: true, avatarUrl: true } },
      question: {
        select: {
          teacherBrief: true,
          howToStart: true,
          estimatedLevel: true,
          declaredLevel: true,
          topic: { select: { id: true, nameHe: true, nameEn: true } },
          subtopic: { select: { id: true, nameHe: true, nameEn: true } },
        },
      },
      offers: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          teacherId: true,
          expiresAt: true,
          respondedAt: true,
          createdAt: true,
        },
      },
    },
  });
}

/**
 * The session a teacher is currently being held for, or `null`. **Added by the offer
 * delivery fix on top of 5.8**, and it exists because `offer:new` is a live frame with
 * nobody to catch it when the teacher's socket is not connected.
 *
 * A teacher who logs in *after* the student pressed **Send request**, or who reloads
 * mid-offer, holds the lock — their header even says "Offer pending" — and sees no
 * modal at all, because the only thing that raises it is a frame that was emitted
 * before their socket existed. 5.7 scoped the rehydrate out and said so; this is the
 * read that closes it, from the socket handshake rather than from a new endpoint.
 *
 * `findFirst` and not `findUnique`: no constraint says a teacher has at most one
 * `OFFER_SENT` session, and the thing that actually guarantees it is 5.3's conditional
 * lock. Ordered newest first so that a row left behind by a failure the lock is meant
 * to prevent resolves to the current offer rather than to a corpse — and so that the
 * absence of a unique index is not quietly relied on.
 *
 * Only the id is selected. The caller answers with `getSessionView`, which is the one
 * place that knows how to shape an offer for a teacher.
 *
 * @param {string} teacherId `sessions.teacher_id`
 * @returns {Promise<{id: string}|null>}
 */
export async function findOfferSessionForTeacher(teacherId) {
  return prisma.session.findFirst({
    where: { teacherId, status: 'OFFER_SENT' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
}

/**
 * The two fields the notification path needs and no other read in E5 returns —
 * `teacher_profiles.created_at` and the teacher's address. PR 5.6.
 *
 * **This is the epic README's ninth gap, and it is a second deliberate reopen of a
 * frozen file.** `IncomingOffer.expectedEarning` is the teacher's cut after §5.3's
 * commission, and `platformFeeRate` cannot answer without a start date.
 * `TEACHER_VIEW` excludes `createdAt` and refuses `email` by explicit design —
 * `teacher.repository.js`'s header lists both — and both session reads above are
 * about the session. So 5.3 shipped with `feeRateFor` resolving to `0` for
 * everybody, `offer.send.test.js` pinned that as a known defect, and 5.6 is the PR
 * that renders the number to a human for the first time. It closes here.
 *
 * The README prescribed this as its own small PR before 5.6. It is inside 5.6
 * instead, by decision: the diff is the same either way, this epic has one
 * developer, and a repository function whose only two callers are in the same PR is
 * easier to review beside them than a week earlier. Said in 5.6's description rather
 * than left for `git log --oneline -- server/src/repositories/session.repository.js`
 * to reveal, which now names four PRs.
 *
 * **Narrower than the README's sketch, which said "the card columns plus
 * `createdAt`".** The card columns are already in hand at the only call site —
 * `findTeacherById` supplied them before the lock — so re-reading them here would be
 * a second answer to `pricePerBlock` on the same request, free to disagree with the
 * one the transaction actually wrote to `sessions.price_per_block`. This returns the
 * two facts nobody has, and the caller keeps the row it already trusts.
 *
 * **`email` is read here and nowhere else, and it is why this read is E5's rather
 * than an amendment to `TEACHER_VIEW`.** That constant feeds `toTeacherCard` and
 * `toTeacherMe`, which serialize to a browser; a column added there ships to the
 * public teacher list the moment it lands. This one is consumed by
 * `notification.service.js`, reaches no payload and no socket event, and the call
 * site is after `COMMIT` on the notification path — so a teacher's address is never
 * loaded by the request that answers the student.
 *
 * `null` when the id has no `teacher_profiles` row. The caller is post-commit and
 * treats it as "send no email" rather than as an error: the offer already exists.
 *
 * @param {string} teacherId `teacher_profiles.user_id`
 * @returns {Promise<{createdAt: Date, user: {fullName: string, email: string}}|null>}
 */
export async function findTeacherForNotification(teacherId) {
  return prisma.teacherProfile.findUnique({
    where: { userId: teacherId },
    select: {
      createdAt: true,
      user: { select: { fullName: true, email: true } },
    },
  });
}

/**
 * **Declared here, left unimplemented. The body is PR 5.3's, and it is the only
 * thing 5.3 may add to this file.**
 *
 * This is the epic. §11.3's mechanism in one statement:
 *
 * ```sql
 * UPDATE teacher_profiles SET status = 'OFFER_LOCKED'
 *  WHERE user_id = $1 AND status = 'ONLINE'
 * ```
 *
 * Three things make it correct and each is easy to lose:
 *
 * **`updateMany`, never `update`.** `update` throws when it matches nothing and hands
 * back no count; `updateMany` returns `{ count }`, which is the `rowCount` §11.3 is
 * asking for. Prisma's `update` on a missing match is an exception in a transaction
 * that should be answering `TEACHER_UNAVAILABLE`.
 *
 * **The `WHERE` carries `status = 'ONLINE'`.** Without it two students both write
 * `OFFER_LOCKED` and both succeed. Under Postgres's default READ COMMITTED the second
 * transaction blocks on the row until the first commits, then re-evaluates its
 * predicate and matches zero — that re-evaluation is the entire mechanism.
 *
 * **The `tx` is not optional.** Outside the transaction that creates the offer, the
 * lock and the offer can commit independently and a crash between them leaves a
 * teacher locked with nothing to unlock them.
 *
 * The signature, the JSDoc and the `{ locked }` return type are frozen here. The
 * return is an object rather than a bare boolean so that 5.3 can add nothing to it
 * and 5.4 reads the same shape from `releaseTeacherLock`.
 *
 * **No test that runs requests in sequence exercises any of this.** Two browsers, the
 * day 5.3 merges.
 *
 * @param {string} teacherId               `teacher_profiles.user_id`
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{locked: boolean}>} `false` means somebody else won the race
 */
export async function lockTeacherForOffer(teacherId, tx) {
  const { count } = await tx.teacherProfile.updateMany({
    where: { userId: teacherId, status: 'ONLINE' },
    data: { status: 'OFFER_LOCKED' },
  });

  // `=== 1` rather than `> 0`: `userId` is the primary key, so a match of two is not
  // a thing that can happen, and the stricter comparison says so.
  return { locked: count === 1 };
}

/**
 * **Declared here, left unimplemented. The body is PR 5.4's**, and the only thing 5.4
 * may add to this file.
 *
 * The lock's mirror, and it has the same shape for the same reason:
 *
 * ```sql
 * UPDATE teacher_profiles SET status = 'ONLINE'
 *  WHERE user_id = $1 AND status = 'OFFER_LOCKED'
 * ```
 *
 * **The `WHERE` matters as much here as it does on the way in.** A teacher who closed
 * the tab while the offer was open is `OFFLINE`, and an unconditional write of
 * `ONLINE` puts them back in the candidate pool without them touching anything —
 * where they will be sent an offer they are not there to answer. `locked: false` back
 * from this call is not an error; it is "they had already moved on", which is exactly
 * what the condition is there to detect.
 *
 * Called by reject (5.4) and by the expiry sweep (5.5). Accept does not call it —
 * accept moves the teacher from `OFFER_LOCKED` to `IN_SESSION`, which is
 * `setSessionActive`'s side of the transaction and not a release.
 *
 * @param {string} teacherId               `teacher_profiles.user_id`
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{locked: boolean}>} `false` means they were not locked any more
 */
export async function releaseTeacherLock(teacherId, tx) {
  const { count } = await tx.teacherProfile.updateMany({
    where: { userId: teacherId, status: 'OFFER_LOCKED' },
    data: { status: 'ONLINE' },
  });

  // `=== 1` rather than `> 0`, matching the lock: `userId` is the primary key, so a
  // match of two cannot happen and the stricter comparison says so. The caller reads
  // `false` as "they had already moved on" — an `OFFLINE` teacher stays `OFFLINE` —
  // and not as an error, which is why nothing here throws.
  return { locked: count === 1 };
}

/**
 * `offers_received += 1`. Called by 5.3, inside the offer transaction.
 *
 * **Not in 5.1's brief — see the header.** §9.2 scores a teacher's acceptance rate as
 * `offers_accepted / offers_received`, smoothed against the platform's; a column
 * nothing increments makes that ratio the prior for every teacher forever, and the
 * scorer would go on working perfectly against data that never moves. The seed writes
 * both counters as fixtures, so the defect would be invisible on a seeded database
 * and appear only once real offers outnumbered demo ones.
 *
 * Unconditional, and it is the one write in this file that is: the teacher was locked
 * two lines earlier in the same transaction, so their status is already known, and a
 * predicate here could only fail for a reason the lock has already ruled out.
 *
 * Counted at send rather than at answer, which is what makes the ratio mean
 * "answered" instead of "received an answer" — an offer that expires unanswered is
 * exactly the case §9.2 wants to count against a teacher.
 *
 * @param {string} teacherId
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<object>} the updated `teacher_profiles` row
 */
export async function incrementOffersReceived(teacherId, tx) {
  return tx.teacherProfile.update({
    where: { userId: teacherId },
    data: { offersReceived: { increment: 1 } },
  });
}

/**
 * `OFFER_LOCKED` → `IN_SESSION`, and `offers_accepted += 1`. Step 4 of the accept
 * transaction (5.4).
 *
 * **Not in 5.1's brief — see the header.** `offer.controller.js` writes the step out
 * and the epic README writes it out twice, and there was no function to do it.
 *
 * Conditional on `OFFER_LOCKED`, like every other write to this column in this file,
 * and for the sharpest version of the same reason: an unconditional update would move
 * a teacher who is already `IN_SESSION` with somebody else into a second session and
 * increment their acceptance count for it. `locked: false` back from here means the
 * accept lost a race it must lose.
 *
 * The status and the counter move together because they are one fact — this teacher
 * took this offer — and splitting them across two statements leaves a window where a
 * crash produces a teacher in a session that was never accepted.
 *
 * @param {string} teacherId
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{locked: boolean}>} `false` means they were no longer locked
 */
export async function setTeacherInSession(teacherId, tx) {
  const { count } = await tx.teacherProfile.updateMany({
    where: { userId: teacherId, status: 'OFFER_LOCKED' },
    data: { status: 'IN_SESSION', offersAccepted: { increment: 1 } },
  });

  return { locked: count === 1 };
}

/**
 * `PENDING` → `OFFER_SENT`, with the price snapshot. The last write in 5.3's
 * transaction.
 *
 * **`pricePerBlock` is snapshotted onto the session, not read from the teacher
 * later.** `sessions.price_per_block` is nullable and its schema comment says it is
 * the offer-time value: a teacher who raises their price mid-session must not
 * reprice blocks already agreed to. The caller reads it from the teacher's own row
 * rather than from the request body — a price that arrives from the client is a
 * price the client can choose.
 *
 * `teacherId` is written here even though nobody has accepted yet. It is who the
 * offer went to, and `GET /sessions/:id` needs it to decide whether the caller is a
 * participant before any accept exists.
 *
 * Conditional on the session still being `PENDING`, and the count comes back for the
 * same reason the lock's does: two **Send request** presses that both passed the
 * status check are a double-booked student, and the second one must lose.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.teacherId
 * @param {number} params.pricePerBlock credits per block, from the teacher's row
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{count: number}>} `0` means the session had already moved
 */
export async function setSessionOfferSent({ sessionId, teacherId, pricePerBlock }, tx) {
  return tx.session.updateMany({
    where: { id: sessionId, status: 'PENDING' },
    data: { status: 'OFFER_SENT', teacherId, pricePerBlock },
  });
}

/**
 * `OFFER_SENT` → `ACTIVE`. Step 3 of the accept transaction (5.4), and **since 6.5 the
 * statement that starts the meter as well as the session.**
 *
 * `blocks_used` and `total_charged` arrive as arguments and are the opening block: the
 * charge that pays for them is `chargeStudent`, in this same transaction, two statements
 * later. E5 shipped this write with both at zero and said in three places that an
 * unbilled `ACTIVE` session was not a billing bug; that stopped being true here, and the
 * paragraph saying it is gone rather than left to age.
 *
 * `endsAt` is written anyway, from `OPENING_BLOCKS × BLOCK_MINUTES`, so that E6 has a
 * real deadline to extend rather than a null to special-case on its first tick. The
 * caller computes both instants; a repository that called `new Date()` would be
 * deciding when a session starts.
 *
 * Conditional on `OFFER_SENT`, so an accept that races the expiry sweep loses rather
 * than resurrecting a session the student has already left.
 *
 * **Widened in 6.2, and the widening changes nothing for E5's caller.** `blocksUsed`
 * and `totalCharged` default to `0`, which is exactly what this function already wrote
 * by leaving them to the column defaults — 5.4 passes neither and the row it produces
 * is byte-identical. 6.5 passes both, because the opening block is charged inside this
 * same transaction and a session that goes `ACTIVE` in one statement and acquires its
 * first block in another is a window where the meter reads zero on a session that has
 * been paid for.
 *
 * They are written explicitly rather than omitted-when-undefined, so that the row this
 * statement produces is a function of its arguments and not of what the column happens
 * to default to. A caller that means "no blocks yet" and a caller that forgot the
 * parameter must not be the same call.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {Date} params.startedAt
 * @param {Date} params.endsAt        `startedAt + OPENING_BLOCKS × BLOCK_MINUTES`
 * @param {number} [params.blocksUsed=0]   `OPENING_BLOCKS` from 6.5; 5.4 passes nothing
 * @param {number} [params.totalCharged=0] the opening charge from 6.5; 5.4 passes nothing
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{count: number}>}
 */
export async function setSessionActive(
  { sessionId, startedAt, endsAt, blocksUsed = 0, totalCharged = 0 },
  tx,
) {
  return tx.session.updateMany({
    where: { id: sessionId, status: 'OFFER_SENT' },
    data: { status: 'ACTIVE', startedAt, endsAt, blocksUsed, totalCharged },
  });
}

/**
 * `OFFER_SENT` → `PENDING`. The reject path (5.4), and the late-accept sweep with it.
 *
 * **Added in 5.4, in a file frozen at 5.1, and that is a deliberate reopen rather
 * than drift.** This file writes sessions forwards only — `setSessionOfferSent` and
 * `setSessionActive` — and §10's diagram has an arrow back that nothing here could
 * make. A reject with no writer for it leaves the session at `OFFER_SENT`, where
 * `session.offer.service.js`'s `PENDING` assertion refuses every future **Send
 * request**: the student's question is stuck, permanently, with no route out of it.
 * The header's procedure is "a note in the epic README and its own small PR"; the
 * note is in the README's gap list and in 5.4's description, and the PR is 5.4
 * because the diff is the same twelve lines either way and this epic has one
 * developer. It is the only function 5.4 adds here.
 *
 * **`teacherId` and `pricePerBlock` are cleared with the status.** They are who the
 * offer went to and what it cost, and the offer is over; a session that reads
 * `PENDING` while still naming a teacher is a row two readers will disagree about —
 * `GET /sessions/:id` decides who may see it from `teacherId`, and a rejecting
 * teacher must stop being a participant the moment they decline. The `offers` rows
 * keep the history, which is where the history belongs.
 *
 * `startedAt` and `endsAt` are not touched because nothing has set them: they are
 * written by `setSessionActive`, and a session that reaches here never reached
 * `ACTIVE`.
 *
 * Conditional on `OFFER_SENT`, like every other writer in this file. Zero means the
 * session had already moved — an accept that beat this reject, or a sweep — and the
 * caller decides what that means rather than seeing an exception.
 *
 * @param {string} sessionId
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{count: number}>} `0` means it was no longer `OFFER_SENT`
 */
export async function setSessionPending(sessionId, tx) {
  return tx.session.updateMany({
    where: { id: sessionId, status: 'OFFER_SENT' },
    data: { status: 'PENDING', teacherId: null, pricePerBlock: null },
  });
}

/**
 * The student's credit balance — the affordability re-check inside 5.3's transaction.
 *
 * E4 applied a ceiling when the list was built; between that screen and the **Send
 * request** button the balance could in principle have moved. This closes the gap
 * with one `SELECT` and no wallet service: it is a **read** of `wallets`, so it
 * crosses none of the seams §17.5 draws around money. Every write still goes through
 * `wallet.service.js`, which is E7's and does not exist yet.
 *
 * `null`, not `0`, when the row is missing. They are different facts — every
 * registered student gets a wallet, so an absent one is a data problem and not a poor
 * student — and the caller decides what to do with each. Same contract E4's own
 * `findWalletBalance` keeps, which is a thing two functions may agree on without one
 * importing the other.
 *
 * @param {string} userId
 * @returns {Promise<number|null>} credits, or `null` when there is no wallet row
 */
export async function findWalletBalance(userId) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { balance: true },
  });

  return wallet?.balance ?? null;
}

// ── E6 ───────────────────────────────────────────────────────────────────────
//
// The epic's whole read/write set, added at once in PR 6.2 and **not added to
// again**. This file already has three PRs in its `git log` and E5's retro named that
// as the discipline slipping; E6 adds exactly one more entry to that log. Everything
// 6.3 through 6.6 needs is written here, before any of it is called, so that a query
// discovered missing mid-6.5 is a conversation rather than an edit in passing.
//
// The three rules in this file's header still hold, and one of them carries the whole
// epic:
//
// **Nothing here contains a product rule about when a transition is legal.** That is
// `session.state.js`'s `assertTransition`, called by the service, inside the
// transaction, against the value the lock just read. The writers below take their
// arguments already decided.
//
// **The conditional writes are the second half of that guarantee and not a
// substitute for it.** `extendSession`, `endSession` and `setSessionRated` are
// `updateMany` returning a `count`, never `update`, and every caller checks the
// count. `assertTransition` refuses an edge that was never legal; a `count` of zero
// says somebody moved the row between the caller's read and its write. Either alone
// leaves one of the two failures silent, and both of them are money.
//
// **No literal status string is written by anything outside this file.** 6.2's
// acceptance criteria have a `grep` behind that.

/**
 * The room Daily minted for a session — 6.3 after its transaction commits, and 6.4's
 * repair path when 6.3's `fetch` failed.
 *
 * **No `tx`, and it is the one writer here without one.** 6.3 calls it *after* COMMIT,
 * deliberately: `createSessionVideo` is a `fetch` across the public internet, and
 * inside the transaction it would hold the teacher's row and the session's for as long
 * as Daily takes to answer. Nothing about the room needs to be atomic with the state
 * change — a room with no session expires in 24 hours, and a session with no room is
 * the degraded case 6.3 is designed to survive.
 *
 * **Conditional on `video_room_name IS NULL`, and that is 6.4's requirement rather
 * than 6.3's.** Two participants pressing join in the same second against a session
 * whose columns are null would otherwise create two rooms and persist the second over
 * the first, leaving one of them alone in a room the other cannot see. The loser
 * matches zero rows and re-reads the winner's. A room is minted at most once per
 * session, and the `count` is how the caller finds out which it was.
 *
 * `status` is not in the `where`. 6.4 repairs an `ACTIVE` session and checks that
 * itself, before it decides to create anything; putting the status here would make a
 * repair on a session that ended mid-call indistinguishable from a lost race.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.roomName Daily's room identifier — `sessions.video_room_name`
 * @param {string} params.roomUrl  the URL the client joins
 * @returns {Promise<{count: number}>} `0` means somebody else minted it first
 */
export async function setSessionVideoRoom({ sessionId, roomName, roomUrl }) {
  return prisma.session.updateMany({
    where: { id: sessionId, videoRoomName: null },
    data: { videoRoomName: roomName, videoRoomUrl: roomUrl },
  });
}

/**
 * The session, **locked**, as the input to every guard in 6.5 and 6.6.
 *
 * `SELECT … FOR UPDATE`, and it is the reason this function is raw SQL rather than a
 * `findUnique`. Prisma's query API has no row lock, and without one the meter is
 * read-then-decide-then-write with a gap in the middle: two concurrent extensions both
 * read `ACTIVE` with the same `ends_at`, both pass `assertTransition`, and both charge.
 * Every caller's step 1 is this function, and every caller's step 2 is
 * `assertTransition(session.status, …)` against what it returned.
 *
 * **`FOR UPDATE OF s` and not a bare `FOR UPDATE`.** The teacher's `teacher_profiles`
 * row is joined for `platformFeeRate`'s `teacherCreatedAt`, and a bare `FOR UPDATE`
 * would lock that row too. Locking a profile for the duration of a billing transaction
 * means two of that teacher's sessions ending at once serialise on a column that never
 * changes — and worse, it would contend with `lockTeacherForOffer`, which writes
 * `status` on the same row every time somebody sends this teacher an offer.
 *
 * **The join is `teacher_profiles` and not `users`, and 7.9 corrected it.** §5.3's free
 * month is measured from the day somebody *became a teacher*, which is
 * `teacher_profiles.created_at` — `commission.js` says so in `teacherCreatedAt`'s own
 * doc comment, and `findTeacherForNotification` has passed that column since 5.6. This
 * function passed `users.created_at`, the account's registration date, so a student who
 * onboarded as a teacher more than thirty days later was charged 15% from their first
 * lesson and never received the exemption. Every test injects the date directly, and
 * the seed writes both rows in one transaction, so nothing but a fixture with the two
 * timestamps deliberately apart can see the difference — `commission.column.test.js` is
 * that fixture.
 *
 * The join rides along on the same statement rather than in a second read. E2's N+1
 * lesson, and this one is on the hot path of every charge the epic makes.
 *
 * Returns `null` for a missing session rather than throwing, the contract every read in
 * this file keeps. The caller answers `NOT_FOUND` — and for a stranger it answers the
 * same `NOT_FOUND`, because `FORBIDDEN` would confirm the id is real.
 *
 * @param {string} sessionId
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<object|null>} camel-cased, or `null`
 */
export async function findSessionForMeter(sessionId, tx) {
  const rows = await tx.$queryRaw`
    SELECT s.id,
           s.status,
           s.student_id      AS "studentId",
           s.teacher_id      AS "teacherId",
           s.price_per_block AS "pricePerBlock",
           s.budget_cap      AS "budgetCap",
           s.blocks_used     AS "blocksUsed",
           s.total_charged   AS "totalCharged",
           s.started_at      AS "startedAt",
           -- 7.4. Section 5.5's "platform technical failure", in the only form this
           -- product can detect: the session ran and no room was ever minted for it.
           --
           -- A boolean, not the URL. findSessionForView above declines to select
           -- video_room_url because it is a join capability that leaves the server
           -- through GET /sessions/:id/video alone; the settlement branch needs to know
           -- only whether one exists, so it is answered here rather than carried. Read
           -- inside the lock rather than beside it, because the money decision is made
           -- inside this transaction and a second read would be one outside it.
           --
           -- No backticks in this comment, deliberately: it is inside a tagged template
           -- literal and one would end the query.
           (s.video_room_url IS NOT NULL) AS "hasVideo",
           s.ends_at         AS "endsAt",
           s.ended_at        AS "endedAt",
           s.end_reason      AS "endReason",
           t.created_at      AS "teacherCreatedAt"
      FROM sessions s
      LEFT JOIN teacher_profiles t ON t.user_id = s.teacher_id
     WHERE s.id = ${sessionId}::uuid
       FOR UPDATE OF s
  `;

  return rows[0] ?? null;
}

/**
 * One row in `session_blocks` — the opening block at activation (6.5) and one per
 * extension after it.
 *
 * **Append-only, like the ledger it sits beside.** A block that was billed happened,
 * and the row saying so is not edited or removed by anything in this epic. The
 * reconciliation question — "does `total_charged` equal the sum of this session's
 * blocks" — is a `GROUP BY` and not a fold, and it is only answerable if nothing here
 * ever updated a row.
 *
 * `blockNumber` is the caller's, from `blocks_used + 1`, computed under the lock. A
 * repository that counted the existing rows itself would be a second source of truth
 * for the same number and would race the same way the meter does.
 *
 * `minutes` is `OPENING_BLOCKS × BLOCK_MINUTES` for the first and
 * `EXTENSION_BLOCKS × BLOCK_MINUTES` after it. Both constants are the caller's; no
 * literal `5` or `10` appears in this file.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {number} params.blockNumber 1 for the opening block
 * @param {number} params.minutes
 * @param {number} params.amount      credits, integer — money is never a float here
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<object>} the created row
 */
export async function recordBlock({ sessionId, blockNumber, minutes, amount }, tx) {
  return tx.sessionBlock.create({
    data: { sessionId, blockNumber, minutes, amount },
  });
}

/**
 * One more block — `POST /sessions/:id/extend` (6.5). `ACTIVE` → `ACTIVE`, so
 * `assertTransition` is not what guards it.
 *
 * **This is the first of the two concurrency guards, and it matches on `ends_at` as
 * the caller read it.** A double-tapped **Extend** button is two requests in the same
 * second: the first moves `ends_at`, the second's `where` no longer matches, and it
 * gets a `count` of `0` — which the caller answers `SESSION_NOT_ACTIVE` rather than
 * retrying. Without `expectedEndsAt` in the `where`, one press buys two blocks, the
 * budget cap is checked twice against a stale total, and every test that extends once
 * still passes.
 *
 * This is E5's teacher lock in a different column. `updateMany` returning a count,
 * never `update` — `update` throws `P2025` when it matches nothing, which the error
 * handler turns into a `404`, and "somebody extended first" is not a missing session.
 *
 * `status: 'ACTIVE'` is in the `where` beside it, so an extension that races the
 * auto-end cron loses rather than reviving a session that is over.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {Date} params.expectedEndsAt the value the caller read under the lock
 * @param {Date} params.endsAt         `expectedEndsAt + EXTENSION_BLOCKS × BLOCK_MINUTES`
 * @param {number} params.blocksUsed   the new total, computed under the lock
 * @param {number} params.totalCharged the new total, computed under the lock
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{count: number}>} `0` means somebody extended or ended it first
 */
export async function extendSession(
  { sessionId, expectedEndsAt, endsAt, blocksUsed, totalCharged },
  tx,
) {
  return tx.session.updateMany({
    where: { id: sessionId, status: 'ACTIVE', endsAt: expectedEndsAt },
    data: { endsAt, blocksUsed, totalCharged },
  });
}

/**
 * The end of a session — both terminal edges out of `ACTIVE`, in one writer.
 *
 * **`status` is a parameter because §10 draws two arrows out of `ACTIVE` and they are
 * the same race.** `ENDED` is 6.5's auto-end cron and 6.6's end button; `NO_SHOW` is
 * 6.6's report, within `NO_SHOW_WINDOW_SEC`. A second function for the second arrow
 * would be a second `where` to keep in step with this one, and the day they drift is
 * the day a no-show and an auto-end both succeed on the same row. The service decides
 * which arrow it is taking and `assertTransition` has already refused every arrow that
 * is not one of these two.
 *
 * **This is the second concurrency guard, and it matches on `status = 'ACTIVE'`.** The
 * auto-end cron and the student's end button can fire in the same tick, and exactly one
 * wins: the loser's `count` is `0` and its transaction rolls back, so the teacher is
 * credited once and `sessions_count` moves once. Crediting twice is not recoverable by
 * anything short of a manual ledger correction, which is why this `where` is not an
 * optimisation.
 *
 * **`end_reason` is set in the same statement as the status**, never after it. §11.2
 * enumerates six values and a row that reads `ENDED` with a null reason is a session
 * nobody can explain — including the screen, which renders the reason.
 *
 * `platformFee` and `teacherEarning` land here too, in that same statement, because
 * they are what the teacher was credited and the credit is in this transaction. A
 * session whose money moved in one statement and whose record of it moved in another
 * has a window where the two disagree, and reconciliation reads the columns.
 *
 * Both default to `0`, which is the no-show case exactly: a refunded session has no fee
 * and no earning, and §5.3's split never ran on it.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {'ENDED'|'NO_SHOW'} params.status
 * @param {string} params.endReason        one of §11.2's six values
 * @param {Date} params.endedAt
 * @param {number} [params.platformFee=0]     §5.3's cut; `0` on a no-show
 * @param {number} [params.teacherEarning=0]  gross minus the fee; `0` on a no-show
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{count: number}>} `0` means it was no longer `ACTIVE`
 */
export async function endSession(
  { sessionId, status, endReason, endedAt, platformFee = 0, teacherEarning = 0 },
  tx,
) {
  return tx.session.updateMany({
    where: { id: sessionId, status: 'ACTIVE' },
    data: { status, endReason, endedAt, platformFee, teacherEarning },
  });
}

/**
 * `ENDED` → `RATED`. The review has been written and the session has reached its
 * terminal state (6.6).
 *
 * Conditional on `ENDED`, like every other writer here. `reviews.session_id` is
 * `UNIQUE` and is the real guarantee that one session gets one review — this `where` is
 * what keeps the *session* from being rated twice if the insert is ever moved, and it
 * costs one clause.
 *
 * Nothing else moves. `ended_at`, `end_reason` and the money were written by
 * `endSession` and are not the rating's to touch.
 *
 * @param {string} sessionId
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{count: number}>} `0` means it was not `ENDED`
 */
export async function setSessionRated(sessionId, tx) {
  return tx.session.updateMany({
    where: { id: sessionId, status: 'ENDED' },
    data: { status: 'RATED' },
  });
}

/**
 * Sessions whose current block is inside the warning window — 6.5's Block Warning
 * sweep, every tick.
 *
 * `ends_at - WARNING_SECONDS <= now < ends_at`, expressed as the half-open interval the
 * caller passes: it computes both instants from `WARNING_SECONDS` and this function
 * takes them. A repository that called `new Date()` would be deciding when a warning is
 * due, and the two jobs would each have their own idea of "now" within the same tick.
 *
 * **Read-only, and on the global client rather than a `tx`.** A sweep that opened a
 * transaction to read would hold one for the whole tick; the rows it finds are each
 * handled in their own transaction afterwards, if at all — a warning is an emit and
 * writes nothing.
 *
 * **Idempotence is not here.** 6.5 keeps the last-warned `ends_at` per session in
 * memory for the life of the process, so this query has no flag column to filter on and
 * no migration behind it. A restart re-warns once, which is a duplicate modal and not a
 * duplicate charge.
 *
 * `pricePerBlock` and `budgetCap` ride along because the warning's payload carries all
 * four of `{ secondsLeft, extensionPrice, balanceAfter, canAfford, withinCap }` — the
 * server decides every one of them, because a client that computes affordability
 * computes it differently from the endpoint that enforces it.
 *
 * @param {Date} from `now`
 * @param {Date} to   `now + WARNING_SECONDS`
 * @returns {Promise<object[]>}
 */
export async function findSessionsDueForWarning(from, to) {
  return prisma.session.findMany({
    where: { status: 'ACTIVE', endsAt: { gt: from, lte: to } },
    select: {
      id: true,
      studentId: true,
      teacherId: true,
      pricePerBlock: true,
      budgetCap: true,
      blocksUsed: true,
      totalCharged: true,
      endsAt: true,
    },
  });
}

/**
 * Sessions past their deadline and past the grace period — 6.5's Session Auto-End
 * sweep, and 6.6 rewires what happens to them.
 *
 * The caller passes `now - GRACE_SECONDS`; §5.1's grace is a product rule and this
 * function does not know it. Same reason `findSessionsDueForWarning` takes its window.
 *
 * Read-only, global client, for the same reason as the warning sweep.
 *
 * **Neither sweep is correctness.** Render's free plan sleeps the instance and
 * `node-cron` runs in-process, so on a sleeping server neither runs at all. This is
 * E5's ruling and it holds: `GET /sessions/:id` evaluates `ends_at` lazily on every
 * read, so a session past its deadline reads as over whether or not anything swept it.
 *
 * @param {Date} deadline `now - GRACE_SECONDS`
 * @returns {Promise<object[]>}
 */
export async function findSessionsDueForAutoEnd(deadline) {
  return prisma.session.findMany({
    where: { status: 'ACTIVE', endsAt: { lte: deadline } },
    select: { id: true, studentId: true, teacherId: true, endsAt: true },
  });
}

/**
 * Who is in a session, for the socket layer's membership check — `session:join`, 6.2.
 *
 * **The socket's check and the video endpoint's are the same rule and deliberately not
 * the same function.** They need different columns: this one answers *may this socket
 * hear this room*, and `findSessionForVideo` below also has to mint a token, which
 * needs the room and the caller's display name. Three consumers wanting three shapes is
 * the arrangement 3.1, 4.1 and 5.1 each made on purpose; a shared `select` here would be
 * the socket handler carrying a room URL it must never emit.
 *
 * `status` comes back rather than being filtered on. A `where` on `ACTIVE` would make a
 * session that has ended indistinguishable from one the caller is not in, and the
 * handler wants to log those two at `warn` as different things even though it answers
 * both the same way — with silence.
 *
 * @param {string} sessionId
 * @returns {Promise<{studentId: string|null, teacherId: string|null, status: string}|null>}
 */
export async function findParticipants(sessionId) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    select: { studentId: true, teacherId: true, status: true },
  });
}

/**
 * The session behind `GET /sessions/:id/video` — 6.4, and the epic's security
 * boundary.
 *
 * Everything that endpoint checks is in this one read: the session exists, its status
 * is `ACTIVE`, and the caller is its `student_id` or its `teacher_id`. **The checks are
 * the service's and none of them is a `where` here** — a filtered query makes "not
 * yours", "not active" and "does not exist" the same empty result, and 6.4 needs to
 * tell them apart in the log while answering all three with the same `404` over the
 * wire.
 *
 * **The two names come from the database and nothing else.** `createSessionVideoAccess`
 * puts `userName` on the tile, and the endpoint it replaced took that from the request
 * body — so a stranger could walk in *and* choose the name they walked in under. Both
 * participants' names are selected here so the service reads one row and picks the
 * caller's; a second query keyed by `req.user.id` would be a second place that decides
 * whose name this is.
 *
 * `videoRoomName` and `videoRoomUrl` come back null when 6.3's `fetch` failed, which is
 * 6.4's repair path and the reason `setSessionVideoRoom` is conditional.
 *
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function findSessionForVideo(sessionId) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      studentId: true,
      teacherId: true,
      videoRoomName: true,
      videoRoomUrl: true,
      student: { select: { id: true, fullName: true } },
      teacher: { select: { id: true, fullName: true } },
    },
  });
}

/**
 * The teacher, after the session is over — 6.6, and **the exact inverse of
 * `setTeacherInSession` above.**
 *
 * It lives beside that function rather than in a file of its own for one reason: the two
 * write the same column in opposite directions, and a `where` that drifts apart from its
 * inverse is a teacher left `IN_SESSION` for ever, invisible to E4's first hard filter.
 * One file, one pair, one `git blame`.
 *
 * **Two statements, and they are deliberately not one.**
 *
 * The release is conditional on `IN_SESSION`, exactly like every other write to this
 * column since 5.3: a teacher who went `OFFLINE` mid-session stays `OFFLINE`, and an
 * unconditional write would put them back in E4's candidate pool while they are asleep.
 * `locked: false` is that case and it is not an error.
 *
 * The counters are not conditional, because **a session that happened counts whether or
 * not the teacher was still connected when it ended.** Folding them into the release
 * would silently drop a lesson from `sessions_count` for any teacher who closed their
 * laptop first — and `sessions_count` is the denominator E4's Bayesian smoothing divides
 * by, so losing one is not a cosmetic loss.
 *
 * **Which counters move is the service's decision, never this function's.** A normal end
 * passes `sessionsCount: 1`; a no-show passes `noShowCount: 1` and nothing else, because
 * nobody taught anything. A repository that branched on an `endReason` would be a second
 * place the product rule lives.
 *
 * @param {object} params
 * @param {string} params.teacherId
 * @param {number} [params.sessionsCount=0] `1` on a normal end, `0` on a no-show
 * @param {number} [params.noShowCount=0]   `1` on a no-show, `0` otherwise
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{released: boolean}>} `false` means they were no longer `IN_SESSION`
 */
export async function releaseTeacherAfterSession(
  { teacherId, sessionsCount = 0, noShowCount = 0 },
  tx,
) {
  const { count } = await tx.teacherProfile.updateMany({
    where: { userId: teacherId, status: 'IN_SESSION' },
    data: { status: 'ONLINE' },
  });

  if (sessionsCount || noShowCount) {
    await tx.teacherProfile.update({
      where: { userId: teacherId },
      data: {
        sessionsCount: { increment: sessionsCount },
        noShowCount: { increment: noShowCount },
      },
    });
  }

  // `=== 1` rather than `> 0`, matching `releaseTeacherLock`: `userId` is the primary
  // key, so a match of two cannot happen and the stricter comparison says so.
  return { released: count === 1 };
}

// ── E8 ───────────────────────────────────────────────────────────────────────
//
// **The file's fifth entry in `git log`, and the first one that only reads.** 8.4's
// history screen asks this table a question nothing has asked it before: not "what is
// this session doing right now" but "what has this student finished". Every read above
// is keyed by a session id and answers one row; both of the two below are keyed by a
// student id and answer a set.
//
// It is this repository's rather than a new `student.repository.js`, for the reason the
// epic README gives twice: **the read belongs to the router that owns the table.** A
// repository whose only job was reading `sessions` on behalf of `/students` would be a
// second file with a second idea of what a session's columns mean — the move E7 refused
// when it put `GET /wallet/earnings` on the wallet router.
//
// **Neither takes a `tx` and neither opens one.** Every writer in this file requires a
// transaction because it is racing something; these race nothing. A history screen is one
// snapshot of rows that have already reached a terminal state, and a transaction here
// would be ceremony around two `SELECT`s.

/**
 * The session statuses that belong in a student's history — 8.4.
 *
 * **A session in this list is one that is over.** `PENDING` and `OFFER_SENT` are a
 * question that has not found a teacher, and `ACTIVE` is the live screen at
 * `/app/session/:id` — putting either in a history is showing somebody the past tense of
 * something still happening.
 *
 * `CANCELLED` is here even though **nothing writes it**: §10 gives it no inbound edge,
 * `session.state.js` records that in as many words, and §12 has no cancel endpoint. It is
 * in the enum and in `SessionHistoryRecord`, so the filter that excludes the live
 * statuses is written as the set it means rather than as a `NOT IN` that would silently
 * start including a status somebody adds later.
 */
const HISTORY_STATUSES = ['ENDED', 'RATED', 'CANCELLED', 'NO_SHOW'];

/**
 * One page of this student's finished sessions, newest first, and how many there are —
 * PR 8.4, `GET /sessions/mine`.
 *
 * **`studentId` is a `where` here and not a check in the service**, which is the opposite
 * call `findSessionForOffer` makes at the top of this file — and the difference is that
 * this read has no id in the path to compare against. There is nothing for a caller to
 * tamper with and nothing to answer `NOT_FOUND` about: the filter *is* the authorisation,
 * and it comes from the verified token.
 *
 * **The row is a session and the review hangs off it**, which is the whole shape of this
 * endpoint. `review` is a nullable one-to-one and a `null` on an `ENDED` row is the state
 * the screen exists to rescue — so it is `select`ed rather than joined through a filter,
 * and a session whose student closed the tab comes back like any other.
 *
 * `student_id` is deliberately the only thing filtered on beyond the status set. A
 * `where` on "has a review" or on `ended_at IS NOT NULL` would each hide exactly the rows
 * this screen is for.
 *
 * The teacher's name rides along on the same statement rather than in a second read —
 * E2's N+1 lesson — and so do the question's title and its two topics. The ids come with
 * the names because the sentinel topic (`topic_id = 0`) is a real row with a real label,
 * and only the serializer can tell it apart from a topic worth putting on a chip.
 *
 * **`teacher_earning` and `platform_fee` are not selected.** They are on the row and they
 * are the teacher's side of the same session; `GET /wallet/earnings` (7.6) is where they
 * belong. A student's receipt says what the student paid.
 *
 * Ordering is `ended_at` descending with **nulls last**, then `created_at`, then `id`.
 * The first key is what "newest" means on a screen about finished sessions; the second
 * dates a `CANCELLED` session that never ran and therefore has no `ended_at`; the third
 * is the total order every paged read in this repository carries, because two rows
 * written in one transaction share an instant to the microsecond and a non-total order
 * lets page 2 repeat a row from page 1.
 *
 * One `$transaction`, the read-only array form: the page and the count against one
 * snapshot, so a session that ends between them cannot make the pager disagree with the
 * list.
 *
 * @param {object} params
 * @param {string} params.studentId from the verified token, never from the path
 * @param {number} [params.skip]
 * @param {number} [params.take]
 * @returns {Promise<{sessions: object[], total: number}>}
 */
export async function findStudentSessionPage({ studentId, skip = 0, take = DEFAULT_PAGE_SIZE }) {
  const where = { studentId, status: { in: HISTORY_STATUSES } };

  const [sessions, total] = await prisma.$transaction([
    prisma.session.findMany({
      where,
      select: {
        id: true,
        status: true,
        endedAt: true,
        blocksUsed: true,
        totalCharged: true,
        teacher: { select: { id: true, fullName: true } },
        question: {
          select: {
            title: true,
            topic: { select: { id: true, nameEn: true, nameHe: true } },
            subtopic: { select: { id: true, nameEn: true, nameHe: true } },
          },
        },
        review: { select: { stars: true, isResolved: true } },
      },
      orderBy: [
        { endedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      skip,
      take,
    }),
    prisma.session.count({ where }),
  ]);

  return { sessions, total };
}

/**
 * How many of this student's sessions are `ENDED` with no review — PR 8.4.
 *
 * **A second query rather than a number derived from the page**, because the client only
 * ever holds one page and the badge is about the whole set. A count computed from twenty
 * rows would say 1 until you paged and then say 2, which is a badge nobody would trust
 * again.
 *
 * `ENDED` alone, not `ENDED` or `NO_SHOW`. §10's only edge out of `ENDED` is the rating,
 * so an `ENDED` row with no review is a session that has not reached a terminal state and
 * whose teacher is missing reputation it earned. `NO_SHOW` is terminal and is deliberately
 * never rated — 6.7 sends the student back to the match list rather than to the rating
 * screen — so counting it here would badge the student with work they cannot do.
 *
 * `review: null` is the Prisma spelling of "the one-to-one has no row"; `reviews.session_id`
 * is `UNIQUE`, which is what makes the absence a fact rather than a coincidence.
 *
 * @param {string} studentId
 * @returns {Promise<number>}
 */
export async function countUnratedStudentSessions(studentId) {
  return prisma.session.count({
    where: { studentId, status: 'ENDED', review: null },
  });
}
