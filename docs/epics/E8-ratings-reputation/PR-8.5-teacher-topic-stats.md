# PR 8.5 — The teacher's own per-topic reputation: `GET /teachers/me/stats`

| | |
|---|---|
| **Epic** | E8 — Ratings & Reputation |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 8.1 (the table has a live writer), 8.3 (E8's `shared/api.d.ts` block) |
| **Blocks** | 8.6 — it is the screen the pass reads the propagation off |
| **Branch** | `dev-a/E8.5-teacher-topic-stats` |

## Contract implemented

`GET /api/v1/teachers/me/stats` → `TeacherStatsResponse`. Teacher-only.

`MVP.md` §12's "Per-topic ratings" row, unimplemented until now, and §14.1's `/teach`
dashboard — "availability toggle · earnings · rating".

## Scope

**This is the first screen in the product that shows `teacher_topic_stats` to a human.**
Until 8.1 there was nothing to show: the table had one writer and it was the seed, so a
screen would have rendered fifteen fixtures and no evidence that anything worked. After
8.1 it is the teacher's own reputation, per topic, and it is the only place the 0.3
propagation is visible without a `psql` prompt.

**One read, one serializer, one block on the teacher's dashboard.** The read is
`teacher_topic_stats` joined to `topics` for the names, filtered to `req.user.id`, ordered
by `sessions_count` descending — which is "what you teach most", and the order a teacher
would sort it into by hand.

**`isLeaf` is `topics.parent_id IS NULL` inverted, and the screen needs it.** A parent row
is not a topic the teacher taught; it is the sum of their leaves at 0.3. Rendering the two
in one flat list without distinguishing them shows a teacher "Calculus: 12.6 sessions"
beside "Integration by parts: 42 sessions" and makes the platform look like it cannot
count. The screen groups: leaves as the rows, parents as the section headers or a muted
summary line, with one sentence of explanation — this is a teacher looking at their own
numbers and the honest version is more useful than the tidy one.

**The fractions are not rounded on the server.** `matchView.js` already met this exact
number and wrote it down — a parent accumulates at `PARENT_TOPIC_WEIGHT`, so 42 leaf
sessions is 12.6 parent ones, and "solved 12.6 questions" is not a card, so the *card*
rounds. This endpoint is not a card. It carries the stored value and the screen decides,
because a server that rounded would make the teacher's own numbers disagree with the ones
the algorithm ranks them on — and the whole reason to show this screen is that they agree.

**`rating` is `null` when `rating_count` is zero, not `0`.** Same rule `TeacherCard`
already states: "null until the teacher has been rated at least once. Not 0." A teacher
with sessions and no stars has taught and has not been rated, and those are different
facts.

**The route goes in `teacher.routes.js`'s `/me` block, above `/:id`.** That block is
DEV-B's by 2.2's split and the file's own comment says `/me` must win over `/:id`; this is
a third `/me` route beside `GET /me` and `PATCH /me`, added to the same block.

**The screen is a block on `/teach`, not a new route.** §14.1's teacher tree has five
entries and none of them is a stats page; the dashboard's third element is "rating" and
this is what that means now that per-topic numbers exist. If it grows past a card, that is
a new route in a later PR, not a widening of this one.

## Files you may touch

```
shared/api.d.ts                                  inside E8's block only — 8.3 opened it
server/src/repositories/teacher.repository.js    findTeacherTopicStats — Decimal converted here, per its own rule
server/src/services/teacher.me.service.js        getMyTopicStats
server/src/controllers/teacher.me.controller.js  one handler, no prisma
server/src/validators/teacher.me.schema.js       no body, no params — the empty-query schema
server/src/routes/teacher.routes.js              one route in the /me block
server/src/utils/teacherView.js                  toTopicStatRecord
server/tests/teacher.stats.test.js               NEW. Decimal → number, null rating, leaf/parent, ordering
client/src/api/teacher.api.js                    getMyTopicStats
client/src/pages/teacher/Dashboard.jsx           the block
client/src/components/teacher/TopicStatsCard.jsx NEW
docs/epics/E8-ratings-reputation/README.md       tick the status box
```

## Files you must NOT touch

```
server/src/repositories/matching.repository.js  it reads two rows of this table for ranking. Different query, different caller
server/src/services/matching.scoring.js         8.2's, and it consumes these numbers rather than presenting them
server/src/utils/matchView.js                   the student's card rounds. This screen does not
server/src/utils/topicStats.js                  8.1's writer. This PR reads
server/src/services/teacher.public.service.js   8.3's, and a stranger does not see this breakdown
prisma/schema/**                                every column exists
client/src/pages/guest/TeacherProfile.jsx       8.3's screen
docs/epics/E6a-*/**  docs/epics/E6b-*/**        other epics' chains
```

## Acceptance criteria

- [ ] `GET /api/v1/teachers/me/stats` as a teacher returns `200` and `{ topics: [...] }`, ordered by `sessionsCount` descending
- [ ] A **student's** token returns `403 FORBIDDEN`; no token returns `401 UNAUTHORIZED`
- [ ] Every numeric field is a JSON `number`, never a string and never `{"s":1,"e":0,"d":[…]}` — no `Prisma.Decimal` leaves the repository, which is that file's own stated rule
- [ ] A parent row comes back with `isLeaf: false` and a fractional `sessionsCount`; a leaf row with `isLeaf: true` and a whole one
- [ ] A topic with `ratingCount: 0` returns `rating: null`, and the screen shows "not rated yet" rather than 0.0
- [ ] A teacher with no rows returns `{ topics: [] }` and the screen shows an empty state, not a broken card
- [ ] After one rating through 8.1, reloading `/teach` shows the leaf row up by one session and the parent row up by 0.30 — **without a restart**
- [ ] `npm test` passes; 375px shows no horizontal scroll

## Manual test

1. `npm run db:up && npm run db:seed && npm run dev`. Log in as a seeded teacher.
2. `/teach` — the topic block lists their seeded topics, leaves separated from parents.
3. Compare one row against `select * from teacher_topic_stats where teacher_id = '…';` —
   the screen shows the stored numbers, not rounded ones.
4. Run one session with this teacher on an integrals question. Have the student rate it 5
   stars, solved.
5. Reload `/teach`. The leaf is `+1` session and `+5` rating sum; the parent is `+0.30`
   and `+1.50`. **This is the propagation, visible without a database client** — and it is
   the screenshot 8.6's pass takes.
6. Log in as a student and `GET /api/v1/teachers/me/stats` — `403`.

## Review checklist additions

- **The `Decimal` conversion happens in the repository and nowhere else.**
  `matching.repository.js` states the rule for this exact table — "No `Prisma.Decimal`
  leaves this file" — and a second converter in a serializer is two places that can
  disagree about what `12.60` is.
- **No rounding on the server.** If `toTopicStatRecord` calls `Math.round`, it is the
  wrong layer; `matchView.js` rounds because a card has to, and this endpoint is not a
  card.
- The route is in the `/me` block and above `/:id`. `teacher.routes.js` already carries
  the comment saying why.
- `rating` must be `null` and not `0` when `ratingCount` is `0`. The same slip is already
  documented on `TeacherCard`.

## Notes

**Why this is filler and still worth writing.** It reads a table 8.1 makes real and adds
no rule of its own, so it can be dropped without changing what E8 delivers. It earns its
place because it is the only surface where the parent propagation is legible: 8.6's
acceptance criterion is "measurably raises their rank, and slightly raises it for other
calculus questions", and "slightly" is a fraction in a column that, without this screen,
only exists in `psql`.

**Two resolve rates will disagree on the same page eventually.**
`TeacherMeResponse` already carries `sessionsCount` and `resolvedCount` from
`teacher_profiles`, whose denominator moves when a session *ends*; this block's
denominators move when a session is *rated*. A teacher whose students close the tab sees a
lower rate on the header than on any of their topics. That is documented in the epic
README's risks; if the dashboard shows both figures in one glance, this PR adds the
sentence that explains it rather than hiding one of them.

**§12 promised this endpoint and nothing could have implemented it.** Until 8.1 the table
had one writer and it was `prisma/seed/teachers.js`, so this screen would have shown every
teacher a fixture and every real teacher nothing. It is listed as a deviation in the epic
README only because §18's E8 rows do not mention it at all.
