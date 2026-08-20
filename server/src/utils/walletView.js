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
