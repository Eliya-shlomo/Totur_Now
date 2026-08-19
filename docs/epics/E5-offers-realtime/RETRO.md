# E5 — Retro

| **Closed** | 2026-08-19 |
| **Verified by** | Rotem (DEV-B), local database, one machine |
| **Result** | ◐ **Closed with two defects filed and the two-machine half not run.** Everything a single machine can prove is proved below with its output; the browser half and the deployed half are named at the bottom with the reason and the plan in the same sentence |

E5 is the first epic in this project with one developer. Its closing PR was written to be
the only review any code in the epic receives, and it found two defects. Both are recorded
here with reproductions, both are filed as their own PRs, and this PR changes no source.

## The lock — the epic's acceptance criterion

`MVP.md` §18 promises that when two students pick the same teacher in the same second,
exactly one wins. It is implemented in four lines and no test in this repository exercises
it, because they all run one request at a time.

Two students, two OS processes, each spin-waiting on a shared `date +%s%N` deadline and
firing `POST /sessions/:id/offer` at the same nanosecond. A fresh question and session per
student per run. The lock released between runs through the real reject route.

    run | A    | B    | PENDING  | teacher       | loser session
      1 | 201  | 409  | 1        | OFFER_LOCKED  | PENDING
      2 | 409  | 201  | 1        | OFFER_LOCKED  | PENDING
      3 | 201  | 409  | 1        | OFFER_LOCKED  | PENDING
      4 | 409  | 201  | 1        | OFFER_LOCKED  | PENDING
      5 | 409  | 201  | 1        | OFFER_LOCKED  | PENDING
      6 | 409  | 201  | 1        | OFFER_LOCKED  | PENDING
      7 | 409  | 201  | 1        | OFFER_LOCKED  | PENDING
      8 | 409  | 201  | 1        | OFFER_LOCKED  | PENDING
      9 | 201  | 409  | 1        | OFFER_LOCKED  | PENDING
     10 | 409  | 201  | 1        | OFFER_LOCKED  | PENDING

    RESULT: 10 runs | exactly-one-winner: 10 | anomalies: 0
            wrong PENDING count: 0 | loser session not PENDING: 0

**Ten simultaneous pairs, ten `201`s, ten `409`s, one `PENDING` offer every time.** The
winner alternated — A took four, B took six — so the order is decided by the race and not by
which process started first. The loser's session was still `PENDING` after all ten: nothing
half-written.

The loser's body, identical in all ten:

    {"success":false,"error":{"code":"TEACHER_UNAVAILABLE",
     "message":"That teacher is no longer available. Here are others.","details":null}}

It is not styled as an error and it names the recovery.

The transaction, read from `DEBUG=prisma:query` rather than from the source:

    BEGIN
    UPDATE "teacher_profiles" SET "status" = CAST($1::text AS "teacher_status")
      WHERE ("user_id" = $2 AND "status" = CAST($3::text AS "teacher_status"))
    INSERT INTO "offers" ("session_id","teacher_id","status","expires_at","created_at") ...
    UPDATE "sessions" SET "status" = ..., "teacher_id" = $2, "price_per_block" = $3
      WHERE ("id" = $4 AND "status" = CAST($5::text AS "session_status"))
    UPDATE "teacher_profiles" SET "offers_received" = ("offers_received" + $1) ...
    COMMIT

Four statements in one `BEGIN`/`COMMIT`, both writes that matter carrying their predicate in
the `WHERE`, and no external call between them — the email and the socket emit are both
outside. That is §11.3-A as written.

**What is still owed: two browsers and two machines.** Two processes on one host share a
kernel and a loopback interface. The result above is strong evidence and it is not the same
experiment as two people clicking.

## Did the freeze hold a fifth time, with nobody to conflict with?

**Four of the five frozen files: yes, absolutely.**

    $ git log --oneline main -- server/src/routes/session.routes.js \
                                server/src/routes/offer.routes.js
    87099b3  feat(offers): E5 core — frozen routers, repositories, Socket.IO handshake (PR 5.1)

