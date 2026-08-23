# E8 — Ratings & Reputation

| | |
|---|---|
| **Depends on** | E4 (4.1–4.8 merged) and **E6 (through 6.9)** — 6.6 already writes the review this epic propagates |
| **Blocks** | nothing. E9's moderation queue reads `reviews.comment`, which exists today |
| **Runs alongside** | E6a's 6a.6 and E6b's 6b.4, both open, both docs-only. See "Collision with 6a.6 and 6b.4" below — one shared file, one shared row |
| **Definition of done** | A student rates a teacher five stars on an integrals question, and the *next* integrals question ranks that teacher above where they were before the rating — measurably, from the same database, with the parent topic moved too and the arithmetic visible in `teacher_topic_stats`. |

## The problem this epic has to solve

**Half of `MVP.md` §18's E8 is already merged, and the half that is missing is the only
half that changes a ranking.**

E6's Amendment 3 is the reason. §10's diagram makes `ENDED → RATED` the only edge out of
`ENDED`, so a session could not reach a terminal state without a review, and E8 was two
epics away. **PR 6.6 wrote the review** — `POST /sessions/:id/review`, the `reviews` row,
the three counters on `teacher_profiles`, and the screen that blocks the way out of a
session — and stopped exactly there, with its own header saying "everything that *reads*
these columns is E8's".

So three of §18's six E8 rows are shipped code. Verified against `main` at `10ca916`:

| §18's row | Where it actually is |
|---|---|
| 8.1 `POST /sessions/:id/review` + validation | `session.routes.js:175`, `reviewSchema`, `session.review.service.js`, PR 6.6 |
| 8.3 Update denormalized aggregates on `teacher_profiles` | `applyReviewAggregates` in `review.repository.js:86`, PR 6.6 |
| 8.4 Mandatory rating screen | `client/src/pages/student/RateSession.jsx`, PR 6.6. **With no Skip** — see the deviations table |

**§18's row 8.2 is the one nobody implemented, and it is this epic.**

`teacher_topic_stats` has four `NUMERIC(8,2)` columns. `prisma/seed/teachers.js` fills
them for all fifteen demo teachers. `matching.repository.js` reads two rows of it per
candidate — the question's leaf and its parent. `matching.scoring.js` turns them into
`topicFit`, which carries **0.35 of §9.2's weight**, the heaviest component in the
algorithm. And **no code in the running product writes a single one of those columns.**

E4's README said so in as many words, four epics ago:

> `teacher_topic_stats` is written by nobody until E8, and that is stated, not implied.

E6 said it again from the other side, in `matching.scoring.js`'s own header:

> `teacher_topic_stats` has one writer — the seed — until E8's review service exists.

A session finished this afternoon moves 0.20 of the score through
`applyReviewAggregates`, and moves the 0.35 not at all. **That is what 8.1 fixes, and
everything else in this epic is a surface that shows the result.**

### E8 inherits an open defect from E4, and E8 is the epic that has to close it

`globalRating` is the one §9.2 component left unsmoothed:

```js
globalRating: ratingCount > 0 ? ratingSum / ratingCount / MAX_STARS : 0,
```

E4's retro measured the consequence and named it "the defect this pass was built to
find": with Gil V. (one 5-star rating) and Shira G. flipped `ONLINE`,
`GET /questions/:id/matches` returns **Gil first**, at ≈0.793 against Dana K.'s ≈0.765
for 4.60 across forty sessions. That is §18's own acceptance criterion for E4 failing
end to end, and §9.3's first sentence — "a teacher with a single 5.0 rating **must** rank
below one with 4.6 across 40 sessions" — failing with it.

`topicFit` **is** smoothed and does favour Dana. The gap is the component §9.3's formula
does not cover.

E4's retro assigned the fix to "its own PR against `matching.scoring.js`" and that PR was
never written. It has been inert for four epics for one reason: **nothing moved the
numbers.** The seed was the only writer, so the order was wrong and stable, and a wrong
order nobody can perturb looks like a fixture.

