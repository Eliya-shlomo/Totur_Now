# PR 6.2 — Session state machine: transition rules, frozen routes, the E6 contract

| | |
|---|---|
| **Epic** | E6 — Session Lifecycle & Video |
| **Owner** | DEV-B (rotem) |
| **Size** | L |
| **Written by** | **Human — no agent.** §18 marks the state machine human-written and this brief keeps that. A transition table with a missing guard is how a session gets charged twice, and it is invisible in review because every legal path still passes. |
| **Depends on** | 6.0 |
| **Blocks** | 6.3, 6.4, 6.5, 6.6, 6.7 |
| **Branch** | `dev-b/E6.2-session-state-machine` |

## Contract implemented

`MVP.md` §10's diagram, as one enforced table. Plus the epic's whole surface, frozen before
any of it is filled in: five routes, the repository's read/write set, the `E6` blocks in
`shared/api.d.ts` and `shared/socketEvents.js`, the `session:{sessionId}` room and its five
emitters.

## Scope

**This is E6's blocking core PR** — the fifth epic in a row to have one, and E4's retro says
stop re-litigating it. With one developer it is not preventing a merge splice; it is forcing
the contract to be written before the money is.

**One function decides every status change, and nothing else writes `status`.**

```js
// server/src/services/session.state.js
export const TRANSITIONS = Object.freeze({
  PENDING:    ['OFFER_SENT'],
  OFFER_SENT: ['ACTIVE', 'PENDING'],
  ACTIVE:     ['ENDED', 'NO_SHOW'],
  ENDED:      ['RATED'],
  RATED:      [],
  NO_SHOW:    [],
  CANCELLED:  [],
});

/** Throws SESSION_NOT_ACTIVE (409) if `to` is not reachable from `from`. */
export function assertTransition(from, to) { … }
```

Every service that moves a session calls `assertTransition` **inside the transaction, after
the row is locked, against the value it just read** — never against a value fetched
earlier. That ordering is the entire guarantee. Read-then-decide-then-write with a gap in
the middle is two concurrent extensions both seeing `ACTIVE`, both charging.

`CANCELLED` has no inbound edge and that is recorded rather than fixed: §12 has no cancel
endpoint, so no code path in E6 can produce it. Leaving the enum value unreachable is honest;
inventing a transition for it would be a state nothing sets and everything has to handle.

**Five routes, appended to `session.routes.js` in their final shape.** This file was frozen
at 5.1 and E6 is the only epic that reopens it. It is reopened **once**, here, and every
route is fully wired — `authenticate`, `authorize` where a role decides, `validate` — against
controllers that throw `NOT_IMPLEMENTED`:

| Route | Auth | Filled by |
|---|---|---|
| `GET /sessions/:id/video` | `authenticate` only | 6.4 |
| `POST /sessions/:id/extend` | `authenticate` + `authorize('student')` | 6.5 |
| `POST /sessions/:id/end` | `authenticate` only — either side may end | 6.6 |
| `POST /sessions/:id/report-no-show` | `authenticate` + `authorize('student')` | 6.6 |
| `POST /sessions/:id/review` | `authenticate` + `authorize('student')` | 6.6 |

**Three of them have no `authorize` and that is the deliberate half.** `GET /sessions/:id`
already made this call in 5.4: student and teacher read the same row, and which one you are
decides what you may see. That is an authorisation rule about a *row*, not a role, and it
belongs in the service. A role gate on `/video` would either lock out half the participants
or say nothing at all. `extend`, `report-no-show` and `review` do carry one, because only a
student can spend, report or rate.

**The repository's whole E6 set, added at once.** `session.repository.js` already has twelve
functions and three PRs in its `git log`; E5's retro named that as the discipline slipping.
E6 adds exactly one more entry to that log. Everything the epic needs is written here,
before any of it is called:

```
setSessionActive({ sessionId, startedAt, endsAt, blocksUsed, totalCharged }, tx)  ← widened
setSessionVideoRoom({ sessionId, roomName, roomUrl })          6.3, after COMMIT
findSessionForMeter(sessionId, tx)                             locked read, the guard's input
recordBlock({ sessionId, blockNumber, minutes, amount }, tx)   session_blocks append
extendSession({ sessionId, expectedEndsAt, endsAt, … }, tx)    conditional on ends_at
endSession({ sessionId, endReason, endedAt }, tx)
setSessionRated(sessionId, tx)
findSessionsDueForWarning(now)         cron, read-only
findSessionsDueForAutoEnd(now)         cron, read-only
findParticipants(sessionId)            the video endpoint's and the socket join's check
```

Two of them are the concurrency guards and they are written as conditional updates
returning a count, not as `update`:

- `extendSession` matches on `ends_at` **as the caller read it**. Two extensions in the same
  second: the second matches zero rows and is refused.
- `endSession` matches on `status = 'ACTIVE'`. The auto-end cron and the student's button
  can fire in the same tick; exactly one wins.

This is E5's teacher lock, twice, and it is written down as already-solved rather than as
new. `updateMany` returning `{ count }`, never `update`.

**The socket layer's second room, and the first one a client asks for.** `rooms.js` gains
`sessionRoom(sessionId)` — the function its own header has been predicting since 5.1 — and
`handlers.session.js` registers `session:join`.

**`user:{userId}` comes from the verified handshake and cannot be wrong. `session:join`
carries an id from the client, and that is a different thing entirely.** The handler reads
`findParticipants(sessionId)` and joins only if the socket's user is one of them, using the
same rule 6.4's endpoint uses. A refusal is silent — no error event, no reason — for the
same reason 6.4 answers `404`: telling a stranger that a session exists is the leak. **A
room name is not a capability.**

