# PR 7.3 — `POST /wallet/topup`, and the balance that updates itself

| | |
|---|---|
| **Epic** | E7 — Wallet & Billing |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent. **The money function it calls is 7.1's and must not be edited** |
| **Depends on** | 7.1 (`topUpWallet`), 7.2 (the router, the controller, the contract block) |
| **Blocks** | 7.5 |
| **Branch** | `dev-a/E7.3-topup-endpoint` |

## Contract implemented

`POST /api/v1/wallet/topup` — body `TopUpRequest`, response `TopUpResponse`.
`wallet:updated` on `shared/socketEvents.js`, payload `{ balance }`, to `user:{userId}`.

`MVP.md` §12 "Wallet", §5.4, §13.

## Scope

The one endpoint that puts credit into the system. Everything else in the product spends.

**It is a mock and it credits immediately** — §18's own word, and §21 puts a payment
provider in Phase 2. That makes the validator the most important file in this PR, because
without it the endpoint is a URL that mints money.

**The client names a package, never an amount.** The body is `{ packageId }`, and
`packageId` is a member of `TOPUP_PACKAGES` — the same `[50, 100, 200]` that
`GET /public/pricing` already puts on the wire as `topupPackages`, so the client has no
second representation to map through. The validator checks membership against the
constant, never a range: `z.literal`-per-package or a refinement over the array, so
adding a package is one edit to `constants/money.js` and no edit here. **A body carrying
credits is a body that grants them**, and a `min/max` check would accept 137.

**This route gets its own rate limiter.** An un-limited mock top-up is an
infinite-money loop a reviewer will find in a minute. Use `makeStrictLimiter()` and keep
the instance in `wallet.routes.js` — **not** the shared `strictLimiter`, which is the
two frozen auth routes' counter. `question.routes.js` already made this call and wrote
down why: one shared instance meant a few sign-ins during a test run spent the questions
a student was allowed to ask, and "the count is about this endpoint" is what a rate limit
is supposed to mean. Same window, same production number (§15.5).

**A thin service, `wallet.topup.service.js`, opens the transaction.** It is the caller
`topUpWallet` was written to have: `prisma.$transaction(tx => topUpWallet({…}, tx))`,
then the emit **after** the commit. It does not compute the amount from the body — it
looks the package up in `TOPUP_PACKAGES` a second time, from the id the validator already
approved, so the amount reaching money is read from the constant rather than from the
request. That is one line and it is the difference between an allowlist and a
transcription.

Do not put this in `wallet.view.service.js`: that file reads and this one writes, and
7.2's brief says it never imports `wallet.service.js`.

**`wallet:updated` is appended and emitted here, and here only.** `shared/socketEvents.js`
is append-only and its header already reserves this name for E7. One emitter,
`emitWalletUpdated(userId, { balance })` in `sockets/events.js`, through the existing
`emitToUser` — nothing else in the server calls `emit`, which is that file's stated
property. **After the commit, never inside**: 6.3, 6.5 and 6.6 all made this call, and an
emit inside a transaction is a client told about a balance that may still roll back.

The epic README states why nothing else emits it: `session:block_warning` carries
`balanceAfter` and `session:extended` carries the balance, so the session screen already
knows. A second event for the same number is two sources of truth for one figure.

## Files you may touch

```
server/src/validators/wallet.schema.js         the topup body — membership of TOPUP_PACKAGES
server/src/services/wallet.topup.service.js    NEW. Opens the transaction; emits after commit
server/src/controllers/wallet.controller.js    one handler, 201, no prisma
server/src/routes/wallet.routes.js             one route + its own makeStrictLimiter() instance
server/src/sockets/events.js                   emitWalletUpdated, through emitToUser
shared/socketEvents.js                         APPEND ONLY: WALLET_UPDATED
shared/api.d.ts                                inside E7's block only, if a comment needs sharpening
server/tests/wallet.topup.test.js              NEW. The allowlist, the emit-after-commit, the 429
docs/epics/E7-wallet-billing/README.md         tick the status box
```

## Files you must NOT touch

