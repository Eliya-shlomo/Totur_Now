# E3 — Retro

| | |
|---|---|
| **Closed** | 2026-08-17, **on paper** — the verification pass was never run |
| **Verified by** | Nobody. See "What is not verified" |
| **Result** | 0 of the 32 items in [PR-3.8](PR-3.8-e3-close.md) were run. Every claim below is evidence from the repository, not from a pass |

E3 shipped seven PRs in one day, blocked nothing, and then did not close. This file is
written during E4's closing PR, three days late, because E4 needed the answers and E3's
`RETRO.md` did not exist to give them. That gap is the epic's most important finding and
it is not a code finding.

## Why this file is late, and what it cost

3.1 through 3.7 merged on 2026-08-16. 3.8 never opened. E4's first PR merged the next
morning against an epic whose verification had not happened and whose retro had not been
written.

The cost is measurable in E4's own README. Writing that epic required re-deriving, by
reading code, four things E3's retro was supposed to hand over: whether `teacher_topics`
holds leaves, whether `onboardingComplete` can be trusted, what the sentinel question's
shape is, and whether F1/F3 gate the matching engine. E4's README spends a table and four
paragraphs on it under "What E4 does not wait for". That work was done twice — once by
whoever would have written this file, and again by whoever wrote E4's.

**For E5:** the closing PR opens on the day the last feature PR merges, or the epic is not
finished. E1 and E2 both closed within a day. E3 did not, and E3 is the epic nobody can
say is correct.

## Did the seam hold?

**Yes, completely.** `classification.service.js` appears in exactly two PRs across the
whole epic:

```
3.1  f339616   created, fallback-only body, 102 lines      DEV-A
3.3  273cabb   the real classifier                         DEV-B
3.3  dc17a59   the same file, rewritten for Gemini         DEV-B
```

3.4 (`1d9d497`, DEV-A) does not open it. Its diff is `question.intake.service.js`, the
intake controller, the intake schema and a test file — DEV-A calls `classifyQuestion` and
persists what comes back, exactly as the README promised. **Nobody stubbed the classifier
twice.** There is one stub, in the file that later held the real thing.

No `prisma` import ever entered that file.

**One question the brief asked cannot be answered from this repository.** "Did 3.4's diff
really not change when 3.3 landed?" — 3.3 merged **first** (`331edd0`, before 3.4's
`a90b5cc`), so 3.4 was built and merged against the real classifier and never had to
survive it landing underneath. The arrangement was not tested here.

It was tested in E4, deliberately, and it worked: 4.5 merged (`965c351`) against 4.1's
deterministic stub, 4.6 landed the real scorer afterwards (`ec03715`), and 4.5's diff did
not reopen. Record it as E4's answer, not E3's.

## Did freezing the router and repository work a third time?

**Yes, unqualified.** Both files appear in the diff of one commit and no other:

```bash
git log --oneline -- server/src/routes/question.routes.js \
                     server/src/repositories/question.repository.js
f339616  feat(questions): freeze the question router, repository and classification seam (PR 3.1)
```

Seven PRs, two developers, one table, and neither file was opened again. This is
three-for-three with E1's `auth.routes.js` and E2's `teacher.routes.js` +
`teacher.repository.js`. E1's `user.repository.js` splice has not recurred in any form
across three epics.

**Stop re-litigating it.** E4 repeated the move a fourth time and E5 should repeat it
without discussion.

3.1 also froze two things the earlier epics did not, and both earned it:

- **`questionView.js`.** `toQuestionResponse` is what 3.4 (DEV-A) and 3.5 (DEV-B) both
  answer with. Moving it into the blocking PR meant "these two payloads are identical" did
  not depend on a file one track wrote mid-epic. Neither track edited it.
- **`upload.js` as a pass-through.** 3.1 wrote the interface, 3.2 replaced the body with
  Multer, and `upload.single(...)` on the frozen route never moved.

## Did the shared-file table's new rows earn their place?

**Yes, and the `package.json` row earned it twice over.** E2's retro added it because E2's
table stopped at the language boundary. E3 planned one dependency change and took two:

```
3.2  8f15d9d   server/package.json +1        cloudinary
—    1da17b5   root                          bump @anthropic-ai/sdk to ^0.117.1
3.3  dc17a59   server/package.json ±2        @anthropic-ai/sdk out, @google/genai in
```

