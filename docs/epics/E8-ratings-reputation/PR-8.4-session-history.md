# PR 8.4 — The session history, and the way back to an unfinished rating

| | |
|---|---|
| **Epic** | E8 — Ratings & Reputation |
| **Owner** | DEV-A (eliya) |
| **Size** | L |
| **Written by** | Agent |
| **Depends on** | 8.3 (E8's `shared/api.d.ts` block, opened whole). Independent of 8.1 and 8.2 |
| **Blocks** | nothing |
| **Branch** | `dev-a/E8.4-session-history` |

## Contract implemented

`GET /api/v1/sessions/mine?page&pageSize` → `SessionHistoryResponse`. Student-only.

`/app/history` — replaces `<Placeholder title="Session history" pr="8.6" />` in
`client/src/router/routes.student.jsx`.

`MVP.md` §14.1's `/app/history`, §12's `GET /students/me/sessions` (see the deviation),
§18's row 8.6.

## Scope

**The student has run sessions since E6 and has no way to look at one afterwards.** The
sidebar has linked to `/app/history` since 1.5 and it has been a placeholder since. This
PR is the endpoint and the screen.

**The endpoint is `GET /sessions/mine`, not §12's `GET /students/me/sessions`, and this
is the second time this epic makes that call.** There is no `/students` router in
`routes/index.js` and there never has been. Creating one for a single endpoint means
creating a `student.repository.js` whose only job is reading the `sessions` table —
exactly the move E7 refused when it put `GET /wallet/earnings` on the wallet router rather
than on `/teachers/me`, with the reason written down: the read belongs to the router that
owns the table.

**`/mine` must be declared before `GET /:id` in `session.routes.js`.** Express walks the
stack in order, `/:id` matches one segment, and `sessionByIdSchema` would turn `mine` into
a `400 VALIDATION_ERROR` on a uuid check. `teacher.routes.js` already carries this note for
`/me` before `/:id`; this is the same hazard on a different router and the brief names it
because the failure is a 400 that reads like a client bug.

**Student-only, `authorize('student')`, and the teacher's list already exists.** A
teacher's finished sessions are `GET /wallet/earnings` (7.6), which carries the money that
side needs — gross, fee, net. One list of the same rows with different money in it per
role would be two serializers of one table, and E7 already built the teacher's.

**What a row carries.** The teacher's name, the question's title, the topic label, when it
ended, `blocksUsed`, `totalCharged`, and the student's own review or `null`. Deliberately
**no minutes field**: minutes are `blocksUsed × block.minutes` and `client/src/lib/credits.js`
already owns that translation for the whole product. E7 ruled on this for `GET /wallet`
and the ruling holds — a server-computed minute figure is a second rounding of a number
the client already renders, shown next to the first.

**`review: null` on an `ENDED` row is the point of this screen.** §10 makes the rating the
only edge out of `ENDED`, and 6.6 shipped a rating screen with no Skip — so a student who
closes the tab leaves a session that has not reached a terminal state, with
`resolved_count` never incremented and a teacher's reputation missing an entry it earned.
Nothing in the product could reach that session again. **Every such row here links to
`/app/session/:id/review`**, and `unratedCount` on the response is the badge on the
sidebar link that tells the student they exist.

That is not a nice-to-have. It is the half of "the rating is mandatory" that 6.6 could not
ship, and after 8.1 an unrated session is also a hole in `teacher_topic_stats` that nothing
else will ever fill.

**The screen.** A list, newest first, paged the way `Teachers.jsx` and the wallet ledger
page. Empty state for a student who has run nothing. Each row: title, teacher, topic,
date, cost, and either the review the student gave or a **Rate this session** action.
Status is rendered as a word a person understands — a `NO_SHOW` row says the teacher never
arrived and that it was refunded, a `CANCELLED` row says it never started.

### The plan is measured, and probably no index is added

`sessions` has no index on `student_id`. This read filters on it, orders by `ended_at`
and joins `users`, `questions`, `topics` and `reviews`.

**Run `EXPLAIN` against the seeded database and record the plan in the PR.** 4.2's ruling
applies unchanged and is the expected outcome: with this little data Postgres will very
likely sequential-scan whatever exists, in which case **the honest result is no migration
and a recorded plan.** An index is a schema change, `OWNERSHIP.md` §2 allows one migration
in flight, and §17.5 makes the schema human-owned. If the plan genuinely argues for an
index, **stop and ask** — do not generate a migration.

## Files you may touch

```
shared/api.d.ts                                  inside E8's block only — 8.3 opened it
server/src/repositories/session.repository.js    findStudentSessionPage + the unrated count. Reads only
server/src/services/session.history.service.js   NEW. The page, the counts, the serializer call
server/src/controllers/session.controller.js     one handler, no prisma
server/src/validators/session.schema.js          sessionHistorySchema — page/pageSize
server/src/routes/session.routes.js              one route, ABOVE `GET /:id`
server/src/utils/sessionView.js                  toSessionHistoryRecord
server/tests/session.history.test.js             NEW. Serializer, paging, the unrated count, role refusal
client/src/api/session.api.js                    getMySessions
client/src/pages/student/History.jsx             NEW
client/src/components/session/HistoryRow.jsx     NEW. One row, and the rate-this-session link
client/src/router/routes.student.jsx             replace the Placeholder; drop the import if it is the last one
client/src/components/nav/navItems.js            the unrated badge on the History item, if it is done here
docs/epics/E8-ratings-reputation/README.md       tick the status box
```

## Files you must NOT touch

```
server/src/services/session.view.service.js   GET /sessions/:id is 6.3's, and its shape is SessionState
server/src/services/session.end.service.js    this PR reads finished sessions; it does not finish them
server/src/services/session.review.service.js 8.1's. This screen links to the rating, it does not submit one
server/src/services/wallet.view.service.js    the teacher's list is GET /wallet/earnings and it stays 7.6's
server/src/repositories/wallet.repository.js  no ledger read. totalCharged is a sessions column
prisma/schema/**                              see "The plan is measured" — an index is a migration
server/src/routes/index.js                    /sessions is already mounted
client/src/pages/student/Session.jsx          the live screen. This is the dead one
docs/epics/E6a-*/**  docs/epics/E6b-*/**      other epics' chains
```

## Acceptance criteria

- [ ] `GET /api/v1/sessions/mine` as a student returns `200`, newest first, with `total` and `unratedCount`
- [ ] `GET /api/v1/sessions/mine` **before** `GET /api/v1/sessions/:id` in the route file — the request returns a list, not `400 VALIDATION_ERROR` from a uuid check
- [ ] A **teacher's** token returns `403 FORBIDDEN`; no token returns `401 UNAUTHORIZED`
- [ ] Another student's sessions never appear — the filter is `req.user.id` and there is no id in the path to tamper with
- [ ] An `ENDED` session with no review comes back with `review: null`, is counted in `unratedCount`, and its row links to `/app/session/:id/review` — following that link and submitting drops `unratedCount` by one on the next load
- [ ] A `RATED` session shows the stars the student gave, or "no rating" when they gave none
- [ ] A `NO_SHOW` row renders as refunded and shows `totalCharged: 0`
- [ ] Paging matches the ledger's: `?page=2&pageSize=5` is stable and `total` is the whole set
- [ ] The screen renders an empty state for a fresh student, not a spinner and not an error
- [ ] The `EXPLAIN` plan for the list query is pasted into the PR description, and **no migration is included**
- [ ] `npm test` passes; 375px shows no horizontal scroll

## Manual test

1. `npm run db:up && npm run db:seed && npm run dev`. Log in as a seeded student.
2. `/app/history` — empty state.
3. Run a session end to end and rate it. Reload `/app/history`: one row, with the stars.
4. Run a second session, end it, and **close the tab on the rating screen**.
5. `/app/history`: two rows. The second says the rating is unfinished and links to it. The
   sidebar History item carries a badge of 1.
6. Follow the link, submit the rating, come back. The badge is gone and the row shows the
   stars.
7. `select status from sessions where id = '<the second>';` — `RATED`. Before step 6 it is
   `ENDED`, which is the state this screen exists to rescue.
8. Log in as a **teacher** and `GET /api/v1/sessions/mine` from the console — `403`.
9. `EXPLAIN ANALYZE` the list query on the seeded database; paste the plan.

## Review checklist additions

- **`/mine` is above `/:id` and a reviewer should see it in the diff.** This is the one
  ordering mistake in this PR that produces a confusing error rather than an obvious one.
- **No money is computed here.** `totalCharged` is read from the `sessions` column, not
  summed from `session_blocks` and not read from `wallet_transactions`. `reconcile.mjs`
  invariant 2 already checks those agree; a third computation of the same number is the
  7.9 shape.
- The repository functions must not take a `tx` and must not open a transaction — this is
  a plain read and nothing in this PR writes.
- **No minutes on the wire.** If a `minutes` field appears in `SessionHistoryRecord`,
  the reviewer sends it back: `lib/credits.js` is the one translation and it takes
  `block.minutes` from `GET /public/pricing`.
- The unrated link must go to `/app/session/:id/review` — the route 6.6 already owns — and
  must not reimplement any part of the rating form.

## Notes

**Why the student's list is not a teacher's list with a flag.** §14.1 gives the student
`/app/history` and the teacher `/teach/earnings`, and E7 built the second. The rows overlap
and the money does not: the student's row is what they paid, the teacher's is gross, fee
and net. One endpoint answering both would be one serializer with a role branch inside it,
which is the thing `SessionState` gets away with only because both roles are looking at the
same live screen at the same time.

**`unratedCount` is on the response rather than derived by the client** because the client
only ever holds one page, and the number the sidebar badge needs is over the whole set. It
is a second query and it is cheap; the alternative is a badge that says 1 until you page.

**What this screen does not do: rate a session inline.** The rating is a screen with a
comment box, a resolve switch and a stars control, and it exists at
`/app/session/:id/review`. A second, smaller rating form here would be a second client of
`POST /sessions/:id/review` with its own idea of what "no stars" means — and "no stars"
is the one value in this product that two implementations have already been warned about
getting wrong.

**This PR does not touch the classification of an old question.** Rows whose question
landed on the sentinel show no topic label, exactly as 8.3's review rows do, and that is
E6a's problem rather than this screen's.
