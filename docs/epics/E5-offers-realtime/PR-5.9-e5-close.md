# PR 5.9 — E5 close: verification + retro

| | |
|---|---|
| **Epic** | E5 — Offers & Real-Time Presence |
| **Owner** | DEV-B (rotem) |
| **Size** | S |
| **Written by** | Agent for the write-up. **The pass itself is run by a human**, on two machines. |
| **Depends on** | 5.2–5.8 merged |
| **Blocks** | E6 |
| **Branch** | `dev-b/E5.9-e5-close` |

## Contract implemented

None. This PR verifies the epic's definition of done end to end and writes `RETRO.md`.

## Scope

Run the checklist against a **local database** (`npm run db:up`, root `.env` on 5433, seeded),
then the read-only half against the deployed Vercel + Render pair.

**This epic's close is different from the last four, and the difference is the whole point.**
E1 through E4 alternated the closing PR between two developers so that the person writing the
retro was not the person whose code was being described. E5 has one developer, so that device
is gone and nothing replaces it. **This checklist is the only review any code in this epic
receives.** Treat it accordingly: E2's three contract defects, E4's inverted ranking — every
one passed review and passed its tests, and every one was found by a human running the product.

Two things make this pass different from E4's, and both are setup:

1. **It needs two browsers throughout, not two tabs.** A second tab shares `localStorage` and
   is therefore the same user. Use a private window or a second browser. Half the items below
   are meaningless otherwise.
2. **The pass writes rows and some of them cannot be undone by an `UPDATE`.** Offers and
   sessions accumulate. Everything is local, and the reset is `npm run db:seed` after
   truncating `offers` — write that down as a ledger entry like E4 did, rather than leaving a
   database nobody can re-run the pass against.

### The checklist

**Flow — the definition of done**
- [ ] `/health` green before starting
- [ ] Student → question → teacher list → **Send request** → awaiting screen with a live countdown
- [ ] Teacher's dashboard raises the modal within a second, with the brief, the level and the earning
- [ ] Teacher accepts → both sides land on `/app/session/:id` and `/teach/session/:id`, both honestly placeheld by E6
- [ ] Teacher declines → the student recovers, and the returned list is one teacher shorter
- [ ] Nobody answers → both sides resolve at zero on their own

**The lock — §11.3-A and the epic's acceptance criterion**
- [ ] **Two students, two browsers, one teacher, simultaneously → exactly one `201`, the other `TEACHER_UNAVAILABLE`.** Ten runs, recorded
- [ ] The same with two concurrent `curl` processes. `select count(*) from offers where teacher_id = ... and status = 'PENDING'` is **1**, every time
- [ ] The loser's session is still `PENDING` — nothing half-written
- [ ] The loser's screen says "someone got there first" and re-runs the list; it is not styled as an error
- [ ] An `OFFLINE` teacher and an `OFFER_LOCKED` teacher both → `TEACHER_UNAVAILABLE`
- [ ] `DEBUG=prisma:query`: the `UPDATE teacher_profiles` is inside one `BEGIN`/`COMMIT`, with no external call between them

**Release — the lock from the other side**
- [ ] Accept → teacher `IN_SESSION`; reject → teacher `ONLINE`; expiry → teacher `ONLINE`
- [ ] A teacher who went `OFFLINE` mid-offer is **still `OFFLINE`** after rejecting it
- [ ] `rejected_by` gains the id on a reject and **does not** on an expiry
- [ ] Two rejects in quick succession both land — no lost array entry

**Expiry — and the sweeper that is allowed to be asleep**
- [ ] An offer past `expires_at` is `EXPIRED` within two ticks, with both sockets notified
- [ ] Accepting an offer whose `expires_at` has passed → `OFFER_EXPIRED` **even when `status` still reads `PENDING`**, and that call releases the teacher
- [ ] Stop the server for two minutes mid-offer, restart, then accept. Still `OFFER_EXPIRED`, still tidy
- [ ] An empty tick logs nothing

**Presence**
- [ ] Heartbeat moves `last_seen_at`; ten beats produce at most one extra write
- [ ] `last_seen_at` older than 60 minutes on an `ONLINE` teacher → swept `OFFLINE`
- [ ] The same on an `OFFER_LOCKED` teacher and on an `IN_SESSION` teacher → **not swept**
- [ ] A teacher with `last_seen_at` null → not swept
- [ ] **F4:** the header pill updates on the teacher's own toggle and on a server-side lock, both without a navigation

**The countdown, which is where the client lies if it is going to**
- [ ] Background the teacher's tab 30 seconds → the modal's countdown is still correct
- [ ] Same on the student's awaiting screen
- [ ] Reload the awaiting screen at second 30 → roughly 30 seconds, not 60 and not blank
- [ ] Kill the student's network for the last 20 seconds → the screen still resolves at zero
- [ ] At zero, **no request is sent** by either side

**Money that E5 does not touch — state it, do not imply it**
- [ ] After an accept: `blocks_used` is `0`, `total_charged` is `0`, and no `wallet_transactions` row exists
- [ ] The student's balance is unchanged by a complete offer-accept cycle
- [ ] Confirm in the retro, in words: `ACTIVE` in E5 means "accepted", not "metered"; the charge is E7's and the Zoom is E6's

**Boundaries**
- [ ] Another student's session id → `NOT_FOUND`, never `FORBIDDEN`
- [ ] Another teacher's offer id → `NOT_FOUND`
- [ ] A student calling accept → `FORBIDDEN`; a teacher calling the offer endpoint → `FORBIDDEN`
- [ ] No token on any of the four routes → `UNAUTHORIZED`
- [ ] `GET /sessions/:id` as a third party → `NOT_FOUND`, leaking nothing
- [ ] A socket with no token, an expired token and a tampered token are each **refused**
- [ ] A connected socket is in `user:{its own id}` and no other room

