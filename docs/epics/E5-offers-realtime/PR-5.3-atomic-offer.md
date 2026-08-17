# PR 5.3 — `POST /sessions/:id/offer` — the atomic teacher lock

| | |
|---|---|
| **Epic** | E5 — Offers & Real-Time Presence |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | **Human — no agent.** `MVP.md` §17.5: the three critical transactions are human-written and manually tested with two browsers, because a race condition is invisible in code review and only appears under concurrency. This is transaction A from §11.3. |
| **Depends on** | 5.1 |
| **Blocks** | 5.4, 5.5, 5.6, 5.8 |
| **Branch** | `dev-b/E5.3-atomic-offer` |

## Contract implemented

`POST /sessions/:id/offer` → `OfferResponse`, and `MVP.md` §11.3 transaction A. The epic's
acceptance criterion lives here: two students send an offer to the same teacher
simultaneously, exactly one succeeds, the other gets `TEACHER_UNAVAILABLE`.

## Scope

**One transaction, five steps, in this order.** The order is not cosmetic — the lock is taken
first so that everything after it is already exclusive:

```
BEGIN
  1. re-read the session; assert it is PENDING and belongs to the caller
  2. re-read the wallet balance; assert balance >= pricePerBlock × OPENING_BLOCKS
  3. lockTeacherForOffer(teacherId)  →  count === 0  ⇒  TEACHER_UNAVAILABLE, roll back
  4. createOffer({ sessionId, teacherId, expiresAt: now + OFFER_TTL_SECONDS })
  5. setSessionOfferSent({ sessionId, teacherId, pricePerBlock })
COMMIT
```

**Step 3 is the whole PR.** It is the body 5.1 left empty in `session.repository.js`, and it is
four lines:

```js
const { count } = await tx.teacherProfile.updateMany({
  where: { userId: teacherId, status: TeacherStatus.ONLINE },
  data:  { status: TeacherStatus.OFFER_LOCKED },
});
return { locked: count === 1 };
```

**`updateMany`, never `update`.** `update` throws `P2025` when it matches nothing and gives you
no count; `updateMany` returns `{ count }`, which is the `rowCount` §11.3 is asking for. Under
Postgres's default READ COMMITTED, the second transaction blocks on the row until the first
commits, then re-evaluates its `WHERE`, sees `OFFER_LOCKED`, and matches zero. That is the
entire mechanism. It is correct, it is four lines, and **no test that issues requests in
sequence exercises it.**

**Everything happens inside one `prisma.$transaction` callback**, and nothing else does. An
email, a socket emit or a log line inside the transaction holds the row lock for the duration
of an external call — that is 5.6's whole reason for being a separate PR, and the reason the
notification lives after `COMMIT`.

**The price is snapshotted, not referenced.** `sessions.price_per_block` gets the teacher's
price *as of now*, and the schema comment says why: a tier change mid-session must not reprice
blocks already agreed to. Read it in step 3's `updateMany` return or in step 1's join — never
from a second query after the commit, which is a different price.

**Step 2 is a read and crosses no seam.** E4 applied a ceiling when the list was built; the
balance could in principle have moved between that screen and this button. One `SELECT` closes
it. `INSUFFICIENT_CREDIT` (402) is the answer, it already exists in `errorCodes.js`, and E4's
selection screen already renders that reason. **This PR calls no wallet service and moves no
money** — see the epic README on where E5 stops.

**Two failures that are not the lock**, and both must precede it so a doomed request never
takes one:

- the session is not `PENDING` → `SESSION_NOT_ACTIVE` (409). A reload re-enables every
  **Send request** button on E4's screen, so a second press on a session that already has an
  offer out is an ordinary user action, not an attack.
- the session's `studentId` is not the caller → `NOT_FOUND`, never `FORBIDDEN`. Same rule 3.5
  and 4.5 both apply: the server does not confirm which ids are real.

**After the commit, and only after:** emit `offer:new` to `user:{teacherId}` through
`sockets/events.js`, and increment `offers_received`. The counter is E4's `acceptance_rate`
input and 4.8's retro records it as "history that stopped" — this is where it restarts.

**`offers_received` is incremented outside the transaction, deliberately.** It is a
denormalised statistic, not a fact the lock protects, and putting it inside adds a second row
to the write set of the most contended transaction in the product.

## Files you may touch

```
server/src/services/session.offer.service.js    new
server/src/controllers/session.controller.js    fill the sendOffer handler
server/src/repositories/session.repository.js   ONLY lockTeacherForOffer's body — the gap 5.1 left
server/src/utils/offerView.js                   new  — toOfferResponse
docs/epics/E5-offers-realtime/README.md         tick the status box

server/tests/offer.send.test.js                 new
```

**`session.repository.js` is frozen except for one function body.** This is 4.2's relationship
to `matching.repository.js`, verbatim: the file was frozen with a named, documented gap, and
filling that gap is the only edit permitted. `releaseTeacherLock` stays empty — it is 5.4's.

## Files you must NOT touch

