# E4 — Matching Engine

| | |
|---|---|
| **Depends on** | E2 (2.1–2.6), E3 (3.1–3.7 merged). **Not** on 3.8, and **not** on F1/F3 — see "What E4 does not wait for". |
| **Blocks** | E5 (an offer is sent to a teacher the student picked here), E8 (the stats this epic reads are the stats ratings will write) |
| **Definition of done** | A student who has just confirmed what their question is about presses one button and sees a short, ordered list of teachers who are online, teach that topic, teach at that level, and cost less than the student can afford — each card saying how many minutes their balance buys with that teacher, and the integrals specialist above the generalist. |

## The problem this epic has to solve

`MVP.md` §18 gives all six PRs to DEV-B. Read literally that is four days of backend for
one person and nothing for the other, which is the split the epic template rejects by
name and which E1, E2 and E3 all deviated from for the same reason.

The obvious repair — "B does the engine, A does the screen" — is worse than it looks. It
is still layer-cut rather than feature-cut, it blocks the screen behind the whole engine,
and it puts the one number that matters on both sides of the wall: the **price ceiling**
is a query parameter, a SQL predicate, a wallet rule, a segmented control and a
minutes-per-credit label, and whoever owns half of those will get a bug report about the
other half.

E3's answer was to cut by **seam** rather than by layer, and E4 has a cleaner one than E3
did, because §9 is already two separable questions:

- **Who is even eligible, and what can this student afford?** §9.1. Rows, filters, a
  wallet balance, a band ceiling. Ends in a list of candidates.
- **In what order do the eligible ones come back, and how does the student read that
  order?** §9.2–§9.3. Arithmetic over those rows, then a screen that shows the result and
  never shows the scores.

So **DEV-A owns the pool** — the candidate query, the ceilings, the two ways the pool can
be empty, the endpoint, and on the client the credit-to-minutes translation and the price
control. **DEV-B owns the ranking** — the Bayesian smoothing, the platform averages, the
scoring function, and the selection screen that makes an order legible.

They meet at exactly one function, and it is pure:

```js
// server/src/services/matching.scoring.js — DEV-B from 4.3 on
rankCandidates(candidates, averages) -> Array<{ teacherId: string, score: number }>
```

No `prisma` import in that file, ever. It does not know `teacher_profiles` exists, it does
not read a request, it returns no payload — it returns an order. DEV-A builds the query
that produces `candidates` and the endpoint that consumes the order; DEV-B decides what
the order is. Neither waits on the other, and the thing they have to agree on is one
plain-object shape, frozen below before either track starts.

This is the same arrangement as E3's `classifyQuestion` and as the video seam in
`docs/OWNERSHIP.md` §2.1 — one owner's code called by another owner's code, with the
argument and return value written down before either side exists.

**Why the pure function returns `{teacherId, score}` and not the scored rows.** So that it
cannot quietly become the serializer. The service already holds the candidate rows; it
joins the order back onto them and hands them to `toTeacherCard`. A scoring function that
returned cards would be a scoring function two people edit.

## The shared files, named up front

E2's retro added `package.json`, the lockfile and `prisma/schema/` to this table because
E2's stopped at the language boundary. E3's carried them. So does this one, and E4 adds a
row E3 did not need: **the files E4 reads that belong to a closed epic.**

