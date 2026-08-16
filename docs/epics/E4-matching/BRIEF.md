# Handoff brief — write the E4 epic

You are being asked to produce **E4 — Matching Engine**: the epic `README.md` plus one
brief per PR, in `docs/epics/E4-matching/`, following `docs/epics/_TEMPLATE-epic.md` and
`docs/epics/_TEMPLATE-pr.md`. Read `docs/epics/E3-question-intake/README.md` first — it is
the closest thing to a worked example of what "good" looks like here, and E4 inherits its
contract.

This file is the state of the world as E3 closes. It is not the epic; it is what the epic
has to be true about.

---

## 1. Where the repo is

`main` = `e34d03f`. Two developers, two tracks: **DEV-A = eliya**, **DEV-B = rotem**.
`main` is what deploys — Vercel for the client, Render for the API.

**E3 is shipped and verified end to end in production**: a student types a question,
attaches a photo, gets a topic and level back, corrects it if it is wrong, and lands on
`/app/ask/:id/teachers` — which is still a `Placeholder`. **That placeholder is E4's front
door.**

Still open in E3, and both matter to you:

| Item | Owner | Why E4 cares |
|---|---|---|
| 3.8 — E3 close: verification + retro | DEV-B | The retro's findings land after your epic is written. Do not block on it, but expect one amendment. |
| F1 — leaf topics: seed stops writing parent rows, one migration cleans the existing 18 | DEV-B | **E4 reads `teacher_topics` to filter candidates.** Today the seed writes parent rows and `assertLeafTopics` rejects them — the two disagree. Decide in your epic whether F1 is a hard dependency of your first PR or lands inside it. |
| F2 — publish `TEACHING_LEVELS` / `BIO_MAX_LENGTH` through a `/public` endpoint | DEV-A | Four copies of one list today. E4's screens will want a fifth. |
| F3 — nullable `onboarded_at`, `onboardingComplete` reads it | DEV-B | **E4 uses the flag.** Today "has ≥ 1 topic" means a teacher who finished step 1 reads as complete. |
| F4 — `TeacherStatusToggle` refreshes on status change | DEV-B | Cosmetic here, but `status` is E4's first hard filter. |

Environment facts that cost time when they are discovered late:

- Local Postgres is on host port **5433** (`npm run db:up`), and `DATABASE_URL` in the
  repo-root `.env` points at it. E2's incident was QA mutating the live demo teacher from
  `localhost:5173`; do not undo that. Every verification run in E4 writes rows — say so in
  the briefs, and say to delete them.
- Render's `buildCommand` runs `npx prisma migrate deploy`. A migration in an E4 PR reaches
  production on merge, with no separate step.
- `GEMINI_API_KEY` is set in the Render dashboard as of this handoff and the API is healthy.
  The free-tier quota is small and has run out twice mid-verification; classification then
  falls back per §8.1 and answers `201` with `classificationOk: false`. **A question filed
  under the sentinel topic is a legal input to matching**, and your fallback story has to
  cover it (see §4).
- `/health` is mounted at the root, not under `/api/v1`.

---

## 2. What E4 is, per the spec

`MVP.md` §9 is the algorithm and it is unusually complete: §9.1 hard filters, §9.2 the six
weighted components, §9.3 Bayesian smoothing with `C = 5`, §9.4 pseudocode, §9.5 the
decisions behind it. `MVP.md` §12 has the endpoint. §18 lists six PRs:

| # | PR | Size |
|---|---|---|
| 4.1 | Hard-filter SQL + partial index | M |
| 4.2 | `bayesian()` helper + `getPlatformAverages()` with 5-min cache | S |
| 4.3 | `matching.service` — full scoring per §9.2 | L |
| 4.4 | `GET /questions/:id/matches` + `rejected_by` exclusion | M |
| 4.5 | Teacher selection screen — "the most important screen in the product" | L |
| 4.6 | Credit-to-minutes translation across all teacher cards | S |

§18's acceptance: with 15 seeded teachers, an integrals question surfaces integrals
specialists first, and a teacher with one 5-star rating ranks below one with 4.6 across 40.

**§18 assigns this whole epic to DEV-B.** That is the split the epic template rejects by
name, and E1/E2/E3 all deviated from §18's owner column for the same reason. E3's answer
was to cut by *seam* rather than by layer: DEV-A owned capture (upload, create endpoint,
form screen), DEV-B owned classification (prompt, validation, override endpoint,
confirmation screen), and they met at exactly one pure function that neither had to wait
for. **You need an equivalent cut here, and E4 has an obvious one**: the scoring is pure
arithmetic over rows, the candidate query is SQL, and the selection screen is a screen.
Do not hand one developer the whole engine and the other the whole UI — that is the four
days of backend / four days of frontend the template exists to prevent. Find the pure
function, freeze its signature before either track starts, and let both sides build
against it.

---

## 3. What already exists — reuse it, do not rebuild it

Written and merged. Anything below that you re-derive in E4 is a second source of truth,
which is the defect class E2 shipped three of.

