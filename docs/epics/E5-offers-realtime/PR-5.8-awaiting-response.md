# PR 5.8 — Student awaiting-response state + 60-second countdown

| | |
|---|---|
| **Epic** | E5 — Offers & Real-Time Presence |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 5.4 |
| **Blocks** | — |
| **Branch** | `dev-b/E5.8-awaiting-response` |

## Contract implemented

`MVP.md` §18's 5.8, and the E5 half of `/app/session/:id`. Consumes §13's `offer:accepted` and
`offer:rejected`. **Closes the `onChoose` seam 4.7 froze.**

## Scope

**`onChoose` stops confirming and starts posting.** E4's `ChooseTeacher.jsx` ends with a modal
that names the teacher and says the sending part is not built. This PR replaces that function
body with a call to `POST /sessions/:id/offer` and a navigation to `/app/session/:id`.

```js
onChoose({ teacherId, pricePerBlock })   // frozen in 4.7, for this
```

**Nothing else in that file moves.** The signature was frozen a whole epic ago precisely so
that E5 would be one function body in a file it inherits. The `sessionId` comes from the
`QuestionResponse` the screen already loads — no second fetch, no new endpoint.
`ChoiceConfirmation` is deleted, because what it existed to say is no longer true.

**No new route.** §14.1 has no awaiting screen, and E4's own ruling applies: a route invented
in one epic is a route the next has to honour or rename. `OFFER_SENT` is a *state of*
`/app/session/:id`, which is currently `<Placeholder pr="6.7" />`. This PR replaces it with a
real screen that renders one state and delegates the rest:

| Session status | This PR |
|---|---|
| `OFFER_SENT` | the awaiting screen — the whole of this PR |
| `ACTIVE` | E6's. Render the placeholder's honest message, not a fake session |
| `PENDING` | the offer was declined or expired → the recovery below |
| anything else | a plain state, not an error |

Per E1's retro, the `Placeholder`'s `pr=` reference is corrected in the PR that replaces the
screen — so the `ACTIVE` branch names 6.7 in the code.

**The awaiting screen.** The teacher's card, the price and what the opening block costs, and a
countdown to `expiresAt`. One sentence about what is happening. **No cancel button** — §10 has
no student-cancel arrow out of `OFFER_SENT`, and inventing one means inventing a server route
E5 does not have.

**The countdown recomputes from `expiresAt` every tick.** Same rule as 5.7 and the same reason:
a phone that sleeps for thirty seconds must wake up showing the right number. A `setInterval`
that decrements a stored value is the most likely bug in this PR.

**Three ways this screen ends, and all three are events, not polls.**

- `offer:accepted` → navigate to the `ACTIVE` state of the same route, which is E6's placeholder
- `offer:rejected` → the recovery below. **The cron sends this on expiry too**, deliberately:
  from the student's side "declined" and "ran out of time" are the same outcome and the same
  next action, and two sentences for one situation is two things to maintain
- the countdown reaching zero → the same recovery, driven locally so the screen resolves even
  if the socket dropped

**The recovery, and it is the point of the screen.** Not an error and not a dead end: one line
saying the teacher did not take it, and a button back to `/app/ask/:id/teachers`. The list
re-runs, `rejected_by` now excludes the declining teacher — **4.2's filter, doing something real
for the first time** — and the student picks again. That loop is what makes a 60-second TTL
tolerable.

**A reload must not lose the state.** The screen reads `GET /sessions/:id` on mount and renders
from the server's status, with the socket as an accelerator rather than a source of truth. A
student who refreshes at second 30 sees 30 seconds, not a blank screen — and one who refreshes
after the offer resolved sees the resolution.

## Files you may touch

```
client/src/pages/student/AwaitingResponse.jsx     new  — the OFFER_SENT state
client/src/pages/student/Session.jsx              new  — the route's state switch
client/src/api/session.api.js                     new  — sendOffer, getSession
client/src/pages/student/ChooseTeacher.jsx        ONE function body: onChoose. Delete ChoiceConfirmation
client/src/router/routes.student.jsx              one line: replace the session/:id Placeholder
docs/epics/E5-offers-realtime/README.md           tick the status box
```

**`OfferCountdown.jsx` is 5.7's and is imported, not copied.** Both screens count down to a
server instant and the rule they must obey is identical. A second copy is a second place for the
background-tab bug to come back.

## Files you must NOT touch

