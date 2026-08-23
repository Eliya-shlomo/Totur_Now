# E8 — Retro

| | |
|---|---|
| **Closed** | 2026-08-23 |
| **Verified by** | Eliya (DEV-A), local Docker Postgres **`localhost:5433/tutor_now`**, one machine, one sitting |
| **Result** | ◐ **Closed with §18's criterion answered in numbers, one half of it failing, and four findings filed.** All thirteen steps ran. The propagation writes exactly what §7 says it writes. The rank moved by +0.0011 and the *position* did not, and that gap is the most useful thing this pass produced |

The database is named above because E7's fifth risk was two databases and tooling that
disagreed about which. Every number below came out of `localhost:5433/tutor_now`, seeded
by `npm run db:seed` immediately before step 1, and `scripts/reconcile.mjs` prints the
same host in step 13's output.

E8 is the fourth single-developer epic in a row. `npm test` is 886 green tests against
injected collaborators and no database. It proved every function keeps the invariant it
was handed; it could not have found any of the four findings below, because all four are
about **what happens when the pieces are composed** — which is E2's finding, arriving for
the fifth epic running.

## What §18 said E8 was, and what it turned out to be

| §18's row | What actually happened |
|---|---|
| 8.1 rating write | Half of it shipped in 6.6 — `reviews` and the two `teacher_profiles` counters. **`teacher_topic_stats` had one writer and it was the seed.** 8.1 wrote the other half |
| 8.2 per-topic aggregation | Not aggregation: the table was already there and E4 already read it. 8.2 is the defect E4's retro filed — `globalRating` was the last unsmoothed component |
| 8.3 public profile + reviews | The profile existed since 2.3. 8.3 added the reviews as their own paged endpoint |
| 8.4 mandatory rating screen | Merged in 6.6, with no Skip. E8 added the consequence instead: the history screen is the way back to an unfinished rating |
| 8.5 (§12's `GET /teachers/me/stats`) | Not in §18 at all. First implementation — nothing could have written it before 8.1 |
| 8.6 session history | Renumbered to 8.4; the endpoint is `GET /sessions/mine`, not §12's `/students/me/sessions` |

## The pass — thirteen steps, one sitting, one database

Driven through HTTP against the running local server, with the two screens that are
genuinely *screens* — `/teach`'s topic block and `/app/history` — read in the browser at
375px. Same deviation E7's retro recorded, same reason: every request below is a real
request through the real router with real authentication, and a pass driven entirely by
hand in two browsers is a pass that gets abandoned halfway.

**Scores are not on any response and could not be.** §14.2 gives the student an order, not
grades. So the numbers below come from a scratch harness that imports
`resolveCandidatePool` and `rankCandidates` — the endpoint's own two functions, in the
endpoint's own order — and prints what the endpoint withholds. It is not in the repository
and this PR adds no file to `server/`.

The harness measures "before" by **substituting the step-1 baseline values back into the
candidate rows** and scoring again: Dana K.'s two `teacher_topic_stats` rows, her four
`teacher_profiles` counters and her offer pair, all rolled back together, with step 1's
platform averages. That method is validated rather than asserted — for the same-subtopic
question it reproduces **0.7633**, which is the score measured live off the endpoint in
step 2, before the rating existed.

### 1. Baseline ✅

Teacher under test: **Dana K.** (`22e5b878-6393-4e86-b67d-2ab5274ee44f`).

    teacher_topic_stats                sessions  resolved  rating_sum  rating_count
      45  Integration by parts (leaf)     40.00     36.00      184.00         40.00
      43  Definite (leaf)                 35.00     31.00      161.00         35.00
      41  Calculus — Integrals (parent)   22.50     20.10      103.50         22.50
      38  Differentiation rules (leaf)    30.00     26.00      138.00         30.00
      37  Calculus — Derivatives (parent)  9.00      7.80       41.40          9.00

    teacher_profiles   sessions 105 · resolved 93 · rating_sum 483 · rating_count 105
                       offers_received 128 · offers_accepted 105 · status ONLINE

    platform averages  rating 4.483516 · resolveRate 0.844607 · acceptRate 0.723545
    teacher_topic_stats, whole table: 46 rows, sessions_count sum 712.40

### 2. Rank before ✅ — and it reproduces itself

Asked as a seeded student: *"how do I choose u and dv for the integral of x·ln(x) dx"*.
The classifier placed it at **topic 41 / subtopic 45, level 5** — the intended pair, with
no help.

| # | Teacher | score |
|---|---|---|
| 1 | Avi K. | 0.7683 |
| 2 | Yossi M. | 0.7652 |
| 3 | **Dana K.** | **0.7633** |

Re-asked with nothing changed: **identical order**. The sort is deterministic, so the
numbers below are measuring the rating rather than noise.

### 3. The rating ✅

One session with Dana on that question: offer → accept → `ACTIVE` → end → 5 stars,
resolved, with a comment. The session is `RATED`.

### 4. The propagation ✅ — exactly §7, to the digit

| row | before | after | delta |
|---|---|---|---|
| 45 leaf — sessions / resolved / sum / count | 40.00 / 36.00 / 184.00 / 40.00 | 41.00 / 37.00 / 189.00 / 41.00 | **+1 / +1 / +5.00 / +1** |
| 41 parent — sessions / resolved / sum / count | 22.50 / 20.10 / 103.50 / 22.50 | 22.80 / 20.40 / 105.00 / 22.80 | **+0.30 / +0.30 / +1.50 / +0.30** |
| `teacher_profiles` | 105 / 93 / 483 / 105 | 106 / 94 / 488 / 106 | +1 / +1 / +5 / +1 |

`/teach` renders it without a database client, which is the reason 8.5 exists: the topic
block reads **41 sessions · 37 solved · 4.6 · 41 ratings** for *Integration by parts*, and
under *Across whole subjects*, **22.8 sessions · 20.4 solved · 4.6 · 22.8 ratings** for
*Calculus — Integrals*. Read at 375px, no horizontal scroll.

### 5. Cache cleared ✅

`getPlatformAverages()` holds for `PLATFORM_AVERAGES_CACHE_MS`. The server was restarted
between step 4 and step 6, and the harness calls `clearPlatformAveragesCache()` on every
run, so no measurement below is taken against a stale prior.

### 6. Rank after, same subtopic ⚠️ — the score moved, the position did not

| | before | after | delta |
|---|---|---|---|
| Dana K., score | 0.7633 | **0.7645** | **+0.0011** |
| Dana K., position | 3 of 3 | **3 of 3** | — |
| Yossi M. (the teacher above her) | 0.7652 | 0.7652 | — |

**§18's criterion says "measurably raises their rank".** The score is measurably higher and
the rank is unchanged: one 5-star rating on top of 105 is 0.0011 of score, and the gap to
the teacher above was 0.0019. Recorded as a partial failure rather than dressed up — see
finding **F2**.

How much would move it, by the same scorer with the same arithmetic §7 uses:

    +1 more rating  → position 2 (0.7655 vs Yossi 0.7652)
    +4 more ratings → position 1 (0.7686 vs Avi  0.7683)

**For the student who wrote the rating, the position did change: 3 → 1.** That student's
next integrals question puts Dana first, ahead of Avi K. and Shira G. — `history` is a
§9.2 component at weight 0.10 and a 5-star review is what sets it. That is the criterion
as a *student* experiences it, and it is worth separating from the criterion as the
*platform* ranks it, because the two answers differ.

### 7. Rank after, sibling topic ✅ — and it found the rule that governs it

Two sibling questions, both under parent 41, and they answer differently:

| question | subtopic | Dana has a leaf row? | total delta | topic-specific part |
|---|---|---|---|---|
| areas between curves | 44 | **no** | +0.0008 | **+0.0003** |
| definite integrals | 43 | yes (35 sessions) | +0.0005 | **0.0000** |

The topic-specific part is the total minus the +0.0005 that every question shows,
including unrelated ones — the profile-level counters and the offer pair, which moved for
this teacher regardless of topic.

So the "and slightly raises it for other calculus questions" half of §18's criterion is
**true, at half the movement of the leaf, and only where the teacher has no history of
their own in that subtopic.** `topicRatingPair` is `subtopicStats ?? topicStats`: the
parent row is consulted only when the leaf row is absent. That is deliberate and
documented in `matching.scoring.js` — "The fallback is structural: it picks a *row*" — and
it means the propagation is invisible on subtopics the teacher already works in. Recorded
as **F3**, because §18's sentence and the code's rule are not the same sentence.

### 8. Rank after, unrelated topic ✅ — the negative control holds

| question | topic / subtopic | result |
|---|---|---|
| derivative of x³·sin(x) | 37 / 38 — Dana teaches it, has stats, different subject tree | topic-specific delta **0.0000**, position 1 → 1 |
| triangle congruence (SAS) | 20 / 21 — geometry | Dana is **not in the pool at all**, and neither is anybody else: no online teacher declares it |

The derivatives case is the stronger control of the two: same teacher, same pass, a
subtopic whose parent is a different subject — and the integrals rating moved nothing
there. The propagation is not leaking.

### 9. E4's criterion ✅ — by 4.3 × 10⁻⁷

Gil V. and Shira G. flipped `ONLINE`, same integrals question:

| # | Teacher | score | ratings behind it |
|---|---|---|---|
| 1 | Avi K. | 0.768307 | 55 |
| 2 | Shira G. | 0.767155 | 15 |
| 3 | Yossi M. | 0.765174 | 120 |
| 4 | **Dana K.** | **0.76445219** | 106 |
| 5 | Gil V. | **0.76445176** | **1** |

**Dana K. is above Gil V.** — the check E4's retro recorded as failing. It passes. It
passes by 0.00000043, and the tie-break in `rankCandidates` would have decided it if one
more digit had gone the other way.

Component by component, which is where the margin comes from:

| component | weight | Dana | Gil |
|---|---|---|---|
| topicFit | 0.35 | 0.919227 | 0.914077 |
| globalRating | 0.20 | 0.919680 | 0.914077 |
| resolveRate | 0.20 | 0.884905 | 0.746350 |
| acceptanceRate | 0.10 | 0.818056 | 0.624395 |
| history | 0.10 | 0 | 0 |
| **newTeacherBoost** | **0.05** | **0** | **1** |

Without 8.2, Gil's `globalRating` is `5/5 = 1.0` raw and contributes 0.20 instead of
0.1828: he scores **0.7816** against Dana's 0.7647 — which is not one place higher, it is
**first in the list**, above Avi K.'s 0.7683 and every other teacher, on the strength of a
single five-star review. 8.2 is what flipped it. What 8.2 did *not* anticipate is that `newTeacherBoost` hands 0.05 straight
back to exactly the teacher smoothing just corrected — see **F1**.

Both rows reverted to `OFFLINE` afterwards; the list returns to three teachers.

### 10. The sentinel ✅ — zero rows, before and after

A session on the seeded unclassified question (`topic_id = 0`, no subtopic), rated 5 stars
and resolved:

    teacher_topic_stats before   46 rows, sessions_count sum 712.40
    teacher_topic_stats after    46 rows, sessions_count sum 712.40
    rows with topic_id = 0       0

`topicStats.js` returns `[]` when there is no classified leaf, and the write path honours
it. A teacher does not earn topical history in a topic that means *we do not know*.

### 11. The unfinished rating ✅

The session from step 3, between ending and rating:

    GET /sessions/mine   total 1 · unratedCount 1
      ENDED · Integration by parts · 2 blocks · review null

After submitting through the review endpoint the row is `RATED`, its review reads
`{stars: 5, isResolved: true}`, and **`unratedCount` drops to 0**. §10's only edge out of
`ENDED` is reachable again from the history screen, which is the whole reason 8.4 exists.

### 12. The public profile ✅ — and no student anywhere in it

Unauthenticated `GET /teachers/:id/reviews`:

```json
{ "id": "d68d09af-…", "stars": 5, "isResolved": true,
  "comment": "Explained the LIATE choice clearly and we finished the integral together.",
  "topicName": "Integration by parts", "createdAt": "2026-08-23T11:15:02.014Z" }
```

Grepped for every seeded student name, for `student`, and for `studentId`: **zero
matches.** The serializer does not know the field exists and the repository does not
select it.

### 13. Money did not move ✅

    database: localhost:5433/tutor_now

    ✔ 1. wallets whose balance disagrees with their ledger — none
    ✔ 2. sessions whose total_charged disagrees with their blocks — none
    ✔ 3. sessions whose split does not add up — none
    ✔ 4. sessions whose ledger rows disagree with their columns — none
    ✔ 5. teachers left IN_SESSION with no session running — none

    RECONCILED — five invariants, zero rows.

## Findings

### F1 — `newTeacherBoost` hands back almost exactly what 8.2's smoothing took away

A teacher with **one** rating and a teacher with **106** score within 4.3 × 10⁻⁷ of each
other on the same question (step 9). 8.2 removed 0.0172 of unearned score from the
one-rating teacher by smoothing `globalRating`; `newTeacherBoost` gives 0.05 × 1.0 = 0.05
back, unconditionally, to every teacher under `NEW_TEACHER_SESSIONS`.

Both weights are defensible alone — §9.2 wants cold start to be survivable, and §9.3 wants
evidence to count. Composed, they cancel, and the number the platform ends up ranking on is
an accident of two constants nobody chose together. `matching.scoring.js` already argues
that scoring the rating at zero *and* paying a boost was "punishing and compensating the
same fact with two different numbers"; this is the same collision from the other side.

**Not fixed here** — a close PR that edits code is a defect wearing a close PR's branch
name. It is a weights decision, it needs a number chosen deliberately, and it belongs in a
PR that can measure the whole seeded pool before and after.

### F2 — §18's criterion says "rank" and one rating moves the score, not the position

Step 6. +0.0011 of score, position 3 → 3. The criterion is answerable either way depending
on what "rank" means, and the honest answer is: **the platform's ordering did not change,
and the ordering the rating student sees did** (3 → 1, via the `history` component).

This is arguably the system working — one review out of 106 *should not* reorder a
marketplace — but §18's sentence promises a reordering, and a criterion that reads as
passed when the list is identical is a criterion nobody can act on. The number that makes
it concrete: **two ratings move her to position 2, five to position 1.**

### F3 — the parent row is invisible wherever the teacher already has a leaf row

Step 7. `topicRatingPair` is `subtopicStats ?? topicStats`, so the 0.3 propagation only
ever reaches the score on subtopics where the teacher has **no** history of their own.
That is a deliberate, documented rule and it is also not what §18's "slightly raises it for
other calculus questions" implies to a reader.

Practically: the propagation is a cold-start mechanism for adjacent subtopics, not a
general lift across a subject. Worth writing into `MVP.md` §9.3's wording rather than into
the code — the code's behaviour is the defensible one.

### F4 — `end_reason` says `error` on a session that has a video room

Step 10's session ended 0.3 s after it went `ACTIVE` and came back
`end_reason: 'error'` — `session.end.service.js`'s case 1, "no room was ever minted, full
refund". But `sessions.video_room_url` on that row **is not null**: the room landed a
moment after the end decision read the column. Step 3's session, ended nine seconds in,
took case 2 (`student_ended`, "ended within the opening window") with the same outcome for
the money.

A race between an asynchronous room mint and a very fast end. Nobody is out of pocket
either way — both branches refund in full — and the only wrong artefact is the reason
recorded against the session. It is E6's file, so it is filed here rather than fixed here.

### F5 — `server/.env` points at a production Neon database, and a script run from `server/` finds it first

Not an E8 defect, and the most dangerous thing this pass touched. The repository keeps one
`.env` at the root — `config/env.js` resolves `REPO_ROOT/.env` explicitly, and
`prisma/seed/index.js`'s own comment says "server/ and client/ have none of their own".
There is one at `server/.env`, it carries `NODE_ENV=production` and a Neon
`DATABASE_URL`, and anything that loads `dotenv/config` with `cwd=server/` — the Prisma
CLI, any scratch script — gets **that** database rather than the local one.

The measurement harness hit it on its first run and read from Neon before the mistake was
noticed. The read was harmless; `npm run db:seed` under the same conditions would not have
been. Left alone deliberately (this PR touches `docs/` only) and raised as an open item,
because deleting or renaming a file with live credentials in it is the operator's call.

## The two items that were known before the pass started

**The 0.3 lives in two places.** `PARENT_TOPIC_WEIGHT` in `server/src/config/constants/`
and `PARENT_WEIGHT` in `prisma/seed/teachers.js`, because `prisma/seed/*` cannot reach
`#config`. Both are written down in both files. Unifying them needs a decision about where
a constant lives that both `server/` and `prisma/seed/` can import — E7's 7.9 is what the
third copy would have become.

**The two `sessions_count` denominators disagree, by design.** `teacher_profiles`' counter
moves when a session *ends*; `teacher_topic_stats`' moves when it is *rated*. This pass
made the gap visible on one screen — after step 3 the dashboard reads 106 sessions at the
top and 41 + 35 + 30 topic sessions below it — and 8.5 answers it with one sentence rather
than hiding either figure. Closing it automatically would mean writing topic stats inside
the settlement transaction, which is one of §17.5's three human-written paths.

## Mutation ledger

Every row written by hand, and the undo.

| # | What | Where | Reverted |
|---|---|---|---|
| 1 | `teacher_profiles.status` `OFFLINE → ONLINE` for Gil V. and Shira G. | step 9 | ✅ both back to `OFFLINE`, pool returns to three teachers |

That is the whole of it. Every other row this pass created — six questions, two sessions,
two reviews, the ledger rows behind them and the `teacher_topic_stats` increments — was
written by the application through its own endpoints, which is what the pass was measuring.

**The database is not at seed state and `npm run db:seed` will not return it there.** The
seed upserts on business keys; it does not delete sessions, reviews or the stat increments
they caused. A clean baseline needs `prisma migrate reset`. Recorded rather than
performed — resetting is the operator's call, and this pass's evidence lives in those rows.

Undo, as run:

    update teacher_profiles set status='OFFLINE'
      where user_id in (select id from users
                        where email in ('gil.v@demo.tutornow.il','shira.g@demo.tutornow.il'));
    UPDATE 2

    Shira G.|OFFLINE
    Gil V.|OFFLINE

## Open items

| # | Item | Where it goes |
|---|---|---|
| 1 | F1 — `newTeacherBoost` cancels 8.2's smoothing for a one-rating teacher | its own PR, with a whole-pool measurement |
| 2 | F2 — §18's E8 criterion is answered by score and not by position | a wording decision in `MVP.md` §18, or a weights PR |
| 3 | F3 — the parent row never reaches the score where a leaf row exists | `MVP.md` §9.3's wording |
| 4 | F4 — `end_reason: 'error'` races an asynchronous room mint | E6's owner |
| 5 | F5 — `server/.env` carries production credentials and shadows the root `.env` for anything run from `server/` | operator, before anything else runs a Prisma command from that directory |
| 6 | `PARENT_TOPIC_WEIGHT` and the seed's `PARENT_WEIGHT` are two copies of 0.3 | a shared-constants decision |
| 7 | The two `sessions_count` denominators | documented on the dashboard; closing it is a §17.5 path |
| 8 | Reviews are unmoderated student text on a public page | E9's admin surface |

## What one epic of reputation cost, in plain words

The table §18 asked for had existed since PR 0.2 and nothing had ever written to it except
the seed. Four epics ranked teachers on it. E4's retro filed the defect, E5, E6 and E7
inherited it, and every match score in the product was computed from fixtures for a month.

E8 is six PRs, one of which — 8.1 — is the twenty lines that make the other five true. The
rest is reading it back: to a stranger on a profile, to a student in their history, to the
teacher whose numbers they are. The pass above is the first time anybody has watched a
five-star review travel from a rating screen to a ranking, and the two things it found that
matter — a cold-start boost that cancels a smoothing fix, and a propagation that stops at
the first row it finds — are both consequences of two correct decisions meeting. Which is
what a closing pass is for.
