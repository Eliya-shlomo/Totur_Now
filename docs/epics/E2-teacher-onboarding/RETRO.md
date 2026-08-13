# E2 — Retro

| | |
|---|---|
| **Closed** | 2026-08-13, provisionally — four checklist items are outstanding |
| **Verified by** | Eliya (DEV-A), one machine, against the deployed Vercel + Render pair |
| **Result** | 17 of the 21 items in [PR-2.7](PR-2.7-e2-close.md) passed. Four are **not run** — see "What is not verified" |

E1's retro asked three questions of E2 and this file answers them with what the repository
and the deployed pair actually did, not with what the plan intended.

## Did freezing the repository prevent the E1 splice, or just move it?

**It prevented it.** `teacher.routes.js` and `teacher.repository.js` were written once in
2.1 and appear in the diff of **no** later PR:

```
2.2  constants/teacher.js · teacher.me.{controller,service,schema}.js
2.3  teacher.public.{controller,service,schema}.js · tests/standing.test.js
2.4  client: teacher.api.js · 3 pickers · TeacherStatusToggle · UserMenu · Onboarding · routes.teacher.jsx
2.5  client: teacher.public.api.js · TeacherCard/Badge/Filters · Teachers · TeacherProfile · routes.guest.jsx
2.6  client: Profile.jsx · routes.teacher.jsx
```

Two developers wrote against one table for a whole epic and neither opened the two files
that would have made a splice possible. E1's `user.repository.js` failure did not recur in
any form. Repeat the move verbatim in E3.

**It did move one thing, and the epic README's own table is why it was small.**
`routes.teacher.jsx` was co-edited by 2.4 (DEV-B) and 2.6 (DEV-A), which is exactly what
the table predicted and permitted — "one line per PR, replace a `Placeholder`, never
reorder". Both PRs added a route line and an import; the imports are alphabetical and the
route lines are in different positions, so the second merge was clean with no rebase. A
rule that names a file and prescribes the shape of the edit is worth more than a rule that
forbids the edit.

**Where the freeze did not reach: `package.json`.** 2.3 added the `test` script and 2.4
added the root Prisma dependencies. Both landed, in sequence, without conflict — but that
is luck of the region, not process. The E1 lesson was "name every shared file", and E2's
list named every shared *source* file and stopped at the language boundary. `package.json`
and `package-lock.json` are shared files with merge behaviour worse than any `.js` in the
repo.

**For E3:** the shared-file table gets `package.json`, `package-lock.json` and
`prisma/schema/*.prisma` rows, each with a rule.

## Did the audience cut hold?

**Yes, at the file level, with one deliberate crossing.** No source file appears in both a
`dev-a/*` and a `dev-b/*` branch. The two tracks met three times and each meeting was
designed:

- **`routes.teacher.jsx`** — one line each, above.
- **`components/teacher/`** — DEV-B owns the three pickers, DEV-A owns the card, badge and
  filters. Same directory, disjoint files, no collision.
- **2.6 imports DEV-B's pickers and `teacher.api.js` and edits neither.** This is the
  clearest evidence the cut works: the edit screen and the stepper set the same four
  fields through the same three controls, and the controls exist once.

The one crossing that was *not* in the plan is `UserMenu.jsx`: DEV-B added
`TeacherStatusToggle` to the header in 2.4, having decided against `AppLayout.jsx`, which
is DEV-A's. The component says so in its own header comment. Deciding it in the file rather
than in chat is the behaviour E1's ownership-drift finding asked for, and it worked.

The cut also produced the epic's best reuse: `TeacherCard` is written once and read by the
public list, the public profile, and the teacher's own edit screen. Splitting the read and
write surfaces across two people would have produced two cards.

## Was 2.6-depends-on-2.2 a real cost or a non-event?

**A non-event, because the filler was real work that was ready to merge.**

```
14:42  filler branch: band + query-schema tests committed
14:50  2.4 merges (DEV-B)      14:50  filler merges (DEV-A)
15:38  2.6 merges (DEV-A)
```

