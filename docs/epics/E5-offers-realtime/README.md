# E5 — Offers & Real-Time Presence

| | |
|---|---|
| **Depends on** | E4 (4.1–4.7 merged). **Not** on 4.8's verification pass, and **not** on F1/F3 — see "What E5 does not wait for". |
| **Blocks** | E6 (a session cannot start until an offer is accepted), E7 (the wallet charges the session E5 creates), E8 (a review needs an ended session) |
| **Definition of done** | A student presses **Send request** and watches a 60-second countdown. The teacher's dashboard raises the offer with the brief, the price and what they would earn. The teacher accepts and both sides land on the session screen. And when two students pick the same teacher in the same second, **exactly one wins** — the other gets `TEACHER_UNAVAILABLE` and a refreshed list. |

## The problem this epic has to solve

E1 through E4 all solved the same problem: two developers writing one feature in the same
days without editing the same files. Every device in those READMEs — the seam cut, the
shared-file table, the parallelism map, the pre-planned filler — exists for that.

**E5 has one developer, so that problem is gone.** The temptation is to copy the structure
anyway because it is what the last four epics look like. That would be cargo cult. The
honest question is which of those devices were load-bearing for a reason other than two
people, and the answer is: three of them, for reasons that get *stronger* with one
developer, not weaker.

### What is gone

| Device | Why it existed | Status in E5 |
|---|---|---|
| The split table (DEV-A / DEV-B) | Two owners | **Gone.** One owner, every PR |
| The parallelism map | Showing who waits on whom | **Gone.** The order is a straight line |
| Pre-planned filler | Work for whoever is blocked | **Gone.** Nobody is ever blocked by another person |
| "Never two migrations in flight" | Two people generating migrations | **Reduced** to "one migration per PR", which is just hygiene |
| "Announce in chat before touching a shared file" | Warning the other developer | **Gone.** There is nobody to announce to |

### What survives, and why it survives harder

**1. The blocking core PR.** Four-for-four across E1–E4, and E4's retro says stop
re-litigating it. But the *reason* changes. With two people it prevented a merge splice.
With one person it does something else: it forces the contract to be written before the
concurrency is. **E5's entire risk is a race condition**, and a race is designed, not
discovered — you cannot refactor your way to an atomic lock after the fact, because the
bug is invisible in every code path you can read.

**2. The frozen file list.** Not for conflict avoidance any more — for review. One
developer means no second reader, ever. The file list is the only mechanism that will tell
you a later PR reopened something it had no business in, and `git log --oneline -- <file>`
is the only reviewer this epic has.

**3. The contract freeze.** The client and the server are still two consumers of one
contract even when one person writes both. E2 shipped three defects of the class "two
subsystems disagree", and E4 shipped a fourth — §18's ranking criterion, which passed every
unit test it had. Not one of those four was caught by the person who wrote the code. They
were caught by a human running the thing.

**4. The closing verification PR.** More important than in any previous epic, not less.
With two developers, verification was the second look. With one developer it is the
**only** look. E5's acceptance criterion is two browsers, and §18 says so in as many words.

### The risk two developers were hiding

**Nothing in this epic gets reviewed by anybody.** Every defect the last three epics found
at verification — E2's seed-versus-validator disagreement, E2's stale status pill, E4's
inverted ranking — passed review and passed its tests. The reviewer that caught them was a
person running the product.

So the two `human` markers below mean something different than they did in E3 and E4. There,
"human-written" implied a second pair of eyes on the agent's output. Here it means only
"not agent-generated". **Treat 5.9's checklist as the epic's quality gate, not its
paperwork**, and run the two-browser test the day 5.3 merges rather than the day the epic
closes.

## Where E5 stops — the two seams it must not cross

`MVP.md` §12 writes the accept endpoint as "Creates Zoom, charges 2 blocks, `ACTIVE`".
**E5 does none of the first two.** Zoom is E6. `wallet.service.js` is E7, and §17.5 marks it
human-written because a bug there creates or destroys real money.

So the accept transaction in 5.4 is exactly four steps, and the two it does not have are
named in the file rather than left to be inferred:

```js
// server/src/services/offer.respond.service.js — 5.4
//   1. lock the offer row; assert PENDING and not past expires_at
//   2. offer   → ACCEPTED, responded_at = now()
//   3. session → ACTIVE, teacher_id, price_per_block snapshot, started_at, ends_at
//   4. teacher → IN_SESSION, offers_accepted += 1
//
//   [E7] charge the opening block — not here. wallet.service.js does not exist.
//   [E6] create the Zoom meeting  — not here. §12 lists it; E6 owns it.
```

