# PR 5.4 — Accept / reject, lock release, `rejected_by`

| | |
|---|---|
| **Epic** | E5 — Offers & Real-Time Presence |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | Agent, **reviewed hard.** It is not one of §17.5's three transactions, but it releases the lock 5.3 takes, and a release with the condition dropped is the same defect from the other side. |
| **Depends on** | 5.3 |
| **Blocks** | 5.7, 5.8 |
| **Branch** | `dev-b/E5.4-accept-reject` |

## Contract implemented

`POST /offers/:id/accept`, `POST /offers/:id/reject`, `GET /sessions/:id`, and §13's
`offer:accepted` / `offer:rejected`.

## Scope

**Accept — one transaction, four steps.** The two it does not have are named in the file:

```js
// 1. lock the offer row; assert PENDING and expiresAt > now()
// 2. offer   → ACCEPTED, respondedAt = now()
// 3. session → ACTIVE, startedAt = now(), endsAt = now() + OPENING_BLOCKS × BLOCK_MINUTES
// 4. teacher → IN_SESSION, offersAccepted += 1
//
// [E7] charge the opening block — not here. wallet.service.js does not exist,
//      and MVP.md §17.5 makes it human-written when it does.
// [E6] create the Zoom meeting  — not here. §12 lists it on this endpoint; E6 owns it.
```

**`ACTIVE` in E5 means "the offer was accepted".** `blocks_used` stays 0, `total_charged`
stays 0. `ends_at` is set anyway, from the constants, so that E6 has a real instant to extend
rather than a null to special-case. Put that paragraph in the service's header — a session that
starts and takes no money looks exactly like a billing bug to anyone who has not read the epic
README.

**Step 1 asserts expiry in code, not by trusting the column.** The cron may not have run —
Render's free plan sleeps the instance, so `status` can still read `PENDING` on an offer that
expired forty minutes ago. `expiresAt <= now()` is `OFFER_EXPIRED` (409) regardless of what
`status` says, **and the same transaction sweeps it**: mark the offer `EXPIRED` and release the
teacher, so a late accept leaves the world tidy instead of leaving a locked teacher behind.
This is the epic README's gap 6, and it is the reason correctness never depends on the sweeper.

**Reject — one transaction, three steps**, plus the thing E4 has been waiting for:

```js
// 1. lock the offer row; assert PENDING (an expired reject is a no-op success)
// 2. offer   → REJECTED, respondedAt = now()
// 3. session → PENDING   (back, per §10)
// 4. appendRejectedBy({ questionId, teacherId })
//    releaseTeacherLock(teacherId)
```

**`appendRejectedBy` is inside the transaction**, and 5.1's repository takes a `tx` for exactly
this reason: Prisma has no array-append for a scalar list, so the write is read-append-write,
and two rejections in the same second lose one entry unless both hold the same transaction.

**The session goes back to `PENDING`, not to a new state.** §10's diagram has that arrow.
The student's screen then re-runs matching, the rejecting teacher is filtered out by E4's
`rejected_by` predicate — **which has never had a non-empty array to read until this PR** — and
the list is genuinely shorter. That is 4.2's filter becoming real.

**Release is conditional, in both paths.** `releaseTeacherLock` is the gap 5.1 left in
`session.repository.js`, and its body is the mirror of 5.3's:

```js
const { count } = await tx.teacherProfile.updateMany({
  where: { userId: teacherId, status: TeacherStatus.OFFER_LOCKED },
  data:  { status: TeacherStatus.ONLINE },
});
```

**The `where` on `OFFER_LOCKED` is not optional.** A teacher who closed their laptop while an
offer was open may already be `OFFLINE`; an unconditional write to `ONLINE` puts them back in
the matching pool against their wishes, and the next student sends an offer to a teacher who
is not there. Same shape as the lock, same failure if the condition is dropped, and no
sequential test notices.

**`GET /sessions/:id`** answers both sides from one route, with the row-level rule 5.1's
missing `authorize` implies: the caller must be the session's student or its teacher, and
anyone else gets `NOT_FOUND`. The teacher's view carries `IncomingOffer`; the student's carries
`OfferResponse`. One route, two shapes, decided by who is asking — which is why the
authorisation is in the service and not in a middleware.

**After each commit, and only after:** `offer:accepted` to `user:{studentId}` with the
`sessionId`, or `offer:rejected` to the same. **`offer:accepted`'s §13 payload names
`zoomUrl`** — E5 has no Zoom, so the field is omitted rather than sent as `null`. A null that
means "later" is indistinguishable from a null that means "failed".

## Files you may touch

```
server/src/services/offer.respond.service.js    new
server/src/services/session.view.service.js     new  — GET /sessions/:id, both shapes
server/src/controllers/offer.controller.js      fill accept and reject
server/src/controllers/session.controller.js    fill the getSession handler
server/src/repositories/session.repository.js   ONLY releaseTeacherLock's body — the gap 5.1 left
server/src/utils/offerView.js                   add toIncomingOffer
docs/epics/E5-offers-realtime/README.md         tick the status box

server/tests/offer.respond.test.js              new
```