| File | Rule | Set by |
|---|---|---|
| `server/src/routes/matching.routes.js` | **New, and frozen after 4.1.** One route, fully wired — `authenticate`, `authorize('student')`, `validate` — against a controller that throws `NOT_IMPLEMENTED`. | 4.1 |
| `server/src/repositories/matching.repository.js` | **New, and frozen after 4.1.** All five queries either track needs, written before either track opens — signatures, select lists and `Decimal` → `number` conversion final. The one deliberate gap is `findCandidates`' `where`, which is 4.2's and is the only thing 4.2 may add to this file. | 4.1 |
| `server/src/validators/matching.schema.js` | **New in 4.1, and finished there rather than stubbed.** `:id` and one optional `priceBand` is the whole input; two of 4.1's acceptance criteria assert it. 4.5 does not open it. | 4.1 |
| `server/src/services/matching.scoring.js` | Created in 4.1 with the frozen signatures and a deterministic stub. **Ownership transfers to DEV-B at 4.3.** DEV-A does not open it again. | 4.1 → 4.3 |
| `server/src/config/constants/matching.js` | **E4 owns this file, and only 4.1 opens it.** Three appended values (`MAX_STARS`, `HISTORY_MIN_STARS`, `NEUTRAL_PLATFORM_AVERAGES`); the seven that are already there are not edited. No PR in this epic writes any of those numbers as a literal anywhere else. | 4.1 |
| `server/src/repositories/teacher.repository.js` | **E2's, frozen since 2.1. E4 changes exactly one line, in 4.1: `TEACHER_VIEW` becomes an export.** Announced in chat first (`OWNERSHIP.md` §1, rule 2). Nothing else in E4 opens it — see the note below on why one line beats a second copy. | 4.1 |
| `server/src/routes/index.js` | Append-only, one line. **Two routers share the `/questions` mount** — see "Why E4 has its own router". | 4.1 |
| `server/src/config/constants/index.js` | Not touched. `matching.js` is already in the barrel (0.5). | — |
| `shared/api.d.ts` | Append-only, one `// ── E4` block, written once in 4.1. **The E3 block is not widened and not edited.** | 4.1 |
| `shared/errorCodes.js` | **Not touched.** Every code this epic needs exists, and the one it deliberately does not throw (`NO_AVAILABLE_TEACHERS`) also already exists. | — |
| `client/src/components/match/` | New shared directory, disjoint files. DEV-A: `CreditMinutes.jsx`, `PriceCeiling.jsx`. DEV-B: `MatchCard.jsx`. Same arrangement as `components/teacher/` in E2 and `components/question/` in E3, both of which merged clean. | 4.4, 4.7 |
| `client/src/components/teacher/TeacherCard.jsx` | DEV-A's, from 2.5. 4.6 of `MVP.md` §18 is "credit-to-minutes **across all teacher cards**", so this file gains one optional line — in DEV-A's own PR, and in no other. | 4.4 |
| `client/src/router/routes.student.jsx` | One line, one PR: 4.7 replaces the `ask/:id/teachers` `Placeholder`. **Unlike E3, only one E4 PR opens this file at all.** | 4.7 |
| `client/src/api/client.js` | **Not touched.** DEV-A's single-owner file, frozen at 15 seconds. Matching is a database query, not an LLM call — it needs no override. | — |
| `package.json` (root + workspaces) | **No dependency is planned for this epic**, and none should be needed: the algorithm is arithmetic and the screen is Mantine. If one becomes necessary, announce it in chat, land it as its own one-line PR, and let the other developer rebase (`OWNERSHIP.md` §4). | — |
| `package-lock.json` | Never hand-merge. `git checkout --theirs package-lock.json && npm install`. | — |
| `prisma/schema/*.prisma` | **No migration is planned for this epic, and this time that claim has been checked** — see the contract freeze, which resolves seven §9-vs-schema gaps without one. The only thing that may still produce a migration is 4.2's index measurement, which is a `CREATE INDEX` and nothing else. F1 and F5 carry the epic's other database work and both are DEV-B's filler. **Never two in flight** (`OWNERSHIP.md` §2) — announce in chat before generating one. | 4.2 (maybe), filler |
| `prisma/seed/` | DEV-B's, and only through filler F1 and F5. No PR in the main sequence edits the seed. | filler |
| `.env.example`, `server/src/config/env.js` | **Not touched.** E4 calls nothing external. | — |

Everything else is suffixed by track: `matching.candidates.service.js` and
`matching.service.js` are DEV-A's, `matching.scoring.js` and `matching.averages.service.js`
are DEV-B's. **Never one `matching.service.js` that both developers open.**

**No `matchStore`.** Same ruling as E3's `questionStore`, for the same reason. The question
id is in the URL, the price ceiling is a query parameter, and the match list is server
state that goes stale the moment a teacher goes offline. A store here would be a second
copy of it, owned by whichever screen mounted first.

### Why E4 has its own router, and why it still mounts at `/questions`

`§12` spells the endpoint `GET /questions/:id/matches`, and `question.routes.js` is frozen
after 3.1. E4 does not unfreeze it. `matching.routes.js` is a second router mounted on the
same path:

```js
apiRoutes.use('/questions', questionRoutes);
apiRoutes.use('/questions', matchingRoutes);   // appended by 4.1
```

Express walks mounted routers in order, and `GET /:id` in the first one matches a single
segment, so `/questions/<uuid>/matches` falls through it and into the second. The URL is
§12's, E3's frozen file is not opened, and E4 gets a router it owns and can freeze on its
own terms. It is the same answer this epic gives everywhere else: **E4 reads E3's and E2's
tables through E4's own files.**

The one place that answer does *not* apply is `TEACHER_VIEW`, and it is worth saying why.
The match cards and the browse cards must be the same `TeacherCard`, field for field —
that is the contract, and E2's best outcome was one card read by three screens. A private
copy of the select list in `matching.repository.js` would be a second source of truth for
"what a teacher looks like", which is exactly the defect class E2 shipped three of. One
exported `const` is cheaper than that, so 4.1 exports it, announces it, and nothing else in
E4 goes near the file.

## What E4 does not wait for

The handoff brief lists four E3 debts and marks two of them as E4's dependencies. Checked
against the code, **none of them blocks this epic**, and the reasons matter enough to write
down rather than discover:

