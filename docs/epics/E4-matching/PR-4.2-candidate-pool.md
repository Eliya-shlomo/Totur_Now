# PR 4.2 — Candidate pool: §9.1 hard filters

| | |
|---|---|
| **Epic** | E4 — Matching Engine |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 4.1 (merged) |
| **Blocks** | 4.5 |
| **Branch** | `dev-a/E4.2-candidate-pool` |

## Contract implemented

`MVP.md` §9.1 — the hard filters — as the body of `findCandidates` in the frozen
`matching.repository.js`, plus `matching.candidates.service.js`, which decides what to pass
it. No endpoint yet; 4.5 wires it.

## Scope

Who is eligible. Six predicates, and the epic README's contract freeze has already ruled on
five of them — this PR implements those rulings, it does not relitigate them.

**The service (`matching.candidates.service.js`, new, DEV-A's) resolves the inputs:**

```
requiredLevel = estimatedLevel ?? declaredLevel ?? min(TEACHING_LEVELS)
affordable    = Math.floor(walletBalance / OPENING_BLOCKS)
priceCeiling  = Math.min(bandCeiling(priceBand), affordable)
```

and short-circuits before touching the pool when `affordable < MIN_PRICE_PER_BLOCK`: that
student cannot afford anybody on the platform at any band, and the answer is
`INSUFFICIENT_CREDIT` with an empty list and **no candidate query at all**. The seeded
`ido.student` (0 credits) is that case, and it is correct behaviour rather than a bug to
route around.

Nothing here is a literal. `OPENING_BLOCKS` is `constants/session.js` (§5.1 — the opening
block is two blocks, charged immediately, which is exactly §9.1's `* 2`), `bandCeiling` is
`utils/pricing.js` (already written, already used by the browse filter, so the two can never
disagree about what a band means), `MIN_PRICE_PER_BLOCK` and `TEACHING_LEVELS` come from the
barrel.

**The repository fills in `findCandidates`.** Prisma `where`, not raw SQL — see the epic's
deviations table.

**What 4.1 left you, precisely.** The signature, the select list and the `Decimal` → `number`
conversion are written, frozen and merged. What is *not* written is the `where`: 4.1 ships
the function accepting all five parameters and using none of them, so it currently returns
every teacher in the table. **This PR adds a `where` clause and changes nothing else in that
file.** If you find yourself editing the select list, the return mapping or the signature,
stop — that is a frozen shape and a chat message before the code.

Every predicate:

| §9.1 | Implementation |
|---|---|
| `status == 'ONLINE'` | `status: 'ONLINE'` — and `user: { isActive: true }` beside it, because `findTeacherPage` already excludes blocked accounts and a matching pool must not be laxer than a public list |
| `level_max >= question.estimated_level` | `levelMax: { gte: requiredLevel }`, with the fallback above |
| `question.topic_id ∈ teacher.topics` | the **subtopic-or-sibling** rule below |
| `price_per_block <= band_ceiling(...)` | `pricePerBlock: { lte: priceCeiling }` |
| `wallet_balance >= price_per_block * 2` | folded into `priceCeiling` — one evaluation, not one per row |
| `teacher_id ∉ student.blocked_teachers` | **cut** — no table, no column, no feature (E9) |
| `teacher_id ∉ question.rejected_by` | `userId: { notIn: excludeTeacherIds }` |

**The topic rule, which is the one that needs care.** A candidate passes if they declare the
question's **subtopic**, or **any leaf under the question's parent topic**:

```js
topics: { some: { OR: [ { topicId: subtopicId }, { topic: { parentId: topicId } } ] } }
```

and when `subtopicId` is null the whole key is `undefined` — the filter is skipped and
everyone passes, which is §9.1's `topic_id == 0 → everyone passes` arriving by a shorter road,
because a question on the sentinel always has a null subtopic.

Not `teacher_topics.topic_id = question.topic_id`, which is what §9.1 literally says.
`teacher_topics` holds leaves — that is what F1 finishes and what `assertLeafTopics` already
enforces on every write — so a predicate on the parent id would match nobody once F1 lands,
and only the fourteen seeded teachers with legacy parent rows before it. The rule above is
inert with respect to those rows: a declared parent is neither the question's subtopic nor a
leaf under it, so **this PR behaves identically whether or not F1 has merged.** Prove that in
a test rather than asserting it in a comment.

**`excludeTeacherIds` is `undefined`, never `[]`.** `rejected_by` is `[]` on every existing
row and stays that way until E5, and an exclusion list with nothing in it should be absent
from the query rather than present and empty. Check what Prisma actually emits for `notIn: []`
with `DEBUG=prisma:query` before deciding you do not care.

**The select list is 4.1's and does not change.** `...TEACHER_VIEW` plus `offersReceived`,
`offersAccepted`, and `topicStats` narrowed to the question's subtopic and parent — the
relation field on `TeacherProfile` is `topicStats`, not `teacherTopicStats`, which is what an
earlier draft of this brief called it. Two things 4.1 has already done that this PR must not
undo: the stats relation is loaded **with** the candidates rather than per candidate (E2's
N+1 lesson), and the four `Decimal` columns are converted to `number` on the way out, because
the seam says `number` and `Prisma.Decimal * 0.35` does not do what it looks like it does.

**The statement-count measurement is this PR's, and it moved here from 4.1.** 4.1 could not
run it: with no `where`, a 3-candidate run and a 30-candidate run are the same query over the
same table and the check has nothing to vary. Now that the filters exist it is a real
measurement, and it is an acceptance criterion below.

**No index is added on faith.** Run `EXPLAIN (ANALYZE, BUFFERS)` on the generated query
against the seeded local database and paste the plan into the PR description. `idx_teacher_available`
already covers `(status, level_max, price_per_block) WHERE status = 'ONLINE'` — it was widened
to include price by `20260811120000_open_marketplace` — so **do not create it again**; a
duplicate `CREATE INDEX` for a name that exists is exactly what `teachers.prisma`'s comment
warns about. The one plausible new index is `teacher_topics(topic_id)`, whose composite
primary key is `(teacher_id, topic_id)` and therefore does not serve a lookup by topic alone.
With 22 seeded teachers Postgres will very likely sequential-scan regardless, in which case
**the correct outcome is no migration and a paragraph in the PR** saying what the plan was and
at what row count it would change. If it does warrant one: announce in chat first, because F1
and F5 are queued on the same rule (`OWNERSHIP.md` §2 — never two migrations in flight).

## Files you may touch

```
server/src/services/matching.candidates.service.js  new
server/src/repositories/matching.repository.js      the `where` clause of findCandidates and
                                                    nothing else — the signature, the select list
                                                    and the Decimal conversion are 4.1's and frozen
server/tests/matching.pool.test.js                  new
prisma/migrations/                                  ONLY if EXPLAIN justifies it, announced first
docs/epics/E4-matching/README.md                    tick the status box
```

## Files you must NOT touch

```
server/src/services/matching.scoring.js             DEV-B's since 4.3 — this PR ranks nothing
server/src/services/matching.averages.service.js    DEV-B's, 4.3
server/src/repositories/teacher.repository.js       frozen; TEACHER_VIEW is imported, not copied
server/src/repositories/question.repository.js      frozen since 3.1
server/src/utils/pricing.js                         bandCeiling is called, not edited
server/src/config/constants/matching.js             4.1 finished it; import from the barrel
server/src/routes/matching.routes.js                frozen since 4.1
server/src/controllers/matching.controller.js       4.5's
prisma/schema/*.prisma                              no model change is needed for any of this
client/**                                           nothing client-side in this PR
```

## Acceptance criteria

- [ ] An `integration-by-parts` question at level 5, band C, balance 120 → **three** candidates on the seed: Dana K., Yossi M., Avi K. (Gil V. and Shira G. teach it but are `OFFLINE`, Tal/Lior/Roni cap below level 5)
- [ ] The same question at band A → zero candidates, and the service reports `NO_AVAILABLE_TEACHERS`, not an error
- [ ] Balance 24 (`noya.student`) → `priceCeiling` is 12, and every candidate's `pricePerBlock` is ≤ 12
- [ ] Balance 0 (`ido.student`) → `INSUFFICIENT_CREDIT`, empty list, and **`DEBUG=prisma:query` shows no candidate query ran**
- [ ] A question with `subtopic_id = NULL` and `topic_id = 0` returns every online, affordable teacher regardless of their topics or level
- [ ] A question with `estimated_level = NULL` but `declared_level = 4` filters at 4, not at 3 and not at nothing
- [ ] A question with both null filters at 3 and excludes nobody on level
- [ ] A teacher who declares a *sibling* leaf under the same parent is a candidate; a teacher who declares only an unrelated leaf is not
- [ ] Deleting the seed's legacy parent rows from `teacher_topics` by hand changes **no** result (this is the F1-independence check — restore them, or re-seed, afterwards)
- [ ] Putting a candidate's id into the question's `rejected_by` removes exactly that candidate; emptying it restores them
- [ ] Every numeric field reaching the service is `typeof === 'number'` — no `Prisma.Decimal` escapes the repository (4.1 wrote the conversion; this criterion is that the `where` did not break it)
- [ ] `findCandidates` costs a constant number of statements at 3 and at 30 candidates (`DEBUG=prisma:query`) — **carried from 4.1, which had no filter to vary**
- [ ] The diff to `matching.repository.js` touches the `where` and nothing else: no line of the select list, the signature or the return mapping moves
- [ ] The PR description contains the `EXPLAIN` output and a sentence on whether an index is warranted
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` pass

## Manual test

1. `npm run db:up && npm run db:seed`, then drive the service from a node one-liner (no endpoint exists yet) for each of the acceptance rows above
2. `psql` on 5433: `update teacher_profiles set status='ONLINE' where user_id = (select id from users where email='gil.v@demo.tutornow.il');` → the pool becomes four. **Set it back to `OFFLINE` when you are done** — the seed's status distribution is what 4.8 verifies against
3. `update questions set rejected_by = array[<dana's uuid>]::uuid[] where id = '<q>';` → Dana disappears. `update questions set rejected_by = '{}' where id = '<q>';` → she returns
4. `delete from teacher_topics tt using topics t where t.id = tt.topic_id and t.parent_id is null;` → re-run every case, confirm identical results, then `npm run db:seed` to restore
5. `DEBUG=prisma:query npm run dev:server` and watch the statement count for a 3-candidate and a 30-candidate run (duplicate the seed teachers locally if you need 30, then reset)

## Review checklist additions

- Confirm the wallet rule is expressed **once**, as a ceiling, and does not also appear as a per-row predicate. Two spellings of one rule is the defect class E2 shipped three of.
- Confirm `bandCeiling` is imported from `#utils/pricing.js` and that the band table is not read directly. The browse filter and the match filter must resolve `'B'` through the same function.
- Confirm the topic predicate does not mention `parentId: null`, `assertLeafTopics`, or anything that assumes F1 has landed.
- Confirm the `Decimal` → `number` conversion happens in the repository and not in the service, and that it is not `Number(x)` on a possibly-`null` relation row.
- Confirm no new index was added without an `EXPLAIN` in the PR description, and that `idx_teacher_available` was not recreated.

## Notes

**Why Prisma and not raw SQL, when §18 says "hard-filter SQL".** Every §9.1 predicate is
expressible in a `where`, including the topic `OR`. Raw SQL would buy one thing — hand-written
index hints, which nobody wants — and cost three: a second copy of `TEACHER_VIEW`'s column
list, manual `snake_case` mapping on the way back, and `Decimal` handling that differs from
every other read in the codebase. `EXPLAIN` still runs; the plan is the plan whichever layer
emitted the query.

**Why the wallet rule became a ceiling.** §9.1 writes it as a per-row comparison, which is
true but unhelpful: it cannot use the index, it re-reads a constant balance once per teacher,
and — the part that matters — it makes "you cannot afford anyone" indistinguishable from
"nobody is online". As a ceiling it is one integer, computed before the query, and the
distinction falls out for free. That is why `MatchesResponse` carries `priceCeiling`: the
screen can say *why* a teacher the student saw yesterday is missing today.

**The 0-credit student is a feature of the demo, not a hole in it.** The seed says so
explicitly — Ido "sees the top-up flow, which is the other half of §5.4". Top-up is E7, so in
E4 that path ends at a sentence. Make the sentence right; 4.7 renders it.

**`teacher_topic_stats` comes back through this query but is not used by it.** The pool does
not care how good a teacher is, only whether they are eligible — §9.5 is explicit that
availability and price are filters and quality is scoring. The stats ride along because
fetching them separately would be the N+1 this codebase has now avoided three times, not
because this PR reads them.
