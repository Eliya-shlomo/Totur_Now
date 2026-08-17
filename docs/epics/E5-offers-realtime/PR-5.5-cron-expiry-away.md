# PR 5.5 — Cron: offer expiry + auto-away

| | |
|---|---|
| **Epic** | E5 — Offers & Real-Time Presence |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 5.3 |
| **Blocks** | — |
| **Branch** | `dev-b/E5.5-cron-expiry-away` |

## Contract implemented

Two of `MVP.md` §13's four background jobs, on the `CRON_TICK_SECONDS` (10) tick:
**Offer Expiry** and **Auto-Away**. The other two are E6's.

## Scope

**The scheduler.** One `node-cron` registration, in one file, started from `server/src/index.js`
after the HTTP server is listening and stopped on `SIGTERM` alongside the graceful shutdown 0.4
already has. A job that is still running when Prisma disconnects logs an error on every deploy.

**Job 1 — Offer Expiry.** Every tick: find `PENDING` offers whose `expires_at` has passed,
mark them `EXPIRED`, release each teacher, and emit `offer:expired` to the teacher and
`offer:rejected` to the student. The session returns to `PENDING`, exactly as a reject does.

**The teacher is NOT appended to `rejected_by` on an expiry.** A teacher who never saw the
modal has not rejected anything, and permanently excluding them from a student's pool because
they were away from the keyboard for sixty seconds is a punishment for being busy. §12 puts
`rejected_by` on the reject endpoint and only there. Write the reason in the job's header —
it is the single most likely "improvement" someone makes to this file.

**Job 2 — Auto-Away.** Every tick: teachers whose `status` is `ONLINE` and whose `last_seen_at`
is older than `AUTO_AWAY_MINUTES` (60) go `OFFLINE`, and each gets a `teacher:status`.

**The `status = 'ONLINE'` predicate is load-bearing.** A teacher who is `OFFER_LOCKED` has an
offer out and a stale `last_seen_at` is expected — they are reading the modal, not clicking.
Sweeping them would release a live offer's lock without touching the offer, which is the one
way this epic can produce a teacher who is `ONLINE` with a `PENDING` offer against them. A
teacher who is `IN_SESSION` is teaching. Neither is swept.

**Both jobs are `updateMany` with the condition in the `where`,** so a tick that overlaps the
previous one cannot double-act, and a second instance would be harmless. There is one instance
today; this is written down so the property is not lost during a scale-up.

**No index is created.** `idx_offers_pending` — `(expires_at) WHERE status = 'PENDING'` —
landed in `20260810113433_init` and is deliberately absent from `sessions.prisma` because
Prisma cannot express a partial index. It already serves job 1 exactly. Job 2 scans
`teacher_profiles`, which has 22 rows. **Measure with `EXPLAIN` and record the plan in the PR;
add nothing on faith.** This is 4.2's instruction and 4.2's outcome was "no migration and a
note".

**The cron is a sweeper, not the source of truth.** Render's free plan spins the instance down
after ~15 minutes without a request, so these jobs do not run on a sleeping server. 5.4 already
evaluates expiry lazily on every read and sweeps the row it finds. This PR makes the *timely*
case timely — the teacher's modal closes itself, the student's countdown resolves — and is
never the reason a stale row is eventually correct.

**Logging.** One line per tick that did something, at info, with the count. **Nothing at all on
an empty tick** — 8,640 log lines a day of "expired 0 offers" is how a log stops being read.

## Files you may touch

```
server/src/jobs/index.js                       new  — registration and shutdown
server/src/jobs/offer.expiry.job.js            new
server/src/jobs/presence.autoAway.job.js       new
server/src/repositories/offer.repository.js    NOTHING — expirePendingOffersBefore exists
server/src/repositories/teacher.presence.repository.js   add the auto-away sweep
server/src/index.js                            start the scheduler, stop it on SIGTERM
docs/epics/E5-offers-realtime/README.md        tick the status box

server/tests/jobs.test.js                      new  — the job functions, called directly
```

**The jobs are exported functions that the schedule calls**, not closures inside a `cron.schedule`
callback. That is what makes `jobs.test.js` possible: the test calls `runOfferExpiry()` against
seeded rows and asserts, without waiting ten seconds or mocking a scheduler.

