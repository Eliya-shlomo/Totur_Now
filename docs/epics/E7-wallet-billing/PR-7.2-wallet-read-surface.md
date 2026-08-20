# PR 7.2 — The wallet read surface: `GET /wallet`, `GET /wallet/transactions`

| | |
|---|---|
| **Epic** | E7 — Wallet & Billing |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent. |
| **Depends on** | 7.1 (merged — it opens `wallet.repository.js` for one JSDoc line first) |
| **Blocks** | 7.3, 7.6 |
| **Branch** | `dev-a/E7.2-wallet-read-surface` |

## Contract implemented

`GET /api/v1/wallet` → `WalletResponse`
`GET /api/v1/wallet/transactions?page&pageSize` → `WalletTransactionsResponse`

`MVP.md` §12 "Wallet". This PR also **opens E7's block in `shared/api.d.ts`** and writes
the whole contract freeze from the epic README into it, including the shapes 7.3 and 7.6
will implement — one append, one conflict region, per the epic's collision note.

## Scope

There is no `/api/v1/wallet` mount of any kind. `routes/index.js` goes `auth · offers ·
public · questions · sessions · teachers` and stops, so a student cannot read the balance
the entire product spends from. This PR builds the router and its two reads. **No money
moves in it.**

**A new service file, `wallet.view.service.js`, and that is the important decision.**
Layering (`CONVENTIONS.md` → "Server layering", rule 1) forbids a controller touching the
database, so a read needs a service — and it must not be `wallet.service.js`, which
§17.5 makes human-written and which this PR is not allowed to open. E6 made the same
split for the same reason and gave it a name: `session.view.service.js` reads what
`session.*.service.js` writes. So: **`wallet.service.js` moves money and an agent never
writes it; `wallet.view.service.js` answers questions and never imports it.**

**`GET /wallet` returns credits and `updatedAt`, and no minutes.** The epic README argues
this at length: minutes are a function of a teacher's price and this endpoint has no
teacher. `client/src/lib/credits.js` owns the translation and 7.5 renders it.

**`GET /wallet/transactions` is the whole ledger for the caller, newest first, paged.**
Standard paging — `?page` 1-based, `?pageSize` capped at `MAX_PAGE_SIZE`, both from
`constants/pagination.js`, neither a literal in the validator. `total` is the count of
the caller's rows, not of the page. Model the query schema on
`teacher.public.schema.js`, including its `.strict()` posture: a client that invents
`?type=TOPUP` gets a `VALIDATION_ERROR` naming the parameter rather than a silently
ignored filter.

**`note` is not on the response.** `appendWalletTransaction`'s contract says it is
operator-facing and never reaches a client, and this endpoint is the first thing that
could break that by accident. The row carries `id`, `type`, `amount`, `balanceAfter`,
`sessionId`, `createdAt` and nothing else. Put the projection in a view util —
`utils/walletView.js`, beside `sessionView.js` and `teacherView.js` — so the exclusion is
one function rather than a habit.

**Both routes are `authenticate` and no `authorize`.** A wallet is per-user, not
per-role: teachers hold a balance too, and 7.6's earnings screen shows it. The user comes
from the token and is never a parameter — a route that could name a user is a route that
could read somebody else's ledger.

**A caller with no wallet row is a 500, not an empty balance.** Every registered user
gets one in the same transaction as their account (`createUserWithProfile`), so its
absence is a data problem, and `wallet.service.js` already takes exactly this position on
it. Answering `{ balance: 0 }` would show a student a plausible screen over a missing
row.

## Files you may touch

```
server/src/repositories/wallet.repository.js   two reads: the wallet row, the paged ledger + count
server/src/services/wallet.view.service.js     NEW. Reads only. Never imports wallet.service.js
server/src/controllers/wallet.controller.js    NEW. Two handlers, no prisma, no logic
server/src/routes/wallet.routes.js             NEW. authenticate, validate, asyncHandler
server/src/routes/index.js                     ONE line, alphabetical: apiRoutes.use('/wallet', walletRoutes)
server/src/validators/wallet.schema.js         NEW. The paging query, .strict()
server/src/utils/walletView.js                 NEW. The projection that leaves `note` behind
shared/api.d.ts                                NEW BLOCK at EOF: the epic README's whole contract freeze
server/tests/wallet.read.test.js               NEW. Paging bounds, the note exclusion, the missing-wallet 500
docs/epics/E7-wallet-billing/README.md         tick the status box
```

