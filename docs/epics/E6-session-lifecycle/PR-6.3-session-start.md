# PR 6.3 — Session activation + `createSessionVideo` persistence

| | |
|---|---|
| **Epic** | E6 — Session Lifecycle & Video |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | Agent, **reviewed hard.** It opens E5's accept transaction, and the one line this PR must not write is a `fetch` inside it. |
| **Depends on** | 6.1, 6.2 |
| **Blocks** | 6.4, 6.5, 6.7 |
| **Branch** | `dev-b/E6.3-session-start` |

## Contract implemented

`MVP.md` §10's `OFFER_SENT → ACTIVE` edge, and §12's "Creates the Daily room" half of
`POST /offers/:id/accept`. The comment E5 left at `offer.respond.service.js:220` is deleted
and replaced with the thing it promised.

## Scope

**The accept path grows one step and gains a sequel.** E5's transaction was four steps with
two absences named in the file. This PR closes the video one; **6.5 closes the money one**,
in the same service, a PR later.

```js
// server/src/services/session.activate.service.js — 6.3
//
//  inside the transaction (unchanged from 5.4 except the assert):
//   1. lock the offer row; assert PENDING and expiresAt > now()
//   2. assertTransition(session.status, 'ACTIVE')     ← 6.2's, against the locked read
//   3. offer   → ACCEPTED, respondedAt = now()
//   4. session → ACTIVE, startedAt, endsAt = startedAt + OPENING_BLOCKS × BLOCK_MINUTES
//   5. teacher → IN_SESSION, offersAccepted += 1
//
//  [E6.5] charge the opening block — not here, one PR later. wallet.service.js
//         does not exist yet, and §17.5 makes it human-written when it does.
//
//  after COMMIT, and only after:
//   6. emitOfferAccepted(studentId, { offerId, sessionId })
//   7. createSessionVideo(sessionId) → setSessionVideoRoom(...)   ← this PR
```

**Step 7 is outside the transaction and that is the single most important line in this
brief.** `createSessionVideo` is a `fetch` across the public internet. Inside the
transaction it holds a row lock on the teacher *and* the session for as long as Daily takes
to answer, which on a bad day is thirty seconds — during which the teacher cannot be
released, no other offer can be evaluated against them, and the connection pool is one
smaller. Nothing about the room needs to be atomic with the state change: a room with no
session is litter that expires in 24 hours, and a session with no room is the degraded case
this PR is explicitly designed to survive.

**A failed room creation does not fail the accept.** Catch it, log it at `error` with the
session id, and return the `200` anyway. The columns stay null, `hasVideo` is `false`, and
the session runs. This is the same ruling E5 made for the offer email — *an offer that 500s
because an email provider is down is a worse product than an offer with no email* — and it
is why 6.1 turned the missing-key `Error` into an `AppError` this path can recognise.

**The retry is 6.4's, not this PR's**, and it is worth knowing while writing this one: the
first `GET /sessions/:id/video` against a session with null columns creates the room then.
So a Daily outage at accept time costs nothing permanent as long as it has ended by the time
somebody presses join.

**`ends_at` is set from the constants and was already being set in E5** — 5.4 wrote it
deliberately so that E6 had a real instant to extend rather than a null to special-case.
This PR does not recompute it, does not move it, and adds no literal `2`, `5` or `10`.

**`blocks_used` and `total_charged` stay `0`.** One more PR. The header comment E5 wrote in
`session.repository.js:433` explaining that an unbilled `ACTIVE` session is not a billing bug
stays true through this PR and is deleted by 6.5.

**One serializer change.** `GET /sessions/:id` starts answering the `SessionState` shape once
the session is `ACTIVE`, per 6.2's contract — `hasVideo` from whether `video_room_name` is
set, `counterpart` from the other side, `balance` and `teacherEarning` nulled per role.
Below `ACTIVE` it keeps answering 5.4's `OfferResponse` / `IncomingOffer`, unchanged. **5.8's
screen must not break**, and its switch on offer status is the reason it will not.

## Files you may touch