The middle line is the interesting one: a dependency bump landed for structured outputs and
was thrown away by the vendor switch a few commits later. Both `package-lock.json` changes
merged sequentially with no conflict — which is the row working, not luck, because the rule
("announce in chat, land it alone, the other developer rebases") was followed both times.

`prisma/schema/*.prisma` earned its row differently — see below.

## The migration count E3 got wrong, and got right

The epic was planned as needing no migrations. 3.1 found three:

```
20260816072333_question_attachment_uploader
20260816072455_question_declared_level
20260816072639_question_student_confirmation
```

`questions.declared_level`, `questions.student_confirmation` and
`question_attachments.uploaded_by` were all in the contract freeze and none of them had a
column. All three are additive and nullable.

**The outcome is a success, not a miss.** They were found while writing the blocking PR,
landed inside it, one at a time, three minutes apart by their own timestamps, and no later
PR in the epic opened `prisma/`. A schema gap discovered in 3.1 costs an hour; the same gap
discovered in 3.5 costs a migration racing two open branches, which is the failure
`OWNERSHIP.md` §2's "never two in flight" exists to prevent.

E4 was planned the same way and its README says so in as many words — "no migration is
planned for this epic, **and this time that claim has been checked**". That sentence exists
because of this epic.

## The vendor switch, and the one line a repo could not catch by itself

3.3 shipped twice. `273cabb` classified with Anthropic; `dc17a59`, marked
`feat(questions)!:`, replaced it with Gemini — `config/anthropic.js` deleted,
`config/gemini.js` added, the prompt rewritten, 65 lines of tests changed, `.env.example`
and `config/env.js`'s `requiredInProduction` renamed from `ANTHROPIC_API_KEY` to
`GEMINI_API_KEY`.

The rename missed `render.yaml`. DEV-A caught it in a separate branch:

```
e1e8f61  fix(deploy): rename the Render env var to GEMINI_API_KEY
577759f  Merge dev-a/E3-render-gemini-key: the Render key rename 3.3 missed
```

This is E1's finding in a third form, and it is worth being precise about which form.
E1's three failures lived **only** in dashboards and nothing in the repo could have caught
them. This one lived half in the repo — `render.yaml` declares the variable, so the miss
was reviewable — and half outside it, because the variable is `sync: false` and the value
is dashboard-set. `env.js`'s `requiredInProduction` turns the dashboard half into a boot
failure rather than a runtime one, which is the right trade and the reason
`docs/DEPLOYMENT.md` now carries the sentence "an existing deployment must set the new name
or it will not boot".

**The repo half was caught by a person reading a diff, not by a test.** A cross-track fix
to another developer's PR, landed as its own branch, is the process working — but nothing
would have failed if nobody had looked.

## Did the capture/classification cut hold?

**Yes, at the file level, with no unplanned crossing.** No source file appears in both a
`dev-a/*` and a `dev-b/*` branch across the epic.

The two tracks met exactly where the README said they would:

- **`routes.student.jsx`** — one line each, 3.6 (DEV-A, `1a675e5`) and 3.7 (DEV-B,
  `20f0e79`), replacing a `Placeholder` and never reordering. The same edit shape E2's
  retro identified as worth more than a prohibition. Clean both times.
- **`components/question/`** — DEV-A wrote `ImagePicker.jsx` and `QuestionTextField.jsx`,
  DEV-B wrote `ClassificationCard.jsx` and `TopicOverride.jsx`. Same directory, disjoint
  files, no collision. Third epic this arrangement has worked in.
- **`question.classify.{controller,schema}.js`** — created by DEV-A in 3.1 as frozen stubs,
  filled by DEV-B in 3.5. Suffixed by track exactly as the table specified, so a file DEV-A
  wrote first was never a file DEV-A came back to.

3.7 also extended `TopicPicker.jsx`, which is DEV-B's own component from 2.4. Same owner,
no crossing.

One PR shipped twice: 3.6 merged at `6d34059`, then a follow-up at `e34d03f` surfaced a
rejected submit's field details on `/app/ask`. DEV-A's own file, DEV-A's own fix.

## What is not verified