| Item | Owner | Blocks E4? | Why |
|---|---|---|---|
| **3.8** — E3 close + retro | DEV-B | No | Nothing in E4 reads its output. Expect one amendment to this file when the retro lands; do not hold 4.1 for it. |
| **F1** — leaf topics in `teacher_topics` | DEV-B | **No** | E4's topic filter is written so a parent row in `teacher_topics` is *inert*: it is neither the question's subtopic nor a leaf under the question's parent, so it matches neither half of the predicate. F1 makes the data agree with the rule without changing a single result. Every seeded teacher declares at least one leaf, so nobody drops out of the pool. |
| **F3** — nullable `onboarded_at` | DEV-B | **No** | **E4 does not filter on `onboardingComplete`.** §9.1's filter list is closed and does not contain it; a teacher who set their status to `ONLINE` is making a claim about themselves, which §6.1 says is how this platform works. A teacher with no topics fails the topic filter anyway on every classified question. The one path where they can surface is an unclassified question, where the product's answer is deliberately "show everyone". |
| **F4** — `TeacherStatusToggle` refresh | DEV-B | No, but | `status` is E4's first hard filter, so a header pill that lies during a demo reads as a matching bug rather than a toggle bug. Worth landing before 4.8's verification pass. |

**F1 and F3 stay on DEV-B's filler list.** They are still worth doing; they are just not
gates, and treating them as gates would idle DEV-B's whole track behind DEV-B's own filler.

## Before anything starts

Unchanged from E3, and it is a prerequisite rather than a nicety, because **every
verification run in this epic writes rows**:

1. `npm run db:up` — Postgres 16 on host port **5433** (`docker-compose.yml`)
2. `DATABASE_URL` in the repo-root `.env` points at that container
3. `npm run db:migrate && npm run db:seed`
4. the Neon URL is supplied inline, per command, when production is genuinely meant

Matching writes fewer rows than E3 did — the endpoint is a read — but its *verification*
does not: flipping a teacher `ONLINE`, inserting a review to make `studiedWith` true, and
hand-writing a `rejected_by` array are all writes, and all three are on 4.8's checklist.
**Every PR brief in this epic that says to write a row also says to delete it.**

One more, and it is new: **Render's `buildCommand` runs `npx prisma migrate deploy`.** A
migration merged to `main` reaches production on the next deploy with no separate step. If
4.2's measurement produces an index, that is the path it takes.

## The split