## Files you must NOT touch

```
server/src/repositories/session.repository.js   everything except releaseTeacherLock's body
server/src/repositories/offer.repository.js     frozen at 5.1
server/src/services/session.offer.service.js    5.3's
server/src/routes/**                            frozen at 5.1
server/src/sockets/**                           call events.js, do not add to it
server/src/repositories/matching.repository.js  E4's — rejected_by is written from offer.repository.js
shared/**                                       frozen at 5.1
prisma/**                                       no migration
client/**                                       5.7 and 5.8 consume this
```

## Acceptance criteria

- [ ] A teacher accepting a `PENDING` offer gets `200`; the offer is `ACCEPTED`, the session `ACTIVE`, the teacher `IN_SESSION`
- [ ] `sessions.started_at` is set and `ends_at` is exactly `OPENING_BLOCKS × BLOCK_MINUTES` later
- [ ] `blocks_used` is `0` and `total_charged` is `0` after an accept — **E5 charges nothing**
- [ ] `offers_accepted` incremented by one
- [ ] A teacher rejecting gets `200`; the offer is `REJECTED`, the session back to `PENDING`, the teacher back to `ONLINE`
- [ ] After a reject, `questions.rejected_by` contains that teacher's id, and re-running `GET /questions/:id/matches` **does not return them**
- [ ] Two rejections against two questions for the same teacher both land — neither array loses an entry
- [ ] Accepting an offer whose `expires_at` has passed → `OFFER_EXPIRED` (409) **even when `status` still reads `PENDING`**, and the teacher is released by that same call
- [ ] Accepting an already-`ACCEPTED` offer → `OFFER_EXPIRED` or `SESSION_NOT_ACTIVE`, never a second `ACTIVE` session
- [ ] A teacher who went `OFFLINE` while the offer was open is **still `OFFLINE`** after rejecting it
- [ ] Another teacher's offer id → `NOT_FOUND`
- [ ] A student calling accept → `FORBIDDEN` (the route's `authorize`)
- [ ] `GET /sessions/:id` answers for the student and for the teacher, with different shapes, and `NOT_FOUND` for anyone else
- [ ] `offer:accepted` carries no `zoomUrl` key at all
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. Run 5.3's flow to get a `PENDING` offer, with the teacher logged in on a second browser
2. Accept. Both rows move; `psql` confirms `blocks_used = 0`
3. Reset, send again, and **reject**. `select rejected_by from questions where id = ...` shows one uuid
4. As the student, reload `/app/ask/:id/teachers` — the rejecting teacher is gone from the list. Delete the array back to `'{}'` and they return
5. Send an offer, then `update offers set expires_at = now() - interval '1 minute'` and accept. `OFFER_EXPIRED`, and the teacher is `ONLINE` again
6. Send an offer, set the teacher `OFFLINE` by hand, then reject. The teacher is still `OFFLINE`

## Review checklist additions

- Confirm `releaseTeacherLock`'s `where` carries `status: 'OFFER_LOCKED'`. Without it the release is an unconditional overwrite, and every sequential test passes anyway.
- Confirm the expiry check is `expiresAt <= now()` in code and does not read `status` to decide. The cron is a sweeper and may be asleep.
- Confirm `appendRejectedBy` receives the transaction client, not `prisma`.
- Confirm the accept path does **not** import anything from a wallet or a Zoom module, and that the two absent steps are commented with their epic numbers.
- Confirm `ends_at` is computed from `OPENING_BLOCKS` and `BLOCK_MINUTES` and that neither `2` nor `5` appears as a literal.
- Confirm the socket emits are after `COMMIT`, not inside the callback.
- Read `GET /sessions/:id` as a third user. It must be `NOT_FOUND` and must not leak whether the id exists.

## Notes

**Why an expired reject is a no-op success and an expired accept is an error.** Rejecting
something that already went away is what the teacher wanted; answering `409` to it makes a
dismissed modal look broken. Accepting it is different — the teacher believes they have a
session and they do not, so they must be told.

**Why the session returns to `PENDING` rather than getting a `REJECTED` state.** §10's diagram
has the arrow, and `SessionStatus` has no such value. Adding one would be a migration, and the
product's meaning is genuinely "this question is unmatched again" — which is what `PENDING`
already says, and what E4's matching endpoint already accepts.

**This PR makes two E4 predictions come true.** `rejected_by` gets its first non-empty array,
so 4.2's exclusion filter runs against real data for the first time; and `offers_accepted`
starts moving, so 4.8's retro line about `acceptance_rate` being "history that stopped" stops
being true. Both are worth a sentence in 5.9's retro.