## Files you must NOT touch

```
server/src/services/offer.respond.service.js   5.4's — the lazy path is already there
server/src/repositories/session.repository.js  frozen; both gaps are filled
server/src/routes/**                           this PR adds no HTTP surface
server/src/sockets/**                          call events.js
server/src/app.js                              frozen since 0.4
prisma/**                                      no migration, and no index — see the notes
client/**                                      5.7 and 5.8 consume the events
```

## Acceptance criteria

- [ ] An offer whose `expires_at` has passed is `EXPIRED` within two ticks, its teacher back to `ONLINE`, its session back to `PENDING`
- [ ] The teacher's socket receives `offer:expired`; the student's receives `offer:rejected`
- [ ] **`questions.rejected_by` is unchanged by an expiry**
- [ ] An offer expiring while its teacher is `OFFLINE` leaves them `OFFLINE`
- [ ] An `ONLINE` teacher with `last_seen_at` older than 60 minutes goes `OFFLINE` and emits `teacher:status`
- [ ] An `OFFER_LOCKED` teacher with a stale `last_seen_at` is **not** swept
- [ ] An `IN_SESSION` teacher with a stale `last_seen_at` is **not** swept
- [ ] A teacher with `last_seen_at` null is not swept — a teacher who has never connected is not idle, they are new
- [ ] Two ticks in the same second produce the same end state as one — the jobs are idempotent
- [ ] An empty tick logs nothing
- [ ] `SIGTERM` stops the scheduler before Prisma disconnects; no job error appears in the shutdown log
- [ ] `EXPLAIN` on the expiry query is recorded in the PR description, and no `CREATE INDEX` is in the diff
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. Send an offer (5.3's flow), then do nothing for 60 seconds with both browsers open
2. The teacher's modal disappears on its own; the student's countdown reaches zero and the screen recovers
3. `psql`: the offer is `EXPIRED`, the teacher `ONLINE`, the session `PENDING`, and `rejected_by` is `'{}'`
4. `update teacher_profiles set last_seen_at = now() - interval '2 hours' where user_id = '<online teacher>'` — within two ticks they are `OFFLINE`
5. Repeat step 4 against an `OFFER_LOCKED` teacher. Nothing happens
6. `Ctrl-C` the server. The shutdown log shows `SIGTERM received` then `Shutdown complete`, with no job error between them
7. `EXPLAIN ANALYZE` the expiry query on the seeded database; paste the plan into the PR

## Review checklist additions

- Confirm the expiry job does not touch `rejected_by`. It is the most likely well-meant change to this file and it silently narrows every future match list.
- Confirm the auto-away `where` includes `status: 'ONLINE'` **and** `lastSeenAt: { not: null }`.
- Confirm both jobs are `updateMany` and neither reads-then-writes in two statements.
- Confirm the scheduler is stopped in the `SIGTERM` handler, before `prisma.$disconnect()`.
- Confirm no `CREATE INDEX` in the diff and that `idx_offers_pending` was checked rather than assumed.
- Confirm the empty tick is silent.

## Notes

**Why only two of §13's four jobs.** Block Warning and Session Auto-End both read `ends_at` as
a live billing deadline and both fire against a meter that is running. Nothing in E5 charges a
block or moves `ends_at` after the accept, so writing them here would be writing two jobs
against a clock that does not tick. They are E6's, with the charge that makes them mean
something.

**Why the sweeper cannot be the source of truth, again.** Render's free plan sleeps the
instance after ~15 minutes without a request, and `node-cron` runs in-process. An offer that
expired at 14:02 may still read `PENDING` at 14:40. 5.4 handles that on the read path; this PR
handles the case where somebody is watching. Neither is sufficient alone and the split is
deliberate: **correctness on the read, timeliness on the tick.**

**Why the tick is 10 seconds and not 1.** `CRON_TICK_SECONDS` is §13's number. A 60-second TTL
resolved within 10 seconds is a countdown that ends when it says it does, to the precision
anyone can perceive. One second would be six times the database load for no product
difference, on a free tier that counts instance hours.