**Performance and logs**
- [ ] `POST /sessions/:id/offer` issues a constant number of SQL statements — `DEBUG=prisma:query`, not by reading the code
- [ ] `EXPLAIN` on the expiry query, recorded; `idx_offers_pending` used or the sequential scan confirmed. **No `CREATE INDEX` in the epic's diff**
- [ ] The `201` is not delayed by the email — measured with the provider unreachable
- [ ] With `RESEND_API_KEY` unset, the whole flow still works
- [ ] Server logs carry no JWT, no API key, no student raw text at info level, no wallet balance
- [ ] Both screens usable at 375px, `scrollWidth === clientWidth`

**Two machines**
- [ ] The lock test above, run from two physical machines rather than two browsers
- [ ] The deployed pair runs the read-only half, with a real cold start timed and recorded
- [ ] **Sockets work through Render** — confirm the connection upgrades and survives, and record what transport it settled on

### `RETRO.md`

Same shape as E1's through E4's. Answer the questions this epic inherits, with what the
repository and the deployed pair actually did:

1. **Did the freeze hold a fifth time, with nobody to conflict with?** `session.routes.js`,
   `offer.routes.js` and both repositories were frozen at 5.1 with two named gaps. Did any
   later PR open them beyond those two function bodies? The point of the answer is whether the
   discipline survives when its original justification — two developers — is gone.
2. **Did the E4 seam work?** 4.7 froze `onChoose({teacherId, pricePerBlock})` and argued a
   callback beats a route because E5 replaces one function body in a file it owns. Was 5.8's
   diff to `ChooseTeacher.jsx` really just that body and the dead modal? If it was more, the
   argument was wrong and E6 should stop repeating it.
3. **What did one developer cost?** No PR in this epic was read by a second person. Count the
   defects the checklist found and say honestly whether any of them would have been caught by
   review. This is the epic's most useful finding and it is the one nobody else can write.
4. **Did the lock hold under real concurrency?** Not "did the tests pass" — how many
   simultaneous runs, from how many machines, with what result. Paste the counts.

Then the parts only running the thing can tell you: the measured latency of the offer endpoint,
what the countdown did on a real phone, whether the 60-second TTL felt right, whether the
recovery loop after a decline is a product or a dead end, and any contract two subsystems
disagree about.

Close by listing what carries into E6, and **say explicitly which E5 behaviour is inert until
E6 and E7 land** — the charge, the Zoom link, `blocks_used`, and every `ends_at` extension — so
that the first person who accepts an offer and gets a free session does not file the design as
a bug. E4's retro had to do exactly this for the ranking data; this is the same obligation.

Also record the state of the E4 debts this epic inherited: the `globalRating` smoothing defect,
the classification outage, and 4.8's untranscribed checklist values.

## Files you may touch

```
docs/epics/E5-offers-realtime/RETRO.md         new
docs/epics/E5-offers-realtime/README.md        tick the boxes, correct anything the epic disagrees with
docs/DEPLOYMENT.md                             only if the pass found something wrong with it — sockets through Render is a candidate
```

## Files you must NOT touch

```
server/**                                      a defect found here is its own small PR
client/**                                      same
prisma/**                                      same — including the seed
shared/**                                      same
```

## Acceptance criteria

- [ ] Every box above is either ticked with its recorded output, or marked not-run **with the reason and the plan for running it in the same sentence**
- [ ] `RETRO.md` exists and answers all four questions with evidence, not adjectives
- [ ] `README.md`'s PR table is fully ticked
- [ ] The diff contains no source change
- [ ] The concurrency result is a **number of runs and a count**, not the word "verified"

## Manual test

The checklist above **is** the manual test. Record the actual output — the status codes, the
row counts, the statement counts, the timings — not a tick. E2's retro is readable a month
later because it quotes `{"status":"ok","db":"ok","uptime":491}` and "7 for 1, 5 and 20 rows".
E4's is readable because it quotes `Gil ≈ 0.793 against Dana ≈ 0.765`. For this epic the
equivalent is the lock: **"ten simultaneous pairs, ten `201`s, ten `409`s, one `PENDING` offer
every time"** is a sentence that means something in six months.

## Review checklist additions

- An unexplained "not run" is how E2 closed provisionally. It has not happened since and does not happen here.
- A defect found during the pass is filed and fixed in its own PR. This PR changes no source.
- The retro states the no-money problem in plain words. A passing check must not be left to imply that an accepted offer took payment.
- The one-developer question is answered honestly, including if the answer is "it cost nothing".

## Notes

**Why the lock section is the one that matters.** Everything else in this epic has a test.
"Two students, one teacher, exactly one wins" is a promise `MVP.md` §18 makes as the epic's
acceptance criterion, it is implemented in four lines, and **no test in this repository
exercises it**, because they all run one request at a time. It is only observable by two
people clicking at once, or by two processes started from one shell.

**Why 5.3's two-browser test is run twice.** Once the day 5.3 merges — the brief says so — and
again here, from two machines, after 5.4 through 5.8 have piled seven PRs of behaviour on top.
The first run proves the transaction; the second proves nothing since has undermined it.

**Sockets through Render is a real unknown.** Nothing before this epic opened a persistent
connection to the deployed API. The free plan, the proxy and the ~50-second cold start have
never been tested against a WebSocket upgrade, and a fallback to long-polling is a plausible
outcome that would work but should be *known* rather than discovered during a demo. Record the
transport, and if `DEPLOYMENT.md` needs a paragraph, this is the PR that writes it.
