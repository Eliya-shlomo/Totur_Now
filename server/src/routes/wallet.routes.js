import { Router } from 'express';

import {
  getWalletBalance,
  listTeacherEarnings,
  listWalletTransactions,
  topUpWalletBalance,
} from '#controllers/wallet.controller.js';
import { authenticate } from '#middlewares/authenticate.js';
import { authorize } from '#middlewares/authorize.js';
import { makeStrictLimiter } from '#middlewares/rateLimit.js';
import { validate } from '#middlewares/validate.js';
import { asyncHandler } from '#utils/asyncHandler.js';
import {
  walletSchema,
  walletTopUpSchema,
  walletTransactionsSchema,
} from '#validators/wallet.schema.js';

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
 * **No rate limiter on the two reads.** `strictLimiter` is for routes that spend money on
 * an external call, and `session.routes.js` already declined it twice for the same
 * reason — these are two indexed reads and `globalLimiter` in `app.js` covers them.
 * `POST /topup` is a different matter and has its own budget below.
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

/**
 * This router's own budget for `POST /topup`, **not the shared `strictLimiter`.**
 *
 * `question.routes.js` made this call first and wrote down why: one shared instance
 * guarded login, register and question creation at once, so the three shared a counter —
 * a few sign-ins during a test run spent the questions a student was allowed to ask, and
 * the ask screen answered `429` having made one request. Same window and same production
 * number (§15.5); what changes is that the count is about this endpoint, which is what a
 * rate limit is supposed to mean.
 *
 * **A mock top-up credits immediately, so an unlimited one is an infinite-money loop.**
 * The allowlist in `walletTopUpSchema` stops a client naming its own amount; this stops
 * them asking for the largest package a thousand times a minute. Both are needed and
 * neither is a substitute for the other.
 */
const topUpLimiter = makeStrictLimiter();

/** 7.3 — credit one of §5.4's packages. `201`, and the body names a package, not an amount. */
walletRoutes.post(
  '/topup',
  authenticate,
  topUpLimiter,
  validate(walletTopUpSchema),
  asyncHandler(topUpWalletBalance),
);

/**
 * 7.6 — the teacher's earnings. **The one route on this router with a role gate.**
 *
 * `GET /wallet` deliberately has none: a wallet is per-user rather than per-role,
 * teachers hold a balance and are credited into it at the end of every session, and a
 * gate there would lock half the account holders out of their own money. This endpoint is
 * different in kind — `EarningsResponse` is a fee-and-net breakdown of sessions taught,
 * which is meaningless for a student, and answering them `{ earnings: [], totals: {0,0,0} }`
 * would be a worse answer than refusing.
 *
 * **`403` here, and `404` on the session endpoints, and both are right.** `OWNERSHIP.md`
 * §2.1 rule 4 says a `403` on a session id confirms that the session exists — the rule is
 * about not leaking the existence of a row. There is no id in this URL. Refusing a student
 * tells them that they are not a teacher, which they already knew.
 *
 * **7.2's paging schema, not a second one.** `walletTransactionsSchema` validates a page
 * and a page size against `constants/pagination.js` and nothing else, which is exactly
 * this route's input; its name is about where it was written rather than what it checks.
 * Two paging validators on one router is two ceilings, and the day somebody raises
 * `MAX_PAGE_SIZE` only one of them moves.
 *
 * No rate limiter, for the reason the two reads above have none: it is an indexed read
 * plus two aggregates, and `globalLimiter` in `app.js` covers it.
 */
walletRoutes.get(
  '/earnings',
  authenticate,
  authorize('teacher'),
  validate(walletTransactionsSchema),
  asyncHandler(listTeacherEarnings),
);
