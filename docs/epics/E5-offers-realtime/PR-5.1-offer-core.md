# PR 5.1 — Offer core: frozen routers, repositories, socket server, seeded questions

| | |
|---|---|
| **Epic** | E5 — Offers & Real-Time Presence |
| **Owner** | DEV-B (rotem) |
| **Size** | L |
| **Written by** | **Human — no agent.** Two reasons. Every later PR in the epic is shaped by this one, which is why 2.1, 3.1 and 4.1 were human-written. And it carries the Socket.IO handshake, which authenticates a connection from a JWT — `MVP.md` §17.5 puts auth middleware on the human-written list, and a handshake that trusts a query parameter is a silent authentication bypass. |
| **Depends on** | E4 (4.1–4.7 merged). Not 4.8, not F1/F3 — see the epic README, "What E5 does not wait for". |
| **Blocks** | 5.2, 5.3 |
| **Branch** | `dev-b/E5.1-offer-core` |

## Contract implemented

The whole `E5` block of the epic's contract freeze, appended to `shared/api.d.ts`, plus
`shared/socketEvents.js`. **No behaviour ships in this PR** — all four routes answer
`NOT_IMPLEMENTED` until 5.3 and 5.4 land. The socket server is real and authenticated but
emits nothing.

## Scope

Seven things, merged before anything else in the epic starts.

**1. `session.routes.js` and `offer.routes.js`, new and frozen.** Every route in its final
shape, against stub controllers that throw `new AppError(ERROR_CODES.NOT_IMPLEMENTED, ...)`:

| Method | Path | Middleware | Lands in |
|---|---|---|---|
| POST | `/sessions/:id/offer` | `authenticate`, `authorize('student')`, `validate(sendOfferSchema)` | 5.3 |
| GET | `/sessions/:id` | `authenticate`, `validate(sessionByIdSchema)` | 5.4 |
| POST | `/offers/:id/accept` | `authenticate`, `authorize('teacher')`, `validate(offerByIdSchema)` | 5.4 |
| POST | `/offers/:id/reject` | `authenticate`, `authorize('teacher')`, `validate(offerByIdSchema)` | 5.4 |

`validate` is on every one from the start, for the reason 4.1 gives: `:id` is `@db.Uuid` and
Postgres raises `22P02` on a malformed one rather than returning no rows, so a typo in the URL
becomes a 500 for what is plainly a bad request.

**`GET /sessions/:id` carries `authenticate` but not `authorize`**, and that is deliberate:
both the student and the teacher read the same session, and which one you are decides what
you may see. That is an authorisation rule about a row, not about a role, and it belongs in
the service — the same call 3.5 made for `GET /questions/:id`.

**No rate limiter on the three POSTs.** `strictLimiter` exists for routes that spend money on
an external call. These take a row lock and send an email; `globalLimiter` in `app.js` covers
them. A strict limit on `accept` would throttle the one action the product most needs to be
instant.

Two appended lines in `routes/index.js`, alphabetical, with nothing reordered:

```js
apiRoutes.use('/offers', offerRoutes);
apiRoutes.use('/sessions', sessionRoutes);
```

**2. `offer.repository.js`, new and frozen.** Every query the epic needs, written once:

- `findOfferForRespond(offerId)` — the offer's `status`, `expiresAt`, `teacherId`, and its
  session's `id`, `status`, `studentId`, `questionId`. One read, for the accept and reject
  paths both.
- `findPendingOfferForSession(sessionId)` — so a second **Send request** on a session that
  already has one is answerable without a second round trip.
- `createOffer({ sessionId, teacherId, expiresAt }, tx)` — takes a transaction client.
- `markOfferResponded({ offerId, status }, tx)` — `ACCEPTED` or `REJECTED`, sets
  `respondedAt`. Conditional on the row still being `PENDING`, and returns the count.
- `expirePendingOffersBefore(instant)` — the sweep's `updateMany`. Returns the affected ids
  so 5.5 can emit to each teacher.
- `appendRejectedBy({ questionId, teacherId }, tx)` — **the only writer of `rejected_by` in
  this codebase.** Read-append-write inside the caller's transaction; see the notes.

**3. `session.repository.js`, new and frozen.**