**`ACTIVE` in E5 means "the offer was accepted". It does not mean the meter is running.**
Nothing is charged, `blocks_used` stays 0, `total_charged` stays 0, and `ends_at` is set
from `OPENING_BLOCKS × BLOCK_MINUTES` so that E6 has a real value to extend rather than a
null to special-case. 5.9's retro states this in plain words, the way E4's stated the inert
ranking data — because a session that starts and takes no money looks exactly like a
billing bug to anyone who did not read this paragraph.

**The one money question E5 must still answer** is affordability at offer time. E4 applied a
ceiling when the list was built; between that screen and the **Send request** button the
balance could in principle have moved. 5.3 re-asserts it inside the offer transaction:

```
balance >= pricePerBlock × OPENING_BLOCKS   →   else INSUFFICIENT_CREDIT (402)
```

That is a **read** of `wallets`, not a write, so it needs no wallet service and crosses no
seam. It closes the gap honestly and costs one `SELECT`.

## The shared files, named up front

Same table as the last four epics, kept for review rather than for conflict. The rule column
now answers "may a later PR open this?" rather than "whose is it?".

| File | Rule | Set by |
|---|---|---|
| `server/src/routes/session.routes.js` | **New, and frozen after 5.1.** `POST /sessions/:id/offer` and `GET /sessions/:id`, fully wired — `authenticate`, `authorize`, `validate` — against controllers that throw `NOT_IMPLEMENTED`. | 5.1 |
| `server/src/routes/offer.routes.js` | **New, and frozen after 5.1.** `POST /offers/:id/accept`, `POST /offers/:id/reject`. A second router because §12 puts these on a different mount — see "Why two routers". | 5.1 |
| `server/src/repositories/offer.repository.js` | **New, and frozen after 5.1.** Every query the epic needs, written before any of them is called. The one deliberate gap is the conditional `updateMany` that is the lock itself, which is 5.3's and is the only thing 5.3 may add here. | 5.1 |
| `server/src/repositories/session.repository.js` | **New, and frozen after 5.1.** Session reads and the state transitions. Nothing outside `session.*.service.js` writes `status`. | 5.1 |
| `server/src/sockets/` | **New directory, created in 5.1.** `index.js` (the server and its JWT handshake), `rooms.js` (`user:{userId}`, `session:{sessionId}`), `events.js` (emitters, one function per §13 event). No controller ever calls `io.emit` directly. **5.2 reopened two of them, by decision and not by drift**: `index.js` registers the heartbeat listener, and `events.js`'s `emitTeacherStatus` became a broadcast — 5.1 wrote it to the teacher's own room, which no student can hear, and §13 addresses that event to students. The reasoning is in the emitter's header, where the next person will actually meet it. | 5.1, then 5.2 |
| `server/src/config/constants/session.js` | **E5 owns it, and only 5.1 opens it.** One appended value, `OFFER_STATUS`; the ten already there are not edited and none is re-typed as a literal anywhere in this epic. | 5.1 |
| `server/src/config/constants/index.js` | Not touched. `session.js` is already in the barrel. | — |
| `shared/api.d.ts` | Append-only, one `// ── E5` block, written once in 5.1. The E4 block is not widened and not edited. | 5.1 |
| `shared/socketEvents.js` | **New, and the reason it is in `shared/`** is the reason `errorCodes.js` is: two drifting lists of event names is a silent bug, and the client switches on the same strings the server emits. Append-only, alphabetical. | 5.1 |
| `shared/errorCodes.js` | **Not touched.** `TEACHER_UNAVAILABLE`, `OFFER_EXPIRED`, `SESSION_NOT_ACTIVE`, `INSUFFICIENT_CREDIT` all already exist, with the right statuses. E5 is the first thrower of the first two. | — |
| `server/src/validators/teacher.me.schema.js` | **Not touched, and this is worth a sentence.** `SETTABLE_STATUSES` is `['OFFLINE','ONLINE']` — a teacher may not hand-set `OFFER_LOCKED` or `IN_SESSION`, which is correct. The system writes those two through E5's own repository. | — |
| `server/src/controllers/teacher.me.controller.js` | **E2's, and 5.2 opens it — the one E2 file E5 touches.** §13 says a teacher's own toggle emits `teacher:status`, and a `PATCH` is HTTP: nothing in the socket layer can observe it, so the announcement has to be made where the write is known to have succeeded. Two lines after `res.json`, guarded on the request having said anything about `status`, calling a service. The service, the schema and the repository underneath are untouched, and the endpoint's status codes, payload and validation are what they were. | 5.2 |
| `server/src/repositories/matching.repository.js` | **Not touched.** E4's, frozen since 4.2. E5 writes `rejected_by`; E4 reads it. The write lives in `offer.repository.js`. | — |
| `prisma/schema/*.prisma` | **No migration is planned, and the claim has been checked** — see the eight gaps below, all of which resolve without one. `Offer.status` is the only tempting candidate and the temptation is answered there. | — |
| `prisma/seed/questions.js` | **New in 5.1**, carried from E4's F5. Two `PENDING` demo questions, written as upserts like the rest of the seed. | 5.1 |
| `client/src/router/routes.student.jsx` | One line, one PR: 5.8 replaces the `session/:id` `Placeholder`. E1's retro rule applies — the placeholder's `pr=` is corrected in the PR that replaces it. | 5.8 |
| `client/src/router/routes.teacher.jsx` | One line, one PR: 5.7 replaces the `/teach` index `Placeholder`, which already reads `pr="5.7"`. | 5.7 |
| `client/src/pages/student/ChooseTeacher.jsx` | **E4's, and E5 changes exactly one function body**: `onChoose` stops confirming and starts posting. The signature `({ teacherId, pricePerBlock })` was frozen in 4.7 for this. Nothing else in the file moves. | 5.8 |
| `package.json` (root + workspaces) | **No dependency is planned.** `socket.io`, `socket.io-client`, `node-cron` and `resend` all landed in E0 and are already in the lockfile. If one becomes necessary it is its own one-line PR. | — |

