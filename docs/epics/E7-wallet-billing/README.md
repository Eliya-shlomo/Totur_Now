# E7 — Wallet & Billing

| | |
|---|---|
| **Depends on** | E1 (1.1–1.5 merged) and **E6 (through 6.9)** — 6.5 already built the money layer this epic extends |
| **Blocks** | nothing. E8's history screen reads sessions, not the ledger |
| **Runs alongside** | E6a. See "Collision with E6a" below — three shared files, all append-only, all named |
| **Definition of done** | A student with no credit tops up on `/app/wallet`, watches the balance change without reloading, spends it on a session, and finds both movements in the ledger below the button they pressed — and after that pass, `node scripts/reconcile.mjs check` returns zero rows. |

## The problem this epic has to solve

**Most of what `MVP.md` §18 lists for E7 is already merged**, and the naive split — the
one §18 wrote — would have this epic build a second money layer beside the one that
charges every session today.

E6's Amendment 2 is the reason. §18 wrote E6 as depending on E7, and E7 did not exist,
so rather than block the epic or fake the charge, **PR 6.5 built `wallet.service.js`
human-written with the three operations a session needs** — `chargeStudent`,
`creditTeacher`, `refundSession` — each one a row lock, an assert, a balance move and a
ledger append, in a transaction the caller opened. 6.6 spent them. E5's
`utils/commission.js` had already written §5.3's split as a pure function, so the fee
and the earning were decided before E6 needed them.

So five of §18's eight E7 rows are shipped code:

| §18's row | Where it actually is |
|---|---|
| 7.1 `wallet.service` — single money entry point + ledger | `server/src/services/wallet.service.js`, PR 6.5. Human-written |
| 7.2 Block charging transaction with `FOR UPDATE` | `lockWalletBalance` in `wallet.repository.js`, PR 6.5. Spent by 6.3 and 6.5 |
| 7.3 Teacher earnings + platform fee + commission rules | `platformFeeRate` (E5) resolved at `started_at` by `session.end.service.js` (6.6) |
| 7.4 Refunds — no-show | `reportSessionNoShow`, PR 6.6. **Technical failure and early exit were never written** — see below |
| 7.6 Reconciliation query | `scripts/reconcile.mjs`, PR 6.9, invariant 1 of five |

**What is left is the half of the wallet that a human can see.** There is no
`/api/v1/wallet` mount of any kind: no balance read, no ledger read, no top-up, and
therefore no way for a student to put credit into an account the whole product spends
from. `routes/index.js` goes `auth · offers · public · questions · sessions · teachers`
and stops. `TOPUP` has been in the `tx_type` enum since PR 0.2 and no row has ever
carried it. Both screens §14.1 promises — `/app/wallet` and `/teach/earnings` — are
still `<Placeholder pr="7.7">` and `<Placeholder pr="7.8">`.

That is the shape of this epic: **one new money operation, one new router, two screens,
and the two refund rules §5.5 states and nobody implemented.** It adds to
`wallet.service.js`. It does not get a second one.

### The two refunds that were never written

`MVP.md` §5.5 has six rows and E6 implemented four of them. The two it did not:

| §5.5 scenario | Outcome | Today |
|---|---|---|
| **Platform technical failure** | Full refund | `end_reason` has an `error` value and nothing writes it. A session ended by a failure charges in full |
| **Student closes within 60s of start** | Full refund | `terminateSession` charges in full at any elapsed time. `NO_SHOW_WINDOW_SEC` has exactly one reader, and it is the *teacher's* no-show path |

Neither is an oversight to be embarrassed about — 6.6's brief scoped the terminal edges
and the no-show refund, and §5.5's other two rows are a *pricing* rule rather than a
lifecycle one. But they are money, they are the epic named after money, and the student
who quits forty seconds in because the teacher opened with the wrong topic is the exact
person §5.5 was written for. 7.4 writes them, **by hand**, per §17.5.