Both routers appear in 5.1 and nowhere else. `offer.repository.js` is the same — and more
than that, **the one gap the README permitted it was never used.** The table reserved 5.3's
conditional `updateMany` for that file; 5.3 put the lock in `session.repository.js` instead,
by filling a body 5.1 had already frozen:

    -  throw AppError.notImplemented('lockTeacherForOffer');
    +  const { count } = await tx.teacherProfile.updateMany({
    +    where: { userId: teacherId, status: 'ONLINE' },
    +    data: { status: 'OFFER_LOCKED' },
    +  });

That is not a reopen. That is the freeze working exactly as designed: signature at 5.1, body
at 5.3, no negotiation.

**`session.repository.js` took four commits after the freeze, and three of them were
written down first.**

    3ba2fd8  5.3  lockTeacherForOffer's body        the freeze's own mechanism
    c5cb710  5.4  setSessionPending                 documented — README's "tenth gap"
    2120deb  5.6  findTeacherForNotification        documented — "second deliberate reopen"
    110f6b7  fix  findOfferSessionForTeacher        NOT documented anywhere

The fourth is the finding. `findOfferSessionForTeacher` entered a frozen repository in a fix
commit made ten minutes after 5.8 merged, and it appears in neither the README's shared-file
table nor 5.8's brief. Every other reopen in this epic was argued in writing before the code
existed, which the README correctly identifies as the thing that separates a freeze working
from a freeze eroding.

**So the discipline survived losing its justification — for planned work.** Nobody needed
protecting from anybody and the freeze was still honoured through eight PRs. It slipped once,
and it slipped in a post-merge fix commit: the place with no brief, no checklist and no
reader. That is worth carrying to E6 more than the four clean cases are, because the same
gap exists in every epic and the previous four never had a fix commit land after the closing
PR's window opened.

## Did the E4 seam work?

**The signature held. The claim about the diff did not.**

4.7 froze `onChoose({ teacherId, pricePerBlock })` and argued a callback beats a route
because "E5 replaces one function body in a file it owns". The signature was never touched —
that half is correct, and it is the half that matters for whether the seam was cut in the
right place.

The diff was not one function body:

    049586e  5.8   ChooseTeacher.jsx   108 insertions(+), 75 deletions(-)
    110f6b7  fix   ChooseTeacher.jsx    26 insertions(+),  2 deletions(-)
    c5e5fe7  fix   ChooseTeacher.jsx    53 insertions(+),  2 deletions(-)

Three commits, not one. 5.8 alone rewrote 75 lines of a screen E4 had signed off. It removed
the dead modal as predicted, and it also added a `useRef` double-press guard, a `sessionId`
derivation, two imports, and an entire `onSendFailed` callback handling three distinct error
codes — `TEACHER_UNAVAILABLE`, `INSUFFICIENT_CREDIT` and `SESSION_NOT_ACTIVE`, each with its
own recovery.

None of that is E5 overreaching. It is all failure handling for an action E4 could not
perform and therefore could not anticipate. **The lesson is not that the callback was the
wrong seam — it is that "one function body" undercounts a seam where the new epic introduces
the first way for the action to fail.** E6 should keep the callback and stop repeating the
size estimate.

## What did one developer cost?

No PR in this epic was read by a second person. **The checklist found two defects. Both are
of a kind review catches, and neither is of a kind tests catch.**

### Defect 1 — the availability pill releases a live lock

The serious one. Reproduced with API calls only, no SQL writes, on a teacher untouched by
the rest of the pass:

    1. teacher goes online through the pill      teacher=ONLINE        pending_offers=0
    2. student A sends an offer                  teacher=OFFER_LOCKED  pending_offers=1
    3. teacher presses their own pill (ONLINE)   teacher=ONLINE        pending_offers=1
    4. student B sends an offer                  teacher=OFFER_LOCKED  pending_offers=2
    5. teacher accepts A's offer                 teacher=IN_SESSION    pending_offers=1
    6. offer A|ACCEPTED   offer B|PENDING
       session A|ACTIVE   session B|OFFER_SENT

Step 4 is **two `PENDING` offers on one teacher** — the exact state §11.3-A exists to make
impossible — reached through a button on the teacher's own dashboard rather than through any
race. Step 6 leaves student B watching a countdown for a teacher who is already in a session
with somebody else.

