# PR 6.5 — Wallet service, opening charge, extend, and the meter crons

| | |
|---|---|
| **Epic** | E6 — Session Lifecycle & Video |
| **Owner** | DEV-B (rotem) |
| **Size** | L |
| **Written by** | **Human — no agent.** `MVP.md` §17.5 names `wallet.service.js` explicitly, and this PR creates it. A bug here mints or destroys real credit. |
| **Depends on** | 6.3 |
| **Blocks** | 6.6, 6.7 |
| **Branch** | `dev-b/E6.5-billing-and-meter` |

## Contract implemented

`MVP.md` §5.1's blocks, §11.3-B's charge transaction, §12's `POST /sessions/:id/extend`, and
two of §13's four cron jobs — Block Warning and Session Auto-End. Plus the three socket
events that carry the meter to a screen.

## Scope

### 1. `wallet.service.js` — three operations and no fourth

E7 does not exist and §18 wrote E6 as depending on it. Rather than block the epic or fake the
charge, this PR creates the part of E7 that a session needs. **E7 then builds top-up, the
ledger endpoint and the wallet screen on top of this service. It does not get a second one.**

```js
chargeStudent({ userId, sessionId, amount, note }, tx)  → { balanceAfter }
creditTeacher({ userId, sessionId, amount, note }, tx)  → { balanceAfter }
refundSession({ userId, sessionId, amount, note }, tx)  → { balanceAfter }
```

Every one is the same four steps, and they are §11.3-B's:

```
1. SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE   -- the row lock, first
2. assert the result (balance >= amount for a debit; nothing for a credit)
3. UPDATE wallets SET balance = balance + $delta
4. INSERT INTO wallet_transactions (type, amount, balance_after, session_id, note)
```

**Each takes a `tx` and never opens its own.** The charge and the state change are one
transaction or they are a bug: a session that goes `ACTIVE` and then fails to charge is free
tutoring, and a charge that lands against a session that failed to start is theft. The row
lock is `FOR UPDATE` and it is step 1, before the read is used for anything — read-then-write
with a gap is two concurrent charges both seeing the same balance.

**`CHECK (balance >= 0)` is on the table and is the second line of defence, not the first.**
The assert in step 2 is the first. If the CHECK ever fires, that is a bug report, not a
control flow — it means the assert was skipped or the lock was not held.

**The ledger is append-only. No `UPDATE`, no `DELETE`, ever.** `balance_after` is written on
every row so the reconciliation query is a single `GROUP BY` and not a fold.

Amounts are integers in credits. Money is never a float anywhere in this system.

### 2. The opening block, inside the activation transaction

The second absence E5 named in `offer.respond.service.js` is closed. Step 5.5 of the accept:

```
amount = OPENING_BLOCKS × session.pricePerBlock
chargeStudent(...)                                    → INSUFFICIENT_CREDIT (402) if short
session.blocks_used   = OPENING_BLOCKS
session.total_charged = amount
recordBlock({ blockNumber: 1, minutes: OPENING_BLOCKS × BLOCK_MINUTES, amount })
```

E5 already re-asserted affordability at offer time as a read; this is the write, and the
teacher is released and the offer left `PENDING` if it fails — the student's balance can move
between the two moments and the failure must not consume the offer.

**The comment at `session.repository.js:433` saying an unbilled `ACTIVE` session is not a
billing bug is deleted in this PR.** It stopped being true here.

### 3. `POST /sessions/:id/extend` — one block, no body

```
lock the session; assertTransition is not called — this is ACTIVE → ACTIVE
assert status === 'ACTIVE'                            → SESSION_NOT_ACTIVE (409)
amount = EXTENSION_BLOCKS × pricePerBlock
assert totalCharged + amount <= budgetCap             → BUDGET_CAP_REACHED (402)
chargeStudent(...)                                    → INSUFFICIENT_CREDIT (402)
extendSession({ expectedEndsAt, endsAt: endsAt + EXTENSION_BLOCKS × BLOCK_MINUTES })
recordBlock({ blockNumber: blocksUsed + 1, ... })
after COMMIT: emitSessionExtended → session:{id}
```

**`extendSession` matches on `ends_at` as the caller read it** — 6.2 wrote it that way. Two
extend requests in the same second: the second matches zero rows, and it is answered
`SESSION_NOT_ACTIVE` rather than being retried. A double-tapped button must not buy two
blocks.

**No body.** One block is the only thing an extension can buy. A quantity in the body is a way
to overrun the budget cap in one request.

