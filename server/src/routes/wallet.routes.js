import { Router } from 'express';

import { getWalletBalance, listWalletTransactions } from '#controllers/wallet.controller.js';
import { authenticate } from '#middlewares/authenticate.js';
import { validate } from '#middlewares/validate.js';
import { asyncHandler } from '#utils/asyncHandler.js';
import { walletSchema, walletTransactionsSchema } from '#validators/wallet.schema.js';

/**
 * The wallet endpoints, mounted at `/api/v1/wallet` — PR 7.2, MVP.md §12.
 *
 * **`authenticate` and no `authorize`, on both routes.** A wallet is per-user, not
 * per-role: teachers hold a balance, are credited into it at the end of every session,
 * and 7.6's earnings screen shows the same number `GET /wallet` returns. A role gate
 * here would lock half the account holders out of their own money. The one route on this
 * router that *will* carry `authorize('teacher')` is 7.6's `/earnings`, whose shape is
 * meaningless for a student.
 *
 * **No route names a user, and none ever should.** The caller comes from the verified
 * token. An `:id` under this mount would move the authorisation question from the token
 * to whoever typed the URL, and the answer to "may I read this ledger" is never in a
 * path segment. That is why both schemas declare an empty, `.strict()` `params`.
 *
 * **No rate limiter on either.** `strictLimiter` is for routes that spend money on an
 * external call, and `session.routes.js` already declined it twice for the same reason —
 * these are two indexed reads and `globalLimiter` in `app.js` covers them. 7.3's
 * `POST /topup` is a different matter and brings its own instance.
 *
 * Route order is not load-bearing here: `/` and `/transactions` cannot shadow each
 * other. It is written most-specific-last anyway, matching `teacher.routes.js`, so that
 * 7.6 appending `/earnings` does not have to think about it either.
 */
export const walletRoutes = Router();

/** 7.2 — the caller's balance. Credits and `updatedAt`; the minutes are the client's. */
walletRoutes.get('/', authenticate, validate(walletSchema), asyncHandler(getWalletBalance));

/** 7.2 — a page of the caller's ledger, newest first. `note` is not on the wire. */
walletRoutes.get(
  '/transactions',
  authenticate,
  validate(walletTransactionsSchema),
  asyncHandler(listWalletTransactions),
);