DEV-A never waited on DEV-B: the block was absorbed by a filler PR that pinned two rules
the epic had just argued about (the band ceiling, the public query schema). The design
rule that made this work is not "have filler" but "have filler that is small, owned, and
in the same area of the code" — a filler PR that needed review from the blocked developer
would have moved the wait rather than removed it.

The dependency was also cheaper than the table said. The README carried "2.2, 2.5" until
2.5 shipped, and was corrected to "2.2, 2.4, 2.5" mid-epic. Correcting the table rather
than working around it is the E1 lesson applied.

## What the verification actually found

The end-to-end pass is where E2's real defects surfaced. None of them is a bug in a PR;
all four are contracts that disagree with each other.

**1. The seed declares parent topics; 2.2 rejects them.** `declaredTopics()` in
`prisma/seed/teachers.js` adds each subtopic's parent on purpose
(`for (const slug of [...slugs]) if (PARENT_OF[slug]) slugs.add(PARENT_OF[slug])`), and
2.2's `assertLeafTopics` answers `VALIDATION_ERROR` for exactly those ids. Live production
data at close: **18 parent rows out of 74, across 14 of 22 teachers.**

This is not cosmetic. Before 2.6 shipped its filter, any affected teacher who touched a
checkbox got

```
Pick subtopics rather than whole subjects — these are not: 37, 41.
```

with no control on the screen that could clear it. 2.6 now filters `topicIds` to leaves on
the way out and names the dropped topics in the UI, which unblocks the screen but leaves
the disagreement. **Decide it in E3, before the matching engine reads the column:** either
the seed stops writing parents, or `assertLeafTopics` accepts and ignores them. §9.1 scores
on subtopics, so "leaves only" is the likelier answer, and it is a seed change plus one
migration to clean the existing rows.

**2. `onboardingComplete` is "has ≥ 1 topic".** Documented and deliberate
(`utils/teacherView.js`) because `pricePerBlock` and `levelMax` are `NOT NULL` with
defaults and `teacher_profiles` has no `updated_at`, so nothing distinguishes a chosen 10
from a defaulted 10. The consequence is real: a teacher who finished only step 1 reads as
complete, and 2.4 works around it with a `localStorage` marker that does not survive a
device change. Fixing it is a schema change — a nullable `onboarded_at`, or nullable
price/level columns — not a serializer change, and it should land before E4 uses the flag
for anything.

**3. Teacher constants are copied, not published.** `TEACHING_LEVELS` now has four copies
(`constants/teacher.js`, `authRules.js`, `TeacherFilters.jsx`, `LevelPicker.jsx`) and
`BIO_MAX_LENGTH` two (`constants/teacher.js`, `Profile.jsx`). Every copy names the others,
which is why this is a nuisance rather than a bug — but the price bounds show the
alternative working: they come from `GET /public/pricing`, and no screen in this epic could
disagree with `money.js` about ₪5–20 even by accident. The fix is the same shape: publish
the teacher constants through `/public` or `@tutor/shared`. It is a shared-contract change,
which is why no screen PR took it.

**4. The header status pill is stale until the next navigation.** `TeacherStatusToggle`
re-reads `GET /teachers/me` on `location.pathname`, so finishing the stepper's "go online"
leaves the header showing the previous status until the teacher navigates. Small, and the
fix is DEV-B's file.

## The incident: local development writes to production

During 2.6's verification, edits made at `http://localhost:5173` changed the live demo
teacher `dana.k@demo.tutornow.il` — bio text, and two topic rows. The cause is one line:
`server/.env` holds the **Neon production** `DATABASE_URL`, so the local server and the
deployed server share a database. The bio was restored; the two parent topic rows were not,
because the API that would restore them is the one that rejects parent ids.

`docs/DEPLOYMENT.md` §4 already warns about this exact configuration — "putting the
production URL in your `.env` and forgetting it there is how a local `prisma migrate reset`
ends up pointed at production". The warning was written about `reset` and the damage came
from ordinary QA typing in a form, which is the more likely path and the one nobody
guarded.

