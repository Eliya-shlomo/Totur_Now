import { api } from '@/api/client';

/**
 * The wallet surface — `GET /wallet`, `GET /wallet/transactions` and
 * `POST /wallet/topup` (PRs 7.2 and 7.3, MVP.md §12 "Wallet").
 *
 * One module per server domain and no component imports `@/api/client` directly
 * (CONVENTIONS.md → Client). The interceptor already unwraps `{ success, data }`, so
 * every function here resolves to the payload itself and rejects with an `ApiError`.
 * No `try` blocks: the screen decides what a failure looks like.
 *
 * **Not one of these functions names a user, and none ever should.** The caller comes
 * from the verified token — `wallet.routes.js` has no `:id` under the mount for exactly
 * this reason, and a `userId` parameter here would be the client-side half of an
 * authorisation question that does not belong in a path segment.
 *
 * **`note` is not on any of these responses.** It is operator-facing text
 * (`appendWalletTransaction`), `LEDGER_VIEW` does not select it and `toWalletTransaction`
 * builds the response field by field. A screen that reads `tx.note` is reading a field
 * that is not coming, and `components/wallet/txLabel.js` owns the sentence instead.
 */

/**
 * The caller's balance — credits and a timestamp.
 *
 * **No minutes on it, and that is the contract rather than an omission.** Minutes are a
 * function of a *teacher's* price and this endpoint has no teacher — §5.4's own example
 * is "₪96 ≈ 40 minutes with Dana". `lib/credits.js`'s `minutesFor` renders the sentence
 * from `GET /public/pricing`, so the label cannot drift from the billing, and a
 * server-computed `approxMinutes` would be a second rounding of the same number sitting
 * beside the first on the same screen.
 *
 * A missing wallet row is a `500`, not an empty balance: every user gets one at
 * registration, so its absence is a broken invariant rather than a state to render.
 *
 * @returns {Promise<import('@tutor/shared').WalletResponse>}
 */
export function getWallet() {
  return api.get('/wallet');
}

/**
 * A page of the caller's ledger, newest first.
 *
 * `total` is the whole ledger rather than the page, so a screen can build a pager
 * without walking to the end. An empty ledger is an empty array and a `200` — a student
 * who has never moved money is a first-time state, not a `404`.
 *
 * `pageSize` is **capped rather than rejected** by `walletTransactionsSchema`: asking for
 * more than `MAX_PAGE_SIZE` returns the ceiling, so an over-eager caller gets rows rather
 * than a blank screen. `page` below 1 *is* rejected, because a page that does not exist
 * cannot be honoured smaller.
 *
 * @param {{page?: number, pageSize?: number}} [query]
 * @returns {Promise<import('@tutor/shared').WalletTransactionsResponse>}
 */
export function getWalletTransactions(query = {}) {
  return api.get('/wallet/transactions', { params: query });
}

/**
 * Credit one of §5.4's packages — `201`, and the body names the row it wrote.
 *
 * **The argument is a package, never an amount.** `packageId` is the credit value itself
 * and has to be a *member* of `TOPUP_PACKAGES`; the server checks membership rather than
 * a range, because a body that carries credits is a body that grants them. The list is
 * already on the wire as `PublicPricingResponse.topupPackages`, so a screen that offers
 * `pricing.topupPackages` cannot offer an amount the endpoint would refuse — which is
 * why nothing in `client/` may write `[50, 100, 200]` of its own.
 *
 * **The response is what the screen trusts.** `wallet:updated` carries the same balance
 * to every tab this user has open, but the socket may be down, and a screen that only
 * learns from an event shows a stale balance whenever the connection dropped. Both paths
 * write the same server-computed number, so the last to arrive wins and either order is
 * correct.
 *
 * The top-up is a mock and credits immediately (§21 puts a provider in Phase 2), so the
 * route carries its own rate limiter. `RATE_LIMITED` (429) is therefore a state a real
 * person can reach by pressing twice too quickly, and it is worth its own sentence:
 * retrying it immediately is the one thing that cannot work.
 *
 * @param {number} packageId  a member of `PublicPricingResponse.topupPackages`
 * @returns {Promise<import('@tutor/shared').TopUpResponse>}
 */
export function topUp(packageId) {
  return api.post('/wallet/topup', { packageId });
}
