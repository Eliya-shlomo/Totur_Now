# PR 2.1 — Teacher core: frozen router, repository, serializer

| | |
|---|---|
| **Epic** | E2 — Teacher Onboarding |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | **Human — no agent** |
| **Depends on** | E1 merged |
| **Blocks** | 2.2, 2.3, 2.4, 2.5, 2.6 |
| **Branch** | `dev-b/E2.1-teacher-core` |

## Contract implemented

The `E2` block of `shared/api.d.ts` (copied verbatim from the epic README's contract
freeze), plus the skeleton every later PR fills in. No endpoint returns real data at the
end of this PR.

## Scope

The blocking PR, and the direct application of the E1 retro. Three files are created here
and then never edited again by anyone in this epic.

**The router.** `teacher.routes.js` with all four routes fully wired — middleware,
validator, controller — pointing at stub controllers that throw `NOT_IMPLEMENTED`. Mounted
in `routes/index.js` with one appended line. After this PR nobody opens either file.

**The repository.** Every query both audiences need, written once: fetch one teacher with
their user, topics and counters; fetch a filtered page of online teachers with the same
includes; replace a teacher's topic set transactionally. The list query uses a Prisma
`include` for topics — not a per-teacher fetch — because it is the only N+1 in the epic and
the frozen file is where it gets prevented rather than reviewed.

**The serializer.** `toTeacherCard(teacher)` and `toTeacherMe(teacher)` in
`server/src/utils/teacherView.js`. Both call the existing `standingOf` from
`utils/standing.js` — do not reimplement it, do not add a badge column. `toTeacherCard`
omits email, `status`, and every counter except the rating pair; it exposes `isOnline` as a
boolean derived from `status === 'ONLINE'`. `onboardingComplete` is computed here and only
here: true when the teacher has at least one topic **and** has saved `levelMax` and
`pricePerBlock` at least once.

The `rating` field is `ratingCount > 0 ? ratingSum / ratingCount : null` — `null`, not `0`.
An unrated teacher has not scored zero.

## Files you may touch

```
server/src/routes/teacher.routes.js               new — frozen after this PR
server/src/repositories/teacher.repository.js     new — frozen after this PR
server/src/utils/teacherView.js                   new
server/src/controllers/teacher.me.controller.js   new — stubs only
server/src/controllers/teacher.public.controller.js  new — stubs only
server/src/validators/teacher.me.schema.js        new — stubs only
server/src/validators/teacher.public.schema.js    new — stubs only
server/src/routes/index.js                        one appended line, alphabetical
shared/api.d.ts                                   one appended `// ── E2` block
docs/epics/E2-teacher-onboarding/README.md        tick the status box
```

## Files you must NOT touch

```
server/src/app.js                          frozen since 0.4
server/src/routes/auth.routes.js           frozen since 1.1
server/src/routes/public.routes.js         DEV-A's, and E1's
server/src/config/constants/teacher.js     already complete — read it, do not edit it
server/src/utils/standing.js               already correct — call it, do not touch it
prisma/schema/                             no schema change in this epic
```

## Acceptance criteria

- [ ] `GET /api/v1/teachers`, `GET /api/v1/teachers/:id`, `GET /api/v1/teachers/me` and `PATCH /api/v1/teachers/me` all resolve and return `NOT_IMPLEMENTED` in the standard error shape
- [ ] `GET /teachers/me` without a token returns `UNAUTHORIZED`; with a student's token returns `FORBIDDEN`
- [ ] `GET /teachers` and `GET /teachers/:id` work with no token at all
- [ ] `toTeacherCard` output contains no `email`, no `status`, no `offersReceived`, no `noShowCount`
- [ ] `toTeacherCard` of a teacher with `ratingCount: 0` has `rating: null`
- [ ] `toTeacherCard` of the seeded teachers produces the badge `standingOf` returns for the same row
- [ ] The list query issues a fixed number of SQL statements regardless of how many teachers come back — check the Prisma query log, not the code
- [ ] `npm run lint` clean, server boots, `/health` still `db: ok`

## Manual test

1. `npm run dev` and `curl localhost:3000/api/v1/teachers` → `NOT_IMPLEMENTED`, not a 404
2. Log in as `dana.k@demo.tutornow.il` (password in `docs/DEPLOYMENT.md`), call `/teachers/me` with the token → `NOT_IMPLEMENTED`
3. Same call with `avi.student@demo.tutornow.il`'s token → `FORBIDDEN`
4. Set `DEBUG=prisma:query` and confirm the list repository function logs a constant number of queries against the 15 seeded teachers

## Review checklist additions

- The router header comment must say it is frozen and why, in the style of `auth.routes.js`. A future reader has to learn the rule from the file, not from this brief.
- The repository must be reviewed as if it were finished, because it is. A missing query here becomes an unfrozen file later.

## Notes

This PR exists because of `3e05e3c` — see [RETRO.md](../E1-auth/RETRO.md). In E1 the
router was frozen and never conflicted; the repository was not frozen, was edited by two
parallel PRs, and the merge produced a file that would not parse. `main` did not boot.

The fix is not more care. It is that both files are finished before either track starts.

Written by a human, not an agent, for the same reason 1.1 was: everything downstream
codes against these shapes, and a shape that is wrong here is wrong in six PRs.