**Constants — `server/src/config/constants/matching.js`, and it is already complete.**
`MATCH_COUNT = 5`, `MATCH_WEIGHTS` (the six §9.2 components, with a boot-time assertion
that they sum to 1.0), `BAYES_C = 5`, `PARENT_TOPIC_WEIGHT = 0.3`,
`NEW_TEACHER_SESSIONS = 5`, `PLATFORM_AVERAGES_CACHE_MS`, `UNCLASSIFIED_TOPIC_ID = 0`.
E4 owns this file. No PR in this epic may write one of those numbers as a literal
anywhere else — `CONVENTIONS.md` is explicit and E3 held the line.

**Pricing — `server/src/utils/pricing.js`.** `bandOf()`, `bandCeiling(band)` and
`priceBandRanges()` all exist, and `constants/money.js` holds `PRICE_BANDS`,
`MIN_/MAX_PRICE_PER_BLOCK` and the fee constants. §9.1's price ceiling is `bandCeiling`,
already written.

**Teacher data — `server/src/repositories/teacher.repository.js` (frozen since 2.1),
`utils/teacherView.js` (`toTeacherCard`, `toTeacherMe`), `services/teacher.public.service.js`.**
The public teacher list already filters by topic, level, band and online-only, and already
paginates. The E4 candidate query is *not* that query — it scores — but the card payload a
student reads is `toTeacherCard`, and the selection screen should answer with the same
shape the browse screens already use. Decide explicitly whether `teacher.repository.js`
gains E4's query (it is frozen — that is a chat message and a blocking PR, exactly as 3.1
did for questions) or whether E4 opens `matching.repository.js` of its own.

**Question data — `question.repository.js` and `utils/questionView.js`, both frozen since
3.1.** `QUESTION_VIEW` deliberately does **not** select `rejectedBy`: the comment says it
is matching-engine state and has no business in a student-facing payload. E4 is the caller
that needs it. Same decision as above, and 3.1's header says a query missing from that file
is "not a small omission — it is an unfrozen file".

**Client — `client/src/api/client.js` is DEV-A's single-owner file, frozen at a 15-second
timeout.** Per-request overrides only; `question.api.js` shows how. `routes.student.jsx`
takes exactly one line per PR, no reordering — that convention survived 3.6 and 3.7 landing
in it from two branches. `components/teacher/TopicPicker.jsx` now has a single-selection
mode and label/description props (3.7); `components/state/{Loading,Error,Empty}State.jsx`
exist and are used everywhere. `TeacherCard.jsx`, `TeacherBadge.jsx` and `TeacherFilters.jsx`
are E2's, and 4.5's selection screen should read like their sibling, not like a new app.

**The route E4 fills:** `client/src/router/routes.student.jsx` →
`{ path: 'ask/:id/teachers', element: <Placeholder title="Choose a teacher" pr="4.5" /> }`.

---

## 4. The gaps between §9 and the database — decide these before writing PR 4.1

E3's biggest single correction was made in its blocking PR: the epic assumed no migrations
were needed and three columns were missing. **E4 has the same shape of problem and it is
larger.** Every item below is a real mismatch between `MVP.md` §9.1 and
`prisma/schema/*.prisma` as it stands today. Your README's contract-freeze section has to
resolve them; do not leave them to the PR that trips over them.

1. **`student.price_band` does not exist.** §9.1's filter reads
   `price_per_block <= band_ceiling(student.price_band)`, but `student_profiles` has only
   `grade`, `math_level` and `school`. §12 spells the endpoint as
   `GET /questions/:id/matches?priceBand=A|B|C` — a query parameter, not a column. One of
   those is wrong. The query-parameter reading needs no migration and makes "show me more
   teachers, cheaper" a re-call; the column reading is a profile edit screen nobody has
   built. Pick one, write down why, and put it in the deviations table.

2. **`blocked_teachers` does not exist anywhere** — not a column, not a table, not a
   constant. §9.1 filters on it. Either cut it from the MVP filter with a note (the honest
   option: nothing in the product blocks a teacher yet, so the set is always empty), or
   carry a migration. Do not write a filter against a table that does not exist.

3. **The wallet filter empties the pool.** §9.1 requires
   `wallet_balance >= price_per_block * 2`. Wallets exist, but E7 builds top-up, and the
   seed gives students 120, 24 and **0** credits. The 0-credit student legitimately matches
   nobody. That is correct behaviour and a terrible first demo — 4.4 needs a distinct
   answer for "no candidates because you cannot afford anyone" versus "no candidates
   online", and `shared/errorCodes.js` already carries `NO_AVAILABLE_TEACHERS`.

4. **`teacher_topic_stats` is written by nobody until E8.** The columns exist
   (`rating_sum`, `rating_count`, `resolved_count`, `sessions_count`, all
   `NUMERIC(8,2)` so the 0.3 parent-topic propagation does not truncate), and **the seed
   fills them for all 15 teachers** with hand-tuned numbers — `integration-by-parts` at
   4.60 across 40 sessions, a 4.80 across 30, and so on. So E4's scoring is verifiable
   against the seed today, and §18's acceptance criterion is checkable, but nothing in the
   running product updates those rows yet. Say that plainly in the epic rather than letting
   4.3's verification imply live data.

