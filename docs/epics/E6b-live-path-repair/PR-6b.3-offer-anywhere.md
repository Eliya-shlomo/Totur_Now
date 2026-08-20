# PR 6b.3 — The offer reaches the teacher wherever they are

| | |
|---|---|
| **Epic** | E6b — Live-Path Repair |
| **Owner** | DEV-B (rotem) |
| **Size** | S |
| **Written by** | Agent. |
| **Depends on** | E6 (merged). **Schedule against 6a.5** — see "Scheduling" |
| **Blocks** | 6b.4 |
| **Branch** | `dev-b/E6b.3-offer-anywhere` |

## Contract implemented

None. `MVP.md` §14.1's incoming offer, delivered on every `/teach/*` route instead of one.

## Scope

`lib/socket.js` already guarantees the thing this PR needs and states it twice: one
connection per tab, owned by the auth store, "app-wide, not teacher-only", built that
way so that "a teacher who navigates away from that screen would stop hearing offers"
cannot happen. The connection is fine. The **listener** is one route deep —
`useSocketEvent(SOCKET_EVENTS.OFFER_NEW, …)` is called in `pages/teacher/Dashboard.jsx`,
and `useSocketEvent` detaches on unmount, by design and correctly.

A teacher on `/teach/profile` therefore has a live socket receiving `offer:new` frames
that nothing is listening for. The header reads **Offer pending** because 5.3's lock is
held and `teacher:status` is a separate listener that *is* app-wide. The student's
countdown runs to zero. This is the observed screenshot exactly.

**Move the mount point, change nothing else.** A new `components/offer/OfferHost.jsx`
takes the three things that belong to the offer and not to the dashboard: the `offer`
state, the `OFFER_NEW` and `OFFER_EXPIRED` listeners with the replay and
second-offer rules already written on them, and the `IncomingOfferModal` render.
`layouts/TeacherLayout.jsx` mounts it once, and it is mounted for every `/teach/*` route
because the layout is.

`Dashboard.jsx` loses that code and keeps everything else — the standing block, the
availability card, its own `teacher:status` listener, `getTeacherMe`.

**Carry the comments across, do not rewrite them.** Three rules on that code were paid
for in E5 and are not this PR's to re-derive: the same `offerId` twice is a handshake
replay and must not rebuild the modal under a teacher who is reading it; a *different*
`offerId` while one is open is 5.3's lock having failed and is logged loudly and dropped
rather than queued; `OFFER_EXPIRED` is matched on `offerId` so a late frame cannot close
the modal raised by the next offer. All three move with the code, comments included.

**`IncomingOfferModal.jsx` is not edited.** It is mounted somewhere else. This is what
keeps the overlap with 6a.5 down to one file.

Out of scope: the modal's contents, `OfferCountdown.jsx`, the accept/reject calls, the
server, and anything about students. A teacher outside `/teach/*` entirely — on
`/login`, or on a public profile — is also out of scope; the offer only exists for a
teacher who is online, and going online happens inside the layout.

## Scheduling

The single overlapping file across the two epics is `client/src/pages/teacher/Dashboard.jsx`,
which 6a.5's allowlist claims conditionally ("the dashboard's question card, if it shows
one"). `layouts/`, the new `OfferHost.jsx` and `useSocketEvent.js` are claimed by
nothing.

**Land this before `dev-b/E6a.1` is cut.** E6a has zero PRs merged and 6a.5 is five deep
in its chain; a change already on `main` is not a collision for a branch that does not
exist yet. If E6a has already started, this waits for 6a.6 and rebases — which costs a
teacher every offer that arrives while they are on the wrong tab, for the length of an
epic, and is the more expensive of the two options by a wide margin.

## Files you may touch

```
client/src/components/offer/OfferHost.jsx    new — the listeners, the state, the modal
client/src/layouts/TeacherLayout.jsx         mounts it, once
client/src/pages/teacher/Dashboard.jsx       loses the offer code, keeps the rest
```

## Files you must NOT touch

```
client/src/components/offer/IncomingOfferModal.jsx   6a.5's file. Mounted, not edited
client/src/components/offer/OfferCountdown.jsx       E5's clock, and it works
client/src/lib/socket.js                             already correct — this PR is the proof
client/src/hooks/useSocketEvent.js                   detaching on unmount is right
client/src/api/offer.api.js
server/**                                            offer delivery is correct server-side
```

## Acceptance criteria

- [ ] A teacher sitting on `/teach/profile` receives a student's request and the modal appears, over the profile page
- [ ] Same on `/teach/earnings`
- [ ] Same on `/teach` — the dashboard behaviour is unchanged
- [ ] Accept from the profile page navigates to the session room exactly as accepting from the dashboard does
- [ ] Reloading while an offer is open still raises the modal, on whichever `/teach/*` route the reload lands on
- [ ] Navigating between `/teach` routes with a modal open does not close, duplicate or restart it
- [ ] A second `offer:new` with a different `offerId` still logs the 5.3 lock violation and drops the second offer
- [ ] `npm test` passes

## Manual test

1. Two browsers. Teacher online, sitting on **Profile**.
2. Student sends a request to that teacher.
3. Modal appears over the profile page, countdown running.
4. Navigate teacher to **Earnings** with the modal open — it stays, and the clock does not restart.
5. Accept. Both land in the session room.
6. Repeat, and this time reload the teacher's tab while the modal is up. It comes back.

## Review checklist additions

- No second `io()` anywhere, and no `useEffect` that connects. If this PR opens a
  connection, it has reintroduced the double-modal bug `lib/socket.js` was written to
  prevent, and the symptom looks identical to the 5.3 lock failing.
- The dropped-second-offer `console.error` must survive, with its message and its
  `{ open, dropped }` payload. It is the client's only witness to a server-side
  invariant, and moving code is exactly when a log like that gets tidied away.
- `OfferHost` renders nothing when there is no offer. A layout-level component that
  renders an empty node on every teacher route is a layout bug waiting to be found by
  someone else.

## Notes

5.7's header comment describes the reload case of this defect and records the fix — the
server re-emits `offer:new` on every teacher handshake, so the modal survives a reload,
a late login and a dropped socket. That fix is real and it does not reach this case: the
socket never dropped, so there is no handshake to replay on. The two failures look
identical to a teacher and share nothing mechanically.

The PR is small because E5 and 5.8 did the hard parts. What is left is that the offer
was mounted on a screen instead of on the teacher.
