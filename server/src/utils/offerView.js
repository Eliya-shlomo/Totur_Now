import { OPENING_BLOCKS } from '#config/constants/index.js';
import { toTeacherCard } from '#utils/teacherView.js';

/**
 * The two shapes an offer is allowed to leave the server in — `OfferResponse` and
 * `IncomingOffer` in `shared/api.d.ts`. PR 5.3, MVP.md §12 and §13.
 *
 * One transaction, two audiences. The student who pressed **Send request** gets
 * `OfferResponse` as the HTTP body; the teacher gets `IncomingOffer` on `offer:new`
 * and, from 5.4, on `GET /sessions/:id`. Both serializations live here so that the
 * difference between them is one file a reviewer can read top to bottom — the same
 * call `teacherView.js` made for its two audiences and `matchView.js` after it.
 *
 * **`toIncomingOffer` is here even though 5.3's brief names only `toOfferResponse`.**
 * 5.3 has to emit the payload and 5.4 has to answer with it, and the alternative is
 * two definitions of what an offer looks like to a teacher, written a week apart. That
 * is the defect class the epic README's contract-freeze section spends a paragraph on.
 * Noted in the PR description rather than left as a surprise in the diff.
 *
 * Every field is written out by name. Never a spread of a Prisma row and never a
 * delete: the teacher row this file receives carries `offersReceived`,
 * `offersAccepted` and `status`, and none of them belongs in either payload.
 */

/**
 * The student's answer — `OfferResponse`, the body of a successful
 * `POST /sessions/:id/offer`.
 *
 * **`pricePerBlock` is passed in, never read back off the teacher.** It is the value
 * the transaction actually wrote to `sessions.price_per_block`, and passing it
 * explicitly is what makes the response structurally unable to disagree with the
 * column. A serializer that reached for `teacher.pricePerBlock` would be a second
 * reading of the snapshot, free to drift from the first the day the two reads happen
 * either side of a tier change.
 *
 * **The teacher row is the one read *before* the lock, and `isOnline` is therefore
 * `true`.** `toTeacherCard` computes it as `status === 'ONLINE'`, and re-reading the
 * row after the lock would answer `false` — which on the student's awaiting screen
 * reads as "you sent a request to somebody who is not there". They are there; they are
 * holding this offer. The pre-lock row is the honest one for this payload, and 5.8
 * renders a countdown from it rather than an availability pill.
 *
 * `status` comes off the created row rather than being typed as `'PENDING'`. The
 * column is a `VarChar(20)` with no enum behind it, so the value the row starts at and
 * the value the client switches on come from one place — `offer.repository.js` writes
 * it from `OFFER_STATUS` and this reads back what it wrote.
 *
 * @param {object} params
 * @param {{id: string, status: string, expiresAt: Date}} params.offer the created row
 * @param {string} params.sessionId
 * @param {object} params.teacher a `TEACHER_VIEW` row, read before the lock
 * @param {number} params.pricePerBlock the snapshot written to the session
 * @returns {import('@tutor/shared').OfferResponse}
 */
export function toOfferResponse({ offer, sessionId, teacher, pricePerBlock }) {
  return {
    offerId: offer.id,
    sessionId,
    status: offer.status,
    expiresAt: offer.expiresAt.toISOString(),
    teacher: toTeacherCard(teacher),
    pricePerBlock,
  };
}

/**
 * The teacher's side — `IncomingOffer`, the `offer:new` payload and 5.4's answer for
 * the teacher on `GET /sessions/:id`.
 *
 * **`expiresAt` is an absolute instant, and that is the contract.** The modal's
 * countdown recomputes from it on every tick rather than running a `setTimeout` seeded
 * once, so a laptop that sleeps for thirty seconds wakes up showing the right number
 * and a client clock two minutes fast does not close the modal early. A payload
 * carrying "60 seconds" would leave the teacher's clock disagreeing with the server's
 * about when the offer died.
 *
 * `brief` is E3's `teacher_brief`, shown and never re-summarised. The column is
 * nullable in the schema, but every write path fills it — the classifier writes the
 * model's brief and `classification.service.js`'s sentinel fallback writes the
 * student's own words — so the coalesce below is belt-and-braces for a row that came
 * from somewhere other than intake.
 *
 * `level` prefers the classifier's estimate over the student's declaration, the same
 * order `matching.candidates.service.js` reads them in. Both are nullable and `null` is
 * a legal answer: a question on the sentinel topic has neither.
 *
 * **`topicLabel` is `null` and not `''` when there is no topic.** The contract types it
 * `string | null` and `null` is what "unclassified" means; an empty string is a label
 * that renders as an empty chip, which is the same distinction `teacherView.js` argues
 * for `rating` and `matchView.js` for `subtopicResolveRate`. The subtopic wins over the
 * parent because it is the more specific true thing — a teacher deciding whether to
 * take a question is better served by "Derivatives" than by "Calculus".
 *
 * **`expectedEarning` is not rounded into credits.** `commission.js` answers a rate and
 * leaves the arithmetic to whoever owns a balance; E7 does the rounding when it moves
 * money, and a serializer that rounded first would be a second answer to "what did I
 * earn". It is `OPENING_BLOCKS` worth, because the opening block is what accepting this
 * offer actually guarantees the teacher (§5.1 — it is charged immediately and is
 * non-cancellable). Everything after it depends on the student extending.
 *
 * @param {object} params
 * @param {{id: string, expiresAt: Date}} params.offer
 * @param {string} params.sessionId
 * @param {object} params.question `teacherBrief`, the two levels, and the topic pair
 * @param {number} params.pricePerBlock the snapshot written to the session
 * @param {number} params.feeRate §5.3's commission, from `platformFeeRate`
 * @returns {import('@tutor/shared').IncomingOffer}
 */
export function toIncomingOffer({ offer, sessionId, question, pricePerBlock, feeRate }) {
  return {
    offerId: offer.id,
    sessionId,
    brief: question?.teacherBrief ?? '',
    topicLabel: question?.subtopic?.nameHe ?? question?.topic?.nameHe ?? null,
    level: question?.estimatedLevel ?? question?.declaredLevel ?? null,
    expectedEarning: pricePerBlock * OPENING_BLOCKS * (1 - feeRate),
    expiresAt: offer.expiresAt.toISOString(),
  };
}