```
server/src/services/wallet.service.js      §17.5. topUpWallet is 7.1's and is finished
server/src/services/wallet.view.service.js 7.2's, and it reads
server/src/config/constants/money.js       TOPUP_PACKAGES is the allowlist, not a thing to grow here
server/src/sockets/handlers.*.js           no new client → server event
server/src/app.js                          frozen after 0.4
client/**                                  7.5 presses this button
prisma/schema/**                           TOPUP has been in the enum since 0.2
docs/epics/E6a-*/**                        another epic's chain
```

## Acceptance criteria

- [ ] `POST /api/v1/wallet/topup` with `{ "packageId": 50 }` returns `201` and `{ balance, credited: 50, transactionId }`, and the balance is the pre-existing balance plus 50
- [ ] `{ "packageId": 137 }`, `{ "packageId": 0 }`, `{ "packageId": -50 }` and `{ "amount": 50 }` each return `400 VALIDATION_ERROR` and write **nothing** — no balance change, no ledger row
- [ ] The ledger row is `type: 'TOPUP'`, `sessionId: null`, positive `amount`, `balance_after` equal to the new balance
- [ ] A second tab logged in as the same user receives `wallet:updated` with the new balance, without reloading
- [ ] No token → `401`. A teacher's token → `201`; wallets are per-user, not per-role
- [ ] Repeating the request past the strict budget returns `429 RATE_LIMITED` in the standard error shape
- [ ] The emit happens after the commit: a forced failure inside the transaction emits nothing
- [ ] `grep -c "emit(" server/src/sockets/events.js` is unchanged outside the two helpers — nothing outside this file calls `emit`
- [ ] `node scripts/reconcile.mjs check` returns zero rows after ten top-ups
- [ ] `npm test` passes

## Manual test

1. `npm run dev`. Log in as a seeded student in two tabs.
2. In tab 1, `POST /api/v1/wallet/topup {"packageId": 100}` from the console.
3. Tab 2's socket receives `wallet:updated` with the new balance. Watch it in the
   Network → WS frames panel; no screen renders it until 7.5.
4. `select type, amount, balance_after, session_id from wallet_transactions where user_id = … order by created_at desc limit 1;` — `TOPUP`, `100`, null session.
5. `POST` with `{"packageId": 137}` — `400`, and the balance is unchanged.
6. Repeat step 2 until `429`.
7. `node scripts/reconcile.mjs check` — zero rows.

## Review checklist additions

- **The amount that reaches `topUpWallet` must be read from `TOPUP_PACKAGES`, not from
  `req.body`.** Even with the validator in front, a service that transcribes the body is
  one refactor away from being the only check. Grep the service for `req` — it must not
  appear at all (`CONVENTIONS.md`, layering rule 2).
- The emit is outside `prisma.$transaction`'s callback. A reviewer should be able to see
  the closing brace above the emit line.
- `shared/socketEvents.js` is APPEND-ONLY. The header paragraph that says
  `wallet:updated` "stays E7's" is **not edited** — E6 set that precedent when it
  appended five names under a paragraph saying they were unappended, and said why. Add a
  comment below, do not rewrite above.
- No new error code. A bad package is `VALIDATION_ERROR`; `INSUFFICIENT_CREDIT` has
  nothing to do with a credit.

## Notes

**Why `credited` is echoed on the response.** The client already knows which package it
pressed, so the field looks redundant — it is there so the confirmation cannot disagree
with what actually happened. If the allowlist ever rejects and something answers `200`
anyway, the screen shows the number the server credited rather than the number the button
believed.

**`transactionId` is on the response for one reason**: it is the row the ledger screen
scrolls to after a top-up, and 7.5 uses it to highlight the new line rather than
re-fetching and diffing. If 7.5 does not end up needing it, it stays — a ledger row's id
is the only handle a support conversation has.

**This PR is where the epic's second risk lives.** Free credit is deliberate for the MVP,
so the defence is not "make it real" — it is the allowlist, the rate limiter, and the fact
that every credit lands in an append-only ledger that `reconcile.mjs` sums. All three are
in this PR, and a review that waves any of them through is the review that matters.
