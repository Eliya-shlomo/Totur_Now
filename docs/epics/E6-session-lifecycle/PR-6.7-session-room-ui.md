# PR 6.7 — The session room: one screen, both roles, the call embedded

| | |
|---|---|
| **Epic** | E6 — Session Lifecycle & Video |
| **Owner** | DEV-B (rotem) — the screen. **`VideoRoom.jsx` is DEV-C's and is mounted, not opened.** |
| **Size** | L |
| **Written by** | Agent. `ends_at` is server truth and the review checklist is mostly about that. |
| **Depends on** | 6.4, 6.5, 6.6 |
| **Blocks** | 6.8 |
| **Branch** | `dev-b/E6.7-session-room-ui` |

## Contract implemented

`MVP.md` §14.3, the active session screen, at `/app/session/:id` for the student and
`/teach/session/:id` for the teacher. Consumes `SessionState`, `SessionVideoResponse`,
`ExtendResponse` and the four `session:*` events.

## Scope

**One screen, two roles.** §18 asked for two PRs and two screens; the two roles differ by three
fields and one button, and the contract already answers both from one endpoint with a `role`
discriminator. Two files would be two timers, and a timer written twice is a timer that
disagrees with itself on one of the two screens.

**One route each side, no new route shapes.** 5.8 built `Session.jsx` as a switch on offer
status with E6's branch left as an honest placeholder; this PR fills that branch and adds
nothing outside it. The teacher's route is one line in `routes.teacher.jsx` pointing at the
same component — §14.1 has no separate active-session route and inventing one is a route the
next epic has to honour or rename.

### The layout

```
┌────────────────────────────────────────────────────────┐
│  In session with <counterpart>            ⏱  03:42     │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  block 2 of 2                   │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │        <VideoRoom roomUrl=… token=… />           │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  the brief · the topic · the level · the image         │
│                                                        │
│  student:  Charged ₪32 · Balance ₪64 · Cap ₪40         │
│  teacher:  You'll earn ₪27 for this so far             │
│                                                        │
│  [ We're done — end session ]                          │
│  student, first 60s only:  [ They never showed up ]    │
└────────────────────────────────────────────────────────┘
```

**The three role differences, and they are the whole of the branching:** the money line
(`balance`/`totalCharged` versus `teacherEarning`), the no-show button (student, and only
inside `NO_SHOW_WINDOW_SEC` of `startedAt`), and the extension modal (student — the teacher
sees a passive "your student is deciding" note when the warning fires).

### The clock

**`endsAt` is the only source and it is recomputed from on every tick.** Not a `setTimeout`
seeded from a duration. E5's countdown proved this pattern under a backgrounded tab and a
reload at second 30 and both passed; this one is the same pattern with money behind it, and
the failure mode is worse — a client clock two minutes fast shows a session ending that the
server is still charging for.

The screen re-fetches `GET /sessions/:id` on mount, on `visibilitychange` back to visible, and
after every mutation. **The server is the source of truth and the socket is an accelerator** —
5.8's sentence, and it is why this screen works on a train.

### The call

```jsx
const { roomUrl, token } = await getSessionVideo(sessionId);   // 6.4, on mount
<VideoRoom roomUrl={roomUrl} token={token}
           onJoined={…} onLeft={…} onError={…} />
```

**`VideoRoom.jsx` is not edited.** Its props were frozen at import in 6.1 and the screen goes
around it. If the layout needs something the component does not expose, that is a DEV-C change
in its own PR — not an edit here.

Three states the surrounding frame must render, because the component renders none of them:

- **`hasVideo === false`** — no room, and the session is otherwise fine. A plain line saying
  the call could not be set up, and everything else on the screen still works. This is 6.3's
  designed degradation and it must not look like a crash.
- **`onError`** — the join failed. Most likely cause is Daily's `max_participants: 2`: the
  student opened the session on a phone *and* a laptop and consumed both slots, locking the
  teacher out of their own lesson. The message says so, in those words, because "call error"
  sends nobody anywhere useful. A retry button re-fetches a fresh token.
- **`onLeft`** — somebody pressed Daily's own leave button. The **session is not over.** The
  meter is still running and still charging. The frame says that and offers rejoin, because a
  screen that looks finished while credit is leaving the wallet is the worst thing this epic
  could ship.

### The four events

| Event | What the screen does |
|---|---|
| `session:block_warning` | The student's extend modal, with the server's `extensionPrice`, `balanceAfter`, `canAfford`, `withinCap`. **Every number comes from the payload.** A client that computes affordability computes it differently from the endpoint that enforces it, and the modal then offers a button that 402s. |
| `session:extended` | The clock, `blocksUsed`, `totalCharged` and the balance all update. Both sides. |
| `session:ended` | Straight to the outcome. The student to the rating screen — it blocks — and the teacher to their dashboard with a summary. |
| `session:participant_left` | 6.8's. The name is reserved and the handler is a no-op stub here. |

`session:join` is emitted once on mount so the socket is in the room before any of the above
can arrive.

### After it ends

The student cannot leave. §10 makes the rating mandatory and 6.6 built the screen; this PR
routes `ENDED` with `isRated === false` straight to it and refuses back-navigation into the
session. `NO_SHOW` skips it entirely and lands on the match list with the refund confirmed —
nobody rates a person who never arrived.

### Responsive

