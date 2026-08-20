import { z } from 'zod';

import { DEFAULT_PAGE_SIZE, FIRST_PAGE, MAX_PAGE_SIZE } from '#config/constants/index.js';

/**
 * Zod schemas for the wallet router — PR 7.2, MVP.md §12 "Wallet".
 *
 * `teacher.public.schema.js`'s posture, and its reasoning holds unchanged here:
 *
 * **No bound is a literal.** The page numbers come from `constants/pagination.js`. A
 * number typed here would be a second copy of one that already exists, and the two drift
 * the first time somebody edits the original.
 *
 * **`.strict()` on all three parts.** A client that invents `?type=TOPUP` gets a
 * `VALIDATION_ERROR` naming the parameter rather than a silently ignored filter and a
 * bug report about a ledger "not filtering". A dropped filter is worse than a rejected
 * one — it looks like the data is wrong. It also means `?userId=<someone else>` is a
 * `400` rather than a parameter nothing reads, which is the friendlier failure for a
 * request nobody should be making.
 *
 * **Neither schema has a `params`.** There is no id anywhere under `/wallet`: the caller
 * is the token. That is an authorisation decision written down as an empty object.
 */

/** `GET /wallet` — no input at all, and `.strict()` says so rather than assuming it. */
export const walletSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
});

/**
 * `GET /wallet/transactions?page&pageSize`.
 *
 * `pageSize` is **capped by `.transform()` rather than rejected by `.max()`**, the call
 * `teacherListSchema` already made: a client cannot know our ceiling before it asks, so
 * asking for 1000 returns `MAX_PAGE_SIZE` rows. A `400` would turn one over-eager query
 * parameter into a blank screen. `total` on the response still reports the true unpaged
 * count, so a client that hit the ceiling can tell it did not receive everything.
 *
 * `page` **is** rejected below `FIRST_PAGE`, and the asymmetry is deliberate: `?page=0`
 * is not an over-eager request that can be honoured smaller, it is a request for a page
 * that does not exist, and silently answering it with page 1 would make a paging bug in
 * a client look like a working screen.
 */
export const walletTransactionsSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z
    .object({
      page: z.coerce.number().int().min(FIRST_PAGE, 'Pages start at 1.').default(FIRST_PAGE),
      pageSize: z.coerce
        .number()
        .int()
        .min(1, 'Ask for at least one row.')
        .default(DEFAULT_PAGE_SIZE)
        .transform((value) => Math.min(value, MAX_PAGE_SIZE)),
    })
    .strict(),
});