| | DEV-A (eliya) | DEV-B (rotem) |
|---|---|---|
| **Slice** | **The pool** — who is eligible, and what this student can afford | **The ranking** — what order they come back in, and how a student reads it |
| **Server** | `matching.repository.js` and `matching.routes.js` (both frozen at 4.1), the §9.1 candidate query, the band and wallet ceilings, the two empty-pool answers, `GET /questions/:id/matches` | `bayesian()`, `getPlatformAverages()` with its 5-minute cache, `rankCandidates()` — §9.2's six weighted components and §9.3's smoothing |
| **Client** | The credit-to-minutes translation, everywhere a price is shown (`CreditMinutes.jsx`, and one line in E2's `TeacherCard`), and the price-ceiling control | `/app/ask/:id/teachers` — the selection screen, the match card, the specialty line, the "studied with" badge, both empty states |
| **Filler** | F2: publish the teacher constants through `/public` | F1, F3, F4 (carried from E3), F5: seeded demo questions |

Both developers ship server and client. DEV-A owns the endpoint the screen calls; DEV-B
owns the screen. Neither opens the other's service.

## Order

| # | PR | Owner | Size | Depends on | Status |
|---|---|---|---|---|---|
| 4.1 | [Matching core: frozen router, repository, scoring seam](PR-4.1-matching-core.md) | DEV-A · **human** | M | E3 (3.1–3.7) | ☐ |
| 4.2 | [Candidate pool — §9.1 hard filters](PR-4.2-candidate-pool.md) | DEV-A | M | 4.1 | ☐ |
| 4.3 | [`bayesian()` + `getPlatformAverages()`](PR-4.3-bayesian-averages.md) | DEV-B | S | 4.1 | ☐ |
| 4.4 | [Credit-to-minutes and the price ceiling control](PR-4.4-credit-minutes.md) | DEV-A | M | 4.1 | ☐ |
| 4.5 | [`GET /questions/:id/matches`](PR-4.5-matches-endpoint.md) | DEV-A | M | 4.2 | ☐ |
| 4.6 | [`matching.scoring` — full scoring per §9.2](PR-4.6-scoring.md) | DEV-B | L | 4.3 | ☐ |
| 4.7 | [Teacher selection screen](PR-4.7-selection-screen.md) | DEV-B | L | 4.4, 4.5, 4.6 | ☐ |
| 4.8 | [E4 close: verification + retro](PR-4.8-e4-close.md) | DEV-A | S | 4.2–4.7 | ☐ |

### Filler, pre-planned

E2's retro is explicit: filler works only when it is *small, owned, and in the blocked
developer's own area* — otherwise the wait moves rather than disappearing.

| # | Filler PR | Owner | Size | Why it matters |
|---|---|---|---|---|
| F1 | Leaf topics: the seed stops writing parent rows, one migration cleans the existing 18 | DEV-B | S | Carried from E3. Not a gate for E4 (above), but the seed and `assertLeafTopics` still disagree, and every epic that reads `teacher_topics` inherits the disagreement. |
| F2 | Publish `TEACHING_LEVELS` and `BIO_MAX_LENGTH` through `/public` | DEV-A | S | Carried from E3. Four copies of one list. E4 needs no fifth — `PriceCeiling` and `CreditMinutes` both read `GET /public/pricing`, which already carries the bands and `block.minutes` — which is the argument for finishing the job. |
| F3 | Nullable `onboarded_at`, `onboardingComplete` reads it | DEV-B | M | Carried from E3. Not a gate for E4 (above). Carries a migration. |
| F4 | `TeacherStatusToggle` refreshes on status change | DEV-B | S | Carried from E3. `status` is E4's first hard filter; a stale pill during 4.8's demo reads as a matching bug. |
| F5 | `prisma/seed/questions.js` — two `PENDING` demo questions | DEV-B | S | One on `integration-by-parts` at level 5, one on the sentinel (`topic_id = 0`, `subtopic_id` null, `estimated_level` null). §18's acceptance criterion and the whole fallback branch become runnable without typing a question and spending a Gemini call. Written as an upsert like the rest of the seed. |

**F1, F3 and F5 all touch `prisma/`, and F1 and F3 carry migrations. Never two in flight**
(`OWNERSHIP.md` §2) — announce in chat, land one, then the next. If 4.2's measurement
produces an index, it queues with them.

**DEV-A's filler is thinner than DEV-B's, deliberately.** DEV-A carries five PRs to DEV-B's
three and the two L's are both DEV-B's, so DEV-A's slack is review time on 4.6 and 4.7 —
and §18 says of the selection screen "Agent, but reviewed hard". That is not a gap in the
plan; it is the plan.

## Parallelism map

```
                     ┌─ 4.2 ─── 4.5 ──┐                              (A)
                     │  (A)     (A)   │
4.1 (A, blocking) ───┼─ 4.4 ──────────┼─── 4.7 ─── 4.8
                     │  (A)           │    (B)     (A)
                     └─ 4.3 ─── 4.6 ──┘
                        (B)     (B)
```

4.1 is the only thing either developer waits on, and it is one sitting.

**4.5 depends on 4.6 for its output, not for its shape.** 4.1 ships `rankCandidates` with a
deterministic stub — real signature, real return type, every score `0`, order stable. 4.5 is
built and merged against that, and when 4.6 lands, **4.5's diff does not change**: the same
function starts returning a real order. This is E3's 3.4-against-3.3 arrangement, verbatim,
including its one rule: **do not stub the scorer a second time inside 4.5.** One stub, in the
file that will hold the real thing.

The corollary is worth saying out loud so nobody "fixes" it: between 4.5 and 4.6, the
endpoint returns the right five teachers **in an arbitrary but stable order**. That is
correct behaviour for that week.

**4.7 is the one cross-track wait, and it is real.** It needs 4.5's endpoint, 4.4's two
components and 4.6's ordering — the first two are DEV-A's. DEV-B has 4.3 and 4.6 to do in
the meantime, and F1/F3/F4/F5 after that, so the wait is absorbed rather than moved. This
is E3's 3.7 with the same shape and the same answer.

## Contract freeze

Agreed before 4.2 and 4.3 start. Appended to `shared/api.d.ts` in 4.1 as one `E4` block.
Changing any of it afterwards is a chat message **before** the code.

```ts
// ── E4 ──────────────────────────────────────────────────────────────────────

/**
 * Why a match list came back empty. `null` when it did not.
 *
 * Both are string values, not thrown errors — see "Two empty pools" below.
 */
export type MatchEmptyReason = 'NO_AVAILABLE_TEACHERS' | 'INSUFFICIENT_CREDIT';

/**
 * One ranked teacher: E2's card, plus the three things §14.2 shows that a card
 * does not carry.
 *
 * **No score, and no rank number.** §14.2 is explicit — the student sees an order,
 * not grades. Nothing in this shape lets a client reconstruct one.
 */
export interface TeacherMatch {
  /** Field-for-field the same shape `GET /teachers` returns. */
  teacher: TeacherCard;
  /**
   * Sessions this teacher has completed in the question's *subtopic* — §14.2's
   * "solved 12 questions in Integrals". A whole number; `teacher_topic_stats`
   * stores it as NUMERIC(8,2) because of the 0.3 parent propagation, and this is
   * that value rounded for display. `0` when they have never taught it.
   */
  subtopicSessions: number;
  /**
   * Their resolve rate in that subtopic, 0–1 — §14.2's "91% resolved".
   * `null`, never `0`, when they have no history there: the same distinction
   * `TeacherCard.rating` already makes.
   */
  subtopicResolveRate: number | null;
  /**
   * §14.2's 💙 "studied with" badge: this student rated this teacher at least
   * `HISTORY_MIN_STARS` before. The same fact §9.2 scores as `history_bonus`.
   */
  studiedWith: boolean;
}

/**
 * `GET /questions/:id/matches?priceBand=A|B|C`.
 *
 * Always 200 when the caller owns a `PENDING` question, even with no teachers.
 */
export interface MatchesResponse {
  /** At most `MATCH_COUNT` (5), best first. Empty iff `reason` is set. */
  teachers: TeacherMatch[];
  reason: MatchEmptyReason | null;
  /**
   * The ceiling actually applied, in credits per block — the lower of the band's
   * ceiling and what the balance affords. The screen shows it so that "why is
   * Dana missing" has an answer on the page.
   */
  priceCeiling: number;
  /**
   * The student's balance at match time. Returned because the server has already
   * read it to compute `priceCeiling`, and because `GET /wallet` is E7.
   */
  walletBalance: number;
}
```

### The internal seam — not in `api.d.ts`, but frozen just as hard

```js
/**
 * @typedef {{ ratingSum: number, ratingCount: number,
 *             resolvedCount: number, sessionsCount: number }} TopicStats
 *
 * @typedef {object} MatchCandidate
 * @property {string}  teacherId
 * @property {number}  sessionsCount    teacher_profiles, all topics
 * @property {number}  resolvedCount    teacher_profiles, all topics
 * @property {number}  ratingSum        teacher_profiles, all topics
 * @property {number}  ratingCount      teacher_profiles, all topics
 * @property {number}  offersReceived
 * @property {number}  offersAccepted
 * @property {TopicStats|null} subtopicStats  the question's leaf, or null
 * @property {TopicStats|null} topicStats     the question's parent, or null
 * @property {boolean} hasPositiveHistory     this student rated them >= 4
 *
 * @typedef {{ rating: number, resolveRate: number, acceptRate: number }} PlatformAverages
 */

/** @returns {Array<{teacherId: string, score: number}>} sorted, best first */
export function rankCandidates(candidates, averages)

/** @returns {number} MVP.md §9.3 */
export function bayesian({ sum, count }, prior, c)
```

**Every number in `MatchCandidate` is a JavaScript `number`.** `teacher_topic_stats`'
four columns are `Decimal @db.Decimal(8, 2)` and Prisma hands them back as
`Prisma.Decimal` objects, on which `*` and `+` do not do what they look like they do.
The repository converts; the scorer never sees a `Decimal`. This is a review item in
4.2 and an acceptance criterion in 4.6.

**`rankCandidates` is total and pure.** No `prisma`, no `req`, no clock, no random. It
answers for an empty array, for a candidate with every stat at zero, and for a platform
with no history at all. Ties break on `teacherId` ascending, so two calls with the same
input return the same order — which matters more than it sounds, because on a fresh
database *every* candidate scores identically and a nondeterministic sort makes "show me
more teachers" look broken.

### The seven gaps between §9 and the database, resolved

`MVP.md` §9.1 was written before the schema and disagrees with it in seven places. E3's
biggest single correction was made in its blocking PR, when an epic that "needed no
migrations" turned out to need three. These were checked the same way, against
`prisma/schema/*.prisma` and the migration SQL as they stand at `e34d03f`, and **none of
them needs a migration.**

**1. `student.price_band` is a query parameter, not a column.** `student_profiles` has
`grade`, `math_level` and `school` and nothing else, and §12 already writes the endpoint as
`?priceBand=A|B|C`. That reading needs no migration, makes "show me cheaper teachers" a
re-call rather than a profile edit, and matches §14.2, where the control sits on the
selection screen itself. The column reading would need a profile screen nobody has built
and a `PATCH /students/me` that does not exist. Absent or unknown, the band means **no
ceiling** — `bandCeiling()` already answers `MAX_PRICE_PER_BLOCK` for `undefined`, and it
does so precisely "so a typo in a query string does not silently empty the selection
screen".

**2. `blocked_teachers` is cut.** There is no table, no column and no constant, and nothing
in the product blocks a teacher — moderation is E9. The set is empty for every student, so
the filter is a no-op, and writing SQL against a table that does not exist is worse than
leaving a line of the spec unimplemented. Recorded in the deviations table so the next
person does not think it was missed.

**3. The wallet filter becomes part of the price ceiling, and empties the pool honestly.**
§9.1 writes `wallet_balance >= price_per_block * 2`. That `2` is `OPENING_BLOCKS` (§5.1 —
the opening block is two blocks, charged immediately), so it is a constant, not a literal.
Rearranged, the predicate is a ceiling on price:

```
affordableCeiling = floor(balance / OPENING_BLOCKS)
priceCeiling      = min(bandCeiling(priceBand), affordableCeiling)
```

which is the same rule, evaluated once instead of per row, and served by the existing
partial index on `(status, level_max, price_per_block)`. It also makes the two empty pools
distinguishable **before** the query runs:

- `affordableCeiling < MIN_PRICE_PER_BLOCK` → the student cannot afford *anybody* on the
  platform. `reason: 'INSUFFICIENT_CREDIT'`, empty list, no candidate query at all. This
  is the seeded `ido.student` with 0 credits, and it is correct behaviour rather than a
  bug to work around.
- otherwise, an empty result → `reason: 'NO_AVAILABLE_TEACHERS'`.

**Two empty pools, two sentences, one 200.** `§9.4`'s own pseudocode returns
`{ teachers: [], reason: 'NO_AVAILABLE_TEACHERS' }` rather than throwing, and that is what
this epic does: `NO_AVAILABLE_TEACHERS` stays in `shared/errorCodes.js` **unthrown**,
exactly as `LLM_FAILED` did through the whole of E3. An empty list is a state every list in
this codebase already has to render (`CONVENTIONS.md` → Client), and turning it into a 409
would make the screen show an error for the product working as designed. The two reasons
are different sentences to a student — "nobody who teaches this is online right now" versus
"your balance does not cover an opening block with anyone" — and only the second one has a
top-up link (E7) at the end of it.

**4. `teacher_topic_stats` is written by nobody until E8, and that is stated, not implied.**
The four columns exist, they are `NUMERIC(8,2)` so the 0.3 parent propagation does not
truncate, and `prisma/seed/teachers.js` fills them for all 15 demo teachers with hand-tuned
numbers — `integration-by-parts` at 4.60 across 40 sessions, 4.80 across 30, and the
deliberate Bayesian pair. So **E4's scoring is fully verifiable today and §18's acceptance
criterion is checkable today** — against seeded data. Nothing in the running product updates
these rows: a session completed this afternoon moves no ranking until E8's review service
exists. 4.6's tests and 4.8's verification both say so in as many words rather than letting
a passing check imply live data.

The same is true of two other inputs. `reviews` is empty, so `studiedWith` is `false` for
every real pair until E8 or a hand-written row. `offers_received` / `offers_accepted` are
seeded but written by E5, so `acceptance_rate` is history that stopped.

**5. `idx_teacher_available` already exists, and 4.2 must not create it.** §18's first PR is
"hard-filter SQL + partial index"; the index landed in the init migration and was **dropped
and recreated with `price_per_block`** by `20260811120000_open_marketplace`:

```sql
CREATE INDEX "idx_teacher_available"
  ON "teacher_profiles"("status", "level_max", "price_per_block")
  WHERE "status" = 'ONLINE';
```

It is deliberately absent from `teachers.prisma` — Prisma cannot express a partial index,
and declaring the full one instead makes every later `migrate dev` emit a `CREATE INDEX` for
a name that already exists. The model carries a comment saying exactly that. **4.2 adds no
index on faith.** It runs `EXPLAIN` against the real candidate query on the seeded database,
records the plan in the PR, and adds at most one index — the plausible candidate is
`teacher_topics(topic_id)`, whose composite primary key is `(teacher_id, topic_id)` and
therefore does not serve a lookup by topic alone. With 22 seeded teachers Postgres will
very likely sequential-scan anyway, in which case the honest outcome is no migration and a
note.

**6. The sentinel topic, and the two nulls it drags in.** E3's fallback path writes exactly
one shape — `topic_id = 0`, `subtopic_id NULL`, `estimated_level NULL`,
`classification_ok false` — and it is a **legal input to matching**, not an edge case: the
Gemini free-tier quota ran out twice during E3's verification and the classifier fell back
for real. Two rules, and the second is not optional:

*The topic filter runs on the subtopic, generously, and skips itself when there is none.*
A candidate passes if they declare the question's **subtopic**, or **any leaf under the
question's parent topic**. When `subtopic_id` is null — the fallback path, and the override
where the student picked "none of these" — the topic filter is **skipped entirely** and
everyone passes, which is §9.1's `topic_id == 0 → everyone passes` arriving by a shorter
road, because a question on the sentinel always has a null subtopic.

Not `question.topic_id ∈ teacher.topics`, which is what §9.1 literally says. After F1,
`teacher_topics` holds leaves only, so a predicate on the parent id would match **nobody** —
and before F1 it would match only the fourteen teachers whose seeded parent rows F1 exists to
delete. The rule above preserves §9.1's *intent* (a parent-level pool, narrowed by ranking)
in the rows the schema actually has, and it is why `PARENT_TOPIC_WEIGHT = 0.3` is in
`constants/matching.js`: the filter is generous, and the score is what separates "has taught
this exact leaf" from "has taught its sibling".

*The level filter falls back down the row, never to null.*
`level_max >= NULL` is NULL, which excludes everybody, so:

```
requiredLevel = estimated_level ?? declared_level ?? min(TEACHING_LEVELS)
```

`declared_level` is on the row for exactly this kind of reason — it is the student's own
claim and E3 stored it per question rather than reading a mutable profile. When both are
absent the floor is 3, which every teacher satisfies (`level_max` defaults to 3 and the set
is 3/4/5), so an unclassifiable question narrows the pool by price and availability and by
nothing else. That is the right answer: we do not know what level it is, so we must not
pretend to.

**7. `rejected_by` is a `UUID[]` on `questions`, and E4 is its first reader.** The schema
comment explains the choice — read on every matching run, never joined, never more than a
handful of entries. E5 writes it on a rejected offer; nothing writes it today, so E4's tests
and 4.8's checklist seed it by hand and delete it after. Two notes for 4.2: it is `[]`, not
null, for every existing row, and an exclusion list with nothing in it should be passed as
`undefined` rather than as an empty array — check what Prisma emits with
`DEBUG=prisma:query` either way.

`rejected_by` is also the one thing E4 needs from `questions` that `QUESTION_VIEW` refuses
to select, with a comment saying it "is matching-engine state and has no business in a
student-facing payload". That comment is right, and it is the reason `matching.repository.js`
has its own read of `questions` rather than 3.1's frozen file gaining a query: the shape E4
needs is not a `QuestionResponse` and must never become one.

### The E5 seam — where this epic stops

E4 ends when the student presses **Send request**. `POST /sessions/:id/offer`, the atomic
teacher lock, the 60-second countdown and the accept/reject flow are all E5, and 5.3 is
human-written per §17.5. So the button is wired to one callback with a frozen signature, in
DEV-B's own page:

```js
onChoose({ teacherId, pricePerBlock })
```

In E4 its body confirms the choice and stops. **E4 creates no route for what comes next.**
§14.1 has no offer screen, 5.8 is "student awaiting response", and a route invented here is a
route E5 has to either honour or rename — whereas a callback is one function body E5
replaces in a file it already owns. The `sessionId` E5 will need is already in the
`QuestionResponse` the screen loads.

## Deliberate deviations from `MVP.md` §18

| MVP said | We do | Why |
|---|---|---|
| 6 PRs (4.1–4.6) | 8 (4.1–4.8), plus 5 pre-planned filler | The blocking core PR and the closing verification PR are three-for-three in E1, E2 and E3. §18 has neither. |
| Owner: B, all six | Split by seam, both full-stack | The §18 reading gives DEV-B four days of backend and DEV-A four of frontend. The epic template rejects that split by name, and E1/E2/E3 all deviated from §18's owner column for the same reason. |
| 4.1 "Hard-filter SQL **+ partial index**" | Prisma `where`, and **no new index without a measurement** | `idx_teacher_available` already covers `(status, level_max, price_per_block) WHERE status = 'ONLINE'` as of `20260811120000_open_marketplace`. Re-adding it emits a `CREATE INDEX` for a name that exists. Raw SQL buys nothing here: Prisma expresses every §9.1 predicate, spreads `TEACHER_VIEW` so the card cannot drift, and keeps `Decimal` handling consistent — and it is still measured with `EXPLAIN`. |
| 4.2 `bayesian()` and `getPlatformAverages()` in one PR | Same PR, but `bayesian()` lives **inside `matching.scoring.js`** | One is a pure five-line function and the other reads the database and caches. Splitting them across files would put half of DEV-B's seam in a util directory that `OWNERSHIP.md` §2 assigns to DEV-A. Exported and unit-tested where it is. |
| 4.6 "credit-to-minutes" last | Fourth, before the screen | The selection screen consumes it, and "across all teacher cards" means E2's `TeacherCard.jsx`, which is DEV-A's file. Landing it last would mean the screen either waits or grows a second copy. |
| §9.1 `student.price_band` | `?priceBand=` query parameter | §12 already writes it that way. No column, no profile screen, and re-calling is §14.2's "show me more teachers". |
| §9.1 `teacher_id ∉ student.blocked_teachers` | Cut | No table, no column, no constant, no feature. E9. |
| §9.1 `wallet_balance >= price_per_block * 2` | Folded into the price ceiling as `floor(balance / OPENING_BLOCKS)` | Identical predicate, one evaluation instead of one per row, served by the existing index — and it makes "you cannot afford anyone" answerable before the query rather than inferable from an empty list. |
| §9.1 `question.topic_id ∈ teacher.topics` | The question's subtopic, **or any leaf under its parent** | `teacher_topics` holds leaves (F1 finishes the job the seed started). A predicate on the parent id matches nobody. Same intent, expressed in the rows that exist. |
| §9.4 returns `{teachers: [], reason}` | Kept — 200 with a reason, never a 409 | Follows §9.4's own pseudocode. `NO_AVAILABLE_TEACHERS` stays in `errorCodes.js` unthrown, exactly as `LLM_FAILED` did in E3. |
| — | A second reason, `INSUFFICIENT_CREDIT` | The seeded 0-credit student matches nobody *correctly*, and "nobody is online" is the wrong sentence for it. Both codes already exist. |
| §14.2 "⏱ responds in ~20s" | Cut from the card | Nothing measures response time. `offers.responded_at` exists and E5 writes it; until then the number would be invented. |
| §12 "Re-callable = show me more teachers" | Re-call, no pagination and no offset | `MATCH_COUNT` is 5 and the sixth-best teacher is not a product. The button re-runs the query — teachers go online and offline, and from E5 on the pool shrinks as offers are rejected. Widening the pool is the price control, which is the honest answer to "show me more". |
| §12 error list | `SESSION_NOT_ACTIVE` (409) when the question's session is not `PENDING` | Same rule 3.5 already applies to re-classification: once an offer is out, a fresh match list is a way to double-book a student. |

## Risks

- **The ranking reads data the product never writes.** `teacher_topic_stats`, `reviews` and
  the two offer counters have exactly one writer between them — the seed. Everything in this
  epic works and is verifiable, and none of it will *change* until E8's review service and
  E5's offer flow exist. The failure mode is not a bug, it is a demo: someone completes a
  session, re-runs matching, sees the same order, and files it. 4.6 and 4.8 both state it
  explicitly; nobody should have to infer it from a passing test.
- **The seed's `ONLINE` set does not contain the Bayesian pair.** §18's acceptance criterion
  is "a teacher with one 5-star rating ranks below one with 4.6 across 40" — that is Gil V.
  against Dana K., and **Gil is `OFFLINE`**, as are Shira G. and every other integrals
  teacher except Dana, Yossi and Avi K. An integrals question at level 5 therefore surfaces
  **three** teachers on the seed as it stands, and the criterion is invisible through the
  endpoint. 4.6 pins it as a unit test on `rankCandidates` with the seed's own numbers, and
  4.8 runs it end to end after flipping Gil and Shira `ONLINE` locally and reverting.
- **Prisma `Decimal` does not do arithmetic with `*`.** The four `teacher_topic_stats`
  columns come back as `Prisma.Decimal`. A scoring function that multiplies one by a weight
  produces something that is neither a number nor an error — it produces a ranking that is
  wrong in a way no test asserts unless the test uses real rows. The conversion happens in
  the repository, the seam says `number`, and 4.6's tests use fixtures copied from the seed
  rather than invented integers.
- **`topic_id = 0` is a legal question, and it is the *widest* one.** A sentinel question
  skips the topic filter and the level filter both, so its pool is every online teacher the
  student can afford — including teachers who have never picked a topic. That is the
  product's answer (§6.1: nothing is verified; §8.1: classification must not block the
  flow), but it is also the path most likely to be seen during a demo, because a Gemini quota
  error produces it. It must be walked deliberately in 4.8, not discovered.
