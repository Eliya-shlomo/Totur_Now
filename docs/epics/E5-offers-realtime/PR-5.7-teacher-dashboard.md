# PR 5.7 — Teacher dashboard: availability toggle + incoming offer modal

| | |
|---|---|
| **Epic** | E5 — Offers & Real-Time Presence |
| **Owner** | DEV-B (rotem) |
| **Size** | L |
| **Written by** | Agent, **reviewed hard.** §18 says so, and it is the teacher's half of the product — the screen that decides whether a teacher is reachable at all. |
| **Depends on** | 5.2, 5.4 |
| **Blocks** | — |
| **Branch** | `dev-b/E5.7-teacher-dashboard` |

## Contract implemented

`/teach` — `MVP.md` §14.1's teacher dashboard, replacing the `Placeholder` that already reads
`pr="5.7"`. Consumes §13's `offer:new`, `offer:expired` and `teacher:status`.

## Scope

**The socket client, once, for the whole app.** `client/src/lib/socket.js` creates a single
`socket.io-client` connection with `auth: { token }` from the auth store, reconnects when the
token refreshes, and disconnects on logout. **One connection per tab, not one per screen** —
a hook that connects on mount would open a second socket every time a route changes, and the
teacher would receive `offer:new` twice.

`useSocketEvent(event, handler)` in `client/src/hooks/` is how screens subscribe. It reads
event names from `shared/socketEvents.js`; **no screen types `'offer:new'` as a literal.**

**The dashboard, three blocks.**

*Availability.* The existing `TeacherStatusToggle` moves here from the header's ownership —
or rather, it stays where it is and finally becomes correct. **This closes F4.** It has read
`GET /teachers/me` on `location.pathname` since 2.4, which was merely stale then and is wrong
now: from 5.3 on, a teacher's status changes because the *server* locked them, and no
navigation happens. Subscribe it to `teacher:status` for the teacher's own id. The
`PATCH /teachers/me` call it already makes is unchanged — this is a new listener, not a new
writer.

*The offer modal.* On `offer:new`, raise a modal that cannot be missed: the brief in full, the
topic and level, **what they earn**, and a countdown to `expiresAt`. Two buttons, Accept and
Decline, and nothing else clickable behind it.

*Standing.* Sessions, rating and earnings-to-date, read from what E2's `GET /teachers/me`
already returns. No new endpoint — E7 owns earnings and this is a summary, not a breakdown.

**The countdown is computed from `expiresAt` on every tick, never from a duration seeded
once.** Background tabs are throttled to roughly one timer callback per minute, phones sleep,
and client clocks are wrong. A `setInterval` that decrements a number will show 47 seconds
remaining on an offer that expired two minutes ago. Recompute `expiresAt − Date.now()` each
tick and let it go negative.

**When it hits zero the modal closes itself** and does not call the server. The offer is gone
whether or not the cron has swept it, and an Accept sent at zero races 5.5 for no benefit —
5.4 answers `OFFER_EXPIRED` and the teacher sees an error for the product working correctly.
`offer:expired` closes it too, whichever arrives first.

**Accept navigates to `/teach/session/:id`**, which is still E6's `Placeholder`. That is
correct and it must not be papered over: the modal's confirmation says the session is starting
and the placeholder says the screen is being built. **Do not render a fake session screen.**
Same ruling 4.7 made for **Send request**, for the same reason — a plausible screen instead of
the honest state is how a demo becomes a lie.

**Decline closes the modal and stays.** No confirmation dialog; sixty seconds is not enough
time to ask twice.

**One offer at a time.** The lock guarantees it. If a second `offer:new` arrives while a modal
is open, that is a bug in 5.3 and the client should log loudly rather than queue — **a queue
here would hide the exact defect the epic exists to prevent.**

**Responsive.** The modal is a full-screen sheet below 768px (§14.4). A teacher answers offers
on a phone, and a centred dialog with a scrollable brief is where the earning number falls
below the fold.

## Files you may touch

```
client/src/lib/socket.js                          new  — one connection
client/src/hooks/useSocketEvent.js                new
client/src/api/offer.api.js                       new  — accept, reject
client/src/pages/teacher/Dashboard.jsx            new
client/src/components/offer/IncomingOfferModal.jsx    new
client/src/components/offer/OfferCountdown.jsx        new
client/src/components/teacher/TeacherStatusToggle.jsx  add the teacher:status listener — F4
client/src/router/routes.teacher.jsx              one line: replace the /teach index Placeholder
docs/epics/E5-offers-realtime/README.md           tick the status box
```