- `findSessionForOffer(sessionId)` — `status`, `studentId`, `questionId`, and the question's
  `teacherBrief`, `topicId`, `subtopicId`, `estimatedLevel`, `declaredLevel`. **Not
  `QUESTION_VIEW`** — E5 needs a different shape for a different consumer, exactly as 4.1
  refused to reuse it. Say so in the function's header.
- `findSessionForView(sessionId)` — what `GET /sessions/:id` answers with, both sides.
- `lockTeacherForOffer(teacherId, tx)` — **declared here, left unimplemented.** The signature,
  the JSDoc and the return type (`{ locked: boolean }`) are this PR's to freeze; the
  conditional `updateMany` inside it is 5.3's and is the only thing 5.3 may add to this file.
  This is 4.1's `findCandidates`-without-a-`where` arrangement, verbatim.
- `releaseTeacherLock(teacherId, tx)` — same shape, also left unimplemented, filled by 5.4.
- `setSessionOfferSent({ sessionId, teacherId, pricePerBlock }, tx)`
- `setSessionActive({ sessionId, startedAt, endsAt }, tx)`
- `findWalletBalance(userId)` — the affordability re-check. A read, and `matching.repository.js`
  has its own; **do not import E4's.** One integer, `null` when the row is missing.

**4. `server/src/sockets/`, new.** The `#sockets/*` import alias has been in
`server/package.json` since E0 and this is the PR that uses it.

- `index.js` — creates the `Server` from `socket.io` bound to the same HTTP server `index.js`
  already listens on, with `cors` read from `env.corsOrigins` (the same list Express uses, not
  a second one). Exports `getIo()`.
- `auth.js` — **the handshake.** Reads the token from `socket.handshake.auth.token`, verifies
  it through the same function `middlewares/authenticate.js` uses, attaches `socket.data.user`,
  and calls `next(new Error(...))` on failure. **No anonymous connection, and no
  authenticate-on-first-message.** A refused handshake disconnects.
- `rooms.js` — `userRoom(userId)` → `` `user:${userId}` ``. That is the only room E5 uses; see
  the epic README on why `session:{id}` is E6's.
- `events.js` — one exported function per server→client event in `shared/socketEvents.js`,
  each taking a recipient and a typed payload. **No controller or service calls `io.emit`
  directly**, so there is exactly one place to look when an event does not arrive.

**5. `shared/socketEvents.js`, new**, verbatim from the epic README's contract freeze. Six
names, five of them server→client. **Nothing else from §13's list** — the other five belong to
E6's meter and E7's wallet, and a catalogue of names nothing emits stops being trustworthy.

**6. `constants/session.js`, one appended value.** The file already holds the ten numbers this
epic needs. Append, do not edit:

| Constant | Value | Why here |
|---|---|---|
| `OFFER_STATUS` | `{ PENDING, ACCEPTED, REJECTED, EXPIRED }` | `Offer.status` is a `VarChar(20)`, not a Postgres enum, so the four values need a home that both the Zod schema and the repository read. See the epic README, gap 1, for why it stays a string. |

`constants/index.js` is **not** touched — `session.js` has been in the barrel since 0.5. **Only
this PR opens `constants/session.js` in the whole epic**, and no PR in E5 writes any of those
eleven values as a literal anywhere else.

**7. `prisma/seed/questions.js`, new** — E4's F5, absorbed here because a blocking PR that
leaves the epic untestable is not blocking enough, and the classifier is currently down. Two
upserts on a stable business key, in the style of the rest of the seed:

- one on `integration-by-parts` at `estimated_level` 5, `classification_ok true`, owned by
  `avi.student@demo.tutornow.il`, with a `sessions` row in `PENDING`
- one on the sentinel — `topic_id = 0`, `subtopic_id` null, `estimated_level` null,
  `classification_ok false` — owned by `noya.student@demo.tutornow.il`, also with a `PENDING`
  session

Both get a `teacher_brief` written by hand, because 5.6's email and 5.7's modal both render it
and an empty brief makes both look broken.