`PATCH /teachers/me {"status":"ONLINE"}` moves `OFFER_LOCKED` to `ONLINE` without resolving
the offer. E2's `SETTABLE_STATUSES = ['OFFLINE','ONLINE']` validates the status being
written and **nothing validates the status being written over**. This README is explicit
that `OFFER_LOCKED` and `IN_SESSION` are "states the system owns"; `presence.autoAway.job.js`
honours that in its predicate and the manual toggle does not.

The server already narrates it at info level, which is how it was first noticed:

    07:37:45 INFO  Accept found the teacher no longer locked
    07:37:45 WARN  POST /api/v1/offers/c2968007-…/accept 409

**Would review have caught it?** Yes. The predicate is missing from one `WHERE` clause in a
file E2 wrote and E5 never opened, and this epic's own README names the invariant it breaks
twice. A reviewer holding the README beside `PATCH /teachers/me` finds it by reading. Every
test in the epic passes with the defect present, because no test toggles availability while
an offer is open.

### Defect 2 — an inbound offer refreshes the teacher's `last_seen_at`

`last_seen_at` backdated thirty minutes, then a student sends this teacher an offer:

    last_seen BEFORE offer: 2026-08-19 07:05:18.093283+00
    offer HTTP 201
    last_seen AFTER  offer: 2026-08-19 07:35:19.365+00

`session.offer.service.js:105` passes `publishTeacherStatus` as its `announceStatus`, and
that wrapper calls `recordTeacherActivity(force: true)`, which writes the column.

What makes this a defect rather than a choice is that **both jobs already refuse to do it,
in writing.** `offer.expiry.job.js` and `presence.autoAway.job.js` each call
`emitTeacherStatus` directly to avoid the wrapper, and each explains:

> the teacher whose offer just expired did nothing at all, and stamping the column here
> would be this job telling the auto-away job a teacher is present. The two jobs share one
> column and must not write each other's inputs.

The justification offered for every other caller is "somebody just did something" — and in
each case listed, that somebody is the teacher: they toggled a pill, accepted an offer,
opened a socket. On the send path the actor is a **student**. An inbound offer is not
evidence that the teacher is at their desk.

Consequence: the teacher the sweep exists for — tab open, nobody there — has their idle
clock reset by other people's offers. They stay in the match list, keep receiving offers
that expire unanswered, and each one pushes the sweep another hour out. Auto-away is
prevented from firing by the very offers it should be stopping.

**Would review have caught it?** Probably, and only because the two jobs document the rule
so plainly. A reviewer who read `offer.expiry.job.js`'s reasoning and then read the send
service would see the same wrapper used for a caller that does not meet its stated test.
Without those two comments this is invisible to everyone.

### The honest answer

**One developer cost two defects, and both were cheap to find and would have been cheaper
to prevent.** Neither is subtle. Neither needed the checklist's harder machinery — no
concurrency, no timing, no second machine. Defect 1 is a missing predicate named in the
epic's own README; defect 2 is a wrapper used against a rule written in two files. Both are
found by one careful person reading two files side by side, which is precisely what a second
developer would have done and what nobody did.

What one developer did **not** cost is also worth recording, because the answer is not
"everything was terrible". The lock is correct, the transaction shape is correct, the
release predicates are correct in all four directions, the boundary matrix is correct in
seventeen of seventeen cases, and the log hygiene is clean. The parts that were designed
carefully and written down survived having no reviewer. The parts that slipped are both at
seams **between** subsystems — presence against offers, E2's toggle against E5's lock —
which is where a single author's attention is structurally weakest and where a second reader
is worth the most.

E4's retro said "a unit test on fixtures is not a verification pass". Fifth epic, same
finding, and now with a number: two defects, zero failing tests.

## Did the lock hold under real concurrency?

Ten simultaneous pairs from two processes on one machine: ten `201`s, ten `409`s, one
`PENDING` offer every time, loser's session `PENDING` every time, winner alternating 4/6.
Zero anomalies across all ten.

**Two physical machines: not run.** Reason and plan in one sentence, as the acceptance
criteria require: the pass had one machine and one person available on 2026-08-19, so the
two-machine run is scheduled as the first item of E6's opening session, using the same
`lock.sh` harness pointed at the Render URL with the second operator on their own laptop.

