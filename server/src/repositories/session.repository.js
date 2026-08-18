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
 * **That happened, once, and it is recorded rather than hidden.** 5.4 added
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
      question: {
        select: {
          teacherBrief: true,
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
 * `OFFER_SENT` → `ACTIVE`. Step 3 of the accept transaction (5.4).
 *
 * **`ACTIVE` in E5 means "the offer was accepted". It does not mean the meter is
 * running.** Nothing is charged here, `blocks_used` stays 0 and `total_charged` stays
 * 0 — the opening block is E7's charge and the Zoom meeting is E6's. Both absences
 * are named in `offer.controller.js` rather than left to be inferred, and 5.9's retro
 * says it again in plain words, because a session that starts and takes no money
 * looks exactly like a billing bug.
 *
 * `endsAt` is written anyway, from `OPENING_BLOCKS × BLOCK_MINUTES`, so that E6 has a
 * real deadline to extend rather than a null to special-case on its first tick. The
 * caller computes both instants; a repository that called `new Date()` would be
 * deciding when a session starts.
 *
 * Conditional on `OFFER_SENT`, so an accept that races the expiry sweep loses rather
 * than resurrecting a session the student has already left.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {Date} params.startedAt
 * @param {Date} params.endsAt        `startedAt + OPENING_BLOCKS × BLOCK_MINUTES`
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{count: number}>}
 */
export async function setSessionActive({ sessionId, startedAt, endsAt }, tx) {
  return tx.session.updateMany({
    where: { id: sessionId, status: 'OFFER_SENT' },
    data: { status: 'ACTIVE', startedAt, endsAt },
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
