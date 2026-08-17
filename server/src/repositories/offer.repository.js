import { OFFER_STATUS } from '#config/constants/index.js';
import { prisma } from '#config/db.js';

/**
 * Every query E5 makes on `offers`, plus the one write to `questions.rejected_by` —
 * MVP.md §11.3, §12.
 *
 * **This file is frozen after PR 5.1, and unlike `session.repository.js` it has no
 * gap.** Every function below has a real body. The two unfinished things in this epic
 * are the lock and its release, and both live next door because both write
 * `teacher_profiles` rather than `offers`.
 *
 * Nothing in the epic may open this file. A query discovered missing mid-5.4 is a
 * frozen file being reopened — which is why the list below was read against the epic
 * README before anything called it, and why the two gaps that reading turned up were
 * fixed in `session.repository.js` rather than found in three days' time.
 *
 * **`OFFER_STATUS`, never a literal.** `offers.status` is a `VarChar(20)` and not a
 * Postgres enum (epic README, gap 1), so Prisma's generated types will not catch
 * `'ACCEPETD'` the way they catch a bad `SessionStatus`. The constant is the only
 * thing standing between this file and a typo that writes a status nothing ever
 * matches, so every value below comes from it.
 *
 * **Expiry is evaluated lazily as well as swept.** The cron in 5.5 runs in-process
 * and Render's free plan spins the instance down after ~15 minutes without a request,
 * so a job on a sleeping instance does not run and an offer that expired at 14:02 may
 * still read `PENDING` at 14:40. `findOfferForRespond` therefore returns
 * `expires_at` and the caller compares it against now regardless of what `status`
 * says. The sweep exists to *notify* a connected teacher and release the lock;
 * correctness must not depend on a process that is allowed to be asleep.
 */

/**
 * The one read behind both `POST /offers/:id/accept` and `POST /offers/:id/reject`
 * (5.4).
 *
 * One statement for two paths, because they need exactly the same facts: who the
 * offer is for, whether it is still answerable, and the session and question behind
 * it. Two near-identical reads would be two places to forget `expiresAt`.
 *
 * `session.questionId` is here for `appendRejectedBy`, which needs the question and
 * holds only an offer id — the walk is offer → session → question, and doing it in
 * this read rather than in a second one keeps the reject transaction to one round
 * trip before it starts writing.
 *
 * Ownership is not filtered, the same call every other repository in this codebase
 * makes: the caller compares `teacherId` against `req.user.id` and answers
 * `NOT_FOUND` for another teacher's offer, because `FORBIDDEN` would confirm the id
 * exists.
 *
 * @param {string} offerId
 * @returns {Promise<object|null>}
 */
export async function findOfferForRespond(offerId) {
  return prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      teacherId: true,
      session: {
        select: {
          id: true,
          status: true,
          studentId: true,
          questionId: true,
        },
      },
    },
  });
}

/**
 * The session's outstanding offer, if it has one — 5.3's second **Send request**.
 *
 * E4's selection screen disables the other cards while an offer is in flight, and a
 * reload re-enables them, so a second press is a real request that has to be
 * answered. The session's own `status` already refuses it (`SESSION_NOT_ACTIVE`);
 * this read is what lets the answer say *which* offer is outstanding and when it
 * expires, so the student's screen can go straight to the countdown rather than
 * showing an error for a state it could have rendered.
 *
 * **`status` and `expiresAt` are not filtered here.** A `where` on `PENDING` would
 * hide exactly the row the caller most needs to see — an offer whose clock ran out
 * while the instance was asleep still reads `PENDING` in the column, and one that the
 * sweep did catch reads `EXPIRED` but is still the offer the screen is explaining.
 * The freshest offer is the answer; what it means is the service's call.
 *
 * @param {string} sessionId
 * @returns {Promise<object|null>} the most recent offer on this session, or `null`
 */
export async function findPendingOfferForSession(sessionId) {
  return prisma.offer.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      teacherId: true,
      expiresAt: true,
      createdAt: true,
    },
  });
}

/**
 * The offer itself. The write 5.3's transaction exists to make.
 *
 * `expiresAt` is computed by the caller from `OFFER_TTL_SECONDS` and passed in, for
 * the reason every instant in this codebase is passed in: a repository that called
 * `new Date()` would be deciding how long a teacher has to answer, and that number
 * belongs in `constants/session.js` where the product can see it.
 *
 * **The instant is absolute and server-issued, and that is a contract.**
 * `OfferResponse.expiresAt` is an ISO string for exactly this reason: the student's
 * countdown recomputes from it on every tick rather than running a `setTimeout`
 * seeded once, so a phone that sleeps for thirty seconds wakes up showing the right
 * number and a client clock two minutes fast does not expire the offer early. 5.8's
 * most likely bug is a countdown seeded from a duration.
 *
 * `status` defaults to `PENDING` in the schema and is written anyway. The default is
 * a string literal in a `.prisma` file that no test reads; writing it here means the
 * value the row starts at comes from the same constant every comparison uses.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.teacherId
 * @param {Date} params.expiresAt `now + OFFER_TTL_SECONDS`
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<object>} the created offer
 */
export async function createOffer({ sessionId, teacherId, expiresAt }, tx) {
  return tx.offer.create({
    data: { sessionId, teacherId, expiresAt, status: OFFER_STATUS.PENDING },
    select: { id: true, status: true, teacherId: true, expiresAt: true, createdAt: true },
  });
}

