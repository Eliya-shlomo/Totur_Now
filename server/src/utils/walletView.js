/**
 * The two shapes a money row is allowed to leave the server in — `WalletResponse` and
 * `WalletTransactionRecord` in `shared/api.d.ts`. PR 7.2.
 *
 * `teacherView.js`'s rule, applied to the table where getting it wrong costs more:
 * **every field is written out by name.** Never a spread of the Prisma row and never a
 * `delete`. With explicit construction a column added to `wallet_transactions` in a
 * later epic is invisible until somebody adds it below; with a spread it ships to the
 * client the moment the migration lands, and with a delete it ships the moment somebody
 * forgets to extend the list.
 *
 * **`note` is the field this file exists to leave behind.**
 * `appendWalletTransaction`'s contract is explicit that it is operator-facing and never
 * reaches a client — the strings E6 writes are `'Session earning'`, `'No-show refund'`,
 * English chosen for whoever reads a log. Putting them on a student's screen would
 * quietly make every future note a user-facing string that nobody reviews as one.
 * `LEDGER_VIEW` in `wallet.read.repository.js` already declines to select it, so a leak
 * would need two independent mistakes.
 *
 * Dates leave as ISO 8601 UTC strings, the shape every other contract in this project
 * uses — `expiresAt`, `endsAt`, `endedAt`. A `Date` serialises to the same string
 * through `res.json`, so writing it out explicitly changes nothing on the wire and makes
 * the contract true of the function rather than of Express's serialiser.
 */

/**
 * `GET /wallet` — credits and when they last moved.
 *
 * **No minutes.** §12 describes this endpoint as "Balance + ≈ X minutes" and it cannot
 * answer that: minutes are a function of a teacher's price and there is no teacher here.
 * §5.4's own example says as much — "₪96 ≈ 40 minutes **with Dana**". `minutesFor` in
 * `client/src/lib/credits.js` owns the translation, floors it to whole blocks, and takes
 * `blockMinutes` from `GET /public/pricing` so the label cannot drift from the billing.
 * A second rounding computed here would be shown beside the first on the same screen.
 *
 * @param {{balance: number, updatedAt: Date}} wallet
 * @returns {import('@tutor/shared').WalletResponse}
 */
export function toWalletResponse({ balance, updatedAt }) {
  return {
    balance,
    updatedAt: updatedAt.toISOString(),
  };
}

/**
 * One ledger row, for the list on `/app/wallet`.
 *
 * `amount` stays **signed** — negative is money leaving the wallet. The sign is the
 * meaning, it is what makes §11.3's reconciliation a `SUM` rather than a fold with a
 * lookup per row, and a client handed absolute values would have to re-derive the
 * direction from `type`, which is a second implementation of the ledger's arithmetic.
 *
 * `sessionId` is `null` for a top-up, which belongs to no session. `type` is the enum
 * from `prisma/schema/wallet.prisma` and the **client owns the sentence** it renders —
 * six values, two of which (`PAYOUT`, `PROMO`) nothing writes yet, so a screen must
 * render an unrecognised one as something rather than as a blank row.
 *
 * @param {{id: string, type: string, amount: number, balanceAfter: number,
 *   sessionId: string|null, createdAt: Date}} row
 * @returns {import('@tutor/shared').WalletTransactionRecord}
 */
export function toWalletTransaction({ id, type, amount, balanceAfter, sessionId, createdAt }) {
  return {
    id,
    type,
    amount,
    balanceAfter,
    sessionId,
    createdAt: createdAt.toISOString(),
  };
}

/**
 * One earning, for the list on `/teach/earnings` — `EarningRecord`. PR 7.6.
 *
 * **The row is the ledger's and the breakdown is the session's**, which is why this
 * takes a transaction rather than a session: `teacherEarning` is `amount` on the
 * `TEACHER_EARNING` row — what was actually credited to the wallet — and not
 * `sessions.teacher_earning`, which is the same number written to a second place in the
 * same transaction. They agree, `reconcile.mjs` invariant 4 is what checks that they do,
 * and when they ever disagree the teacher should be shown the movement rather than the
 * column, because the movement is what their balance is made of.
 *
 * **`platformFee` is rendered, never derived.** §5.3's rate, its thirty-day waiver and
 * its low-demand window are `utils/commission.js`'s, resolved at `started_at` by
 * `session.end.service.js`, and that file's own header says two implementations of §5.3
 * is two answers to "what did I earn". So the fee arrives here as an integer and leaves
 * as one. `PLATFORM_FEE_PCT` does not appear in this file and must never reach the
 * client bundle.
 *
 * `endedAt` falls back to the ledger row's `createdAt`, and the fallback is a type
 * requirement rather than a real case: `sessions.ended_at` is nullable in the schema, but
 * 6.6 writes it in the same transaction that appends this row, so the two are the same
 * instant to the microsecond. A `null` here would mean a session was credited without
 * being ended — and even then, the moment the money moved is the more honest answer for
 * a row labelled "when the earning was credited".
 *
 * `topicName` is the subtopic's Hebrew name, then the topic's, then `null` — the
 * precedence `offerView.js` and `sessionView.js` both already use. A question with no
 * classification has neither, and the screen labels the row by its date instead.
 *
 * @param {{amount: number, createdAt: Date, session: object}} row
 * @returns {import('@tutor/shared').EarningRecord}
 */
export function toEarningRecord({ amount, createdAt, session }) {
  return {
    sessionId: session.id,
    endedAt: (session.endedAt ?? createdAt).toISOString(),
    totalCharged: session.totalCharged,
    platformFee: session.platformFee,
    teacherEarning: amount,
    topicName: session.question?.subtopic?.nameEn ?? session.question?.topic?.nameEn ?? null,
  };
}