### Why the minutes are computed on the client

§12 says `GET /wallet` answers "Balance + '≈ X minutes'". It cannot, and the reason is
worth writing down once here rather than arguing per PR: **minutes are a function of a
teacher's price**, and the wallet endpoint has no teacher. §5.4's own example says so —
"₪96 ≈ 40 minutes **with Dana**".

`client/src/lib/credits.js` already owns that translation, floors it to whole blocks,
and exists — in its own words — "so that the card, the selection screen and the wallet
cannot each round it differently". It takes `blockMinutes` from `GET /public/pricing`
rather than hardcoding `5`, which is what keeps the label from drifting from the
billing. A server-computed `approxMinutes` at the default price would be a second
rounding of the same number, shown beside the first on the same screen.

So `GET /wallet` returns credits and a timestamp, and `minutesFor(balance,
pricing.price.default, pricing.block.minutes)` renders the sentence. Recorded in the
deviations table.

### Why `note` is not on the wire

`appendWalletTransaction`'s contract says `note` is "operator-facing text and never
reaches a client", and nothing in E6 rendered one. E7 is the first epic that could
break that by accident, because the ledger screen is a list of exactly those rows.

It stays off the response. The notes 6.5 and 6.6 write are English strings chosen for a
log reader — `'Session earning'`, `'No-show refund'` — and putting them on a student's
screen would make every future note a user-facing string that nobody reviews as one.
The ledger renders `type`, which is an enum both sides already share, and the client
owns the sentence.

## Collision with E6a

Rotem is mid-E6a. Checked file by file against all six E6a allowlists. **Everything in
this epic is disjoint except three files, and all three are append-only.**

| File | E6a's claim | E7's claim | Rule |
|---|---|---|---|
| `shared/api.d.ts` | 6a.4 adds one field **inside** `Classification` | 7.2 opens a new `// ── E7 — money ──` block **at the end** | Both append at EOF and that is where git conflicts. E7's block is written once, in 7.2, and later PRs append inside it |
| `package.json` | 6a.3 adds `"bench:classify"` | 7.8 adds `"reconcile"` | One line each, in the same object. Trivial to resolve, named so nobody is surprised |
| `docs/README.md`, `docs/OWNERSHIP.md` | 6a.6 updates the epic index and the `media.service.js` row | 7.8 updates the epic index and the `wallet.service.js` owner row | Different rows of the same tables. Whoever closes second rebases |

**`client/src/pages/teacher/**` looks like an overlap and is not.** It is on 6a.5's
allowlist as a glob — "the dashboard's question card, if it shows one" — and 6a.5 edits
`Dashboard.jsx` and possibly `Profile.jsx`. E7's `Earnings.jsx` is a **new file** that
6a.5 has no reason to open and no way to conflict with. Named here so it is a decision
somebody made rather than a glob nobody checked. If 6a.5 turns out to touch
`Earnings.jsx`, that is a chat message, not a merge.

**No schema change, and this is load-bearing.** `prisma/schema/wallet.prisma` already
has `Wallet`, `WalletTransaction` with `TOPUP` in the enum, and `Payout`. §17.5 makes
the schema human-owned and `OWNERSHIP.md` §2 makes migrations a two-developer
agreement — and **Rotem has one in flight in 6a.4**, which adds `how_to_start` to
`questions`. Two migrations in flight at once is the one thing §2 says never to do. If
any PR in this epic finds it needs a column, **stop and ask**; do not generate a
migration.

The socket catalogue is E7's by prior arrangement rather than by accident:
`shared/socketEvents.js`'s own header says `wallet:updated` "stays E7's: E6 has no
wallet screen to update". E6a touches no socket file.

## The split