`events.js` gains five emitters, all shipped here and none called until 6.5:
`emitBlockWarning`, `emitSessionExtended`, `emitSessionEnded`, `emitParticipantLeft`,
`emitTeacherAwayWarning`. Same three properties as 5.1's five: they take a recipient or a
session, never a socket; they never throw into the caller; the names come from
`@tutor/shared`.

**The two `shared/` blocks, verbatim from the epic README's contract freeze.** One `// ── E6`
section in `api.d.ts`, one in `socketEvents.js`. Neither E5 block is edited or widened.

## Files you may touch

```
server/src/services/session.state.js              new — the table and assertTransition
server/src/routes/session.routes.js               UNFROZEN ONCE: five appended routes
server/src/controllers/session.controller.js      five handlers throwing NOT_IMPLEMENTED
server/src/validators/session.schema.js           params + the review body
server/src/repositories/session.repository.js     the E6 read/write set, all of it
server/src/sockets/rooms.js                       sessionRoom()
server/src/sockets/events.js                      five emitters
server/src/sockets/handlers.session.js            new — session:join, with the check
server/src/sockets/index.js                       register the session handlers
shared/api.d.ts                                   one appended E6 block
shared/socketEvents.js                            one appended E6 block
server/tests/session.state.test.js                new — the table, exhaustively
docs/epics/E6-session-lifecycle/README.md         tick the status box
```

## Files you must NOT touch

```
server/src/services/session.*.service.js    6.3–6.6 write those; this PR writes no behaviour
server/src/services/offer.respond.service.js  E5's accept path — 6.3 opens it, not this PR
server/src/services/video.*.service.js      6.1's, frozen
server/src/repositories/offer.repository.js frozen at 5.1
server/src/routes/index.js                  /sessions is already mounted
server/src/config/constants/**              every number E6 needs is already there
shared/errorCodes.js                        every code E6 throws already exists
prisma/**                                   6.0's
client/**                                   6.7's
```

## Acceptance criteria

- [ ] Every one of the five routes answers `501 NOT_IMPLEMENTED` in the standard error shape, with its middleware demonstrably running first — a bad uuid is `400`, an anonymous call `401`, a teacher calling `extend` is `403`
- [ ] `assertTransition` accepts exactly the six legal pairs in the epic README's table and throws `SESSION_NOT_ACTIVE` (409) for every other pair — asserted by a table-driven test over all 49 combinations
- [ ] `grep -rn "status: *'\(ACTIVE\|ENDED\|RATED\|NO_SHOW\)'" server/src/services` finds no write outside a repository function
- [ ] `session:join` with somebody else's session id does not join the room, emits nothing, and logs at `warn`
- [ ] `session:join` with a session the caller is in joins `session:{id}`, and a manual emit to that room reaches both participants' tabs
- [ ] `grep -rn "\.emit(" server/src --include=*.js` returns only `sockets/events.js`
- [ ] Both `shared/` blocks are appended below the E5 blocks with nothing above them edited — `git diff` shows additions only
- [ ] Every repository write that races is an `updateMany` with a count check; no `update` on `sessions.status` anywhere
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. `curl -i` each of the five routes with a student token → `501` and the standard shape
2. The same five with no token → `401`; with a malformed uuid → `400`; `extend` with a teacher token → `403`
3. Open a socket as a student, emit `session:join` with a session id belonging to somebody else, and watch the server log — a `warn`, no join, no reply
4. Emit `session:join` with your own `ACTIVE` session id, then from `node` emit a probe to `session:{id}` — it arrives in both participants' tabs and nowhere else
5. `npm test` — the 49-pair table is the test that matters here; read its output rather than its exit code

## Review checklist additions

- **Read `assertTransition`'s call convention, not just its body.** It must be called after the row is locked and against the freshly-read value. Every caller in 6.3–6.6 will copy whatever this PR's own doc comment shows, so the comment is part of the deliverable.
- Confirm `session.routes.js` is appended to and not reordered. E5 froze it; this is the one reopen and the diff must be five contiguous blocks at the bottom.
- Confirm `handlers.session.js` checks participation **before** `socket.join`, not after, and that the refusal path sends nothing back.
- Confirm no controller filled in here does anything but throw. A handler that half-works is a handler nobody notices is half-working.
- Confirm `setSessionActive`'s widened signature did not change its behaviour for E5's caller. 5.4 still calls it; the new parameters default to what E5 wrote.

## Notes

**Why the state machine is not one `session.service.js`.** §18 asked for one and this is the
one line of §18 the epic overrules on sight. Five PRs open the session layer in E6; one file
means five PRs in one `git log`, which is precisely the signal E5's retro identified as the
project's only reviewer. `session.state.js` holds the *rules* — pure, no database, no
transaction — and the four `session.*.service.js` files hold the behaviour. The rules being
pure is what makes the 49-pair test possible.

**Why five emitters ship before anything calls them.** 5.1 did the same and the reason held:
a payload decided once, in the PR that froze the contract, is what makes 6.5 and 6.6 one-line
consumers rather than two separate inventions of what "the session ended" looks like on the
wire.

**`teacher:away_warning` is here, and its constant has been unread since E0.**
`AUTO_AWAY_WARNING_MINUTES` was 5.2's, then 5.5's, then nobody's — E5's README has the whole
argument, and the blocker was never the query. It was that appending an event name is a
contract change rather than a job, and `teacher:status` with an unchanged status is a no-op
every existing handler already ignores. This PR is appending an event block anyway, so the
name costs one line. **6.5 emits it.**