**For E3:** local `.env` points at the Docker Postgres that `npm run db:up` already
provides, the production URL is supplied inline per command, and a verification pass that
mutates data is run locally by default. Filed as a follow-up task, plus a warning added to
`docs/DEPLOYMENT.md` in this PR.

## What is not verified

Four checklist items were not run, and the epic should not be read as fully closed until
they are:

- Register a new teacher → lands in `/teach`
- The stepper resumes at the right step after closing the tab mid-flow
- "Go online" → the teacher appears in `/teachers` within one refresh
- Two teachers editing simultaneously on two machines → no cross-talk

The first three need writes to the production database, which is exactly what the incident
above says to stop doing casually; they should run against a local database once
`server/.env` is split, or against production as a deliberate, agreed pass. The fourth
needs DEV-B and a second machine — E1's equivalent step is what found the CORS and
`VITE_API_URL` misconfigurations, so it is not optional.

## The checklist, as run

Against `https://tutor-now-api.onrender.com` and
`https://totur-now-client-vnxx.vercel.app` on 2026-08-13. The brief's list, in its order.

| Item | Result |
|---|---|
| `/health` green before starting | ✅ `{"status":"ok","db":"ok","uptime":491}` |
| Register a new teacher → lands in `/teach` | ⏸ not run — needs a production write |
| Stepper resumes at the right step | ⏸ not run — needs a production write |
| Topics, level and price persist; removing a topic removes it | ✅ on `dana.k`, survived a reload |
| Price slider bounds match `GET /public/pricing` | ✅ `min 5 / max 20`, bands A ₪9 · B ₪14 · C ₪20 |
| "Go online" → appears in `/teachers` within one refresh | ⏸ not run — needs a production write |
| New teacher carries `New` and shows no rating | ✅ `NEW` + `rating: null`, never `0` |
| Seeded teacher carries the badge `standingOf` computes | ✅ `dana.k`, 105 sessions at 4.6 → `TOP` |
| `/teachers` browsable logged out | ✅ |
| Filters narrow; combined narrow further; filtered URL shareable | ✅ 22 → 11 (`level=5`) → 5 (`+band=B`) → 3 (`+onlineOnly`), and the URL restores the controls |
| `/teachers/:id` matches the list entry | ✅ field-for-field equality |
| Editing the profile is reflected on the public profile | ✅ |
| Offline toggle removes the teacher from `?onlineOnly=true` | ✅ |
| `PATCH /teachers/me` with a student's token | ✅ `FORBIDDEN` (and `GET` too) |
| `status: 'IN_SESSION'` | ✅ `VALIDATION_ERROR` — "Status can only be OFFLINE or ONLINE." |
| `pricePerBlock: 21` | ✅ `VALIDATION_ERROR` — and `4`, `levelMax: 6`, `{}` and an unknown key all rejected |
| No public payload contains an email, a `status`, or a private counter | ✅ keys are exactly the contract's ten |
| `GET /teachers` issues a constant number of SQL statements | ✅ **7 for 1, 5 and 20 rows** — `BEGIN`, profiles, users, join, topics, `COUNT`, `COMMIT` |
| Both screens usable at 375px | ✅ `scrollWidth === clientWidth` on list, profile and edit |
| Two teachers on two machines → no cross-talk | ⏸ not run — needs DEV-B |
| Server logs contain no password, hash, or token | ✅ zero matches for the password, a JWT, or a bcrypt hash across a login + `PATCH` + `GET` |

## Carried into E3

1. Freeze the domain router **and** the repository in one blocking PR. This is now
   two-for-two.
2. The shared-file table covers `package.json`, `package-lock.json` and the Prisma schema,
   not only application source.
3. Filler PRs are pre-planned, small, and in the blocked developer's own area.
4. A contract that two subsystems disagree about (the seed vs a validator) is a defect at
   the moment the second one is written, not at the moment a user hits it. E2 shipped three
   of them and found all three during verification rather than during review.
5. Local development does not share a database with production.