§14.4, mobile-first. At `< 768px` the call goes full-width above the brief, the money line
wraps, and the extend modal is a sheet. **375px with no horizontal overflow** is an acceptance
criterion, as it has been in every screen epic since E2, and it is the one that catches the
embedded iframe — a fixed `600px` height on a phone in landscape is most of the viewport.

## Files you may touch

```
client/src/pages/student/Session.jsx           fill the ACTIVE branch 5.8 left
client/src/components/session/SessionRoom.jsx  new — the frame around the call
client/src/components/session/SessionTimer.jsx new — endsAt in, mm:ss out
client/src/components/session/ExtendModal.jsx  new — renders the payload, computes nothing
client/src/components/session/MoneyLine.jsx    new — the one role-branching strip
client/src/hooks/useSessionState.js            new — fetch, socket, visibilitychange
client/src/router/routes.teacher.jsx           one line: /teach/session/:id
client/src/api/session.api.js                  already has everything; append nothing new
docs/epics/E6-session-lifecycle/README.md      tick the status box
```

## Files you must NOT touch

```
client/src/components/session/VideoRoom.jsx   DEV-C's. Mount it; do not open it
client/src/theme.js                           frozen since 0.5 — read theme.other
client/src/api/client.js                      DEV-A's interceptors
client/src/router/index.jsx                   frozen since 0.5
client/src/pages/student/AwaitingResponse.jsx 5.8's, and still the PENDING branch
client/src/pages/student/RateSession.jsx      6.6's
server/**                                     every endpoint this screen needs exists
shared/**                                     frozen at 6.2
```

## Acceptance criteria

- [ ] Two browsers, two cameras: both people see and hear each other **inside the page**, with no new tab and no external link
- [ ] The timer counts down from `endsAt` and is correct after backgrounding the tab for a minute
- [ ] A reload at T-30s shows T-30s, not a restarted clock
- [ ] The extend modal appears at T-60s on the student's screen with the server's numbers; the teacher sees the passive note
- [ ] Extending updates the clock, the block counter, the charge and the balance on **both** screens
- [ ] Declining lets the session end at T+30s and both screens move on
- [ ] `canAfford: false` renders a disabled extend button and says why — it does not offer a button that 402s
- [ ] The teacher's screen never shows a balance; the student's never shows an earning
- [ ] The no-show button is visible only to the student and only for the first 60 seconds
- [ ] With `DAILY_API_KEY` unset the screen renders completely, minus the call, with an honest line — no crash, no spinner for ever
- [ ] A third participant's join is refused by Daily and the screen explains it in words a person can act on
- [ ] Pressing Daily's leave button says the session is still running and offers rejoin
- [ ] After `session:ended` the student lands on the rating screen and cannot navigate back into the session
- [ ] 375px: no horizontal overflow on either role, and the call is usable
- [ ] `npm run lint`, `npx prettier --check .`, `npm test`, and `npm run build` in `client/` all pass

## Manual test

1. Two browsers — separate sessions, not tabs — through the flow to `ACTIVE`. Grant camera in both
2. Watch the tile for the other person appear on each side. Talk
3. Background the student's tab for 90 seconds and come back. The clock is right
4. Reload the teacher's browser mid-session. The call rejoins and the clock is right
5. Ride the clock to T-60s. The modal fires. Extend. Both screens move
6. Open the student's session in a **third** browser to trip `max_participants`. Read the message
7. Press Daily's leave button. Confirm the screen says the session is still running, then rejoin
8. Let the next block run out without extending. Both screens land on their outcome; the student cannot escape the rating
9. Comment out `DAILY_API_KEY`, restart, run a fresh session. Everything but the call
10. 375px, both roles, whole flow

## Review checklist additions

- Confirm no `setTimeout` or `setInterval` computes remaining time from a duration. The tick may fire on an interval; the *value* is always `endsAt - now`.
- Confirm `ExtendModal` renders `extensionPrice`, `balanceAfter`, `canAfford` and `withinCap` from the payload and computes none of them.
- Confirm `VideoRoom.jsx` is unchanged — `git diff --stat` must not list it.
- Confirm the token is fetched per mount and is not put in a store, a URL or `localStorage`. It is a credential with an hour on it.
- Confirm `onLeft` does not end the session, navigate away, or stop the timer. Leaving the call and ending the session are different acts and only one of them stops the charging.
- Confirm the socket joins `session:{id}` before the first fetch resolves, or that a missed early event is repaired by the fetch. One of the two must be true.

## Notes

**Why one screen and not §18's two.** The two roles are one layout with three differences, and
the contract was written to answer both from one endpoint precisely so this could be one file.
The cost of the merge is a `role` check in three places. The cost of the split would have been
two timers, two socket subscriptions and two ways to be wrong about `endsAt` — and §20's
"timer desync" risk is on the list for a reason.

**Why `onLeft` is the subtle one.** Daily's prebuilt UI has its own leave button and nothing
can remove it. A user pressing it has left the *call*, not the *session*: the meter is running,
the block is charging, and `ends_at` has not moved. A screen that treats the two as the same
either stops a meter that is still billing or ends a session the user only wanted to step out
of. It says what is true and offers the way back.

**Why the third-participant message is specific.** `max_participants: 2` is 6.1's, deliberate,
and the most likely way a real person trips it is opening the lesson on a phone as well as a
laptop — which is a completely reasonable thing to do and produces a completely opaque failure
if the screen just says "error". Naming the cause turns a support conversation into a closed
tab.
