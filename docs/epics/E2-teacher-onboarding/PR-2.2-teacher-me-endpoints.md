# PR 2.2 — `GET` / `PATCH /teachers/me`

| | |
|---|---|
| **Epic** | E2 — Teacher Onboarding |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 2.1 (merged) |
| **Blocks** | 2.4, 2.6 |
| **Branch** | `dev-b/E2.2-teacher-me-endpoints` |

## Contract implemented

`TeacherMeResponse` and `TeacherUpdateRequest` from the epic's contract freeze.
`MVP.md` §5.2 (price), §6.1 (level), §11.2 (the table).

## Scope

The teacher's write path. Fill in `teacher.me.controller.js`, `teacher.me.service.js` and
`teacher.me.schema.js` against the repository 2.1 froze.

**`GET /teachers/me`** returns `toTeacherMe` of the authenticated teacher. It is the
stepper's source of truth for which steps are already done, so it must be correct on a
brand-new teacher whose profile row was created by registration with defaults and nothing
else.

**`PATCH /teachers/me`** takes a partial. Every field is optional — the stepper saves one
step at a time and the edit screen saves whatever changed. An empty body is a
`VALIDATION_ERROR`, not a no-op success; it always means a client bug.

Validation, all from constants and never hardcoded:

- `pricePerBlock` — integer, within `PRICE.min`–`PRICE.max` from `constants/money.js`
- `levelMax` — one of `TEACHING_LEVELS` from `constants/teacher.js`
- `topicIds` — non-empty array of **leaf** topic ids that exist. A parent topic is a
  `VALIDATION_ERROR`: a teacher who declares "Algebra" and nothing under it cannot be
  ranked by the matching engine, which scores on the subtopic.
- `bio` — trimmed, max 500, and `null` clears it
- `status` — `OFFLINE` or `ONLINE` only. `OFFER_LOCKED` and `IN_SESSION` are set by the
  matching engine in E4 and a teacher must not be able to set either by hand.

`topicIds` **replaces** the whole set inside one transaction — delete then insert, not
merge — because a merge makes removing a topic impossible through this endpoint.

No ownership parameter anywhere. The teacher being edited is always `req.user.id`. There
is no `PATCH /teachers/:id`, and adding one is out of scope for this epic.

## Files you may touch

```
server/src/controllers/teacher.me.controller.js
server/src/services/teacher.me.service.js         new
server/src/validators/teacher.me.schema.js
docs/epics/E2-teacher-onboarding/README.md        tick the status box
```

## Files you must NOT touch

```
server/src/routes/teacher.routes.js               frozen by 2.1
server/src/repositories/teacher.repository.js     frozen by 2.1 — if a query is missing, say so in chat
server/src/utils/teacherView.js                   2.1's
server/src/controllers/teacher.public.controller.js   DEV-A's, 2.3
server/src/services/teacher.public.service.js         DEV-A's, 2.3
shared/api.d.ts                                   the E2 block is closed
```

## Acceptance criteria

- [ ] `GET /teachers/me` as a freshly registered teacher returns defaults and `onboardingComplete: false`
- [ ] `PATCH` with `{ "pricePerBlock": 12 }` alone succeeds and changes nothing else
- [ ] `PATCH` with `{ "pricePerBlock": 4 }` and with `21` both return `VALIDATION_ERROR` naming the field
- [ ] `PATCH` with `{ "levelMax": 6 }` returns `VALIDATION_ERROR`
- [ ] `PATCH` with a parent topic id returns `VALIDATION_ERROR`
- [ ] `PATCH` with `topicIds: [a, b]` then `topicIds: [a]` leaves exactly one row in `teacher_topics`
- [ ] `PATCH` with `{ "status": "IN_SESSION" }` returns `VALIDATION_ERROR`
- [ ] `PATCH {}` returns `VALIDATION_ERROR`
- [ ] After topics + level + price are all set, `onboardingComplete` is `true`
- [ ] A student's token on either route returns `FORBIDDEN`
- [ ] No response body contains a password hash, a token, or another user's data

## Manual test

1. Register a new teacher through the deployed client
2. `GET /teachers/me` → defaults, `onboardingComplete: false`, `topics: []`
3. `PATCH` each of the three steps in turn, re-`GET` after each
4. After the third, `onboardingComplete` flips to `true`
5. `PATCH topicIds` with a shorter list → the removed topic is gone, not merged

## Review checklist additions

- No number from `money.js` or `teacher.js` is repeated as a literal in this PR. Grep the diff for `5`, `20`, `3`, `4`, `5` used as bounds.
- The topic replacement is inside `prisma.$transaction`. A delete that succeeds and an insert that fails leaves a teacher with no topics and no way to notice.

## Notes

`onboardingComplete` is computed in 2.1's serializer, not here, and not in the stepper.
Three definitions of "done" is three answers to the same question.

The `status` restriction looks like paranoia today because the matching engine does not
exist. It stops being paranoia in E4, when `OFFER_LOCKED` becomes the flag that prevents a
teacher receiving two offers at once — and a teacher who can set it by hand can make
themselves permanently unmatchable, or permanently first in line.
