# PR 3.8 — E3 close: verification + retro

| | |
|---|---|
| **Epic** | E3 — Question Intake & LLM Classification |
| **Owner** | DEV-B (rotem) |
| **Size** | S |
| **Written by** | Agent for the write-up. **The pass itself is run by a human**, on two machines. |
| **Depends on** | 3.2–3.7 merged |
| **Blocks** | E4 |
| **Branch** | `dev-b/E3.8-e3-close` |

## Contract implemented

None. This PR verifies the epic end to end and writes `RETRO.md`.

## Scope

Run the checklist below **against a local database** (`npm run db:up`, root `.env` on port 5433) and
then the read-only half against the deployed Vercel + Render pair. E2's verification was blocked on
four items because three of them needed production writes and the local environment shared
production's database; that is fixed as of 3.1, so **every item here is runnable and none may be left
"not run" for that reason.**

The two-machine item still needs DEV-A. Schedule it rather than deferring it — E1's equivalent step
is what found the CORS and `VITE_API_URL` misconfigurations, and E2's went unrun.

### The checklist

**Flow**
- [ ] `/health` green before starting
- [ ] Student registers → logs in → `/app/ask` reachable, and a teacher's token is redirected away from it
- [ ] Text-only question → confirmation screen inside §4.1's 2–4 seconds
- [ ] Photographed exercise, no text → classifies correctly; the image genuinely reached the model
- [ ] Two photos on one question → both bound, both visible
- [ ] Reload on the confirmation screen → same content
- [ ] Override to another leaf → persists across a reload, both `topic_id` and `subtopic_id` moved
- [ ] Confirm → `/app/ask/:id/teachers` placeholder

**The fallback path (§8.1) — this is the epic's load-bearing behaviour**
- [ ] `ANTHROPIC_API_KEY` unset → `POST /questions` still answers `201`, the question row exists, `classification_ok = false`, `teacher_brief` is the student's raw text
- [ ] `LLM_TIMEOUT_MS = 1` → same
- [ ] Gibberish text → fallback, and the screen asks rather than tells
- [ ] In every fallback case the student can still choose a topic and continue

**Data**
- [ ] Every created question has a `sessions` row in `PENDING` with the right `student_id`
- [ ] `select count(*) from questions where topic_id is null` is `0`
- [ ] Every `subtopic_id` written by the epic is a leaf that exists in `topics`
- [ ] `question_attachments` has no orphan bound to a question that is not the uploader's

**Boundaries**
- [ ] Another student's question: `GET` and `PATCH` both `NOT_FOUND`
- [ ] Another student's attachment id in `attachmentIds` → `VALIDATION_ERROR`, no question created
- [ ] A parent topic id as `subtopicId` → `VALIDATION_ERROR`
- [ ] `estimatedLevel: 6`, `{}`, and an unknown key → `VALIDATION_ERROR`
- [ ] PDF, renamed `.txt`, 20 MB image → `VALIDATION_ERROR` each
- [ ] `POST /questions` in a loop → `RATE_LIMITED` in the standard error shape
- [ ] Wrong Cloudinary secret → `EXTERNAL_SERVICE_ERROR`, server stays up

**Performance and logs**
- [ ] `GET /questions/:id` issues a constant number of SQL statements regardless of attachment count
- [ ] `POST /questions` holds no database transaction across the LLM call — check the query log's timing, not just the code
- [ ] Server logs contain no API key, no student raw text at info level, no upload signature
- [ ] Both screens usable at 375px, `scrollWidth === clientWidth`

**Two machines (needs DEV-A)**
- [ ] Two students, two machines, questions created simultaneously → no cross-talk, each sees only their own
- [ ] The deployed pair does the same flow the local one did, with a real cold start timed and recorded

### `RETRO.md`

Same shape as E1's and E2's. Answer the three questions this epic inherits, with what the repository
and the deployed pair actually did:

1. **Did the seam hold?** Did any file appear in both a `dev-a/*` and a `dev-b/*` branch? Did 3.4's
   diff really not change when 3.3 landed? Did anyone stub the classifier twice?
2. **Did freezing the router and repository work a third time?** E2's answer was an unqualified yes.
   If it held again, say so plainly and stop re-litigating it in E4.
3. **Did the shared-file table's new rows earn their place?** `package.json`, the lockfile and
   `prisma/schema/` were added because E2's table stopped at the language boundary. Did the one
   planned dependency change (3.2's `multer`) land without a lockfile conflict?

Then the parts only running the thing can tell you: how often the fallback fired on real questions,
what the classification actually got wrong, the measured latency of `POST /questions` warm and cold,
and any contract two subsystems disagree about — the defect class E2 shipped three of.

Close by listing what carries into E4, including the state of the four E2 debts (F1–F4). **E4 must
not start until F1 and F3 are merged** — the matching engine ranks on the columns they fix.

## Files you may touch

```
docs/epics/E3-question-intake/RETRO.md              new
docs/epics/E3-question-intake/README.md             tick the boxes, correct anything the epic disagrees with
docs/DEPLOYMENT.md                                  only if the pass found something wrong with it
```

## Files you must NOT touch

```
server/**                                           a defect found here is its own small PR, by its owner
client/**                                           same
prisma/**                                           same
```

## Manual test

The checklist above **is** the manual test. Record the actual output — the error code, the row count,
the timing — not a tick. E2's retro is readable a month later because it quotes
`{"status":"ok","db":"ok","uptime":491}` and "7 for 1, 5 and 20 rows" instead of "verified".

## Review checklist additions

- Any item that cannot be run must say **why**, in the retro, in the same sentence as the plan for running it. An unexplained "not run" is how E2 closed provisionally.
- A defect found during the pass is filed and fixed by the file's owner in its own PR. This PR changes no source.

## Notes

**Why DEV-B closes this epic.** DEV-A closed E2. Alternating means the person writing the retro is not
always the person whose track dominated the epic, and DEV-B holds the half of E3 — the prompt and the
fallback — whose failures only show up when a human reads output rather than a status code.

**The fallback section is the one that matters.** Everything else in this epic has a test. "The flow
continues when the LLM fails" is a promise made in `MVP.md` §8.1, implemented across three files owned
by two people, and only observable by breaking the key on purpose and watching a student get a
teacher anyway.
