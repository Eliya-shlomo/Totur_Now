# PR 6.8 — Error-state hardening and the end-to-end lifecycle tests

| | |
|---|---|
| **Epic** | E6 — Session Lifecycle & Video |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 6.7 |
| **Blocks** | 6.9 |
| **Branch** | `dev-b/E6.8-error-hardening-e2e` |

## Contract implemented

No new endpoint and no new shape. `MVP.md` §15.3's end-to-end error handling, applied to the
six ways a session can go wrong that the happy-path PRs each left as one sentence — plus the
integration suite that walks the whole lifecycle in one file.

## Scope

### 1. `SESSION_NOT_ACTIVE` says which "not active" it is

Six endpoints throw it and the client currently renders one string for all six. The code and
the status stay exactly as they are — `errorCodes.js` is frozen and 409 is right for every
case — but the **message** and the client's handling become specific:

| Situation | What the user is told, and what the screen does |
|---|---|
| Session already `ENDED` | "This session has already finished." → the outcome screen |
| Session `RATED` | The same, and there is nothing left to do |
| Session `NO_SHOW` | "This session was refunded." → the match list |
| Extending past `ends_at + GRACE_SECONDS` | "The session ended while you were deciding." → the outcome. **This one is a race a real person hits**, by pressing extend as the auto-end sweep fires |
| A double-tapped extend losing the conditional update | Silently reconciled: re-fetch and show the block that *did* land. The user pressed once as far as they know |
| No-show reported past the window | "The no-show window has closed — you can end the session instead." |

**One helper on the client, not six catch blocks.** The session screen has one error boundary
for mutations; it maps the code plus the freshly-fetched state to a message and a
destination. Six independent handlers is six places for the recovery to drift.

### 2. The five degradations, each made non-fatal and visible

Named across 6.1–6.7 as one sentence each; here they get a test and a rendered state.

- **`DAILY_API_KEY` unset.** Session activates, `hasVideo` false, screen complete minus the
  call. Already 6.3's design — this PR pins it with a test that runs with the key removed.
- **Daily unreachable at accept.** Same, plus 6.4's repair on first join. Test with the API
  base pointed at a dead host.
- **Daily unreachable at join.** `502 EXTERNAL_SERVICE_ERROR`, a retry button, the rest of the
  screen alive.
- **The token expired mid-session.** A session extended past `VIDEO_TOKEN_TTL_SECONDS` outlives
  its token, Daily ejects, and `onError` fires. The screen re-fetches `GET /sessions/:id/video`
  and rejoins with a fresh one, **once**, before showing an error. This is a real case at one
  hour of extensions, and it is the only one on this list nobody would find by hand.
- **Socket disconnected.** The clock still runs — it is computed from `endsAt` — and a
  reconnect triggers a re-fetch. The screen carries a small "reconnecting" marker rather than
  freezing or lying.

### 3. Gap 11 — the teacher who walks out

E5's README recorded it and said explicitly: *a fix without E6's screen is a state change
nobody can see.* 6.7 built the screen.

A participant's last socket disconnecting during an `ACTIVE` session emits
`session:participant_left` to `session:{id}` — 6.2 reserved the name and 6.7 stubbed the
handler. The other side sees a line saying the person's connection dropped, **and the meter
keeps running**, because a dropped connection is not an ended session and a tunnel lasts
fifteen seconds.

**Nothing auto-ends on a disconnect in this PR.** `PRESENCE_DISCONNECT_GRACE_SECONDS` exists
and E5's presence layer already distinguishes a reload from a departure, but the product's
answer to "the other person is gone" is the buttons that already exist — the student's no-show
report inside the window, and either side's end button after it. An automatic end would decide
who pays for the disconnection, and that is a product decision nobody has made.

**`IN_SESSION` is still not touched by the presence sweep**, exactly as 5.8's fix left it. A
teacher whose socket dies mid-session stays `IN_SESSION` until the session ends, which is
honest and keeps them out of the matching pool while a student is still sitting in their room.

### 4. The end-to-end suite

One integration file that walks the whole lifecycle against the real database, with Daily
stubbed at the `video.service` boundary and sockets asserted through a connected test client:

```
offer accepted → ACTIVE, charged, room persisted
  → GET /sessions/:id/video mints a token for each participant, 404 for a third party
  → block warning fires at the boundary
  → extend charges one block and moves ends_at
  → extend to the budget cap and be refused
  → auto-end sweeps at ends_at + GRACE_SECONDS
  → teacher credited net of the fee
  → review → RATED, aggregates moved
  → reconciliation: every balance equals its ledger
```

And the same walk down the no-show branch: accept → report inside the window → refund → `NO_SHOW`
→ no rating possible.

**Clocks are injected, never waited on.** The suite manipulates `ends_at` and the job's notion
of now; a test that sleeps for ten minutes is a test that gets skipped. **Daily is never
called.** A suite that needs an API key is a suite that fails in CI and gets disabled.

