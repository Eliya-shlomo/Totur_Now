# PR 7.1 — Top-up: the wallet's fourth operation, and its last

| | |
|---|---|
| **Epic** | E7 — Wallet & Billing |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | **Human — no agent.** `MVP.md` §17.5: `wallet.service.js` is human-written, and an agent may write its tests |
| **Depends on** | E6 (merged through 6.9) |
| **Blocks** | 7.2, 7.3 |
| **Branch** | `dev-a/E7.1-topup-operation` |

## Contract implemented

No endpoint. One exported function, `topUpWallet`, in
`server/src/services/wallet.service.js`. `MVP.md` §5.4, §11.2's `TOPUP`, §11.3's
principle.

## Scope

`wallet.service.js` has three operations and its header says "**Three operations and no
fourth**". This PR writes the fourth and changes that sentence, because the reason the
sentence was true is that E6 had no way for credit to enter the system — every balance
in the database today came from a seed.

`topUpWallet({ userId, amount, note }, tx, deps)` is a **credit**, so it is the same
four steps `creditTeacher` takes and it goes through `applyWalletDelta` unchanged: lock,
no assert, `balance + amount`, one `TOPUP` row. It writes `sessionId: null` — a top-up
belongs to no session, which is why the column is nullable and why
`appendWalletTransaction`'s own doc says so.

**It does not open a transaction.** Same rule as the other three and for a weaker reason
than theirs — a top-up has nothing to commit alongside it today, so the `tx` argument
buys nothing at this call site. It takes one anyway, because a function in this file
that opens its own transaction is a function the next caller will nest, and the four
signatures being identical is what makes the file readable in one pass. 7.3's service
opens the transaction and passes it in.

**The amount is not the caller's to invent.** The signature takes credits, and the
allowlist check against `TOPUP_PACKAGES` lives in 7.3's validator, one layer up — the
same place every other validation in this repo lives. What *this* file keeps is the
existing guard it already applies to all three operations: a non-integer or non-positive
amount is a programming error and fails as an internal error before step 1.

Three edits and nothing else:

1. `topUpWallet` beside the other three, with the file's JSDoc density.
2. The header paragraph — "Three operations and no fourth" becomes four, and says why
   the fourth arrived in E7 rather than in E6.
3. `appendWalletTransaction`'s `@param {…} params.type` union in `wallet.repository.js`
   gains `'TOPUP'`. **One line, JSDoc only.** No new repository function: the append
   already writes any `tx_type` and the read functions 7.2 needs are 7.2's.

The tests are the deliverable an agent could have written and did not, because they are
in the same PR as the money: `wallet.service.test.js` gains a `topUpWallet` block
asserting the four steps in order, the `TOPUP` type, the null `sessionId`, and that a
credit takes no affordability branch. Follow the existing file — it injects all three
collaborators through the third argument and needs no database.

## Files you may touch

```
server/src/services/wallet.service.js       topUpWallet, and the header's "no fourth"
server/src/repositories/wallet.repository.js  ONE JSDoc line: the type union gains 'TOPUP'
server/tests/wallet.service.test.js         the fourth describe block
docs/epics/E7-wallet-billing/README.md      tick the status box
```

## Files you must NOT touch

```
server/src/routes/**                    7.2 creates the wallet router. Not this PR
server/src/controllers/**               there is no controller for this yet, by design
server/src/services/session.*.js        the three existing operations' callers are correct
prisma/schema/**                        TOPUP has been in the enum since 0.2
shared/**                               7.2 opens E7's contract block
server/src/config/constants/money.js    TOPUP_PACKAGES already exists
docs/epics/E6a-*/**                     another epic's chain
```

## Acceptance criteria

- [ ] `topUpWallet` is exported from `wallet.service.js` and takes `({ userId, amount, note }, tx, deps)` — the same shape as the other three
- [ ] It routes through `applyWalletDelta`. `grep -c 'applyWalletDelta' server/src/services/wallet.service.js` returns 5
- [ ] `prisma` does not appear in `wallet.service.js`: `grep -c "from '#config/db.js'" server/src/services/wallet.service.js` returns 0
- [ ] The ledger row it writes has `type: 'TOPUP'`, a positive `amount`, and `sessionId: null`
- [ ] A non-integer, zero or negative amount throws `AppError.internal()` and writes neither the balance nor the ledger
- [ ] The header no longer claims three operations, and says why the fourth is here
- [ ] `npm test` passes with no database and no network

## Manual test

1. `npm test -- server/tests/wallet.service.test.js` — the new block passes.
2. In a Node REPL against a real database, inside a `prisma.$transaction`, call
   `topUpWallet({ userId: <a seeded student>, amount: 50 })`, then
   `select balance from wallets where user_id = …` and
   `select type, amount, balance_after, session_id from wallet_transactions order by created_at desc limit 1;`
   — balance up 50, one `TOPUP` row, `session_id` null, `balance_after` equal to the balance.
3. `node scripts/reconcile.mjs check` — zero rows.

## Review checklist additions

- **The lock is step 1 and it is not optional for a credit.** A credit cannot fail on
  affordability, which is exactly why it is tempting to skip the `FOR UPDATE` here — and
  skipping it makes `balance_after` on the ledger row a number read before somebody
  else's concurrent debit committed. The row would be wrong while the balance stayed
  right, and invariant 1 of `reconcile.mjs` sums `amount`, not `balance_after`, so
  nothing would catch it. Route through `applyWalletDelta` and the question does not
  arise.
- No `$transaction` in this file. `grep prisma server/src/services/wallet.service.js`
  must stay empty.
- The three existing functions' bodies are unchanged. A diff that reformats them is a
  diff that hides the one new function in a file §17.5 says a human reads line by line.

## Notes

**Why this is `M` and §18 called it `L`.** §18's 7.1 was "`wallet.service` — single money
entry point + ledger", written when no such file existed. PR 6.5 built it — the lock,
the four steps, the append-only ledger, the injected collaborators — for the reason E6's
Amendment 2 sets out. What is left of §18's row is one credit operation.

**Read `applyWalletDelta` before writing anything.** It already handles a credit
correctly: `isDebit: false` skips step 2, and steps 3 and 4 are sign-agnostic. If
`topUpWallet` needs anything that is not a name, a sign and a `tx_type`, that is a signal
the design changed and worth a second look rather than a special case.

The mock top-up gives credit away for nothing, which is §18's own word for it and §21's
Phase 2 item. This file is not where that is defended — it moves what it is told to
move. **The allowlist that stops a client naming its own amount is 7.3's validator**, and
that is the PR to be strict in.