Everything else is suffixed by concern: `session.offer.service.js`, `offer.respond.service.js`,
`presence.service.js`, `offer.expiry.job.js`. **Never one `session.service.js` that four PRs
open.** The suffix rule outlived its original purpose — it was about two people, and it is
now about being able to read `git log --oneline -- <file>` and see one PR.

### Why two routers, and why `/sessions` is not `/questions` again

§12 puts the offer under `/sessions/:id/offer` and the responses under `/offers/:id/*`.
Those are two mounts, so they are two routers appended to `routes/index.js`:

```js
apiRoutes.use('/offers', offerRoutes);      // appended by 5.1
apiRoutes.use('/sessions', sessionRoutes);  // appended by 5.1
```

Both new, both alphabetical, both one line — the append-only rule that has held since 0.4.
E4 needed the two-routers-one-mount trick because §12 spelled matching under `/questions`
and 3.1's router was frozen. Nothing here shares a mount with a frozen router, so E5 does
not need the trick and should not import it.

## What E5 does not wait for

| Item | Blocks E5? | Why |
|---|---|---|
| **4.8** — E4 close + verification | **No** | Nothing in E5 reads its output. E4's code is merged and its seam is frozen. Expect one amendment to this file when the checklist values land. |
| **The `globalRating` defect** | **No** | E5 consumes an *order*, not a score. A wrong order still sends a correct offer. It is a real defect in `matching.scoring.js` and it is not a gate. |
| **The classification outage** | **No, but** | E5's flow starts from a question, and a question on the sentinel is a legal input that E4 already handles. It degrades the demo rather than the epic — which is why 5.1 seeds two `PENDING` questions rather than relying on the classifier being up. |
| **F1** — leaf topics | **No** | E5 reads no topic column. |
| **F3** — nullable `onboarded_at` | **No** | E5 filters on `status`, exactly as E4 does, and on nothing else. |
| **F2** — publish teacher constants | **No** | E5 adds no fifth copy. |

**F1, F2 and F3 are now four epics old.** E4's retro concluded that the missing condition is
not size or ownership but a position in the order table. E5 has one developer and no filler
slot to hide them in, so they are either scheduled into E6 with numbers or they are dead
letters. This epic does not carry them forward a fifth time by writing them down again.

**F5 is different and is absorbed.** Two seeded `PENDING` demo questions make every PR in
this epic runnable without typing a question or spending a Gemini call, and the classifier
is currently down. It lands inside 5.1 rather than as filler, because a blocking PR that
does not make the epic testable is not blocking enough.

## Before anything starts

Unchanged, and it is a prerequisite rather than a nicety, because **every PR in this epic
writes rows**:

1. `npm run db:up` — Postgres 16 on host port **5433**
2. `DATABASE_URL` in the repo-root `.env` points at that container
3. `npm run db:migrate && npm run db:seed`
4. the Neon URL is supplied inline, per command, when production is genuinely meant

One thing E5 adds: **the two-browser test needs two sessions, not two tabs.** A second tab
shares `localStorage` and therefore the same access token, so it is the same student. Use a
private window, or a second browser.

## Order