**Also: `server/src/utils/commission.js`, new and small.** `platformFeeRate({ teacherCreatedAt,
at })` returns `0` inside `NEW_TEACHER_FEE_DAYS`, `0` when `isLowDemandHour(at)`, and
`PLATFORM_FEE_PCT` otherwise — §5.3, in one pure function. `IncomingOffer.expectedEarning` in
the contract needs it, and **E7's real charge reuses it** rather than writing §5.3 a second
time. It is not `wallet.service.js` and moves no money, so §17.5 does not reach it.

## Files you may touch

```
server/src/routes/session.routes.js              new, frozen
server/src/routes/offer.routes.js                new, frozen
server/src/repositories/offer.repository.js      new, frozen
server/src/repositories/session.repository.js    new, frozen  (two gaps for 5.3/5.4)
server/src/sockets/index.js                      new
server/src/sockets/auth.js                       new  ← the human-written half
server/src/sockets/rooms.js                      new
server/src/sockets/events.js                     new
server/src/utils/commission.js                   new
server/src/config/constants/session.js           one appended value
server/src/routes/index.js                       two appended lines
server/src/index.js                              wire the socket server onto the HTTP server
shared/api.d.ts                                  one appended `// ── E5` block
shared/socketEvents.js                           new
prisma/seed/questions.js                         new
prisma/seed/index.js                             one appended call
docs/epics/E5-offers-realtime/README.md          tick the status box

server/tests/offer.core.test.js                  new  — the freeze, not the coverage