**All of it.** PR 3.8's checklist has 32 items across five sections and none was run. The
epic's load-bearing behaviour is among them:

> **The fallback path (§8.1)** — `GEMINI_API_KEY` unset → `POST /questions` still answers
> `201`, `classification_ok = false`, `teacher_brief` is the student's raw text.

That is `MVP.md` §8.1's central promise, implemented across three files owned by two
people, and 3.8's own notes say it is "only observable by breaking the key on purpose and
watching a student get a teacher anyway". Nobody has watched.

It is not unevidenced — `server/tests/classification.test.js` covers it, and it was
rewritten for Gemini in `dc17a59`. But a passing unit test on a mocked client is not the
same claim as the deployed pair answering `201` with the key removed, and E2's retro is the
argument for why: all three defects E2 found were contracts two subsystems disagreed about,
and every one of them passed its own tests.

Two facts are known from outside the checklist and both are good news:

- The fallback path fired **for real, twice**, during E3's development — the Gemini
  free-tier quota ran out. E4's README treats `topic_id = 0` as a legal, expected input
  because of it, not as a theoretical branch.
- The deployed pair is live and seeded. Measured 2026-08-17: `/health` →
  `{"success":true,"data":{"status":"ok","db":"ok","uptime":8}}` in **33.5s cold**,
  `/api/v1/teachers` returns real rows, `VITE_API_URL` is correctly baked as
  `https://tutor-now-api.onrender.com/api/v1`, and CORS allows the Vercel origin with
  credentials while rejecting a bogus one. E1's three deploy failures are all absent.

**The plan for running it:** 3.8's checklist runs as its own pass before E5 opens, against
a local database per the epic's own prerequisite, by whichever developer is not closing E5.
It is one sitting. It has been deferred once and the deferral is what produced this file.

## The prediction E3 made and got wrong

PR 3.8's brief states:

> **E4 must not start until F1 and F3 are merged** — the matching engine ranks on the
> columns they fix.

E4 checked that claim against the code and rejected it, in a table with a reason per row:
E4's topic filter treats a parent row in `teacher_topics` as inert, so F1 changes no result;
and E4 does not filter on `onboardingComplete` at all, because §9.1's filter list is closed
and does not contain it.

**E4 then ran to 4.7 with neither merged, and neither blocked anything.** The rejection was
correct.

The lesson is not that the brief was careless — it is that a gate asserted in prose is worth
less than a gate checked against the code, and that treating F1 and F3 as gates would have
idled DEV-B's entire E4 track behind DEV-B's own filler. E4's README makes exactly that
argument. It is the right one.

## Carried into E4 — and, unfinished, into E5

**The four E2 debts, all still open at 2026-08-17:**

| # | Item | Owner | State |
|---|---|---|---|
| F1 | Leaf topics — the seed stops writing parent rows | DEV-B | **Open.** `prisma/seed/teachers.js:317` still adds each subtopic's parent |
| F2 | Publish `TEACHING_LEVELS` / `BIO_MAX_LENGTH` through `/public` | DEV-A | **Open.** Still four copies |
| F3 | Nullable `onboarded_at` | DEV-B | **Open.** No such column in `prisma/schema/` |
| F4 | `TeacherStatusToggle` refreshes on status change | DEV-B | **Open.** Still keyed on `location.pathname` |

Four debts entered E3 from E2 and four left it. E3 added a fifth (F5, seeded demo
questions, planned in E4). None is a gate; all five are real; the pattern is that filler
that is genuinely optional does not get done, three epics running.

**For E5:** either the filler list is scheduled into the epic like a PR with a number and a
position in the order table, or it should stop being written down as if it will happen.

**Carried as process:**

1. The closing PR opens the day the last feature PR merges. E3 is the counterexample.
2. Freeze the domain router and repository in one blocking PR. **Three-for-three**, and
   four-for-four after E4.
3. Freeze anything two payloads must agree on — `questionView.js` is the model.
4. A schema gap found in the blocking PR is cheap; the same gap found mid-epic races two
   branches. Check the "no migrations needed" claim before asserting it.
5. A gate asserted in a brief must be checked against the code before it idles a track.
6. A dependency change is announced, lands alone, and the other developer rebases. Worked
   twice in one epic, including a vendor swap.