| # | PR | Size | Depends on | Status |
|---|---|---|---|---|
| 5.1 | [Offer core: frozen routers and repositories, Socket.IO with the JWT handshake, seeded demo questions](PR-5.1-offer-core.md) | **human** · L | E4 | ☑ |
| 5.2 | [Availability heartbeat, `last_seen_at`, `teacher:status` broadcast](PR-5.2-presence-heartbeat.md) | S | 5.1 | ☑ |
| 5.3 | [**`POST /sessions/:id/offer` — the atomic teacher lock**](PR-5.3-atomic-offer.md) | **human** · M | 5.1 | ☑ |
| 5.4 | [Accept / reject, lock release, `rejected_by`](PR-5.4-accept-reject.md) | M | 5.3 | ☑ |
| 5.5 | [Cron: offer expiry + auto-away](PR-5.5-cron-expiry-away.md) | M | 5.3 | ☑ |
| 5.6 | [Email to the teacher on a new offer](PR-5.6-offer-email.md) | S | 5.3 | ☑ |
| 5.7 | [Teacher dashboard — availability toggle + incoming offer modal](PR-5.7-teacher-dashboard.md) | L | 5.2, 5.4 | ☑ |
| 5.8 | [Student awaiting-response state + 60-second countdown](PR-5.8-awaiting-response.md) | M | 5.4 | ☑ |
| 5.9 | [E5 close: verification + retro](PR-5.9-e5-close.md) | S | 5.2–5.8 | ◐ |

**5.9 is closed with two defects filed and six browser/two-machine items scheduled into the
head of E6.** [`RETRO.md`](RETRO.md) carries the recorded output: ten simultaneous pairs,
ten `201`s, ten `409`s, one `PENDING` offer every time. The two defects it found — the
availability pill releasing a live lock, and an inbound offer stamping the teacher's
`last_seen_at` — are each their own PR, and neither was caught by any test in the epic.

§18's numbering is preserved exactly for 5.1–5.8, so the `pr="5.7"` placeholder already in
`routes.teacher.jsx` stays correct. 5.9 is appended, as it was in E2, E3 and E4.

**Two PRs are human-written, and §18 only names one of them.** 5.3 is §18's — the atomic
lock, "test with two browsers". 5.1 is the addition: it carries the Socket.IO handshake,
which authenticates a connection from a JWT, and §17.5 puts auth middleware on the
human-written list. An agent-written handshake that trusts a query parameter is a silent
authentication bypass, and it is exactly the class of bug §17.5 exists for.

**Land 5.3 and run its two-browser test the same day.** Not at 5.9. The whole epic's design
rests on that `rowCount` check, and everything from 5.4 on assumes it holds.

## The eight gaps between the spec and the database, resolved

`MVP.md` §12 and §13 were written before the schema in places, and §11.3's SQL is Postgres
rather than Prisma. These were checked against `prisma/schema/*.prisma` and the migration
SQL as they stand at `1962bbd`, and **none of them needs a migration.**

**1. `Offer.status` is a `VarChar(20)`, not an enum — and it stays one.**
`SessionStatus` and `TeacherStatus` are Postgres enums; `Offer.status` is a string with a
comment listing `PENDING|ACCEPTED|REJECTED|EXPIRED`. Making it an enum for consistency costs
a migration and buys no behaviour: the four values become `OFFER_STATUS` in
`constants/session.js`, a Zod enum on the way in, and the same catalogue on both sides. The
init migration made a choice and re-making it mid-epic is churn.

**2. `OFFER_LOCKED` and `IN_SESSION` already exist and have never been written.**
Both are in `TeacherStatus`. E2's `SETTABLE_STATUSES` is `['OFFLINE','ONLINE']`, so a
teacher cannot hand-set either — correct, and deliberate. **E5 is the first writer of both,
through its own repository, and opens no E2 file to do it.**

The consequence worth noticing: **E4's first hard filter is `status = 'ONLINE'`**, so a
locked teacher leaves the candidate pool for free. E5 adds no exclusion, writes no new
filter, and the "show me more teachers" button on E4's screen starts doing something real
the moment offers exist.

**3. The student holds a question id; the endpoint takes a session id.**
`QuestionResponse.sessionId` already carries it (`shared/api.d.ts:344`) and E4's screen
already loads that payload. No lookup endpoint, no route change, no second fetch. This was
designed in E4 — its README says so — and it holds.

**4. `rejected_by` lives on `questions`, and the rejecter holds an offer id.**
The walk is offer → session → question. `matching.repository.js` is E4's frozen reader of
that column; **E5 writes it from `offer.repository.js`** rather than unfreezing E4's file.
Two notes carried from 4.2: it is `[]` and never null for every existing row, and Prisma's
array append is `push`, which is a `set` under the hood — read, append, write inside the
same transaction as the reject, or two rejections in the same second lose one entry.

**5. `idx_offers_pending` and `idx_sessions_active` already exist. 5.5 adds neither.**
Both landed in `20260810113433_init`:

```sql
CREATE INDEX "idx_offers_pending"  ON "offers"("expires_at")  WHERE "status" = 'PENDING';
CREATE INDEX "idx_sessions_active" ON "sessions"("status")    WHERE "status" = 'ACTIVE';
```