```
server/src/services/session.activate.service.js   new — the activation, step 7, the catch
server/src/services/offer.respond.service.js      the accept path calls into the above
server/src/services/session.view.service.js       SessionState for ACTIVE and past
server/src/utils/sessionView.js                   new — toSessionState, both roles
server/src/repositories/session.repository.js     ONLY setSessionVideoRoom's body — 6.2's gap
server/tests/session.activate.test.js             new — createSessionVideo stubbed
docs/epics/E6-session-lifecycle/README.md         tick the status box
```

## Files you must NOT touch

```
server/src/services/video.*.service.js       6.1's, frozen. Call it; do not open it
server/src/services/session.state.js         6.2's rules
server/src/repositories/session.repository.js  everything except setSessionVideoRoom's body
server/src/routes/**                          frozen again after 6.2
shared/**                                     frozen at 6.2
server/src/services/wallet.service.js         does not exist. 6.5 creates it
prisma/**                                     no migration
client/**                                     6.7's
```

## Acceptance criteria

- [ ] Accepting an offer moves the session to `ACTIVE` and, within a second or two, `video_room_name` and `video_room_url` are both non-null
- [ ] `blocks_used` is `0` and `total_charged` is `0` after activation — **6.3 charges nothing**
- [ ] `started_at` is set and `ends_at` is exactly `OPENING_BLOCKS × BLOCK_MINUTES` later
- [ ] With `DAILY_API_KEY` unset the accept still returns `200`, the session is still `ACTIVE`, both video columns are null, and one `error` line names the session id
- [ ] With the key set but Daily unreachable — point `DAILY_API_URL` at a dead host — the same
- [ ] The accept's HTTP response does not wait on Daily: the `200` and the room write are separately observable in the log, in that order
- [ ] No `fetch`, no `createSessionVideo`, and no import from `services/video.*` appears inside a `prisma.$transaction` callback anywhere in the server
- [ ] `GET /sessions/:id` answers `SessionState` for an `ACTIVE` session, with `balance` null for the teacher and `teacherEarning` null for the student
- [ ] `GET /sessions/:id` still answers `OfferResponse` / `IncomingOffer` for a session at `OFFER_SENT`, and 5.8's awaiting screen still works untouched
- [ ] `assertTransition` is called against the value read under the lock, not one read before it
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. Two browsers, student and teacher, through E5's flow to a `PENDING` offer
2. Accept. `select status, started_at, ends_at, blocks_used, total_charged, video_room_name from sessions where id = …` — `ACTIVE`, both timestamps, both counters `0`, a room name
3. Open the `video_room_url` in a third browser: Daily refuses it without a token. That is the pass
4. Comment out `DAILY_API_KEY`, restart, and run 1–2 again. Still `ACTIVE`, room columns null, one `error` line in the log
5. `GET /sessions/:id` as each side and diff the two payloads. Same shape, `role` differs, the two role-only fields swap between a number and `null`

## Review checklist additions

- **First line of the review: find every `prisma.$transaction` in the diff and read what is inside it.** A `fetch` in there is the defect this PR is most likely to ship, it passes every test, and it only hurts under load.
- Confirm the room-creation failure path returns the `200`. A `try` with no `catch`, or a `catch` that rethrows, turns an optional integration into a required one.
- Confirm the emit to the student is before the room write and after the commit. The student's screen navigates on `offer:accepted` and then fetches; it must not wait on Daily either.
- Confirm nothing in this PR imports a wallet module or writes `blocks_used`. One PR later.
- Confirm `toSessionState` nulls the other role's field rather than omitting the key. The contract says null and a renderer cannot tell the difference between an absent key and a forbidden one.

## Notes

**Why the room is created at activation rather than lazily on first join.** `OWNERSHIP.md`
§2.1 says the session owner calls the seam and persists the result, and activation is the
moment the session becomes a thing two people are about to be in. Creating it lazily would
put an external call on the critical path of the *first join*, which is exactly when both
people are staring at a spinner. Creating it at accept spends the latency while the student
is still watching a countdown resolve.

The lazy path still exists as 6.4's retry, and having both is not a contradiction: one is the
normal path, the other is the repair.

**Why `session.activate.service.js` rather than growing `offer.respond.service.js`.** The
accept endpoint is E5's and its service is about answering an offer. What happens to the
*session* when the answer is yes is a different concern and it is about to acquire a charge,
a room and a meter. Suffixed by concern, as everything has been since E3.