Note also that the ten runs above test the race the epic was worried about, and **defect 1
reaches the same broken end-state with no race at all.** The concurrency was never the only
way in.

## The rest of the checklist, as run

Full recorded output — every status code, row count, statement, timing and log line — is in
this section's evidence and reproduced in the PR description.

**Flow.** `/health` returned `{"success":true,"data":{"status":"ok","db":"ok","uptime":16}}`,
HTTP 200 in 0.017s, before anything else ran. Offer send `201` in 47–120ms across the pass.

**Release, all four directions.**

    accept                        -> teacher IN_SESSION
    reject                        -> teacher ONLINE
    expiry                        -> teacher ONLINE
    reject after going OFFLINE    -> teacher still OFFLINE     (conditional release holds)
    rejected_by on a reject       -> gains the id
    rejected_by on an expiry      -> 0 entries
    two rejects, two teachers     -> {dana, yossi}, 2 entries, neither lost

**Expiry.** `expires_at 07:40:41` → `EXPIRED` observed `07:40:50`: inside one ten-second
tick, not two. Session back to `PENDING`, teacher back to `ONLINE`, both sockets notified.

Accepting past `expires_at` while the row still reads `PENDING` returns `409 OFFER_EXPIRED`
— "That request has expired. The student has been sent back to their list." — and **that
call releases the teacher**, `OFFER_LOCKED` → `ONLINE`.

Server stopped for 2m10s mid-offer, `expires_at` passing 89 seconds into the downtime: the
offer was still `PENDING` on disk because nothing was running to sweep it, the first tick
after boot swept it, and the accept that followed returned `409 OFFER_EXPIRED` with the
session back at `PENDING`. Still tidy.

An empty tick logs nothing: across roughly 138 ticks the only job lines are the two ticks
that did work — `Auto-away swept idle teachers { count: 1 }` and `Offer expiry swept offers
{ count: 1 }`.

**Presence.** Four teachers parked in four states with `last_seen_at` ninety minutes stale,
then two ticks:

    dana.k    ONLINE       -> OFFLINE      swept
    yossi.m   OFFER_LOCKED -> unchanged    not swept
    tal.r     IN_SESSION   -> unchanged    not swept
    avi.k     ONLINE, last_seen NULL       not swept

Heartbeat coalescing: `last_seen_at` moved exactly once across a connect plus ten beats
400ms apart, and the one write is the documented forced write on connect. The ten beats
produced none. `PRESENCE_WRITE_INTERVAL_MS` is 1,800,000 and derives from
`AUTO_AWAY_MINUTES / 2` rather than being typed.

**Boundaries — seventeen of seventeen.** Ownership failures are `NOT_FOUND` and role
failures are `FORBIDDEN`, everywhere. A third party learns nothing about whether the row
exists. No token on any of the four routes is `UNAUTHORIZED`; a malformed uuid is
`400 VALIDATION_ERROR` rather than a 500, which is the reason `sessionByIdSchema` parses
`:id` at all; a tampered token is `401 TOKEN_INVALID`.

**Sockets.** No token, an expired token and a tampered signature are each refused at the
handshake. A valid token connects, locally over `websocket`. Room isolation tested by
behaviour — two teachers connected, one offer sent — and `offer:new` reached only the
addressed teacher.

One nuance the checklist's wording invites getting wrong: both sockets **did** receive
`teacher:status`, because 5.2 deliberately made that emitter a broadcast so students can
hear it. "In `user:{its own id}` and no other room" is true of the room set; broadcast
events arrive regardless, by design. The two statements do not conflict, but the next person
reading that box will think they do.

**Performance and logs.** `POST /sessions/:id/offer` issues a constant number of statements,
read from `prisma:query`: the topic fan-out is one `SELECT ... WHERE "id" IN ($1,…,$5)`, not
a query per topic.

    explain analyze select id from offers where status='PENDING' and expires_at < now()

    Index Scan using idx_offers_pending on offers
      (cost=0.15..8.17 rows=1 width=16) (actual time=0.019..0.019 rows=0 loops=1)
      Index Cond: (expires_at < now())
    Execution Time: 0.240 ms