5. **`idx_teacher_available` is a partial index that lives only in the migration SQL.**
   `teachers.prisma` carries a comment explaining that Prisma cannot express
   `(status, level_max, price_per_block) WHERE status = 'ONLINE'`, so it is deliberately not
   declared in the schema. 4.1 must not "add the missing index" to the Prisma model — that
   produces a `CREATE INDEX` for a name that already exists on the next `migrate dev`.
   Check what the init migration actually created before writing a new one.

6. **The sentinel topic passes every topic filter.** §9.1 says `topic_id == 0 → everyone
   passes`. E3's fallback path produces exactly that row: `topic_id = 0`, `subtopic_id
   NULL`, `estimated_level NULL`, `classification_ok false`. `estimated_level` being null
   also breaks `level_max >= question.estimated_level`. Both need an answer in the contract
   freeze, and the second one is not theoretical — the classifier fell back twice during E3
   verification because of a real 429.

7. **`rejected_by` is a `UUID[]` on `questions`,** with a schema comment explaining why it
   is an array rather than a join table. 4.4 excludes on it; E5 writes it. Nothing writes it
   today, so E4's tests seed it by hand.

---

## 5. Conventions that have bitten, three epics running

Copy these into the epic; they are not optional and they are why E2 and E3 merged clean.

- **One blocking PR freezes the domain router and the repository**, with every route wired
  against a `NOT_IMPLEMENTED` stub and every query both tracks need written up front. Two
  for two in E2 and E3; E1 skipped it and `main` did not boot after the merge.
- **Files are suffixed by track**, never shared: `question.intake.*` vs
  `question.classify.*`. Never one `matching.controller.js` that both developers open.
- **Services take injected collaborators as a second argument** — see
  `classification.service.js` and `question.intake.service.js`. It is what lets the tests
  assert ordering and failure modes without a database or a network. E4's scoring is pure
  and should need nothing injected; the service around it will.
- **Barrels are append-only, one line, alphabetical**: `routes/index.js`,
  `config/constants/index.js`, `shared/index.js`. A name exported from two files through
  `export *` is a hard `SyntaxError` on first import, not a lint warning — `constants/question.js`
  has the full story, and it is why `UNCLASSIFIED_TOPIC_ID` is re-exported rather than
  redeclared.
- **Never two migrations in flight.** Announce in chat, land one, then the next.
- **`package.json` / `package-lock.json` changes are announced before the commit**, and the
  lockfile is never hand-merged (`git checkout --theirs package-lock.json && npm install`).
- Branch `dev-{a,b}/E4.x-name`, commit, `merge --no-ff` into `main`.
  **`npm run lint`, `npx prettier --check .` and `npm test` must all pass before a merge**,
  and the client must still `npm run build`.
- **Verify against the real stack, not only the unit tests**, and delete the rows the
  verification wrote. Every E3 PR did this and it caught things the tests could not: a
  frozen 15-second timeout that was shorter than a legal request, a payload that had to be
  byte-identical between two endpoints, a `Content-Type` that had to be deleted rather than
  replaced.
- Each PR brief carries an allowlist, a denylist, acceptance criteria a human can check in
  five minutes, and a manual test. The denylist is what actually prevents the collision.

---

## 6. What E4 must not do

- **Do not build offers.** `POST /sessions/:id/offer`, the atomic teacher lock, the 60-second
  countdown and the accept/reject flow are E5, and 5.3 is explicitly human-written. E4 ends
  when the student has picked a teacher; what happens on that click is E5's to define, so
  agree the handoff shape (probably a route, exactly as 3.6 handed `:id` to 3.7 by URL) and
  stop there.
- **Do not touch `/app/ask` or `/app/ask/:id/matching`.** They are E3's, shipped and
  verified.
- **Do not widen `shared/api.d.ts`'s E3 block.** Append an `E4` block; leave the closed one
  alone.
- **Do not re-derive the taxonomy rules.** Parents are headings, leaves are answers; that
  rule is enforced in `TopicPicker`, in `assertLeafTopics`, and in
  `question.classify.service.js`. F1 is the PR that makes the seed agree with it.

---

## 7. Deliverables

1. `docs/epics/E4-matching/README.md` — from `_TEMPLATE-epic.md`, with every section filled:
   the problem the naive split causes, the two-track cut and the seam they meet at, the
   shared-file table (frozen / append-only / split by track, including `package.json`,
   the lockfile and `prisma/schema/`), the order table with owners and sizes, the
   parallelism map, the contract freeze resolving §4's seven gaps, the deviations table
   against §18, and the risks.
2. One `PR-4.x-slug.md` per PR, from `_TEMPLATE-pr.md`.
3. Pre-planned filler for whoever finishes first, in that developer's own files — E2's
   retro is explicit that filler only works when it is small, owned and local.

Two things worth deciding early because they change the shape of everything else: **whether
the epic is six PRs or eight** (E1, E2 and E3 all needed a blocking core PR and a closing
verification PR that §18 does not list), and **where the pure function sits** that lets both
tracks work without waiting on each other.