## Files you must NOT touch

```
server/src/services/wallet.service.js       §17.5. Human-written, and this PR moves no money
server/src/app.js                           frozen after 0.4 — the router registry is the seam
prisma/schema/**                            no column, and 6a.4 has a migration in flight
shared/socketEvents.js                      7.3 appends wallet:updated
client/**                                   7.5 and 7.6 render this
server/src/repositories/session.repository.js   findWalletBalance there is the session's read, not this one
server/src/config/constants/**              pagination and money constants both already exist
docs/epics/E6a-*/**                         another epic's chain
```

## Acceptance criteria

- [ ] `GET /api/v1/wallet` with a valid token returns `{ success: true, data: { balance, updatedAt } }` and exactly those two fields
- [ ] `GET /api/v1/wallet` with no token returns `401 UNAUTHORIZED` in the standard error shape
- [ ] `GET /api/v1/wallet/transactions` returns rows newest first, and **no row carries a `note` key**
- [ ] `?pageSize=1000` returns at most `MAX_PAGE_SIZE` rows and does **not** 400 — the cap is a ceiling, not a rejection (`constants/pagination.js` says so)
- [ ] `?page=0`, `?page=-1` and `?sortBy=whatever` each return `400 VALIDATION_ERROR` naming the parameter
- [ ] `total` is the caller's whole ledger count, and does not change when `pageSize` does
- [ ] Two students' ledgers never mix: a token for A never returns a row belonging to B
- [ ] `grep -rn "prisma" server/src/controllers/wallet.controller.js` returns nothing
- [ ] `grep -rn "wallet.service" server/src/services/wallet.view.service.js` returns nothing
- [ ] `routes/index.js` gained exactly one line and nothing was reordered
- [ ] `npm test` passes

## Manual test

1. `npm run dev`, log in as a seeded student, and from the browser console with the
   access token: `GET /api/v1/wallet` → the same number
   `select balance from wallets where user_id = …` returns.
2. Run one session end to end so the ledger has a `SESSION_CHARGE` and a
   `TEACHER_EARNING`. `GET /api/v1/wallet/transactions` as the student shows the charge
   and not the earning; as the teacher, the reverse.
3. `GET /api/v1/wallet/transactions?pageSize=1` — one row, and `total` unchanged.
4. `GET /api/v1/wallet/transactions?page=0` — `400`, `VALIDATION_ERROR`, `details.page`.
5. `curl -s -o /dev/null -w "%{http_code}\n" localhost:PORT/api/v1/wallet` with no
   header — `401`.

## Review checklist additions

- **No `prisma.$transaction` anywhere in this PR.** Two reads that must agree with each
  other is a design smell here, not a transaction: the balance and the ledger are read
  by two separate requests from two separate screens, and 7.5 reconciles them by showing
  `balanceAfter` on the newest row.
- The `note` exclusion must be a projection, not a `delete row.note`. A view util that
  builds the response field by field cannot leak a column added later; a deletion can.
- `routes/index.js` is append-only and alphabetical (`OWNERSHIP.md` §2). `/wallet` sorts
  after `/teachers`, which is the end of the list — append, do not tidy, and do not
  reformat the block comments around it.
- The E7 block in `shared/api.d.ts` is appended **at the end of the file**, marked
  `// ── E7 — money ─────`, matching the existing section headers exactly. 6a.4 is
  appending to this file in the same week.

## Notes

**Why the whole contract freeze lands in this PR rather than one interface per PR.**
`shared/api.d.ts` is the file both epics append to, and every append at EOF is a conflict
region. One PR opening E7's block with all six shapes gives the epic one such region
instead of four. `TopUpRequest` and `EarningsResponse` are declarations that compile to
nothing — writing them before their endpoints exist costs nothing and is what makes 7.3
and 7.6 into implementations of an agreed shape rather than proposals of a new one.

**Prior art for every piece of this.** The paged validator is `teacher.public.schema.js`;
the view util is `utils/teacherView.js`; the read-only service is
`session.view.service.js`; the router shape is `session.routes.js`. Nothing here is a new
pattern and a review should be able to say which file each decision came from.

`findWalletBalance` already exists in `session.repository.js` — 6.5's read, for the block
warning's `balanceAfter`. **Do not import it and do not move it.** That repository is the
session's and it is frozen; a second small read in the wallet's own repository is cheaper
than a cross-domain import that makes one file's freeze another file's problem.