They are deliberately absent from `sessions.prisma` — Prisma cannot express a partial index,
and declaring the full one instead makes every later `migrate dev` emit a `CREATE INDEX` for
a name that already exists. The models carry comments saying exactly that. This is the same
trap 4.2 was warned about, and 4.2 avoided it by measuring with `EXPLAIN` first. 5.5 does
the same.

**6. The cron is a sweeper, not the source of truth.**
`node-cron` runs in-process, and Render's free plan spins the instance down after ~15
minutes without a request. **A cron job on a sleeping instance does not run.** An offer that
expired at 14:02 may still read `PENDING` at 14:40 because nothing was awake to sweep it.

So expiry is evaluated **lazily as well as swept**: every read of an offer treats
`expires_at < now()` as `EXPIRED` regardless of what the column says, and the accept path
asserts it inside the transaction. The cron exists to emit `offer:expired` to a connected
teacher and to release the lock, which is a *notification* problem, not a correctness one.
Correctness must not depend on a process that is allowed to be asleep.

The same reasoning covers a second instance double-firing the sweep. There is one instance
today, the sweep is idempotent because it is a conditional `updateMany`, and this is written
down so nobody discovers it during a scale-up.

**7. §13 lists four cron jobs and only two are E5's.**
Offer Expiry and Auto-Away are E5's. **Block Warning and Session Auto-End are E6's** — both
read `ends_at` as a live billing deadline, and nothing in E5 charges a block or moves that
value after the accept. Writing all four now would be writing two jobs against a meter that
does not run.

**8. `AUTO_AWAY_WARNING_MINUTES` needs a socket, not a cron.**
§10 wants a "Still there?" modal at 55 minutes and an auto-`OFFLINE` at 60. The 60 is the
cron's. The 55 is a `teacher:status`-adjacent event to one connected user, and it is 5.2's,
because 5.2 owns `last_seen_at` and is the only PR that knows what "activity" means. Both
constants already exist in `constants/session.js`.

**Amended when 5.2 landed: the 55-minute warning is 5.5's, not 5.2's.** 5.2 has no clock.
Firing the warning from the heartbeat path means either a per-socket timer — which a
heartbeat resets, so on an open dashboard it never fires — or reading `last_seen_at` to
decide, which 5.2's own review checklist forbids for the reason that two readers of a
freshness rule drift. 5.5 already sweeps on `last_seen_at` every `CRON_TICK_SECONDS` and
already holds the one reader; the warning is the same query with a different threshold and
an emit instead of an update. **5.5 owns both numbers**, and the event is still
`teacher:status` carrying the teacher's *current* status, exactly as §10 asked — the client
decides that "you are still ONLINE and we are asking" is a modal.

**Amended again when 5.5 landed: the warning is nobody's yet, and that is now written
down rather than assigned.** The amendment above says 5.5 owns both numbers.
`PR-5.5-cron-expiry-away.md` scopes two jobs, names neither
`AUTO_AWAY_WARNING_MINUTES` nor a warning, and has no acceptance criterion for one —
the two documents disagree, and 5.5 implemented the brief. The blocker is not the
query, which is the same sweep with a different threshold: it is that `SOCKET_EVENTS`
is append-only and has no name that carries "you are still `ONLINE` and we are asking".
`teacher:status` with an unchanged status is an event that tells a client nothing
changed, which is not a modal trigger — it is a no-op every existing handler already
ignores. So the warning needs a seventh event name, and appending one is a contract
change rather than a job. **It is E6's or its own small PR, and `AUTO_AWAY_WARNING_MINUTES`
stays an unused constant until then.**

### A ninth gap, found while implementing 5.3: `expectedEarning` has no backing read

**Blocks 5.6 and 5.7. Does not block 5.4 or 5.5.**

`IncomingOffer.expectedEarning` is the teacher's cut after §5.3's commission, and
`platformFeeRate` needs `teacher_profiles.created_at` to know whether the new-teacher
exemption applies. **No read reachable from E5 returns that column.** `TEACHER_VIEW`
excludes it by explicit design — `teacher.repository.js`'s header lists the columns it
refuses to select — and both session reads are about the session. 5.4's
`findSessionForView` has the same hole, so this is not a 5.3 oversight; it is a gap in the
contract freeze that nobody would have found until an email rendered a wrong number.

5.3 shipped inside its permitted file list rather than unfreezing a repository, so
`feeRateFor` in `session.offer.service.js` currently resolves to `0` for everybody and
`expectedEarning` is the **gross**. Nothing in 5.3 renders it — the field reaches no screen
until 5.6 and 5.7 — and `offer.send.test.js` pins the current value in a test named for the
defect, so the correction breaks a build rather than passing silently.

