# PR 7.5 — The wallet screen: minutes, packages, ledger

| | |
|---|---|
| **Epic** | E7 — Wallet & Billing |
| **Owner** | DEV-A (eliya) |
| **Size** | L |
| **Written by** | Agent. |
| **Depends on** | 7.3 (merged — the top-up endpoint and `wallet:updated`), and 7.2 through it |
| **Blocks** | 7.7 |
| **Branch** | `dev-a/E7.5-wallet-screen` |

## Contract implemented

`/app/wallet` — §14.1's "Balance · top-up · transactions", against `WalletResponse`,
`WalletTransactionsResponse`, `TopUpRequest` and `TopUpResponse`. Plus the balance half
of `/app`, whose placeholder has said `pr="E1/E7"` since PR 1.5.

## Scope

Three blocks on one screen, and a fourth thing on the dashboard behind it.

**The balance, in minutes.** §5.4: "always displayed in minutes — the student thinks in
help remaining, not in money". `lib/credits.js`'s `minutesFor(balance, pricePerBlock,
blockMinutes)` is the translation and it is already written, already floors to whole
blocks, and already refuses to invent `5` — it takes `blockMinutes` from
`GET /public/pricing`. So this screen reads two endpoints on mount: `GET /wallet` for the
credits and `GET /public/pricing` for the block economics.

The price it renders minutes at is `pricing.price.default`, and the label must say so.
"≈ 40 minutes at the typical price" is honest; "≈ 40 minutes" is a promise the wallet
cannot keep, because the number changes per teacher — which is exactly why §5.4's own
example names Dana. The credits figure is shown too, and is the primary number: it is
what the ledger below is denominated in.

**Top-up.** The packages come from `pricing.topupPackages` — the same `[50, 100, 200]`
the server validates against, so the screen cannot offer an amount the endpoint refuses.
Press one, `POST /wallet/topup { packageId }`, and the balance updates. The button is
busy while the request is in flight and cannot be double-pressed; a `429` says the words
"too many requests" rather than a generic failure, because a rate limiter met by a real
person is a real state.

**The ledger.** `GET /wallet/transactions`, newest first, paged. One row per
transaction: a sentence built from `type`, the signed `amount` in credits, the date, and
`balanceAfter` as the running total. **The client owns the sentence** — the server sends
an enum and `note` is deliberately not on the wire (7.2). Map `SESSION_CHARGE` →
"Session", `TOPUP` → "Top-up", `REFUND` → "Refund", `TEACHER_EARNING` → "Earning", and
render an unmapped type as the type itself rather than as nothing: `tx_type` has six
values, two of which (`PAYOUT`, `PROMO`) no code writes yet, and a client that renders an
unknown enum as a blank row is a client that hides money.

Sign is the meaning: negative is money leaving. Colour is not the only carrier — a `−`
and a `+` in the text, per §14.4's own accessibility posture.

**`wallet:updated` keeps it live.** `useSocketEvent(SOCKET_EVENTS.WALLET_UPDATED, …)`
sets the balance from the payload. It is the confirmation the top-up button waits for in
practice, but **the POST's own response is what the screen trusts**: the socket may be
down, and a screen that only learns from an event is a screen that shows a stale balance
whenever the connection dropped. Both paths write the same state, and the last one to
arrive wins, which is correct because both carry a server-computed balance.

The ledger is re-fetched after a successful top-up rather than optimistically
prepended — `TopUpResponse.transactionId` identifies the new row so it can be
highlighted once it arrives.

**The dashboard.** `/app`'s placeholder is replaced with a real screen carrying the
balance in minutes and the "I'm stuck" call to action. §14.1's third element, recent
sessions, **stays E8's** — 8.6 owns the history screen and the reads behind it, and a
list of sessions here would be a second one.

**Loading, empty and error states on every read** (§17.4). Three of them matter: no
wallet row yet is impossible and therefore an error, not an empty state; an empty ledger
is a real first-time state and says so with the top-up buttons still visible; and a
failed pricing fetch means minutes cannot be computed, so credits are shown alone rather
than a spinner that never resolves.

## Files you may touch

```
client/src/api/wallet.api.js                   NEW. getWallet, getTransactions, topUp
client/src/pages/student/Wallet.jsx            NEW. The screen
client/src/pages/student/Dashboard.jsx         NEW. Replaces the pr="E1/E7" placeholder
client/src/components/wallet/BalanceCard.jsx   NEW. Credits + minutes + the "typical price" caveat
client/src/components/wallet/TopUpPackages.jsx NEW. The three buttons, busy and 429 states
client/src/components/wallet/LedgerList.jsx    NEW. Rows, paging, the unknown-type fallback
client/src/components/wallet/txLabel.js        NEW. The enum → sentence map, pure, no JSX
client/src/router/routes.student.jsx           two placeholders become two screens
docs/epics/E7-wallet-billing/README.md         tick the status box
```

## Files you must NOT touch

```
client/src/lib/credits.js               already correct. If it seems wrong, that is a chat message
client/src/router/index.jsx             frozen at 0.5 (OWNERSHIP.md §2)
client/src/theme.js                     frozen at 0.5. Shared values live in theme.other
client/src/api/client.js                the interceptor already unwraps and throws ApiError
client/src/layouts/**                   the shell is unchanged; this is a route, not a chrome change
client/src/components/nav/navItems.js   /app/wallet has been in the sidebar since 0.5
client/src/pages/teacher/**             7.6's screen, and 6a.5 has a glob on this path
server/**                               every endpoint this screen needs is merged
shared/**                               the contract is frozen; a shape that does not fit is a chat message
docs/epics/E6a-*/**                     another epic's chain
```

## Acceptance criteria

- [ ] `/app/wallet` shows the credits balance and a minutes figure that equals `Math.floor(balance / pricing.price.default) * pricing.block.minutes`
- [ ] The minutes label names the price it assumed. A bare "≈ 40 minutes" fails this criterion
- [ ] The three top-up buttons are exactly `pricing.topupPackages`, in the order the server sent them — no hardcoded 50/100/200 anywhere in `client/`
- [ ] Pressing one raises the balance without a reload, and the new row appears in the ledger
- [ ] A second tab open on `/app/wallet` shows the new balance too, from `wallet:updated`, without a reload
- [ ] With the socket disconnected, the top-up still updates the balance — the POST response is trusted
- [ ] Double-pressing a package sends one request
- [ ] A `429` renders a readable sentence, not "something went wrong"
- [ ] A ledger row with an unrecognised `type` renders the type string rather than an empty cell
- [ ] An empty ledger shows an empty state **and** the top-up buttons
- [ ] `/app` shows the balance and the "I'm stuck" action, and no session list
- [ ] Both screens are usable at 375px (§14.4) with no horizontal scroll
- [ ] `grep -rn "note" client/src/components/wallet/` returns nothing — the field is not on the wire and no screen may expect it
- [ ] `npm run lint` clean

## Manual test

1. Log in as a student with zero balance. `/app/wallet` shows `0` credits, `0 minutes`,
   an empty ledger, and three buttons.
2. Press ₪100. The balance becomes 100, minutes fill in, and one "Top-up +100" row
   appears with `balanceAfter` 100.
3. Open `/app/wallet` in a second tab. Top up in the first. The second updates.
4. In devtools, go offline, come back, and top up again — the balance still moves.
5. Run a session. Return to `/app/wallet`: the `SESSION_CHARGE` row is negative, dated,
   and its running total matches.
6. Throttle to 375px. Nothing overflows; the buttons stack.
7. Stop the server and reload `/app/wallet` — an error state with a retry, not a spinner.

## Review checklist additions

- **No number in this screen is computed twice.** Minutes come from `minutesFor`,
  packages from `/public/pricing`, the balance from the server. A `const BLOCK = 5` or a
  literal `[50, 100, 200]` anywhere in `client/` fails the review, and is the exact drift
  `credits.js`'s own doc was written to prevent.
- The socket handler must not be the only writer of the balance. Grep for the two writes
  — the POST's `.then` and the `wallet:updated` handler — and make sure both exist.
- One API module for the domain (`CONVENTIONS.md` → Client). No component imports
  `@/api/client` directly.
- `routes.student.jsx` is DEV-A's own area file (`OWNERSHIP.md` §3.2) — the two
  placeholder lines are replaced in place, and the file's header comment about PR 1.5's
  wrapper is not touched.

## Notes

**The `pr=` attribute on a placeholder is corrected by the PR that replaces it** — E1's
retro rule, and `routes.student.jsx` already carries a comment explaining where that rule
came from and why the review screen's placeholder said `8.4`. `/app/wallet` says `7.7`
and `/app` says `E1/E7`; both are replaced by real elements here, and the epic's PR
numbering moved because E7 was written after those placeholders were.

**Why the ledger is not infinite-scrolled.** `total` is on the response and the endpoint
is paged, so pagination is a control the student can see. A student looking for a charge
they are disputing wants to reach the end of a list, and an infinite scroll is the one
interaction that makes "the end" unreachable on a phone.

**Prior art.** `pages/guest/Pricing.jsx` already renders `GET /public/pricing` and
`components/match/CreditMinutes.jsx` already renders `minutesFor` — read both before
writing the balance card. The loading and error states are `components/state/*`, which
every screen since E2 has used rather than rolling its own.