## Files you must NOT touch

```
client/src/api/client.js                       frozen at 15 seconds since E1
client/src/pages/student/ChooseTeacher.jsx     E4's — 5.8 changes one function body in it
client/src/pages/teacher/Profile.jsx           E2's
client/src/components/teacher/*Picker.jsx      E2's
server/**                                      this PR is client-only
shared/socketEvents.js                         frozen at 5.1 — import from it
```

## Acceptance criteria

- [ ] `/teach` renders the dashboard; the `Placeholder` is gone and its `pr=` reference with it
- [ ] Exactly **one** socket connection per tab, surviving a route change — check the network panel
- [ ] Logging out disconnects it; logging back in reconnects with the new token
- [ ] An incoming offer raises the modal within a second, with the full brief and the earning
- [ ] The countdown matches the server's `expiresAt`; **background the tab for 30 seconds and it is still correct on return**
- [ ] At zero the modal closes itself and **no request is sent**
- [ ] `offer:expired` closes an open modal
- [ ] Accept navigates to `/teach/session/:id`, which is E6's placeholder and says so honestly
- [ ] Decline closes the modal, and the student's screen returns to the teacher list
- [ ] **F4:** toggling availability updates the header pill without a navigation
- [ ] **F4:** a lock taken by 5.3 flips the pill to its locked state with no navigation and no reload
- [ ] A second `offer:new` while a modal is open logs an error and does not queue
- [ ] The modal is a full-screen sheet at 375px; `scrollWidth === clientWidth` on the dashboard
- [ ] No screen contains a socket event name as a string literal
- [ ] `npm run lint`, `npx prettier --check .`, `npm run build -w client` all pass

## Manual test

1. Two browsers: a teacher on `/teach`, a student on their seeded question's teacher list
2. Teacher toggles online — the header pill updates immediately, with no navigation
3. Student sends a request. The modal appears with the brief and a counting-down number
4. Background the teacher's tab for 30 seconds, return. The countdown is right, not 30 seconds behind
5. Let it expire. The modal closes itself; the network panel shows no request at zero
6. Send again and Accept. The teacher lands on `/teach/session/:id` and reads the honest placeholder
7. Send again and Decline. The student's screen recovers and the teacher is back in the list
8. Repeat step 3 at 375px. The earning is above the fold and nothing scrolls sideways

## Review checklist additions

- Confirm the socket is created once at module scope or in a provider, and that `useSocketEvent` only adds and removes listeners.
- Confirm the countdown recomputes from `expiresAt`, not from a decrementing state value. This is the single most likely defect in the PR.
- Confirm nothing calls accept or reject on expiry.
- Confirm the accept path navigates to the real E6 route and does not render a substitute session screen.
- Confirm `TeacherStatusToggle`'s existing `PATCH` behaviour is unchanged — this PR adds a listener and removes nothing.
- Confirm no `'offer:new'` literals; everything comes from `shared/socketEvents.js`.
- Read the modal on a phone-sized viewport before approving.

## Notes

**Why F4 closes here rather than as filler.** E2's retro filed it, E3 carried it, E4 carried it
again and E4's retro concluded that filler without a position in the order table does not get
done. It stops being optional at 5.3: a pill that only re-reads on navigation was stale before
and is now *wrong*, because the server changes the status and the teacher never navigates. The
fix is one listener in a file this PR is already opening.

**Why the socket client is in `lib/` and not `api/`.** `api/` is the axios layer, and every file
in it exports request functions over one client frozen at 15 seconds. A persistent bidirectional
connection is a different thing with a different lifecycle, and putting it beside
`teacher.api.js` would suggest a symmetry that does not exist.

**Why no offer queue.** The atomic lock guarantees a teacher has at most one `PENDING` offer.
If two arrive, 5.3 is broken — and a queue would make the symptom invisible while the real
defect (two students charged for one teacher) waits for production. The client's job here is to
be a witness.

**Why the earning is on the modal and not just the price.** §5.4's rule that a student thinks in
minutes has a mirror: a teacher thinks in what they take home. The price is what the student
pays; `platformFeeRate` is why those differ, and showing only one of them makes the first payout
a surprise.