**8.1 ends that, which is why 8.2 is in this epic and not deferred a fifth time.** From
the moment a review propagates into `teacher_topic_stats`, a live rating moves 0.55 of the
score across two components — and the unsmoothed one is the component that can be moved
furthest by the smallest amount of evidence. A single five-star review on a brand-new
teacher takes `globalRating` from 0 to a full 1.0 in one transaction. E8's own §18
acceptance criterion — "rating a teacher 5 stars on an integrals question measurably
raises their rank" — is not checkable while a *different* rating can raise it by more.

So: **E8 fixes it, in its own PR, before 8.1's write is measured.** The alternative —
land the propagation on top of an unsmoothed component — means 8.6's pass cannot tell
which of the two changes moved the list.

### §18's 8.4 contradicts itself, and 6.6 already resolved it

§18's row 8.4 reads "Mandatory rating screen — blocked navigation, **skip after 10s**".
Those are two different products in one line. §10 draws exactly one edge out of `ENDED`,
and it goes to `RATED`; a Skip button is an edge to nowhere, and a session that took it
sits in `ENDED` for ever with `resolved_count` never incremented.

6.6 made the call and wrote it into `RateSession.jsx`'s header:

> That is why the screen has no **Skip** and no back link — 6.7 owns how the blocking
> feels, this PR owns the fact that it blocks.

**E8 does not reopen it.** It goes in the deviations table, not in code. What E8 *does*
add is the honest consequence of blocking: a student who closes the tab on the rating
screen leaves a session in `ENDED` with no review and no way back to it. **8.4's history
screen is that way back** — every `ENDED` row it renders carries an unfinished rating and
a link to the screen that finishes it. That is the difference between a mandatory rating
and a lost one.

### §12 gives the history screen no endpoint. This is the second time.

E7 hit this exactly once already, and wrote it down:

> §18's 7.8 promises an earnings screen and §12 gives it no endpoint.

§12 is not silent this time — it lists `GET /students/me/sessions`, "Paginated history".
**There is no `/students` router**, there never has been, and `routes/index.js` mounts
`auth · offers · public · questions · sessions · teachers · wallet`. Creating a
`student.routes.js` for one endpoint would create a `student.repository.js` whose only job
is to read the `sessions` table — which is precisely the move E7 refused when it put
`GET /wallet/earnings` on the wallet router rather than on `/teachers/me`, and for
precisely the same stated reason: **the read belongs to the router that owns the table.**

So the history is `GET /sessions/mine`, on `session.routes.js`, and §12's row is a
deviation with a why. Worth saying out loud that this is the second epic running where
§12's endpoint table and §14.1's screen list do not describe the same product: §12 was
written before the routers were, and the routers were split by table.

### Nothing in this epic is `MVP.md` §17.5 human-written, and that is checkable

§17.5 names five areas: `wallet.service.js`, the three critical transactions, the Prisma
schema, auth middleware, and the LLM prompts.

**E8 touches none of them.**

- **No money.** A review moves no balance and appends no ledger row. `wallet.service.js`
  is on every denylist in this epic. `reconcile.mjs` should return the same zero rows
  after E8 as before it, and 8.6 runs it to prove exactly that.
- **No schema.** Every column E8 writes already exists: `teacher_topic_stats`'s four
  since the init migration, `reviews`'s six since the same, `teacher_profiles`'s three
  written by 6.6. See the constraint below.
- **No auth middleware.** Every new route uses the existing `authenticate` / `authorize`
  pair, and the public reviews read uses neither, exactly as `GET /teachers/:id` does.
- **No prompts.** The classifier is E3's and E6a's and E8 does not open `llm.service`.

The one transaction E8 extends — 6.6's review transaction — is not one of §17.5's three
critical ones. Those are the offer lock, the block charge and the settlement, all of them
money or a race for a single teacher. This one races nothing: `session.review.service.js`
already holds `FOR UPDATE OF s` on the session row and the `ENDED → RATED` edge has
already been won by the time the topic write runs. **It is still one transaction, and 8.1
must not make it two** — a `reviews` row that exists while `teacher_topic_stats` does not
is the same under-reporting KPI 6.6's header warns about, one level down, and there is no
reconciliation query that would ever find it.

## No schema change, and none is needed

Every column this epic writes exists today:

| Table | Columns E8 writes | Since |
|---|---|---|
| `teacher_topic_stats` | `rating_sum`, `rating_count`, `resolved_count`, `sessions_count` — all `NUMERIC(8,2)` | init migration |
| `teacher_profiles` | nothing new. 6.6 already writes the three counters | PR 6.6 |
| `reviews` | nothing new. 6.6 already writes the row | PR 6.6 |