**The budget cap is checked before the charge, not after.** `budget_cap` defaults to 40 and
`BUDGET_CAP_REACHED` is a 402 that already exists in `errorCodes.js` with the right status.

### 4. Two cron jobs, on the existing tick

`jobs/index.js` gains two calls in its sequence and its header comment loses the paragraph
saying E6 owns them.

**Block Warning** — sessions where `ends_at - WARNING_SECONDS <= now < ends_at` and no warning
has been sent for the current `ends_at`. Emits `session:block_warning` to `session:{id}` with
`{ secondsLeft, extensionPrice, balanceAfter, canAfford, withinCap }`. The client renders a
modal; the server decides all four numbers, because a client that computes affordability
computes it differently from the endpoint that enforces it.

**Idempotence is on `ends_at`, not on a flag column.** No migration in this PR: the job keeps
the last-warned `ends_at` per session in memory for the life of the process. A restart
re-warns once, which is a duplicate modal and not a duplicate charge — the cheapest possible
failure, and it costs no column.

**Session Auto-End** — sessions past `ends_at + GRACE_SECONDS`. Ends them with
`end_reason = 'no_extension'` through 6.6's path… which does not exist yet. **This PR ships
the sweep and calls `endSession` directly** with the state change and the emit; 6.6 replaces
that call with the full termination including the teacher's credit, and its brief says so.
The alternative — shipping a meter that runs past its deadline for one PR — is a session that
charges for ten minutes and lasts for ever.

**Both jobs are timeliness, not correctness.** Render's free plan sleeps the instance and
`node-cron` runs in-process, so on a sleeping server neither runs. This is E5's ruling and it
holds: `GET /sessions/:id` evaluates `ends_at` lazily on every read, so a session past its
deadline reads as over regardless of whether anything swept it.

### 5. The 55-minute warning, finally emitted

`AUTO_AWAY_WARNING_MINUTES` has been unread since E0 and orphaned since 5.5. 6.2 appended
`teacher:away_warning`, so all that is left is a predicate. **`presence.autoAway.job.js` is
reopened for one predicate and one emit** — `ONLINE` teachers whose `last_seen_at` is older
than `AUTO_AWAY_WARNING_MINUTES` but newer than `AUTO_AWAY_MINUTES`. This is a deliberate
reopen of an E5 file, argued here rather than discovered in the diff, and it is the whole of
the change.

## Files you may touch

```
server/src/services/wallet.service.js             new — HUMAN-WRITTEN, three functions
server/src/repositories/wallet.repository.js      new — locked read, write, ledger append
server/src/services/session.activate.service.js   6.3's — the opening charge
server/src/services/session.meter.service.js      new — the extend endpoint's service
server/src/controllers/session.controller.js      fill the extend handler
server/src/jobs/session.blockWarning.job.js       new
server/src/jobs/session.autoEnd.job.js            new
server/src/jobs/index.js                          two calls in the sequence, header updated
server/src/jobs/presence.autoAway.job.js          REOPEN: one predicate, one emit
server/src/repositories/session.repository.js     ONLY the bodies 6.2 left as gaps
client/src/api/session.api.js                     append extendSession(sessionId)
server/tests/wallet.service.test.js               new
server/tests/session.meter.test.js                new
docs/epics/E6-session-lifecycle/README.md         tick the status box
```

## Files you must NOT touch

```
server/src/utils/commission.js         E5's, pure, correct. IMPORT platformFeeRate; do not restate §5.3
server/src/config/constants/money.js   every number is already there
server/src/config/constants/session.js every number is already there
server/src/services/session.state.js   6.2's rules
server/src/routes/**                   frozen again after 6.2
shared/**                              frozen at 6.2
prisma/schema/wallet.prisma            no migration. The tables and the CHECK exist
client/src/pages/**                    6.7's
```

## Acceptance criteria