/**
 * `PENDING` → `ACCEPTED` or `REJECTED`, with `responded_at`. 5.4's first write on
 * either path.
 *
 * **Conditional and counted, exactly like the lock.** `updateMany` rather than
 * `update`, and the `count` is the answer: zero means the row was no longer `PENDING`
 * when this transaction got to it — the expiry sweep beat it, or the teacher
 * double-clicked and the first click won. Both are `OFFER_EXPIRED` or a no-op to the
 * caller, and neither is an exception. `update` would throw on a missing match and
 * give the caller nothing to distinguish them by.
 *
 * The predicate does **not** include `expires_at > now()`. Expiry is the service's
 * assertion, made against the row it already read under the lock, because a
 * `PENDING` row past its instant is `EXPIRED` in fact whatever the column says and
 * the caller needs to say so specifically rather than see a zero count that could
 * mean three things.
 *
 * @param {object} params
 * @param {string} params.offerId
 * @param {'ACCEPTED'|'REJECTED'} params.status from `OFFER_STATUS`
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<{count: number}>} `0` means it was no longer `PENDING`
 */
export async function markOfferResponded({ offerId, status }, tx) {
  return tx.offer.updateMany({
    where: { id: offerId, status: OFFER_STATUS.PENDING },
    data: { status, respondedAt: new Date() },
  });
}

/**
 * The expiry sweep — 5.5's `updateMany`, and the only function here with no `tx`.
 *
 * Runs on its own, outside anybody's transaction, every `CRON_TICK_SECONDS`. It is
 * idempotent because it is conditional: a second instance running the same sweep in
 * the same second finds nothing left to update. There is one instance today, and this
 * is written down so nobody discovers it during a scale-up.
 *
 * Two statements rather than one, because Postgres has no `UPDATE ... RETURNING`
 * through Prisma's `updateMany`. The ids are read first and the update is then
 * scoped to exactly them, which is what makes the returned list truthful: an
 * `updateMany` on the predicate followed by a second read would catch offers that
 * expired in between and report them as this sweep's, and 5.5 emits `offer:expired`
 * to a teacher per id. The window between the two statements can only shrink the set
 * — an offer answered in between stops being `PENDING` and the update skips it — so
 * the ids returned are a superset of nothing and every one of them was swept by this
 * call.
 *
 * The predicate is the partial index `idx_offers_pending` was created for
 * (`(expires_at) WHERE status = 'PENDING'`, in the init migration). It already
 * exists; 5.5 creates no index. Prisma cannot express a partial index, so declaring
 * the full one in the schema instead would make every later `migrate dev` emit a
 * `CREATE INDEX` for a name that is already taken.
 *
 * @param {Date} instant everything `PENDING` and older than this expires
 * @returns {Promise<string[]>} the ids actually swept, for 5.5 to notify on
 */
export async function expirePendingOffersBefore(instant) {
  const due = await prisma.offer.findMany({
    where: { status: OFFER_STATUS.PENDING, expiresAt: { lt: instant } },
    select: { id: true },
  });

  if (due.length === 0) return [];

  const ids = due.map((offer) => offer.id);

  const { count } = await prisma.offer.updateMany({
    where: { id: { in: ids }, status: OFFER_STATUS.PENDING },
    data: { status: OFFER_STATUS.EXPIRED, respondedAt: null },
  });

  // Equal in every ordinary tick. Fewer means somebody answered between the two
  // statements, which is not an error — it is the conditional update doing its job —
  // and re-reading is how the caller avoids emitting `offer:expired` for an offer
  // that was just accepted.
  if (count !== ids.length) {
    const swept = await prisma.offer.findMany({
      where: { id: { in: ids }, status: OFFER_STATUS.EXPIRED },
      select: { id: true },
    });

    return swept.map((offer) => offer.id);
  }

  return ids;
}

/**
 * Appends a teacher to `questions.rejected_by` — **the only writer of that column in
 * this codebase.**
 *
 * §9.1's last hard filter is `teacher_id ∉ question.rejected_by`, so this is what
 * makes "show me more teachers" stop offering somebody who already said no.
 * `matching.repository.js` is the frozen reader of the same column; E5 writes it from
 * its own file rather than unfreezing E4's.
 *
 * **Read-append-write, and the `tx` is the whole point.** Prisma has no array-append
 * operator for a scalar list — `push` is a `set` under the hood — so writing means
 * reading the current value and putting the whole array back. Two rejections on the
 * same question in the same second therefore lose one entry unless both are inside
 * the transaction that is already holding the offer row, which serialises them. The
 * parameter is required for that reason; there is no default to the global client,
 * because a caller that forgot the transaction should fail to call rather than
 * silently drop a rejection.
 *
 * The column is `[]` and never null on every existing row (4.2 checked), so the
 * fallback below is belt-and-braces rather than a case anyone has seen.
 *
 * Idempotent: rejecting twice does not put a teacher in the array twice, which keeps
 * `notIn` cheap and the column small. It is a `UUID[]` rather than a join table
 * because it is read on every matching run, never joined, and never grows past a
 * handful of entries.
 *
 * @param {object} params
 * @param {string} params.questionId
 * @param {string} params.teacherId
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<string[]>} the column's new value
 */
export async function appendRejectedBy({ questionId, teacherId }, tx) {
  const question = await tx.question.findUnique({
    where: { id: questionId },
    select: { rejectedBy: true },
  });

  const current = question?.rejectedBy ?? [];

  if (current.includes(teacherId)) return current;

  const rejectedBy = [...current, teacherId];

  await tx.question.update({ where: { id: questionId }, data: { rejectedBy } });

  return rejectedBy;
}