`OWNERSHIP.md` §2 allows one migration in flight and `MVP.md` §17.5 makes the schema
human-owned. **If a brief in this epic seems to need a column, stop and ask** — do not
generate a migration. The most likely false alarm is "reviews needs a `topic_id` so the
public profile can label a review"; it does not, because `reviews.session_id` reaches
`sessions.question_id` reaches `questions.subtopic_id`, which is a join and not a column.

The `NUMERIC(8,2)` choice is load-bearing and worth restating, because 8.1 is the first
code that depends on it. `teachers.prisma` says why:

> A session on a subtopic propagates to its parent topic at weight 0.3 (MVP.md §9.3);
> integer columns would truncate that to zero and the Bayesian smoothing would silently
> never see parent history.

## The 0.3 exists twice. E8 must not make it three.

`PARENT_TOPIC_WEIGHT = 0.3` lives in `server/src/config/constants/matching.js:37`.
`PARENT_WEIGHT = 0.3` lives in `prisma/seed/teachers.js:242`, inside `deriveTopicStats`,
which is the seed's own implementation of the propagation 8.1 is about to write for real.

Two implementations of one rule is already one more than the repo wants. **Three is the
shape of E7's 7.9** — §5.3's commission read from three different dates at three call
sites, two of them wrong — and that defect is open on `main` today.

So **8.1 imports `PARENT_TOPIC_WEIGHT` and writes no literal.** The seed's copy stays,
because `prisma/seed/*` cannot reach `server`'s `#config` subpath imports and moving a
matching parameter into `@tutor/shared` would put a ranking weight in the package the
*client* imports. What 8.1 adds is a comment on each side naming the other, so the next
person to change one knows there are two. Unifying them properly is filed as an open item
in the retro, not smuggled into this epic.

## What a review will move once 8.1 lands

Stated as a table, because "the review updates the stats" hides which of §9.2's six
components actually change and by how much.

| §9.2 component | Weight | Moved by a review today | Moved after 8.1 |
|---|---|---|---|
| `topicFit` | **0.35** | **nothing** | the leaf at 1.0, the parent at 0.3 |
| `globalRating` | 0.20 | `rating_sum` / `rating_count` (6.6) | same, **and smoothed** (8.2) |
| `resolveRate` | 0.20 | `resolved_count` (6.6) — numerator only | same |
| `acceptanceRate` | 0.10 | nothing. E5's counters | nothing |
| `history` | 0.10 | the `reviews` row itself, at ≥4 stars | same |
| `newTeacherBoost` | 0.05 | nothing. `sessions_count` moves at session end | nothing |

Two things in that table are worth more than the rest.

**`resolveRate`'s denominator is not the review's.** `applyReviewAggregates` increments
`resolved_count`, `rating_sum` and `rating_count` — three columns, not the four E6's note
3 claims. `sessions_count` on `teacher_profiles` is written by
`releaseTeacherAfterSession` when the session *ends*, rated or not. That asymmetry is
correct at profile level and it does not survive to topic level: **`teacher_topic_stats`
has no writer at session end, so its `sessions_count` counts rated sessions only.** A
student who closes the tab moves the profile's denominator and not the topic's, and the
two resolve rates will therefore disagree for that teacher. 8.1 does not fix this by
adding a second writer at session end — that would need the question's topics inside the
settlement transaction, which is one of §17.5's three — it documents it, and 8.4's history
screen makes the unrated session recoverable so the gap closes by a student's action
rather than by a cron job.

**`history` becomes real in this epic without anyone writing a line for it.** §9.2's
`history_bonus` reads `reviews` for a prior rating of ≥4 from this student
(`HISTORY_MIN_STARS`), and `reviews` was empty through E4 and E5. From 6.6 it is not, and
from E8's first real rating a returning student sees their previous teacher promoted by a
full 0.10 and badged 💙 on the selection screen. Nothing in E8 implements that; E4 did.
It is listed here so 8.6's pass does not attribute the movement to 8.1.

## Collision with 6a.6 and 6b.4

Both open PRs are DEV-A's and both are docs-only. Checked against their allowlists.