**The fix is one function, as its own small PR before 5.6:** a teacher read owned by E5, in
`session.repository.js`, returning the card columns plus `createdAt`. That is the procedure
that file's own header prescribes for a query discovered missing, and it is written here
rather than left as a `TODO` for the same reason the other eight are written down.

**Closed in 5.6, inside that PR rather than before it.** `findTeacherForNotification` is the
function — `session.repository.js`, and the epic's second deliberate reopen of a frozen file.
Two departures from the paragraph above, both by decision and both in 5.6's description:

- **Not its own PR.** The diff is the same either way, this epic has one developer, and a
  repository function whose only callers are in the same PR reviews better beside them than
  a week earlier. The reopen was planned in writing here first, which is the part that
  mattered — it is the difference between the freeze working and the freeze eroding.
- **Narrower than "the card columns plus `createdAt`".** It returns `createdAt` and the
  teacher's address, and nothing else. The card columns are already in hand at the call site
  from `findTeacherById`; re-reading them would be a second answer to `pricePerBlock` on the
  same request, free to disagree with the value the transaction wrote to
  `sessions.price_per_block`.

The address is the second half of the gap and this document did not predict it: **no read in
E5 returned `users.email` either**, and an email needs somewhere to go. `TEACHER_VIEW`
refuses it by explicit design, which is right for a serializer feeding a browser and is why
the notification read is E5's own rather than an amendment to E2's.

`offer.send.test.js`'s pinned test now asserts the net, and three tests beside it pin the two
free cases and the failure fallback. The clock in them is fixed on purpose: §5.3's low-demand
window is `[6, 14)` in `TIMEZONE`, so an unpinned commission test asserts the gross every
morning and the net every afternoon — the first run of that block failed at 12:17 for exactly
that reason.

### A tenth gap, found while implementing 5.4: the session has no way back to `PENDING`

**Resolved inside 5.4, as a deliberate reopen of a frozen file.**

`session.repository.js` wrote sessions forwards only — `setSessionOfferSent`
(`PENDING` → `OFFER_SENT`) and `setSessionActive` (`OFFER_SENT` → `ACTIVE`). §10's
diagram has an arrow back, which is what a reject is, and **no function could make it.**
Without one a rejected session stays at `OFFER_SENT`, where `session.offer.service.js`'s
`PENDING` assertion refuses every future **Send request**: the student's question is
stuck for good, by a teacher declining it.

The file's own header prescribes "a note in the epic README and its own small PR" for a
query discovered missing. 5.4 added `setSessionPending` itself instead, because the diff
is the same twelve lines either way and this epic has one developer, so a separate PR
would buy a second reader who does not exist. **It is the only function 5.4 added to that
file**, alongside `releaseTeacherLock`'s body, which was 5.4's by the freeze. `git log
--oneline -- server/src/repositories/session.repository.js` is the mechanism that will
say so, and it now names three PRs rather than two.

It clears `teacher_id` and `price_per_block` with the status, because a session that
reads `PENDING` while still naming a teacher is a row two readers disagree about — and
`GET /sessions/:id` decides who may see what from `teacher_id`.

**Two smaller notes from the same PR.**