## Files you may touch

```
client/src/components/session/SessionRoom.jsx     the error surfaces and the rejoin
client/src/hooks/useSessionState.js               reconnect, re-fetch, token refresh once
client/src/utils/sessionErrors.js                 new — one code+state → message+destination map
client/src/pages/student/Session.jsx              route the terminal states
server/src/services/session.meter.service.js      message specificity only, no status changes
server/src/services/session.end.service.js        message specificity only
server/src/sockets/handlers.session.js            emit participant_left on disconnect
server/tests/e2e.session.lifecycle.test.js        new — the whole walk
server/tests/e2e.session.noshow.test.js           new
docs/epics/E6-session-lifecycle/README.md         tick the status box
```

## Files you must NOT touch

```
shared/errorCodes.js                    no new code. SESSION_NOT_ACTIVE is right for all six
shared/**                               frozen at 6.2
server/src/services/wallet.service.js   6.5's. This PR changes no arithmetic
server/src/services/session.state.js    6.2's table. No new transition
client/src/components/session/VideoRoom.jsx   DEV-C's
prisma/**                               no migration
```

## Acceptance criteria

- [ ] Each of the six `SESSION_NOT_ACTIVE` situations produces a different sentence and lands the user somewhere they can act
- [ ] Pressing extend at the exact moment the auto-end sweep fires: one clear message, no double charge, no ledger row
- [ ] A double-tapped extend charges once and the screen shows the one block that landed, with no error
- [ ] With the key unset, the whole flow — accept, meter, extend, end, rate — completes with no call and no crash
- [ ] With Daily unreachable at accept and reachable by join time, the room is created on first join and the call works
- [ ] With Daily unreachable at join, the screen shows a retry and the timer keeps running
- [ ] A session outliving `VIDEO_TOKEN_TTL_SECONDS` rejoins once with a fresh token before showing an error
- [ ] Killing the socket server mid-session: the clock keeps counting, a "reconnecting" marker appears, and a re-fetch repairs the state on reconnect
- [ ] Closing one participant's browser raises `session:participant_left` on the other side, and **the meter keeps running**
- [ ] A teacher who disconnects mid-session is still `IN_SESSION`, and is `ONLINE` again once the session ends
- [ ] Both E2E files pass against a clean seeded database, in under a minute, with no network call to Daily
- [ ] The reconciliation assertion is the last line of both E2E files
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. Run a session and end it. Then press end again from the other browser's stale screen → the specific message, the outcome screen, no second credit
2. Ride to T+29s and press extend as the sweep fires. Whichever wins, the screen agrees with the database and the ledger has one row
3. Double-tap extend. One block, one charge, no error
4. Comment out `DAILY_API_KEY` and run the whole flow start to finish
5. Point `DAILY_API_URL` at `http://127.0.0.1:1` and accept an offer. Restore it, then join → the room is created and the call works
6. Mid-session, `docker stop` nothing but kill the server process and restart it. The clock never lied; the screen recovers
7. Close the teacher's browser entirely. The student sees the line, the timer keeps going, and `select status from teacher_profiles` still says `IN_SESSION`
8. `npm test` twice in a row on the same database. Both green — the suite cleans up after itself

## Review checklist additions

- Confirm no new error code was added. Six situations, one code, six messages is the design; a seventh code would be a contract change in a frozen file.
- Confirm the token refresh happens **once**. A rejoin loop against an expired-token error is a request every few seconds for as long as the tab is open.
- Confirm nothing auto-ends a session on a socket disconnect. That is a product decision and it has not been made.
- Confirm the E2E suite injects time rather than sleeping, and that `video.service` is stubbed at the module boundary rather than `fetch` being patched globally.
- Confirm both E2E files end with the reconciliation query and that it is an assertion, not a log line.

## Notes

**Why the E2E tests are here rather than in each PR.** Each of 6.3–6.6 has its own integration
tests for its own transaction, and those catch arithmetic. What they cannot catch is the
*seam between* them — a session that charges correctly, extends correctly and ends correctly
but ends up with `total_charged` disagreeing with the sum of its `session_blocks`, because two
correct transactions wrote the same field from different reads. One file that walks the whole
lifecycle and asserts the ledger at the end is the only thing that looks at all four together.

**Why the expired-token case is on this list at all.** Nobody would find it by hand: it needs a
session that runs for an hour, which no manual test does and no demo would survive. It is one
`onError` branch and a re-fetch, and without it a long lesson dies silently at the sixty-minute
mark with no explanation on either screen.

**What this PR still does not solve, and 6.9 records rather than fixes.** Nobody is charged or
refunded for a session where the *teacher* vanished after the no-show window closed. The
student's remedy is to end the session, which charges them for the blocks that ran. That is a
product gap, not a defect — the alternative is deciding who pays for a broken connection — and
it belongs in E9's moderation surface or in whatever epic first grows a dispute path.