```
client/src/pages/student/ChooseTeacher.jsx     everything except onChoose and the deleted modal
client/src/components/match/**                 E4's — MatchCard, CreditMinutes, PriceCeiling
client/src/lib/socket.js                       5.7's — one connection, already built
client/src/api/client.js                       frozen at 15 seconds since E1
client/src/api/matching.api.js                 E4's
server/**                                      this PR is client-only
shared/**                                      frozen at 5.1
```

## Acceptance criteria

- [ ] Pressing **Send request** posts the offer and lands on `/app/session/:id` — no intermediate modal
- [ ] The awaiting screen shows the teacher, the opening-block cost, and a countdown matching the server's `expiresAt`
- [ ] **Background the tab for 30 seconds; the countdown is still correct on return**
- [ ] Reloading at second 30 shows roughly 30 seconds, not a blank screen and not 60
- [ ] Reloading after the offer resolved shows the resolution, not the countdown
- [ ] `offer:accepted` moves the screen to the `ACTIVE` state, which honestly names E6
- [ ] `offer:rejected` shows the recovery with a working link back to the teacher list
- [ ] An expiry with the socket **disconnected** still resolves the screen at zero
- [ ] After a decline, the returned list excludes the declining teacher
- [ ] `TEACHER_UNAVAILABLE` from the post is rendered as "someone got there first" with the list re-run — not as a red error
- [ ] `INSUFFICIENT_CREDIT` from the post routes to the wallet message E4's screen already has
- [ ] There is **no cancel button**
- [ ] `ChooseTeacher.jsx`'s diff is `onChoose`'s body, the deleted modal, and nothing else
- [ ] 375px: `scrollWidth === clientWidth`
- [ ] `npm run lint`, `npx prettier --check .`, `npm run build -w client` all pass

## Manual test

1. Two browsers, teacher online. Student presses **Send request** — straight to the awaiting screen
2. Reload it at second 30. The countdown resumes near 30
3. Background the tab 30 seconds, return. Still correct
4. Teacher accepts. The student moves to the `ACTIVE` state and reads E6's honest placeholder
5. Reset. Teacher declines. The student sees the recovery, clicks back, and the list is one teacher shorter
6. Reset. Let it expire with the teacher's browser closed. The screen resolves at zero
7. Reset. Kill the student's network for the last 20 seconds. The screen still resolves at zero
8. Two students, one teacher, simultaneously (5.3's test). The loser sees "someone got there first" and a fresh list
9. Repeat 1–5 at 375px

## Review checklist additions

- Confirm the countdown recomputes from `expiresAt` and does not decrement stored state.
- Confirm the screen renders from `GET /sessions/:id` on mount and treats the socket as an accelerator. A screen that only works with a live socket is a screen that breaks on the train.
- Confirm the zero-countdown path resolves locally without waiting for `offer:rejected`.
- Confirm `ChooseTeacher.jsx`'s diff is one function body plus the deleted modal. Anything else means E4's screen was reopened, which the seam existed to prevent.
- Confirm `TEACHER_UNAVAILABLE` is not styled as an error. Losing a race is the product working.
- Confirm `OfferCountdown` is imported from 5.7's file and not reimplemented.
- Confirm no cancel button appeared "for completeness".

## Notes

**Why this PR is the proof the E4 seam worked.** E4's README argued for a callback over a
route: "a route invented here is a route E5 has to either honour or rename — whereas a callback
is one function body E5 replaces in a file it already owns." This is that claim being tested.
If the diff to `ChooseTeacher.jsx` is anything more than `onChoose` and the dead modal, the
argument was wrong and 5.9's retro should say so.

**Why expiry and decline show the same thing.** From the student's side both mean "this teacher
did not take it, choose another", and the next action is identical. Two sentences would be two
strings to keep in step for a distinction the student cannot act on. The teacher's side does
distinguish them, because there the difference is "you declined" versus "you missed it".

**Why no cancel.** §10's diagram has no arrow out of `OFFER_SENT` on the student's side.
Sixty seconds is short enough that waiting is not a burden, and a cancel would need a server
route, a lock release and a rule about what happens when it races the teacher's accept — which
is the atomic-lock problem a second time, for a button nobody asked for.

**What is deliberately still a placeholder.** `/app/session/:id` in its `ACTIVE` state. E5 gets
a session to `ACTIVE` and stops; the meter, the video and the charge are E6 and E7. The screen
says so in words rather than rendering a session that is not running.