- [ ] Accepting an offer charges `OPENING_BLOCKS × price_per_block`: the student's balance drops by exactly that, `blocks_used` is `2`, `total_charged` matches, and one `SESSION_CHARGE` row exists with the right `balance_after`
- [ ] One `session_blocks` row, `block_number = 1`, `minutes = 10`
- [ ] A student who cannot afford the opening block: the accept fails `402 INSUFFICIENT_CREDIT`, the session is **not** `ACTIVE`, the offer is still `PENDING`, the teacher is released, and no ledger row was written
- [ ] `POST /sessions/:id/extend` adds one block: `+EXTENSION_BLOCKS × price` charged, `ends_at` moves by exactly `EXTENSION_BLOCKS × BLOCK_MINUTES`, one more `session_blocks` row, one more ledger row
- [ ] Extending past `budget_cap` → `402 BUDGET_CAP_REACHED`, and **nothing was charged**
- [ ] Extending with an insufficient balance → `402 INSUFFICIENT_CREDIT`, and `ends_at` did not move
- [ ] Two extend requests fired simultaneously buy **one** block. One `200`, one `409`, one ledger row
- [ ] Extending a non-`ACTIVE` session → `409 SESSION_NOT_ACTIVE`
- [ ] A teacher calling extend → `403` (6.2's `authorize`)
- [ ] `session:block_warning` arrives once per block at T-60s, in both participants' tabs, carrying server-computed `canAfford` and `withinCap`
- [ ] A session left alone past `ends_at + GRACE_SECONDS` ends with `end_reason = 'no_extension'` and `session:ended` reaches both sides
- [ ] An `ONLINE` teacher idle past `AUTO_AWAY_WARNING_MINUTES` gets one `teacher:away_warning`; at `AUTO_AWAY_MINUTES` the existing sweep still takes them `OFFLINE`
- [ ] **Reconciliation holds after every one of the above**: every wallet's balance equals the sum of its `wallet_transactions.amount`
- [ ] No literal `2`, `5`, `10`, `40`, `60` or `30` appears in the diff where a constant exists
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. Note both wallet balances. Run an accept. Both numbers moved by exactly the opening amount, in one direction only — the teacher is credited at the **end**, not here
2. `select * from wallet_transactions order by created_at desc limit 3` — one row, right type, right `balance_after`
3. Extend once from the student's screen. Balance, `ends_at`, `blocks_used` and the ledger all move by one block
4. Set `budget_cap` to just above `total_charged` and extend again → `BUDGET_CAP_REACHED`, nothing charged
5. Set the student's balance to one credit under the extension price and extend → `INSUFFICIENT_CREDIT`, `ends_at` unmoved
6. Two `curl` extends in the same command, backgrounded: one `200`, one `409`, **one** ledger row
7. Sit on an `ACTIVE` session with the tab **backgrounded** through T-60s. The warning arrives with the right numbers. Do nothing; at T+30s the session ends
8. The reconciliation query from §11.3, after all of the above:
   ```sql
   SELECT w.user_id, w.balance, COALESCE(SUM(t.amount), 0) AS ledger
   FROM wallets w LEFT JOIN wallet_transactions t ON t.user_id = w.user_id
   GROUP BY w.user_id, w.balance HAVING w.balance <> COALESCE(SUM(t.amount), 0);
   ```
   Zero rows. **This is the acceptance criterion for the whole PR.**

## Review checklist additions

- Confirm every wallet function takes a `tx` and that none calls `prisma.$transaction` itself. A nested transaction here is a charge that commits when its session did not.
- Confirm the balance read is `FOR UPDATE` and is step 1. A plain `SELECT` passes every sequential test and loses money under two clients.
- Confirm `wallet_transactions` is only ever inserted into. One `UPDATE` against that table is the end of the audit.
- Confirm `platformFeeRate` is imported from `#utils/commission.js` and §5.3 is not restated. Two implementations are two answers to "what did I earn", and the teacher was quoted the first one at offer time.
- Confirm the budget-cap check precedes the charge and that its failure path writes nothing.
- Confirm `extendSession`'s `where` still carries `ends_at` as read. Dropping it is invisible in review and buys two blocks for one press.
- Confirm the block-warning emit is after commit and outside the transaction.
- Confirm the auto-away reopen is exactly one predicate and one emit, and that it does not touch the 60-minute sweep beside it.

## Notes

**Why the wallet service is created here rather than waiting for E7.** Because the alternative
was worse in every direction: blocking E6 on an epic nobody has started, or writing a
throwaway charge inside the session service that E7 would then have to find and delete. Three
functions with a row lock and a ledger append is not a smaller thing than E7 would have
written — it is the *same* thing, written when the first caller needed it. `MVP.md` §18's E6
block now records the reversal, and so does the dependency graph.

**Why the teacher is credited at the end and not per block.** A session that is refunded as a
no-show would otherwise have to claw back a credit the teacher already had, and clawing back
is the one ledger operation that cannot be an append. Credit once, at termination, net of the
fee, for the blocks actually consumed. 6.6 does it.

**Why the block warning holds its state in memory.** A `warned_at` column would be honest and
would cost a second migration in an epic that promised one. The failure mode of the in-memory
version is a duplicate modal after a restart; the failure mode of forgetting the column exists
is nothing. If E7 or E10 needs durable warning state, it can have the column then, with a
reason.