# added while implementing — a frozen router cannot import files that do not exist
server/src/controllers/session.controller.js     new  stub, filled by 5.3/5.4
server/src/controllers/offer.controller.js       new  stub, filled by 5.4
server/src/validators/session.schema.js          new  **finished**, not a stub
server/src/validators/offer.schema.js            new  **finished**, not a stub
```

**Why the validators ship finished.** Three of the criteria below are assertions about them,
and a stub cannot satisfy an assertion. The whole input surface is `params.id` as a uuid and,
for the offer, a body of `{ teacherId }` — that is decided and it does not grow. Same split
3.1 and 4.1 both made.

## Files you must NOT touch

```
server/src/repositories/matching.repository.js   E4's, frozen since 4.2 — E5 writes rejected_by from its own file
server/src/repositories/teacher.repository.js    E2's, frozen since 2.1
server/src/validators/teacher.me.schema.js       SETTABLE_STATUSES stays ['OFFLINE','ONLINE'] — see the epic README, gap 2
server/src/routes/question.routes.js             frozen since 3.1
server/src/routes/matching.routes.js             frozen since 4.1
server/src/app.js                                frozen since 0.4 — routes go through the registry
server/src/middlewares/**                        everything these routes need exists
shared/errorCodes.js                             every code E5 needs is already in it
prisma/schema/**                                 this PR needs no migration, and the check is in the notes
client/**                                        nothing client-side in this PR
```

## Acceptance criteria

- [ ] `POST /api/v1/sessions/<uuid>/offer` with a student token returns `NOT_IMPLEMENTED` — not 404, not 500
- [ ] The same with no token is `UNAUTHORIZED`; with a teacher's token, `FORBIDDEN`
- [ ] `POST /api/v1/offers/<uuid>/accept` with a **student's** token is `FORBIDDEN`; with a teacher's, `NOT_IMPLEMENTED`
- [ ] `GET /api/v1/sessions/<uuid>` reaches the stub for a student token **and** for a teacher token — no `authorize` on that route
- [ ] `/sessions/not-a-uuid/offer` returns `VALIDATION_ERROR` naming the parameter
- [ ] `POST /sessions/<uuid>/offer` with `{}`, with `{teacherId: 'x'}`, and with an unknown key are each `VALIDATION_ERROR`
- [ ] Every route already in the app answers exactly as it did before this PR — `routes/index.js` gained two lines and nothing moved
- [ ] A socket connection **with no token is refused**, and the client receives a connect error rather than a connected socket
- [ ] A socket connection with an expired or tampered token is refused
- [ ] A socket connection with a valid token connects and is in `user:{its own userId}` and in no other room
- [ ] `grep -rn "io.emit\|socket.emit" server/src --include=*.js` matches only inside `server/src/sockets/`
- [ ] `npm run db:seed` twice in a row leaves exactly two demo questions and two `PENDING` sessions — the seed is idempotent
- [ ] `platformFeeRate` returns `0` for a teacher created yesterday, `0` at 09:00 Israel time for an old teacher, and `0.15` at 20:00 for an old teacher
- [ ] `session.repository.js` exports `lockTeacherForOffer` and `releaseTeacherLock` and **neither has a body** beyond its JSDoc and a `NOT_IMPLEMENTED` throw
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass; `npm run build -w client` still builds

## Manual test

1. `npm run db:up && npm run db:migrate && npm run db:seed`, then confirm `grep DATABASE_URL .env` shows `localhost:5433`
2. `psql` on 5433: two rows in `questions` carrying the demo briefs, two in `sessions` with `status = 'PENDING'`
3. `npm run dev`, then call all four routes with a student token, a teacher token and no token
4. In a node one-liner, connect a `socket.io-client` with `auth: { token: '<a real access token>' }` — it connects. Repeat with `auth: {}` and with a token with one character changed — both are refused
5. Confirm the refused connection produces a log line and no crash; the server keeps serving HTTP

## Review checklist additions

- The routes must be in their **final** shape. A middleware added in 5.3 is an edit to a frozen file, which is the failure this PR exists to prevent.
- Read the two repositories' function lists against the epic README. A missing query is discovered mid-5.4, in a file that is by then frozen.
- Confirm `lockTeacherForOffer` and `releaseTeacherLock` are **declared and empty**. A lock written here is the one decision this PR must not make — 5.3 is human-written precisely so that four lines get full attention, and pre-writing them buries the decision in an L-sized diff.
- Confirm the handshake verifies the token with the **same** function `authenticate.js` uses, not a second `jwt.verify` call with its own options. Two verifiers is two policies.
- Confirm the socket CORS list is `env.corsOrigins`, not a literal and not `'*'`. `credentials` is on; a wildcard here is the same defect `DEPLOYMENT.md` §6 warns about for Express.
- Confirm `shared/socketEvents.js` has six names and not eleven.
- Confirm the `E5` block in `api.d.ts` is appended and the `E4` block is byte-identical.

## Notes

**Why no migration, in the fourth epic to claim it.** 3.1 claimed it and found three columns
missing. 4.1 claimed it, checked, and was right. The same check was run here against
`prisma/schema/*.prisma` at `1962bbd`:

| §11.3 / §12 / §13 wants | The database has | Resolution |
|---|---|---|
| `offers` with `expires_at`, `responded_at` | ✅ both, and the table | — |
| `teacher_profiles.status = 'OFFER_LOCKED'` | ✅ in the `TeacherStatus` enum, never written | E5 is its first writer |
| `sessions.price_per_block` snapshot | ✅ nullable, with a comment saying it is the offer-time snapshot | — |
| `teacher_profiles.last_seen_at` | ✅ nullable | 5.2's |
| `questions.rejected_by UUID[]` | ✅, `[]` on every row | E4 reads it, 5.4 writes it |
| `idx_offers_pending` | ✅ already in the init migration | **do not create it again** |
| `Offer.status` as an enum | it is a `VarChar(20)` | left alone — a migration for zero behaviour |

If implementing this turns up an eighth gap, the instruction is 3.1's: say so, write it into
the epic README's contract freeze, and land the migration on its own before continuing.

**Why `rejected_by` is read-append-write and why it is in the repository.** Prisma has no
array-append operator for a scalar list; setting it means reading the current value and writing
the whole array back. Two rejections in the same second therefore lose one entry unless both
happen inside the transaction that is already holding the offer row. `appendRejectedBy` takes a
`tx` for that reason and its JSDoc says so. 4.2's brief made the matching side of the same
observation from the read direction.

**Why the seed is in the blocking PR and not filler.** E4's retro concluded that filler without
a position in the order table does not get done — four epics running, F1 through F5. E5 has one
developer and no filler slot, so the item that the epic actually needs to be testable goes into
the PR that unblocks everything else. The two others (F1, F3) are not carried forward again.

**Why the socket server is wired but silent.** Every emitter exists and none is called. That
makes 5.2 through 5.8 one-line consumers of `events.js` rather than each inventing a payload,
and it means the handshake — the part that is a security boundary — gets reviewed on its own
rather than inside an L-sized dashboard PR.
