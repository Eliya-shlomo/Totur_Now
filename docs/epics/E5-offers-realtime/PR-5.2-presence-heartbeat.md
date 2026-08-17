# PR 5.2 — Availability heartbeat, `last_seen_at`, `teacher:status`

| | |
|---|---|
| **Epic** | E5 — Offers & Real-Time Presence |
| **Owner** | DEV-B (rotem) |
| **Size** | S |
| **Written by** | Agent |
| **Depends on** | 5.1 |
| **Blocks** | 5.7 |
| **Branch** | `dev-b/E5.2-presence-heartbeat` |

## Contract implemented

`MVP.md` §13's `teacher:heartbeat` (client → server) and `teacher:status` (server → client),
and the `last_seen_at` column that §10's auto-away rule reads.

## Scope

**The heartbeat.** A connected teacher's client emits `teacher:heartbeat` on an interval.
The server writes `teacher_profiles.last_seen_at = now()` and nothing else. No payload, no
acknowledgement, no response event — a heartbeat that answers is a request, and it would be
one round trip per teacher per interval for information nobody reads.

**Debounce the write, not the event.** At one tick per teacher per interval, an
`UPDATE` per beat is a write amplification the free-tier database does not need. Keep the
last-written instant in module state and skip the write when it is newer than half the
auto-away window. The column exists to answer "has this teacher been gone an hour", and a
value that is up to thirty minutes stale still answers it correctly.

**`last_seen_at` is also written on two non-heartbeat events**, because both are activity by
any reasonable reading and because a teacher who just did something and is then swept offline
is the bug this exists to prevent: connecting the socket, and setting status through E2's
existing `PATCH /teachers/me`. The second is **not** an edit to E2's file — `presence.service.js`
is called from E5's own socket layer on the `teacher:status` broadcast path, not from inside
2.2's service.

**The broadcast.** When a teacher's status changes for any reason — their own toggle, a lock
taken in 5.3, a lock released in 5.4, the sweep in 5.5 — `teacher:status` goes out with
`{ teacherId, status }`. This PR writes the emitter's caller for the toggle path only; 5.3,
5.4 and 5.5 each call the same function from `sockets/events.js`.

**Who receives it.** §13 says "students in selection", and there is no room for that. E5 uses
`user:{userId}` and nothing else, so the honest implementation is a broadcast to every
connected socket, and the client ignores ids it is not looking at. That is correct at this
scale — fifteen teachers and a demo — and the alternative, a room per teacher that students
join when a match list renders, is a subscription lifecycle nobody needs yet. **Write the
reason in the emitter's header** so the next person does not think a room was forgotten.

**The "Still there?" warning.** `AUTO_AWAY_WARNING_MINUTES` (55) fires to one teacher, on
their own `user:` room. It is here rather than in 5.5's cron because this PR owns
`last_seen_at` and is the only one that knows what activity means. The event reuses
`teacher:status` with the teacher's *current* status rather than adding a name to the
catalogue — the client decides that "you are still ONLINE and we are asking" is a modal.

## Files you may touch

```
server/src/services/presence.service.js        new
server/src/sockets/handlers.presence.js        new  — the teacher:heartbeat listener
server/src/sockets/index.js                    register the listener
server/src/repositories/teacher.presence.repository.js   new  — the last_seen_at write
docs/epics/E5-offers-realtime/README.md        tick the status box

server/tests/presence.test.js                  new
```

**Why a fourth repository rather than a query in `session.repository.js`.** The write is to
`teacher_profiles`, which is neither a session nor an offer. Putting it in either would make
the file's name a lie, and `teacher.repository.js` is E2's and frozen. A small file with an
accurate name beats a large one with a convenient one.

## Files you must NOT touch

```
server/src/repositories/teacher.repository.js   E2's, frozen since 2.1
server/src/services/teacher.me.service.js       E2's — this PR does not change what PATCH does
server/src/validators/teacher.me.schema.js      SETTABLE_STATUSES stays as it is
server/src/routes/**                            frozen at 5.1; this PR adds no HTTP route
server/src/sockets/auth.js                      the handshake is 5.1's and is human-written
prisma/**                                       last_seen_at already exists
client/**                                       5.7 consumes this
```

## Acceptance criteria