`markOfferResponded` stamps `responded_at`; `expirePendingOffersBefore` (5.5's) sets it
to `null`. 5.4's late-answer sweep uses the former, because it is the only writer in the
frozen `offer.repository.js` that takes a `tx`, so **the same expired offer ends up with
a different row depending on which path noticed it died.** Nothing renders the column
yet. Whoever next opens that file legitimately reconciles it — either 5.5 stops nulling,
or an `expireOffer(offerId, tx)` joins the repository.

`GET /sessions/:id` answers a student's own session that has no offer row with the
`OfferResponse` shape and `null` in every offer-derived field, rather than a `404`. A
session with no offer is what every question looks like before E4's screen is used, and
`shared/api.d.ts` is frozen at 5.1 so there is no type for it. **This is a deviation
from the contract's types, and it is written here and in 5.4's PR description rather
than left for 5.8 to meet at runtime.**

### An eleventh gap, found in verification: a teacher who walks out of an `ACTIVE` session

A teacher accepts, the session goes `ACTIVE`, and the teacher logs out or closes the
browser. Nothing in E5 notices. The session stays `ACTIVE` for ever, the teacher stays
`IN_SESSION`, and no screen tells the student that the person they are waiting for has
gone.

**No money is at risk today, and that is the only reason this ships.** E5 charges
nothing — 5.4's accept moves state and calls no wallet service, which is itself a
recorded deviation from §12 — so a student cannot yet pay for a lesson nobody attended.
The moment E7 charges the opening block on accept, this becomes a refund path rather
than a cosmetic gap.

What it needs, and where it belongs:

- **E6** owns the session screen and the meter. A teacher whose last socket disappears
  mid-session is a `session:*` event and a message on the student's screen, and E6 is the
  epic that has a screen to put it on.
- **§10's no-show window is already in the constants** — `NO_SHOW_WINDOW_SEC` is 60 —
  and it is the product's answer to "the other side never showed up". Nothing reads it
  yet.
- The presence fix on top of 5.8 deliberately **does not** touch `IN_SESSION`:
  `setTeacherOffline` moves a teacher only from `ONLINE`, so a walked-out session still
  reads `IN_SESSION` and E6 inherits an honest row rather than one this fix quietly
  cleaned up.

Recorded here rather than fixed here, because a fix without E6's screen is a state
change nobody can see.

## Contract freeze

Agreed before 5.2 starts. Appended to `shared/api.d.ts` in 5.1 as one `E5` block. Changing
any of it afterwards is a note in the PR **before** the code.

```ts
// ── E5 ──────────────────────────────────────────────────────────────────────

/** `PENDING` until the teacher answers or the clock runs out. */
export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

/**
 * What the student's awaiting screen renders, and what `POST /sessions/:id/offer`
 * answers with.
 *
 * **`expiresAt` is absolute and server-issued.** The countdown is computed from it
 * on every tick rather than from a client-side `setTimeout` seeded once: a phone
 * that sleeps for thirty seconds must wake up showing the right number, and a
 * client clock that is two minutes fast must not expire the offer early.
 */
export interface OfferResponse {
  offerId: string;
  sessionId: string;
  status: OfferStatus;
  /** ISO 8601, UTC. `createdAt + OFFER_TTL_SECONDS`. */
  expiresAt: string;
  teacher: TeacherCard;
  /** The price snapshotted onto the session, in credits per block. */
  pricePerBlock: number;
}

/**
 * One row in the teacher's incoming-offer modal — §13's `offer:new` payload,
 * and the shape `GET /sessions/:id` answers with for the teacher's side.
 *
 * `brief` is E3's `teacher_brief`, which is the student's own words when the
 * classifier fell back. It is shown, never re-summarised here.
 */
export interface IncomingOffer {
  offerId: string;
  sessionId: string;
  brief: string;
  topicLabel: string | null;
  level: number | null;
  /** What this offer is worth to the teacher after §5.3's commission. */
  expectedEarning: number;
  expiresAt: string;
}
```

### The socket contract — not in `api.d.ts`, and frozen just as hard

`shared/socketEvents.js`, for the reason `shared/errorCodes.js` exists: the client switches
on the strings the server emits, and two drifting lists is a silent bug that no type checker
in this repo would catch.

```js
export const SOCKET_EVENTS = {
  // server → client
  OFFER_NEW: 'offer:new',
  OFFER_EXPIRED: 'offer:expired',
  OFFER_ACCEPTED: 'offer:accepted',
  OFFER_REJECTED: 'offer:rejected',
  TEACHER_STATUS: 'teacher:status',
  // client → server
  TEACHER_HEARTBEAT: 'teacher:heartbeat',
};
```

§13 lists five more — `session:block_warning`, `session:extended`, `session:ended`,
`session:join`, `wallet:updated`. **E5 appends none of them.** Every one belongs to a
subsystem that does not exist: three to E6's meter, one to E7's wallet. Appending them now
would be five names nothing emits, which is how a catalogue stops being trustworthy.

**Rooms are `user:{userId}`, and E5 uses no other.** `session:{sessionId}` is §13's and it
is E6's, because the only events addressed to it are E6's. A room nothing joins is a room
that will be joined wrongly later.

**The handshake authenticates or refuses.** No anonymous socket, no "connect first and
authenticate on the first message". The JWT comes from the handshake auth payload, is
verified with the same code path `authenticate` uses, and a failure disconnects rather than
downgrading. This is the human-written half of 5.1.

## Deliberate deviations from `MVP.md` §18

| MVP said | We do | Why |
|---|---|---|
| 8 PRs (5.1–5.8) | 9 — a closing verification PR appended | Four-for-four in E1–E4. §18 has never had one. |
| 5.1 "Socket.IO setup + JWT handshake + rooms" | Same, **plus** the frozen routers, both repositories and the seeded questions | The blocking-core-PR pattern, and a blocking PR that leaves the epic untestable is not blocking enough. The classifier is currently down, so two seeded `PENDING` questions are the difference between a runnable epic and a stalled one. |
| Only 5.3 marked human-written | 5.1 **and** 5.3 | §17.5 puts auth middleware on the human-written list, and a socket handshake is auth middleware. An agent-written handshake that trusts a query parameter is a silent bypass. |
| 5.4 accept "creates Zoom, charges 2 blocks" (§12) | Accept moves state and **charges nothing, creates nothing** | Zoom is E6, `wallet.service.js` is E7 and §17.5 marks it human-written. Both absences are named in the file, and `ACTIVE` in E5 means "accepted", not "metered". |
| §9.1's wallet check happens at match time | **Re-asserted at offer time**, as a read | Closes the gap between the list being built and the button being pressed, with one `SELECT` and no wallet service. |
| §13's four cron jobs | Two — offer expiry and auto-away | The other two read `ends_at` as a billing deadline. Nothing in E5 moves it. |
| §13's ten socket events | Five, plus one client → server | The other five belong to E6's meter and E7's wallet. A catalogue of names nothing emits is worse than a short catalogue. |
| Cron as the expiry mechanism | Cron **plus** lazy evaluation on every read | Render's free plan sleeps the instance, and a sweeper that is allowed to be asleep cannot be the source of truth. |
| `Offer.status` implied as an enum | Left a `VarChar(20)`, validated by constant and Zod | A migration for zero behaviour change. |
| A `/app/session/:id/awaiting` route | **No new route.** 5.8 renders the awaiting state at `/app/session/:id` | §14.1 has no awaiting screen, and E4's own rule applies: a route invented in one epic is a route the next has to honour or rename. `OFFER_SENT` is a state of the session screen, and E6 adds the `ACTIVE` state to the same file. |
| Pre-planned filler | None | One developer. Nobody is blocked, so filler has nothing to absorb. F1–F3 are scheduled into E6 or dropped, per E4's retro. |

## Risks

- **The lock is the epic, and it is invisible in review.** `UPDATE teacher_profiles SET
  status='OFFER_LOCKED' WHERE user_id = $1 AND status = 'ONLINE'` is correct only if the
  `rowCount` is checked and the whole thing is inside one transaction. In Prisma that means
  **`updateMany`, not `update`** — `update` throws when it matches nothing and gives you no
  count, and `updateMany` returns `{ count }`, which is the `rowCount` §11.3 is asking for.
  Under Postgres's default READ COMMITTED, the second transaction blocks on the row until
  the first commits, then re-evaluates its `WHERE` and matches zero. That is the whole
  mechanism, it is four lines, and no test that runs requests in sequence exercises it.
  **Two browsers, the day 5.3 merges.**

- **Nothing in this epic is reviewed by a second person.** Every defect E2, E3 and E4 found
  at verification passed review and passed its tests. 5.9 is not paperwork.

- **`ACTIVE` sessions that charge nothing look like a billing bug.** Same failure mode as
  E4's inert ranking data: the design is right, the demo is confusing, and somebody files
  it. 5.4 says so in the file and 5.9 says so in the retro.

- **The countdown will lie if it is a `setTimeout`.** Phones sleep, tabs throttle background
  timers to once a minute, and client clocks are wrong. The contract issues `expiresAt` as
  an absolute instant for exactly this reason, and the screen recomputes from it every tick.
  A countdown seeded once from a duration is the single most likely bug in 5.8.

- **The email must not be able to fail the offer.** `RESEND_API_KEY` and `EMAIL_FROM` are
  optional in `env.js` and blank on Render today. 5.6 is a side effect of a committed
  transaction, never a step inside it, and a missing key logs and continues — the same shape
  E3's classifier fallback has, and for the same reason. An offer that 500s because an email
  provider is down is a worse product than an offer with no email.

- **Auto-away can log a teacher out mid-offer.** The 60-minute sweep sets `ONLINE` →
  `OFFLINE`, and a teacher with a `PENDING` offer is `OFFER_LOCKED`, not `ONLINE`, so the
  sweep must not touch them. It is one predicate and it is easy to leave out.

- **A rejected offer must return the teacher to `ONLINE`, not to whatever they were.** If
  they went offline while the offer was open, the release still writes `ONLINE` unless the
  release is written as a conditional update from `OFFER_LOCKED`. Same shape as the lock,
  same failure if the condition is dropped.

- **Two offers on one session.** The student's screen has a **Send request** button per
  card and E4 disables the others while one is in flight — but a reload re-enables them.
  `POST /sessions/:id/offer` must reject when the session is not `PENDING`, which is the
  `SESSION_NOT_ACTIVE` E4 already returns from matching for the same reason.

---

## Checklist before writing the PR briefs

- [x] Every PR has exactly one owner — trivially, and the section on what that costs is written
- [x] The shared-file table says, per file, whether a later PR may open it
- [x] Human-written items from `MVP.md` §17.5 are marked — 5.1's handshake and 5.3's lock
- [x] Each PR has an allowlist and a denylist
- [x] Each PR has acceptance criteria a human can check in under five minutes
- [x] There is a closing verification PR, and it is described as the epic's only review
- [x] No migration is planned, and the claim has been checked against the schema
- [x] The two seams E5 must not cross are named in the file, not just in the epic