`idx_offers_pending` is used. It is a partial index on `expires_at WHERE status = 'PENDING'`
and it predates this epic; **no `CREATE INDEX` appears in E5's diff.**

The `201` is not delayed by the email. With a deliberately bogus key and an unroutable
sender, five offers returned `201` in 0.052–0.104s — the same band as the 0.047–0.120s
measured with email disabled entirely. The failure lands about a second after the response:

    07:46:47 WARN Offer email was not sent {
      sessionId: '80d80038-…', offerId: '7e0cdc7b-…',
      message: 'Unable to fetch data. The request could not be resolved.' }

With `RESEND_API_KEY` unset — the repository's default and Render's current state — the whole
flow runs and the boot line says so.

Logs carry nothing they should not. Grepped across the whole run: JWTs 0, raw student text 0,
balance or wallet 0, `GEMINI`/`RESEND`/`API_KEY`/`secret` 0. The info-level surface is ids,
counts and durations.

## Money that E5 does not touch — in plain words

Both sessions that reached `ACTIVE` through a real accept:

    session                                status  blocks_used total_charged fee earning zoom
    2603b093-d16b-43b3-98f6-64720cfa7667   ACTIVE  0           0             0   0       NULL
    4323c4a0-7c72-4fc7-864b-2823db66d4af   ACTIVE  0           0             0   0       NULL

`wallet_transactions` still holds exactly the two rows the seed wrote at 07:13:51. Student
balances were unchanged across complete offer-accept cycles.

**`ACTIVE` in E5 means "accepted", not "metered".** A teacher accepts, both sides land on a
session screen, and the student is charged nothing, because there is nothing yet to charge
for. The charge is E7's and the Zoom link is E6's. `started_at` and `ends_at` **are** written
at accept — a ten-minute first block, `07:38:23` to `07:48:23` — and nothing extends `ends_at`
and nothing bills against it.

**The first person who accepts an offer and gets a free session has not found a bug.** They
have found E6 and E7 not existing yet. This paragraph is here because E4's retro had to
write the same one about inert ranking data, and because a passing checkbox that reads
"no `wallet_transactions` row exists" would otherwise be left to imply that some other path
does take payment. None does.

## The E4 debts this epic inherited

**The classification outage is still open, and now has a symptom that is not a key
problem.** Every question this pass created returned `classificationOk:false, topicId:0`.
The boot line says `classification: 'enabled'`, so the key is present:

    WARN  Classification fell back {
      reason: 'Unable to make request: TypeError: fetch failed',
      elapsedMs: 267, wordCount: 12, imageCount: 0 }

267ms is a connection failure, not a timeout, and an expired key returns 4xx rather than
this. From the same machine outside the server process the host answers —
`generativelanguage.googleapis.com` returned 404 on its bare root in 0.220s, `example.com`
200 in 0.275s — so general egress is fine and the fault is inside the server's own fetch
path. **Cause still not established.** It carries into E6 unchanged.

The fallback holds, which is why this is a debt and not an outage: `POST /questions` returns
`201`, `teacher_brief` is the raw text per §8.1, and the whole offer flow runs on top of it.

**`globalRating` smoothing is unfixed.** `matching.scoring.js`'s last commit is 4.6
(`2f9fd5a`) and nothing has touched it since. Gil V. still outranks Dana K. against §18.

**4.8's untranscribed checklist values are still untranscribed.** E4's `RETRO.md` still
reads "⚠ Pending the recorded output". Recorded here as inherited and not actioned — this
PR's allowlist does not include E4's files, and re-running E4's pass is its own sitting.

**E3's 3.8 checklist has still never been run**, and E4's retro scheduled it for "before
E5's first PR, by whichever developer is not closing E5". E5 had no such developer. It is
now two epics old.

## What was not run, with the reason and the plan in the same sentence

- **Two browsers, two students clicking at once** — the pass ran from one shell on one
  machine and a second browser profile was not available in the session, so it runs as the
  first item of E6's opening session using the two seeded students already topped up for it.
- **The countdown under a backgrounded tab, a reload at second 30, and a killed network for
  the last 20 seconds** — all four are browser-only behaviours with no server-side proxy, so
  they run in the same sitting as the two-browser test, against the same local server.