| | DEV-A (eliya) | DEV-B (rotem) |
|---|---|---|
| **Slice** | **All of E7.** The wallet's visible half, plus the two refunds §5.5 states and E6 did not write | E6a, uninterrupted |
| **Server** | 7.1 top-up, 7.2 the read surface, 7.3 the top-up endpoint, 7.4 the two refunds, 7.6's earnings read | — |
| **Client** | 7.5 the wallet screen, 7.6 the earnings screen, 7.7 the out-of-credit path | — |
| **Filler** | 7.8's reconciliation pass | — |

This is a single-developer epic, the third in a row — E5, E6 and now E7 — and the
template's "both developers ship server and client work" is satisfied within the one
column rather than across two. DEV-A has four server PRs and three client PRs.

**If Rotem finishes E6a early**, the two clean hand-offs are **7.6** and **7.7**: both
are agent-shaped, both depend only on a merged endpoint, and neither touches
`wallet.service.js` or any file E6a opened. 7.1 and 7.4 are not hand-offable at any
point — they are §17.5's human-written money.

## Order

| # | PR | Owner | Size | Depends on | Status |
|---|---|---|---|---|---|
| 7.1 | [**Top-up: the wallet's fourth operation, and its last**](PR-7.1-topup-operation.md) | DEV-A | **human** · M | E6 | ☑ |
| 7.2 | [The wallet read surface: `GET /wallet`, `GET /wallet/transactions`](PR-7.2-wallet-read-surface.md) | DEV-A | M | 7.1 | ☑ |
| 7.3 | [`POST /wallet/topup`, and the balance that updates itself](PR-7.3-topup-endpoint.md) | DEV-A | M | 7.1, 7.2 | ☑ |
| 7.4 | [**§5.5's two unwritten refunds: early exit and platform failure**](PR-7.4-remaining-refunds.md) | DEV-A | **human** · M | E6 | ☑ |
| 7.5 | [The wallet screen — minutes, packages, ledger](PR-7.5-wallet-screen.md) | DEV-A | L | 7.3 | ☑ |
| 7.6 | [Teacher earnings: the read, and the screen that reads it](PR-7.6-teacher-earnings.md) | DEV-A | L | 7.2 | ☑ |
| 7.7 | [Out of credit, mid-session: top up from the 60-second warning](PR-7.7-out-of-credit.md) | DEV-A | S | 7.5 | ☑ |
| 7.8 | [E7 close: the twenty-operation reconciliation pass, and the retro](PR-7.8-e7-close.md) | DEV-A | S | 7.4, 7.6, 7.7 | ☑ |
| 7.9 | [§5.3 has three implementations and two of them are wrong](PR-7.9-commission-column.md) | DEV-A | S | — | ☑ |

Status: ☐ not started · ◐ partial · ☑ done. Size: S (<2h) · M (2–4h) · L (half day+).
Bold + **human** marks a PR written without an agent, per `MVP.md` §17.5.

**7.9 was not in the plan.** It is the defect 7.8's pass found — §5.3's commission is
computed from three different dates at three call sites — and it is a row here rather
than a line in the retro because 7.8's own review checklist forbids a close PR that also
contains a money fix. See [`RETRO.md`](RETRO.md), F1 and F2. It landed after the close:
the settlement reads `teacher_profiles.created_at` now and the accept modal quotes the
net, so the three call sites answer one number, and `commission.column.test.js` holds
them there with the fixture nobody would build by accident — a teacher whose account and
whose profile were created months apart.

## The pass, in one paste

§18's acceptance criterion for E7 — "after 20 mixed operations, `wallets.balance` equals
the sum of `wallet_transactions.amount` for every user. No exceptions." Twenty operations
ran on 2026-08-23 against `localhost:5433/tutor_now`, `check` ran after every one of them
that moved money, and all twenty-three came back empty. The full account, the two defects
and the mutation ledger are in [`RETRO.md`](RETRO.md).

```
$ npm run reconcile

database: localhost:5433/tutor_now

✔ 1. wallets whose balance disagrees with their ledger — none
✔ 2. sessions whose total_charged disagrees with their blocks — none
✔ 3. sessions whose split does not add up — none
✔ 4. sessions whose ledger rows disagree with their columns — none
✔ 5. teachers left IN_SESSION with no session running — none

RECONCILED — five invariants, zero rows.

$ node scripts/reconcile.mjs diff --baseline .baseline.json

AT BASELINE — every counted table and the credit total are where they were.
```

## Parallelism map

```
  E6a  6a.1 ─ 6a.2 ─ 6a.3 ─┐                       (DEV-B, untouched)
         └──── 6a.4 ─ 6a.5 ─┴─ 6a.6
                 │                    ┊ shared/api.d.ts · package.json · docs/*
                 ┊ append-only, three files, named above
                 ┊
  E7   7.1  top-up op (human)         7.4  §5.5's refunds (human)
        │                              │    ← independent of the whole chain
       7.2  read surface ──────┐       │
        │                      │       │
       7.3  POST /topup      7.6  earnings: read + screen
        │                      │       │
       7.5  wallet screen      │       │
        │                      │       │
       7.7  out of credit ─────┴───────┴─ 7.8  close
```

**7.4 is deliberately off the chain.** It touches `session.end.service.js` and nothing
else in this epic touches that file, so it can be written on any day the wallet chain
is blocked — which is the honest answer to "what does one developer do while reviewing
their own agent's PR".

**7.1 is the head and it is human.** Nothing else in the epic can be written against a
top-up operation that does not exist, and the one thing §17.5 forbids is discovering
its shape from an agent's guess.

## Contract freeze

Appended to `shared/api.d.ts` by **7.2**, in one new `// ── E7 — money ──` block at the
end of the file. Later PRs append inside that block. Changing anything below is a chat
message before the code.

```ts
/** `wallet_transactions.type`. Mirrors the Prisma enum in prisma/schema/wallet.prisma. */
export type WalletTxType =
  'TOPUP' | 'SESSION_CHARGE' | 'REFUND' | 'TEACHER_EARNING' | 'PAYOUT' | 'PROMO';

/**
 * `GET /wallet`. Credits and nothing else — minutes are a function of a teacher's
 * price and this endpoint has no teacher. `lib/credits.js` renders the sentence.
 */
export interface WalletResponse {
  balance: number;
  /** ISO 8601, UTC. `wallets.updated_at`. */
  updatedAt: string;
}

/**
 * One ledger row. **`note` is not here and is not coming** — it is operator-facing
 * text (see wallet.repository.js) and the client owns the sentence it renders.
 */
export interface WalletTransactionRecord {
  id: string;
  type: WalletTxType;
  /** Signed. Negative is money leaving the wallet. */
  amount: number;
  balanceAfter: number;
  /** Null for a top-up, which belongs to no session. */
  sessionId: string | null;
  createdAt: string;
}

/** `GET /wallet/transactions?page&pageSize`. Newest first. `total` is the whole ledger. */
export interface WalletTransactionsResponse {
  transactions: WalletTransactionRecord[];
  total: number;
}

/**
 * `POST /wallet/topup`. **The client names a package, never an amount** — the value
 * is looked up in `TOPUP_PACKAGES` server-side, and a body that carries credits is a
 * body that grants them.
 */
export interface TopUpRequest {
  /** A member of `PublicPricingResponse.topupPackages`. Credits, and an allowlist. */
  packageId: number;
}

export interface TopUpResponse {
  balance: number;
  /** What was added. Echoed so the confirmation cannot disagree with the request. */
  credited: number;
  transactionId: string;
}

/** One row of `/teach/earnings`. A finished session, from the teacher's side. */
export interface EarningRecord {
  sessionId: string;
  /** ISO 8601, UTC. `sessions.ended_at` — when the earning was credited. */
  endedAt: string;
  /** What the student paid. `sessions.total_charged`. */
  totalCharged: number;
  /** `sessions.platform_fee`. Zero in both of §5.3's free cases. */
  platformFee: number;
  /** `sessions.teacher_earning`. Positive. What the ledger row credited. */
  teacherEarning: number;
  /** The session's topic, for the row's label. Null if the question had none. */
  topicName: string | null;
}

/** `GET /wallet/earnings?page&pageSize`. Teacher-only. Newest first. */
export interface EarningsResponse {
  /** The teacher's own wallet balance — the same number `GET /wallet` answers. */
  balance: number;
  earnings: EarningRecord[];
  total: number;
  /** All-time, across every finished session — not just the page returned. */
  totals: { gross: number; fee: number; net: number };
}
```

Appended to `shared/socketEvents.js` by **7.3**:

```js
/** The balance moved. Payload: `{ balance }`. Sent to `user:{userId}`. */
WALLET_UPDATED: 'wallet:updated',
```

**Emitted after a committed top-up and nowhere else, and that is a decision.** §13 lists
it as `user`-scoped with `{balance}`, which invites emitting on every balance change —
but a socket emit inside `wallet.service.js` would be an emit inside the caller's
transaction, which is the one thing E6 established never to do (6.3's room creation,
6.5's `session:extended`, 6.6's `session:ended` are all after the commit). And the two
balance changes E6 makes already reach the only screen that shows them:
`session:block_warning` carries `balanceAfter` and `session:extended` carries the
balance. A second event for the same number, arriving at the same tab, is two sources of
truth for one figure.

## Deliberate deviations from `MVP.md` §18

| §18 said | We do | Why |
|---|---|---|
| **Owner: B** | **DEV-A takes E7** | Rotem is mid-E6a and the one-epic-per-owner rule (§17.7) holds. E7's dependency is E1, and its money layer is E6's — nothing in it needs the developer who wrote E6a's classifier. Recorded here rather than assumed |
| 7.1 `wallet.service` — single money entry point + ledger, **L** | One operation, `topUpWallet`, **M** | The service exists, human-written, since 6.5. E7 adds a fourth operation to it. A second entry point is the thing §15.2's rule 3 exists to forbid |
| 7.2 Block charging transaction with `FOR UPDATE` | **Not re-done.** Already shipped | `lockWalletBalance` is 6.5's, is raw SQL because Prisma has no row lock, and is exercised by every session in the repo |
| 7.3 Teacher earnings + platform fee + commission rules | The **read**, not the write | The write is 6.6's, against E5's `platformFeeRate`, resolved at `started_at`. E7 shows the teacher what it did |
| 7.4 Refunds — no-show, technical failure, early exit | No-show is 6.6's. **E7 writes the other two** | §5.5 has six rows and four are implemented. The remaining two are money, so they are human-written, and they are one PR because they are one branch in one function |
| 7.5 `POST /wallet/topup` (mock) + packages | Split in two: **7.1** the operation, **7.3** the endpoint | §17.5 draws the line inside this row: the function that moves money is human, the controller and validator around it are agent work like any other |
| 7.6 Reconciliation query — balance vs. transaction sum | **Not written.** Re-run instead, in 7.8 | `scripts/reconcile.mjs` is 6.9's and its invariant 1 is exactly this query, generic over `tx_type`. E7's contribution is running it after twenty operations that include top-ups, and wiring `npm run reconcile` |
| §12: `GET /wallet` → "Balance + ≈ X minutes" | Credits and `updatedAt`. Minutes on the client | Minutes need a teacher's price and the endpoint has none. `lib/credits.js` is the one translation, already written and already flooring to whole blocks |
| §12 lists three wallet endpoints | Four. **`GET /wallet/earnings` is new** | §18's 7.8 promises an earnings screen and §12 gives it no endpoint. It reads the ledger joined to sessions, so it belongs on the router that owns the ledger — putting it on `/teachers/me` would make `teacher.repository.js` read the wallet tables |
| §13's `wallet:updated` — "user, `{balance}`" | Appended, emitted on top-up only | An emit on every balance change would be an emit inside somebody else's transaction. The session's two balance changes already ride on events the session screen listens to |
| Nothing about `/app` | 7.5 replaces the `pr="E1/E7"` dashboard placeholder with the balance | The placeholder names this epic. §14.1's "recent sessions" half stays E8's |

## Risks

- **A second money entry point is the failure mode of this epic.** Every PR here is
  one `prisma.$transaction` away from writing a balance without a ledger row —
  `routes/index.js` gaining a `/wallet` mount is exactly the moment a controller could
  reach past the service. Every allowlist below denies `prisma` to controllers, and
  §17.4's "every balance change goes through `wallet.service`" is the review line that
  matters more than any other in this epic.
- **A mock top-up is free money and there is no payment provider behind it.** `POST
  /wallet/topup` credits immediately, so anyone with an account can mint credits, and
  the teacher's earning against them is real. That is deliberate for the MVP and §21
  puts the provider in Phase 2 — but the endpoint must be rate-limited and must refuse
  any amount not in `TOPUP_PACKAGES`, or the demo has an infinite-money URL that a
  reviewer will find.
- **The ledger screen is the first thing that renders `wallet_transactions` to a human,
  and the rows were written for a log.** Three of the six `tx_type` values have never
  been written by any code (`PAYOUT`, `PROMO`) or have no screen (`TEACHER_EARNING`, on
  the student's screen). The client must render an unknown type as something rather
  than as nothing — an enum the server can extend is an enum the client will meet a new
  value of.
- **7.4 changes what an ending session charges, and `e2e.session.lifecycle.test.js`
  asserts the current arithmetic.** A refund branch at 40 seconds is a branch the
  existing E2E fixtures may fall inside by accident, because a test session starts and
  ends in the same millisecond. Named because "the suite went red and I relaxed the
  assertion" is how a refund rule becomes a refund bug.
- **There are two databases and the tooling does not agree on which.**
  `scripts/reconcile.mjs` reads the repo-root `.env` (local Docker, `localhost:5433`);
  anything run from `server/` reads `server/.env` (Neon, hosted). A probe script and a
  reconciliation run started from different directories check different databases, and
  the reconciliation passes because nothing wrote to what it is looking at. **This
  happened in 7.3 and again in 7.4.** 7.8's pass now opens by naming the database. Neon
  carries three probe sessions and two probe top-ups from those PRs, left in place by
  decision; the sessions break invariant 2 there until cleaned up.
- **Two migrations in flight is the rule this epic could break.** Nothing here needs a
  column and 6a.4 has one open. If a PR's scoping says otherwise, the answer is a chat
  message, not `prisma migrate dev`.
- **`shared/api.d.ts` is appended by both epics in the same week.** 7.2 opens E7's block
  once and every later PR appends inside it, so the file has one conflict region for
  this epic rather than six.

---

## Checklist before writing the PR briefs

- [x] Every PR names exactly one owner — DEV-A, all eight
- [x] No two in-flight PRs edit the same file — the chain is sequential where it shares a file; `wallet.repository.js` is opened by 7.1 (one JSDoc line) then 7.2, in that order, and 7.6 after both
- [x] Any shared file is either frozen, append-only, or split by domain — `shared/api.d.ts`, `shared/socketEvents.js`, `routes/index.js`, `package.json` and `.env.example` are all append-only, and the three E6a shares are named above
- [x] Human-written items from `MVP.md` §17.5 are marked as such — 7.1 and 7.4, bold and **human** in the order table
- [x] Each PR has an allowlist and a denylist
- [x] Each PR has acceptance criteria a human can check in under five minutes
- [x] Both developers have server and client work — single-developer epic; DEV-A has four server PRs and three client PRs, and the reason DEV-B has none is E6a, not layering
- [x] There is filler work for whoever finishes first — 7.4 is off the chain by design, and 7.8's pass is the last thing to run