- [ ] A connected teacher emitting `teacher:heartbeat` moves `last_seen_at` forward
- [ ] Emitting it ten times in a row produces **at most one** additional write — the debounce holds
- [ ] A **student** emitting `teacher:heartbeat` writes nothing and does not error the socket
- [ ] Connecting the socket as a teacher sets `last_seen_at` without waiting for the first beat
- [ ] Toggling availability through `PATCH /teachers/me` emits `teacher:status` with the new value
- [ ] `PATCH /teachers/me` still answers exactly as it did before this PR — its status codes, its payload and its validation are unchanged
- [ ] The emitter is called from `sockets/events.js` and `grep` finds no `io.emit` outside `server/src/sockets/`
- [ ] A disconnected teacher's `last_seen_at` stops moving and nothing throws
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. `npm run dev`, log in as `dana.k@demo.tutornow.il` in a browser
2. `psql`: `select last_seen_at from teacher_profiles where user_id = ...` — note the value, wait past one interval, read it again. It moved
3. Read it ten seconds later — it did **not** move again, because of the debounce
4. In a second private window, log in as a student with a socket connected. Toggle Dana offline in the first window; the student's socket receives `teacher:status` with `OFFLINE`
5. Kill the teacher's browser tab. Nothing in the server log is an error

## Review checklist additions

- Confirm the heartbeat handler checks the socket's **role** before writing. A student's client has no reason to emit it, but the handler is the boundary, not the client.
- Confirm the debounce is keyed per teacher, not global. A single module-level timestamp would let one busy teacher suppress every other teacher's write.
- Confirm nothing in this PR reads `last_seen_at` to make a decision. The sweep is 5.5's, and two readers of a freshness rule drift.
- Confirm the broadcast-to-everyone choice carries its explanation in the code, not only here.

## Amendments made while implementing

Four, each decided before code was written rather than discovered afterwards.

**The allowlist gained two files.** `server/src/sockets/events.js`, because the broadcast
decision below is an edit to an emitter 5.1 froze, and
`server/src/controllers/teacher.me.controller.js`, because §13's toggle path is HTTP and
nothing in the socket layer can observe a `PATCH`. Both are named in the epic README's
shared-file table with the rule that now applies to them.

**`emitTeacherStatus` became a broadcast.** 5.1 shipped it addressed to the teacher's own
room, with a header arguing against a broadcast; this brief asked for one. The brief wins:
an event only the teacher themselves can hear cannot do the job §13 gives it, and this
brief's own manual test — a student's socket seeing a teacher go `OFFLINE` — is
unsatisfiable otherwise. The reasoning, including what would have to change before a
heartbeat may ever emit a status, is in the emitter's header.

**The 55-minute "Still there?" warning moved to 5.5.** 5.2 has no clock. A per-socket timer
is reset by the heartbeat, so on an open dashboard it never fires; the alternative is
reading `last_seen_at` to decide, which this brief's own review checklist forbids. 5.5
already sweeps that column on a tick and is already its one reader. Recorded in the epic
README, gap 8.

**A fifth file, `server/src/services/presence.debounce.js`.** `npm test` is bare
`node --test` with no database, so a test that imports `presence.service.js` imports
`PrismaClient`. The debounce is the only part of this PR with branches worth asserting and
it depends on nothing but a clock, so it is its own module and `presence.test.js` imports
that and nothing else.

## Notes

**Why the debounce is safe.** `AUTO_AWAY_MINUTES` is 60 and the write threshold is half of it,
so `last_seen_at` is never more than 30 minutes behind reality. The sweep asks whether it is
more than 60 minutes old. A teacher who is active is therefore never swept, and a teacher who
left is swept between 60 and 90 minutes later. Being late to mark someone away is the harmless
direction; being early logs out a teacher who is sitting there.

**Why this is not F4.** E2's retro filed `TeacherStatusToggle` refreshing on navigation as
filler, and it stayed open through E3 and E4. It stops being filler here: from 5.3 on, a
teacher's status changes because *the server* locked them, not because they clicked something,
so a pill that only re-reads on navigation is now wrong rather than merely stale. 5.7 subscribes
it to `teacher:status`, which closes F4 as a side effect of doing the epic properly rather than
as a chore nobody scheduled.

**Why there is no `presence:online` event.** The status a teacher is in is already
`teacher:status`, and adding a second name for "connected" would mean two sources of truth for
one boolean — the socket's connection state and a column. The column wins, because the sweep
and the matching filter both read it and neither can see a socket.