| File | 6a.6's claim | 6b.4's claim | E8's claim | Rule |
|---|---|---|---|---|
| `docs/README.md` | the epic index, three epics behind | — | this PR adds the E8 row; 8.6 sets its status | Different rows of one table. Whoever lands second rebases — E7's ruling, unchanged |
| `docs/OWNERSHIP.md` | the `media.service.js` row | — | 8.6 adds the `review.repository.js` / `matching.scoring.js` owner rows | Different rows, same table |
| `docs/DEPLOYMENT.md` | — | the two variables and the proxy | nothing | No overlap |
| `docs/epics/E6a-*/**`, `E6b-*/**` | theirs | theirs | **denied in every E8 brief** | Named on every denylist below |

Both of those PRs deny `server/**`, `client/**`, `shared/**` and `prisma/**` outright, so
**every code file in this epic is uncontested.** The only real contact is the epic index
row, and it is one line.

**`matching.scoring.js` is the file to check twice, and it is clean.** It is DEV-B's by
the 4.1 → 4.3 ownership transfer its own header records, and 8.2 opens it. Nothing in
6a.6 or 6b.4 touches it, E6a's classifier work finished at 6a.5, and the single-developer
note applies: DEV-A owns every open branch in the repo. The header's transfer paragraph is
history and 8.2 updates it rather than pretending it did not happen.

**7.9 is filed and unwritten**, at
[`../E7-wallet-billing/PR-7.9-commission-column.md`](../E7-wallet-billing/PR-7.9-commission-column.md).
It touches `session.end.service.js` and `utils/commission.js`; **E8 touches
`matching.scoring.js` and never those two.** No overlap, but 8.2 and 7.9 both edit a file
somebody could describe as "the scoring one", so the boundary is named here rather than
discovered at a rebase.

## The split

| | DEV-A (eliya) | DEV-B (rotem) |
|---|---|---|
| **Slice** | **All of E8.** The write §18 skipped, the ranking defect four epics inherited, and the three surfaces that read them | — |
| **Server** | 8.1 the topic-stats write, 8.2 the smoothing fix, 8.3's reviews read, 8.4's history read, 8.5's per-topic read | — |
| **Client** | 8.3's profile section, 8.4's history screen, 8.5's teacher dashboard block | — |
| **Filler** | 8.5, and 8.6's ranking pass | — |

Single-developer epic, the fourth in a row — E5, E6, E7 and now E8 — so the template's
"both developers ship server and client work" is satisfied inside the one column. DEV-A
has two pure-server PRs, three server-plus-screen PRs and one close.

**If a second developer appears mid-epic, the clean hand-off is 8.4.** It depends only on
tables that exist, touches nothing 8.1 or 8.2 opens, and is the largest single piece of
screen work in the epic. 8.1 and 8.2 are not hand-offable at any point — not because
§17.5 forbids an agent (it does not; see above) but because they are the two PRs that
change every ranking in the product, and the person who measures them in 8.6 should be
the person who wrote them.

## Order