- **Every score is identical on a database with no history.** New platform, new teachers:
  the smoothed components all collapse to the prior and only `new_teacher_boost` varies. Two
  calls must still return the same five teachers in the same order, or the price control and
  the refresh button both look broken. Hence the deterministic tie-break, and hence
  `NEUTRAL_PLATFORM_AVERAGES` being a named constant rather than a `?? 0` somewhere.
- **The platform-average cache is per process and invisible.** Five minutes
  (`PLATFORM_AVERAGES_CACHE_MS`) of module-level state means a value changed in `psql` does
  not appear for five minutes, on a server that may also have just cold-started and thrown
  the cache away. That is right for production and confusing during verification, so 4.3
  exposes a way to clear it in tests and 4.8's checklist restarts the server rather than
  waiting.
- **This is the screen the product is judged on.** §14.2 calls teacher selection "worth more
  investment than any other screen" and §18 says "Agent, but reviewed hard". Two specific
  things are easy to get wrong and hard to notice: showing a score or a rank number, which
  §14.2 forbids outright, and showing the price without the minutes, which is the one
  translation §5.4 says the student actually thinks in.

---

## Checklist before writing the PR briefs

- [x] Every PR names exactly one owner
- [x] No two in-flight PRs edit the same file
- [x] Any shared file is either frozen, append-only, or split by track — including `package.json`, the lockfile and `prisma/schema/`
- [x] Human-written items from `MVP.md` §17.5 are marked as such — 4.1, and the review posture on 4.7
- [x] Each PR has an allowlist and a denylist
- [x] Each PR has acceptance criteria a human can check in under five minutes
- [x] Both developers have server and client work
- [x] There is filler work for whoever finishes first, and it is in that developer's own files