- **375px and `scrollWidth === clientWidth` on both screens** — same sitting, same reason.
- **F4, the header pill updating on a server-side lock without a navigation** — same
  sitting; note that defect 1 above must be fixed first or the test is meaningless, since
  the pill's own toggle is the thing that breaks the lock.
- **The two-machine lock run** — one machine and one person were available on 2026-08-19, so
  it is scheduled against the Render URL with the second operator on their own laptop at the
  start of E6.
- **The deployed read-only half, the cold start timing, and the Socket.IO transport through
  Render** — these need the two-machine sitting's second operator and a deployed build
  carrying E5, so they run together with the item above and the transport is recorded in
  `DEPLOYMENT.md` then.

Six items, one sitting, scheduled at the head of E6 rather than left open. **This is the
half of the pass that E2 closed provisionally on and that has not happened since; it does
not become a habit here.** The distinction that matters: nothing above is unrun because it
was skipped, and every one of them is a browser or a second host, not a gap in judgement.

## Carried into E6

1. **Two defects are filed and fixed in their own PRs before E6's first feature PR.**
   Defect 1 blocks the F4 check and undermines the epic's headline guarantee, so it goes
   first.
2. **The two-machine and two-browser sitting opens E6**, ahead of feature work, with the
   `lock.sh` harness and the six items listed above.
3. **The freeze works; the fix commit is the hole.** Four of five files were untouched and
   three of four reopens were argued in writing. The one that was not entered a frozen
   repository ten minutes after its PR merged. E6 should treat a post-merge fix as needing
   the same written permission a PR needs, because it is the only place in five epics where
   the discipline has slipped.
4. **Keep E4's callback seam, drop the size claim.** `onChoose` was the right cut and the
   signature never moved; "one function body" undercounted it threefold because E5 brought
   the first way for the action to fail.
5. **A verification pass finds what tests cannot, fifth epic running.** Two defects, zero
   failing tests, and the epic's acceptance criterion has a number behind it for the first
   time.
6. **`EMAIL_FROM` will not accept the display-name form.** The server refuses to boot with
   `EMAIL_FROM=TutorNow <noreply@example.invalid>` — "Invalid environment. Fix .env and
   restart. EMAIL_FROM: Invalid email" — and a bare address is required. Resend's own
   documentation uses the display-name form, so whoever first sets this on Render will meet
   it. `DEPLOYMENT.md` is amended in this PR.
7. **Presence is a deliberate act per session, and it surprises people.** Logging in as a
   teacher sets that teacher `OFFLINE`; it is correct, it is documented in
   `presence.service.js`, and it cost this pass an hour before the documentation was found.
   Anything scripting this API must mint the teacher's token first and `PATCH` online second.

## Mutation ledger

Every hand-written row this pass made, so it can be re-run.

| # | Mutation | Why | Undo |
| 1 | `wallets.balance` = 1200 for avi.student and noya.student | Both students must afford `pricePerBlock × OPENING_BLOCKS`; noya held 24 against dana's 16 per block, so student B was returning a legitimate `402 INSUFFICIENT_CREDIT` and never reached the lock at all | `npm run db:seed` |
| 2 | `teacher_profiles.status` and `last_seen_at`, direct `UPDATE`, several teachers | Parking teachers in `ONLINE`/`OFFER_LOCKED`/`IN_SESSION`/null to test the sweep predicate, and isolating the sweep from the login-to-`OFFLINE` behaviour | `npm run db:seed` |
| 3 | `offers.expires_at` pushed into the past on one offer | The lazy-expiry accept path, which cannot be reached by waiting without also letting the sweeper win the race | truncate `offers` |
| 4 | ~35 questions, their sessions, and the offers on them | The lock test needs a fresh `PENDING` session per student per run, ten runs | truncate `offers`, then re-seed |
| 5 | `.env` — `RESEND_API_KEY` and `EMAIL_FROM` set to a bogus key and an unroutable sender, then reverted | Measuring that the `201` is not delayed by an unreachable provider, which is unmeasurable with the key unset because the email path never runs | restored from backup; both lines are commented out again |

Reset:

    docker exec tutor_now_db psql -U tutor -d tutor_now -c "truncate offers cascade"
    npm run db:seed