| # | PR | Owner | Size | Depends on | Status |
|---|---|---|---|---|---|
| 8.1 | [The write nobody wrote — `teacher_topic_stats`, at 1.0 and at 0.3](PR-8.1-topic-stats-write.md) | DEV-A | M | E6 (6.6) | ☑ |
| 8.2 | [The defect E4 filed and four epics inherited — `globalRating` is unsmoothed](PR-8.2-global-rating-smoothing.md) | DEV-A | S | — | ☐ |
| 8.3 | [Reviews on the public profile — `GET /teachers/:id/reviews` and the section that renders it](PR-8.3-public-reviews.md) | DEV-A | L | — | ☐ |
| 8.4 | [The session history, and the way back to an unfinished rating](PR-8.4-session-history.md) | DEV-A | L | — | ☐ |
| 8.5 | [The teacher's own per-topic reputation — `GET /teachers/me/stats`](PR-8.5-teacher-topic-stats.md) | DEV-A | M | 8.1 | ☐ |
| 8.6 | [E8 close: §18's ranking pass, and the retro](PR-8.6-e8-close.md) | DEV-A | S | 8.1, 8.2, 8.3, 8.4, 8.5 | ☐ |

Status: ☐ not started · ◐ partial · ☑ done. Size: S (<2h) · M (2–4h) · L (half day+).
No PR in this epic is `MVP.md` §17.5 human-written — the section above says why, and 8.6's
review checklist re-checks it rather than trusting this paragraph.

**8.2 before 8.1 is a legitimate order and the reverse is not measurable.** Either lands
alone; but if 8.1 lands first, the next ranking measurement contains two changes and
attributes both to whichever is easier to see. 8.2 is an afternoon and it comes first.

## Parallelism map

```
  6a.6 ─┐                                   (docs only, DEV-A)
  6b.4 ─┴─ docs/README.md epic index ┈┈┈┈┈┈┈ one row, named above
                                     ┊
  E8   8.2  globalRating smoothing   ┊  ← independent of everything. Land it first.
        │                            ┊
        │   8.3  public reviews  ────┊──┐   ← independent: reads `reviews`, which 6.6 fills
        │                            ┊  │
        │   8.4  session history ────┊──┤   ← independent: reads `sessions`, which E6 fills
        │                            ┊  │
       8.1  teacher_topic_stats      ┊  │
        │                            ┊  │
       8.5  per-topic screen ────────┴──┴─ 8.6  close: the ranking pass + retro
```

**Only one arrow in this epic is real: 8.1 → 8.5.** 8.5 renders the table 8.1 starts
writing, and against seeded data alone it would render fifteen teachers' fixtures and zero
evidence that anything works.

**8.3 and 8.4 do not wait for 8.1**, and that is the useful property of this graph: both
read tables that E6 already fills, so either can be written on a day the ranking chain is
blocked. That is the honest answer to "what does one developer do while re-reading their
own agent's diff on the file that decides every ranking in the product".

## Contract freeze

Appended to `shared/api.d.ts` by **8.3**, in one new `// ── E8 — ratings & reputation ──`
block at the end of the file, opened whole — including the shapes 8.4 and 8.5 implement.
Later PRs append **inside** that block. The file is append-only and every append at EOF is
a place two branches conflict; E7 opened its block once in 7.2 for exactly this reason and
it worked.

Changing anything below is a chat message before the code.

```ts
/**
 * One review as a stranger sees it on a teacher's profile.
 *
 * **There is no student on this shape and there is not going to be one.** The page is
 * about the teacher; the student is a third party who wrote a sentence about a maths
 * problem, and `GET /teachers/:id/reviews` is unauthenticated. §6.3's rule — the
 * platform states only what it can stand behind — cuts the same way: "Dana K. said
 * this" is a claim about Dana, and nothing on the profile needs it.
 */
export interface TeacherReview {
  id: string;
  /** 1–5, or null. **A review without stars is common** — `isResolved` is the only required field (§6.2). */
  stars: number | null;
  isResolved: boolean;
  /** The student's own words, or null. Unmoderated — see the risks section. */
  comment: string | null;
  /** The question's subtopic, for the row's label. Null on the sentinel path (`topic_id = 0`). */
  topicName: string | null;
  /** ISO 8601, UTC. `reviews.created_at`. */
  createdAt: string;
}

/**
 * `GET /teachers/:id/reviews?page&pageSize`. Public, unauthenticated, newest first.
 *
 * **Its own endpoint rather than a field on `TeacherCard`**, because reviews are paged
 * and a card is not, and because `TeacherCard` is frozen in E2's README and rendered by
 * three screens that have no use for a review array.
 */
export interface TeacherReviewsResponse {
  reviews: TeacherReview[];
  /** Every review, not the page. The number beside the stars on the profile. */
  total: number;
}

/**
 * One finished session, from the student's side. `GET /sessions/mine`.
 *
 * **No minutes and no money beyond `totalCharged`.** Minutes are `blocksUsed ×
 * block.minutes` and `lib/credits.js` already owns that translation — E7 ruled on this
 * once and the ruling holds: a server-computed minute figure is a second rounding of a
 * number the client already renders.
 */
export interface SessionHistoryRecord {
  sessionId: string;
  status: SessionStatus;
  /** ISO 8601, UTC. `sessions.ended_at`. Null for a `CANCELLED` session that never ran. */
  endedAt: string | null;
  /** The teacher. A history entry without a name is a receipt. */
  teacher: { id: string; fullName: string };
  /** The question's subtopic label, then its parent, then null. */
  topicLabel: string | null;
  /** The question's own title, for the row a student will actually recognise. */
  questionTitle: string | null;
  blocksUsed: number;
  /** Credits. `sessions.total_charged`. Zero on a refunded no-show. */
  totalCharged: number;
  /**
   * The student's own review, or null.
   *
   * **Null on an `ENDED` row is the actionable state**, not an empty one: §10 makes the
   * rating mandatory, so that session has not reached a terminal state and the screen
   * links back to `/app/session/:id/review`. See the README.
   */
  review: { stars: number | null; isResolved: boolean } | null;
}

/** `GET /sessions/mine?page&pageSize`. Student-only. Newest first. */
export interface SessionHistoryResponse {
  sessions: SessionHistoryRecord[];
  total: number;
  /** How many `ENDED` sessions carry no review. The badge on the sidebar link. */
  unratedCount: number;
}

/**
 * One row of `teacher_topic_stats`, as the teacher sees their own.
 *
 * **The four stored columns are `NUMERIC(8,2)` and three of them arrive here as
 * whole-ish numbers that are not whole.** A parent topic accumulates at
 * `PARENT_TOPIC_WEIGHT`, so 42 leaf sessions is 12.6 parent ones — `matchView.js`
 * already met this and rounds for display. This shape carries the honest value and the
 * screen decides; a server that rounded would make the teacher's own numbers disagree
 * with the algorithm's.
 */
export interface TopicStatRecord {
  topicId: number;
  slug: string;
  nameHe: string;
  nameEn: string;
  /** False for a parent topic — its numbers are propagated, not taught. */
  isLeaf: boolean;
  sessionsCount: number;
  resolvedCount: number;
  /** `rating_sum / rating_count`, on the 1–5 scale. Null when `rating_count` is 0. Not 0. */
  rating: number | null;
  ratingCount: number;
}

/**
 * `GET /teachers/me/stats` — §12's row, implemented for the first time in 8.5.
 *
 * Leaves first, each followed by nothing: the tree is flat and `isLeaf` is what a
 * renderer groups on. Ordering is `sessionsCount` descending, which is "what you teach
 * most" and is also the order the teacher would sort it into by hand.
 */
export interface TeacherStatsResponse {
  topics: TopicStatRecord[];
}
```

**No socket event.** `shared/socketEvents.js` gains nothing in this epic. A rating changes
a ranking, and a ranking is read by a request rather than pushed — there is no open screen
anywhere in the product showing a number a review moves. `wallet:updated` was appended in
7.3 because a top-up changes a figure on a screen the user is looking at; nothing here
does.

### The internal seam — not in `api.d.ts`, but frozen just as hard

8.1's arithmetic is a pure function and it is the one thing in this epic two PRs meet at.
It is frozen here for the same reason `rankCandidates`'s signature was frozen in E4's
README: 8.1 writes it and 8.6 measures it, and a shape discovered at measurement time is a
shape nobody agreed to.

```js
/**
 * The two `teacher_topic_stats` rows one review moves. §7, §9.3.
 *
 * Pure. No Prisma, no clock, no request. Takes the same triple
 * `applyReviewAggregates` already receives, so the topic-level and profile-level
 * numbers cannot be computed from different rules.
 *
 * Returns `[]` when there is no leaf — the sentinel path (`topic_id = 0`) carries no
 * topical evidence and a stats row on "unclassified" would give every teacher who
 * ever took an unclassified question history in a topic that means "we do not know".
 *
 * Returns one row, not two, when leaf and parent are the same id.
 *
 * @param {object} params
 * @param {number|null} params.subtopicId  the question's leaf
 * @param {number|null} params.topicId     the question's parent
 * @param {number} params.sessionsCount    always 1
 * @param {number} params.resolvedCount    1 or 0
 * @param {number} params.ratingSum        the stars, or 0
 * @param {number} params.ratingCount      1 when stars were given, 0 when they were not
 * @returns {Array<{topicId: number, sessionsCount: number, resolvedCount: number,
 *                  ratingSum: number, ratingCount: number}>}
 */
export function topicStatDeltas({ subtopicId, topicId, ... }) {}
```

The two rules that must not be got wrong, stated rather than left in the arithmetic:

- **`ratingCount` is `0` when no stars were given, and the parent's is `0 × 0.3`, which
  is still 0.** `rating_sum += stars ?? 0` beside an unconditional `rating_count += 1` is
  the defect `session.review.service.js` is already careful about at profile level; at
  topic level it is worse, because `topicFit` carries 0.35 rather than 0.20 and the
  Bayesian smoothing divides by exactly that count.
- **The parent is discounted once, here, and never again.** `matching.scoring.js`'s
  `topicRatingPair` reads the parent row and deliberately does not import
  `PARENT_TOPIC_WEIGHT`, with a header saying why: applying the discount a second time
  would be invisible — everything still ranks in a plausible order, just wrong.

## Deliberate deviations from `MVP.md` §18

| §18 said | We do | Why |
|---|---|---|
| **Owner: B** | **DEV-A takes E8** | Single developer since 2026-08-23; the DEV-A/DEV-B split in the older epic docs is historical. §17.7's one-epic-per-owner rule is satisfied trivially |
| 8.1 `POST /sessions/:id/review` + validation, **S** | **Already merged**, PR 6.6 | §10 makes `ENDED → RATED` the only edge out of `ENDED`, so E6 could not ship a session lifecycle without it. E6's Amendment 3 |
| 8.2 `rating.service` — update `teacher_topic_stats` with 0.3 parent propagation, **M** | **The epic.** One pure function, one repository upsert, inside 6.6's existing transaction. **No new service** | A second service means a second transaction, and a `reviews` row committed without its topic stats is a KPI that under-reports for ever with no reconciliation query that would find it. The rule is 6.6's own and E8 does not weaken it |
| 8.3 Update denormalized aggregates on `teacher_profiles`, **S** | **Already merged**, PR 6.6 — and it is **three** columns, not four | `applyReviewAggregates` moves `resolved_count`, `rating_sum`, `rating_count`. `sessions_count` is written at session end by `releaseTeacherAfterSession`, rated or not. E6's note 3 says four; the code says three, and the difference is a denominator |
| 8.4 Mandatory rating screen — blocked navigation, **skip after 10s** | **Already merged**, PR 6.6, **with no Skip** | §10 draws one edge out of `ENDED` and a Skip is an edge to nowhere. 6.6 decided it and wrote the reason into `RateSession.jsx`. E8 adds the consequence instead: 8.4's history screen is the way back to an unfinished rating |
| 8.5 Public teacher profile + reviews (guest-accessible), **M** | The profile exists since 2.3. **8.3 adds the reviews**, as their own paged endpoint | `TeacherCard` is frozen in E2's README and rendered by three screens; growing it by a review array would change a shape none of them wants. Reviews are paged and a card is not |
| 8.6 Session history screen (student), **M** | **8.4**, and the endpoint is `GET /sessions/mine` | See below |
| §12: `GET /students/me/sessions` | `GET /sessions/mine` | There is no `/students` router and never has been. A router for one endpoint would mean a `student.repository.js` reading the `sessions` table — the move E7 refused for `GET /wallet/earnings`, for the same stated reason |
| §12: `GET /public/teachers/:id` — "Public profile + reviews" | `GET /teachers/:id` (2.3) plus `GET /teachers/:id/reviews` (8.3) | E2 already ruled that a teacher list is not `/public`: `/public` is taxonomy and money, cached for `PUBLIC_CACHE_SECONDS`, and a teacher who just went online would be served stale for the rest of the day |
| §12: `GET /teachers/me/stats` — "Per-topic ratings" | **8.5.** First implementation | Nothing could implement it before 8.1: the table it reads had one writer and it was the seed |
| Nothing about `globalRating` | **8.2 smooths it** | E4's retro filed the defect, assigned it to its own PR, and that PR was never written. 8.1 makes it live rather than seeded, and E8's own §18 criterion is not measurable while a different component can move a rank further |
| Six PRs | Six PRs, three of them different work | Three of §18's rows are merged; three of E8's rows are not in §18 at all. The mapping is this table |

## Risks

- **The five-minute averages cache will make 8.6's acceptance pass look like a
  failure.** `getPlatformAverages()` holds its result for `PLATFORM_AVERAGES_CACHE_MS`,
  and every smoothed component is measured against it. Rate a teacher, re-run the match
  within five minutes, and the *prior* is stale even though the teacher's own numbers
  moved. `clearPlatformAveragesCache()` is exported for exactly this and 8.6's manual test
  must use it or restart the server. This is not a defect and it must not be "fixed"
  during the pass.
- **8.2 changes every ranking in the product, and E4's tests pin the current
  arithmetic.** `server/tests/matching.scoring.test.js` asserts component values against
  fixtures, and at least one of them asserts an unsmoothed `globalRating`. Those
  assertions are correct today and must be *changed with an argument*, not relaxed until
  green. "The suite went red and I updated the expected number" is how a ranking rule
  becomes a ranking bug, and it is the single review line that matters most in 8.2.
- **The propagation writes into a `NUMERIC(8,2)` column through JavaScript floats.**
  `0.3 × 3` is `0.8999999999999999` in IEEE 754 and Postgres rounds it to `0.90` on the
  way in — which is fine — but Prisma's `increment` on a `Decimal` field and a repeated
  `0.3` are two places a rounding argument could hide. 8.1 asserts the stored value, not
  the computed one, and reads the column back in its own test rather than trusting the
  arithmetic it just did.
- **The sentinel topic is a real path and it will be taken.** E4's retro records the
  classifier down for an entire verification pass, three occurrences across E3 and E4, and
  E6a exists because of it. A question on `topic_id = 0` produces a session, a rating and
  a teacher who deserves credit for it — and **8.1 writes nothing** for it, on purpose.
  Every teacher accumulating history in a topic named "unclassified" would be worse than
  no history at all, because §9.1 lets `topic_id == 0` past the topic filter, so that row
  would score in *every* match.
- **`GET /teachers/:id/reviews` puts unmoderated free text on an unauthenticated URL.**
  `reviews.comment` is a student's own words, written on a screen with no character
  guidance and no review, and moderation is E9. The endpoint must page (an unbounded read
  of every review a popular teacher ever received is also a denial-of-service shape), and
  the epic should be honest that the mitigation for abusive text in the MVP is that E9
  exists, not that anything in E8 checks it.
- **Two resolve rates will disagree for the same teacher, and a demo will show both.**
  `teacher_profiles`' denominator moves at session end; `teacher_topic_stats`' moves at
  rating. A teacher whose students close the tab has a profile resolve rate lower than
  every one of their topic resolve rates. `matchView.js` renders the topic one on the
  selection card and `toTeacherMe` carries the profile one. Named so that the first person
  to notice files it as a question rather than as a bug.
- **8.4's history screen is the first read in the product that joins four tables for a
  list**, and `sessions` has no index on `student_id`. Fifteen demo students will not show
  it. The brief requires an `EXPLAIN` on the seeded database and at most one index — and
  4.2's ruling applies unchanged: with this much data Postgres will very likely
  sequential-scan anyway, in which case the honest outcome is **no migration** and a
  recorded plan. An index is a schema change and the constraint above still holds.
- **Nothing in this epic moves money, and 8.6 has to prove it rather than assert it.**
  `reconcile.mjs` returns five zero-row invariants on `main` today. If E8 has broken one,
  something in a rating transaction reached the wallet, which would be the most surprising
  defect in the project. The pass runs it.

---

## Checklist before writing the PR briefs

- [x] Every PR names exactly one owner — DEV-A, all six
- [x] No two in-flight PRs edit the same file — 8.1 and 8.5 share `review.repository.js` and `teacher.repository.js` in that order; nothing else overlaps. 8.2 is alone in `matching.scoring.js`
- [x] Any shared file is either frozen, append-only, or split by domain — `shared/api.d.ts` (one block, opened by 8.3), `routes/index.js` (append-only, and E8 adds no mount), `docs/README.md` (one row)
- [x] Human-written items from `MVP.md` §17.5 are marked as such — **there are none**, and the section above argues each of the five areas rather than asserting it
- [x] Each PR has an allowlist and a denylist
- [x] Each PR has acceptance criteria a human can check in under five minutes
- [x] Both developers have server and client work — single-developer epic; DEV-A has two server-only PRs, three server-plus-screen PRs and a close
- [x] There is filler work for whoever finishes first — 8.3 and 8.4 are off the chain by design, and 8.5 is the last thing before the pass
