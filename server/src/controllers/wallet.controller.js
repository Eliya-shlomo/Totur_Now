import { topUpBalance } from '#services/wallet.topup.service.js';
import { getWallet, getWalletTransactions } from '#services/wallet.view.service.js';

/**
 * The wallet endpoints — `GET /wallet`, `GET /wallet/transactions` (PR 7.2) and
 * `POST /wallet/topup` (PR 7.3). MVP.md §12.
 *
 * Controllers read the request and write the response (`CONVENTIONS.md` → Server
 * layering), so both handlers are a call and a send. There is no `prisma` import in this
 * file and there must never be one: `/wallet` is the mount where a controller reaching
 * past the service would be a balance change outside `wallet.service.js`, which is the
 * one rule §17.4 checks on every PR.
 *
 * **Both handlers take the user from `req.user.id` and nothing else.** No id in a path,
 * no id in a query. `authenticate` has already verified the token by the time either
 * runs, so the caller cannot name whose wallet they are reading.
 *
 * No `Cache-Control`. A balance changes every time a session charges a block, and the
 * `PUBLIC_CACHE_SECONDS` treatment `public.controller.js` gives taxonomy would serve a
 * student a balance from before their last lesson.
 */

/**
 * `GET /wallet` — the caller's balance.
 *
 * The balance is `data` itself rather than `{ wallet }`, matching `GET /teachers/me` and
 * `GET /auth/me`: a single-resource read returns the resource.
 */
export async function getWalletBalance(req, res) {
  res.json({ success: true, data: await getWallet(req.user.id) });
}

/**
 * `GET /wallet/transactions` — a page of the caller's ledger.
 *
 * `req.query` is already coerced, defaulted and capped by `walletTransactionsSchema`, so
 * it is spread into the service whole rather than picked apart here — the same shape
 * `listTeachers` uses.
 */
export async function listWalletTransactions(req, res) {
  res.json({
    success: true,
    data: await getWalletTransactions({ userId: req.user.id, ...req.query }),
  });
}

/**
 * `POST /wallet/topup` — credit one package. PR 7.3.
 *
 * **`201`, because this creates a ledger row.** The same call `sendOffer` makes: the
 * response identifies the row it wrote, and `transactionId` is the handle a support
 * conversation has when a student says money went missing.
 *
 * The user is `req.user.id` and the package is the only thing the body may carry — a
 * body naming a user would be a request to credit somebody else's wallet.
 */
export async function topUpWalletBalance(req, res) {
  const result = await topUpBalance({ userId: req.user.id, packageId: req.body.packageId });

  res.status(201).json({ success: true, data: result });
}