```
server/src/routes/**                            frozen at 5.1 — the route is already final
server/src/validators/session.schema.js         finished at 5.1
server/src/repositories/offer.repository.js     frozen at 5.1 — createOffer already exists
server/src/sockets/**                           5.1's; call events.js, do not add to it
server/src/repositories/matching.repository.js  E4's
server/src/repositories/teacher.repository.js   E2's
shared/**                                       the contract was frozen at 5.1
prisma/**                                       no migration
client/**                                       5.8 consumes this
```

## Acceptance criteria

- [ ] A student with a `PENDING` session and an `ONLINE` teacher gets `201` and an `OfferResponse` with an `expiresAt` 60 seconds out
- [ ] The teacher's row is `OFFER_LOCKED` and the session's is `OFFER_SENT`, both after one call
- [ ] `sessions.price_per_block` equals the teacher's price at the moment of the call
- [ ] **Two students, two browsers, same teacher, simultaneously → exactly one `201`, the other `TEACHER_UNAVAILABLE` (409).** Run it ten times
- [ ] After the losing call, the loser's session is still `PENDING` — nothing was half-written
- [ ] An `OFFLINE` teacher → `TEACHER_UNAVAILABLE`; an `OFFER_LOCKED` teacher → the same
- [ ] A session already `OFFER_SENT` → `SESSION_NOT_ACTIVE` (409), and the existing offer is untouched
- [ ] Another student's session id → `NOT_FOUND`, never `FORBIDDEN`
- [ ] `ido.student` (0 credits) → `INSUFFICIENT_CREDIT` (402), **and no teacher was locked**
- [ ] The teacher's connected socket receives `offer:new` with a non-empty `brief`
- [ ] `offers_received` incremented by exactly one
- [ ] `DEBUG=prisma:query` shows the `UPDATE teacher_profiles` inside a `BEGIN`/`COMMIT` pair, with no `SELECT` against an external service between them
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

**This is the two-browser test, and it runs the day this PR merges — not at 5.9.**

1. `npm run db:up && npm run db:migrate && npm run db:seed`
2. Flip one teacher `ONLINE` in `psql`. Note their `user_id`
3. Two **separate browsers** — not two tabs; a second tab shares `localStorage` and is the same student. Log in as `avi.student@` in one and `noya.student@` in the other, each on their own seeded question's `/app/ask/:id/teachers`
4. Get both to the point where the request is one click away, then click both as close to simultaneously as you can manage. Repeat ten times, resetting the rows between runs
5. Every run: exactly one `201`, one `409 TEACHER_UNAVAILABLE`, one `offers` row, one `OFFER_LOCKED` teacher
6. Harder version, because hands are slow — two `curl` processes started from one shell:

```bash
for i in 1 2; do curl -s -o "r$i.json" -w "%{http_code}\n" -X POST "$API/sessions/$SID$i/offer" -H "Authorization: Bearer ${TOK[$i]}" -H 'Content-Type: application/json' -d "{\"teacherId\":\"$TID\"}" & done; wait
```

7. `select count(*) from offers where teacher_id = '<tid>' and status = 'PENDING'` is **1**, every time

## Review checklist additions

- Confirm `updateMany` and not `update`. `update` throws instead of returning a count, and a `try/catch` around `P2025` looks like it works and silently changes the failure mode under load.
- Confirm the `where` carries **both** `userId` and `status`. A `where` on the id alone is an unconditional overwrite and the lock does nothing — and every sequential test still passes.
- Confirm nothing awaits an external service inside the `$transaction` callback: no email, no socket emit, no `fetch`.
- Confirm the affordability read is inside the transaction and before the lock. After it, a broke student leaves a teacher locked for 60 seconds.
- Confirm `releaseTeacherLock` is still empty.
- Confirm the failure path rolls back rather than compensating. A `catch` that sets the teacher back to `ONLINE` by hand is a second lock implementation with worse semantics.
- Read the log for the losing request: it must be a 409 at info level, not an error. Losing a race is the product working.

## Notes

**Why this is the PR the epic is built around.** Everything from 5.4 on assumes the invariant
"a teacher has at most one `PENDING` offer". If step 3 is wrong, a teacher gets two offers,
accepts both, and two students are charged for one person's time — and every test in this
repository still passes, because they all run one request at a time.

**Why READ COMMITTED is enough, in one paragraph so nobody upgrades it.** The dangerous
interleaving is two transactions both reading `status = 'ONLINE'` and both writing. Under
READ COMMITTED, an `UPDATE` takes a row-level exclusive lock; the second `UPDATE` blocks
rather than reading a stale snapshot, and when it resumes it re-evaluates its `WHERE` against
the committed row. It matches zero and reports `count: 0`. `SERIALIZABLE` would also work and
would add retry handling for a problem this does not have.

**Why not an advisory lock, and why not `SELECT ... FOR UPDATE`.** Both work. Both are more
code, and both put the lock in a different place from the state it protects — which means a
future reader has to know about two things to know whether a teacher is available. The
conditional `UPDATE` makes the column its own lock, and §11.3 specifies it.

**Why the offer's TTL is stored and not computed.** `expires_at` is a column, written once from
`OFFER_TTL_SECONDS`. The countdown, the sweep and the accept path all read the same instant. A
TTL recomputed per reader is three clocks.

**What this PR does not do.** No Zoom, no charge, no `ACTIVE`. The session goes to `OFFER_SENT`
and stops. See the epic README, "Where E5 stops".
