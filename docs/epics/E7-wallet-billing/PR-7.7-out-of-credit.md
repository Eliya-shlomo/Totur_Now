# PR 7.7 — Out of credit, mid-session: top up from the 60-second warning

| | |
|---|---|
| **Epic** | E7 — Wallet & Billing |
| **Owner** | DEV-A (eliya) |
| **Size** | S |
| **Written by** | Agent. |
| **Depends on** | 7.5 (merged — `wallet.api.js`, the packages, the top-up call) |
| **Blocks** | 7.8 |
| **Branch** | `dev-a/E7.7-out-of-credit` |

## Contract implemented

No new endpoint, no new event, no server change. §5.4's last line: "**Out of credit = no
extension.** The current block finishes and the session closes. A top-up banner appears at
the 60-second warning."

## Scope

The banner §5.4 promised and E6 could not build, because there was no top-up to put in it.

6.7's `ExtendModal` already does the hard half. It renders on `session:block_warning`,
every number on it is the server's, and when `canAfford` is false the extend button is
**disabled with a reason rather than hidden** — its own header explains why: "a missing
button is a dead end nobody can act on; 'you need ₪12 more' is a sentence with a next
step in it". This PR makes that sentence into a button.

**When `canAfford` is false, the modal offers a top-up in place.** The packages come from
`GET /public/pricing`, fetched when the modal first needs them and not before — a session
screen that fetches pricing on mount is a fetch on every session for a state most
sessions never reach. Press one, `POST /wallet/topup` through 7.5's `wallet.api.js`, and
the modal stays open the whole time.

**It must not navigate.** A link to `/app/wallet` from a running session is a student who
leaves a paid, timed call to go and buy time for it, and comes back — if the router even
lets them — to a session the auto-end sweep closed while they were shopping. The top-up
happens inside the modal or it does not happen.

**After a successful top-up, the button enables and the endpoint remains the authority.**
The modal does not recompute `canAfford`: 6.7's rule is that a screen which works out
affordability works it out differently from the endpoint that enforces it. What it does
is stop asserting a `canAfford` it now knows is stale — the balance demonstrably moved,
so the disabled state is no longer a fact. If it is still not enough, `POST
/sessions/:id/extend` answers `402 INSUFFICIENT_CREDIT` and the screen already knows what
that looks like (`utils/sessionErrors.js`, 6.8). **`withinCap` is not touched by a
top-up** and still disables the button on its own: the budget cap is the student's own
ceiling for this question, and buying more credit is not a way through it.

Sixty seconds is the whole budget for this interaction. Three buttons, one press, no
confirmation step, no second modal.

## Files you may touch

```
client/src/components/session/ExtendModal.jsx     the out-of-credit branch
client/src/components/wallet/InlineTopUp.jsx      NEW. Packages + one press, no navigation
client/src/components/session/SessionRoom.jsx     only if the modal needs a prop it cannot fetch itself
docs/epics/E7-wallet-billing/README.md            tick the status box
```

## Files you must NOT touch

```
server/**                                     nothing on the server changes. Not one line
client/src/hooks/useSessionState.js           the warning payload is already exactly right
client/src/components/session/SessionTimer.jsx  ends_at is server truth and this PR does not touch time
client/src/components/session/VideoRoom.jsx   DEV-C's, OWNERSHIP.md §2.1
client/src/lib/credits.js                     no minutes on this modal — it deals in the extension price
client/src/api/wallet.api.js                  7.5's, and complete
client/src/pages/student/Wallet.jsx           7.5's screen. This one does not link to it
shared/**                                     frozen
docs/epics/E6a-*/**                           another epic's chain
```

## Acceptance criteria

- [ ] With `canAfford: false`, the modal shows the shortfall sentence **and** top-up packages
- [ ] With `canAfford: true`, the modal is byte-for-byte the experience 6.7 shipped — no packages, no extra fetch
- [ ] `GET /public/pricing` is requested only when the out-of-credit branch renders, never on session mount
- [ ] Pressing a package tops up without leaving the page. The session timer keeps running and the modal stays open
- [ ] After the top-up, the extend button is enabled — unless `withinCap` is false, in which case it stays disabled with the cap's own reason
- [ ] Pressing extend after the top-up buys the block, and the timer extends
- [ ] A top-up that is still not enough produces the existing `INSUFFICIENT_CREDIT` message, not a crash and not a silent no-op
- [ ] Dismissing the modal still ends the session by silence, exactly as §5.1 says — this PR adds no obligation to answer
- [ ] Full-screen sheet below `sm`, matching the modal's existing `useMediaQuery` call (§14.4)
- [ ] `grep -rn "navigate\|Link" client/src/components/wallet/InlineTopUp.jsx` returns nothing
- [ ] `npm run lint` clean

## Manual test

Two browsers. One student with a balance smaller than one extension, one teacher.

1. Run a session to the 60-second warning. The modal appears with the button disabled and
   the shortfall named.
2. Press ₪50 inside the modal. The balance moves; the page does not.
3. Press **Keep going**. The block is bought, `ends_at` moves, the timer extends.
4. Repeat with a student whose `budget_cap` is already reached: after the top-up the
   button stays disabled and says why. Buying credit did not buy a way past the cap.
5. Repeat and dismiss the modal instead. The session auto-ends `GRACE_SECONDS` after the
   block, as before.
6. 375px throughout.

## Review checklist additions

- **No `router` import in this PR.** The one thing this interaction must not do is leave
  the page, and the cheapest way to guarantee it is that there is nothing to leave with.
- The `canAfford: true` path must not change. Diff the modal and confirm the existing
  branch is untouched — this is a `S` PR that sits on the most expensive screen in the
  product, sixty seconds before a session ends.
- No new state in `useSessionState`. The top-up's result is local to the modal; the
  authoritative balance arrives on the next `session:block_warning` or on the extend
  response.
- The modal is the student's alone (6.7). The teacher's side of this screen renders
  nothing new — a top-up control in front of someone who cannot spend is a bug.

## Notes

**Why this is not part of 7.5.** It is a different screen, a different sixty seconds, and
a different failure mode: the wallet screen is a place a student goes, and this is a place
a student is trapped. Splitting it out means the modal — the highest-stakes component in
the product — gets its own diff and its own review.

**§5.4's sentence has two halves and only one of them is this PR.** "Out of credit = no
extension. The current block finishes and the session closes" is already true and was
true before this PR: 6.5's endpoint refuses, 6.7's button is disabled, and the auto-end
sweep closes the session. This adds the banner. If the top-up fails, everything reverts to
that behaviour, which is the correct fallback and needs no code.

**Prior art for the inline purchase.** There is none in this repo — every other spend in
the product happens by pressing a button that charges an existing balance. That is worth
noticing rather than glossing: this is the first place a student gives the platform money
while something else is running, and the reason it is safe is that `POST /wallet/topup` is
a mock that credits immediately. When §21's Phase 2 puts a real provider behind it, **this
modal is the first thing that breaks**, because a payment flow that redirects is a payment
flow that leaves the session. Written down here so whoever does that work finds it.
