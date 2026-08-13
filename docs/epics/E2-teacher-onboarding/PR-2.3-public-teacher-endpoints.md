# PR 2.3 — Standing badge + public teacher endpoints

| | |
|---|---|
| **Epic** | E2 — Teacher Onboarding |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 2.1 (merged) |
| **Blocks** | 2.5 |
| **Branch** | `dev-a/E2.3-public-teacher-endpoints` |

## Contract implemented

`TeacherCard` and `TeacherListResponse` from the epic's contract freeze.
`MVP.md` §6.2 (standing), §5.2 (price bands).

## Scope

The read path a student sees, with no authentication anywhere.

**`GET /teachers`** — a filtered, paged list. Query parameters, all optional:

| Param | Meaning |
|---|---|
| `topicId` | leaf topic; a teacher matches if they teach it |
| `level` | `levelMax >= level` |
| `band` | `A` \| `B` \| `C` — resolved to a price range through `priceBandRanges` in `utils/pricing.js` |
| `onlineOnly` | boolean, default `false` |
| `page`, `pageSize` | `pageSize` capped server-side; a client asking for 1000 gets the cap, not an error |

Every filter composes with every other. Unknown parameters are a `VALIDATION_ERROR` — the
same `noQuerySchema` posture `public.validator.js` already takes, because a silently
ignored typo in a filter is a bug that looks like an empty result.

Default ordering: badge rank descending, then rating descending, then `sessionsCount`
descending. Unrated teachers sort below rated ones rather than above — a `null` rating must
not read as a perfect score. This is presentation ordering only; the real ranking is the
matching engine's job in E4 and nothing here should try to anticipate it.

**`GET /teachers/:id`** — one `TeacherCard`, or `NOT_FOUND`. A user id that exists but has
no teacher profile is a `NOT_FOUND`, not a 500.

**Standing.** `utils/standing.js` already computes the badge and 2.1's serializer already
calls it. This PR does not reimplement it — it adds the unit tests it never got. The badge
is the platform making a public claim about a person, so it should be provably right:
cover each of the four bands, the `TOP` boundary that needs volume **and** rating (100
sessions at 4.49 is `EXPERIENCED`, not `TOP`), and the unrated case.

## Files you may touch

```
server/src/controllers/teacher.public.controller.js
server/src/services/teacher.public.service.js     new
server/src/validators/teacher.public.schema.js
server/tests/standing.test.js                     new
docs/epics/E2-teacher-onboarding/README.md        tick the status box
```

## Files you must NOT touch

```
server/src/routes/teacher.routes.js               frozen by 2.1
server/src/repositories/teacher.repository.js     frozen by 2.1 — if a query is missing, say so in chat
server/src/utils/standing.js                      already correct — test it, do not edit it
server/src/utils/teacherView.js                   2.1's
server/src/controllers/teacher.me.controller.js   DEV-B's, 2.2
server/src/services/teacher.me.service.js         DEV-B's, 2.2
server/src/routes/public.routes.js                E1's, and these routes are not under /public
shared/api.d.ts                                   the E2 block is closed
```

## Acceptance criteria

- [ ] `GET /teachers` with no token returns the seeded teachers
- [ ] No response contains an email, a `status`, `offersReceived`, or `noShowCount`
- [ ] `?topicId=` a leaf id narrows the list correctly
- [ ] `?band=A` returns only teachers priced 5–9, per `priceBandRanges` — no literal `5` or `9` in the diff
- [ ] `?level=5` excludes teachers whose `levelMax` is 3
- [ ] `?onlineOnly=true` returns only `status === 'ONLINE'` teachers, and still never exposes the enum
- [ ] Two filters together narrow, not widen
- [ ] `?pageSize=1000` returns the cap, with `total` reflecting the unpaged count
- [ ] `?nonsense=1` returns `VALIDATION_ERROR`
- [ ] `GET /teachers/:id` on a student's user id returns `NOT_FOUND`
- [ ] An unrated teacher has `rating: null` and sorts below rated teachers
- [ ] `standing.test.js` covers all four bands, the `TOP` boundary, and the unrated case

## Manual test

1. `curl 'https://tutor-now-api.onrender.com/api/v1/teachers'` with no auth header
2. Add `?band=B&level=4` and check the returned prices and levels by eye
3. `?topicId=2` (`quadratic-equations` in the seed) → only teachers carrying it
4. Pick any id from the list, `GET /teachers/:id`, compare with the list entry
5. `GET /teachers/<a student's id>` → `NOT_FOUND`

## Review checklist additions

- Grep the diff for `4.5`, `100`, `25`, `5`, `9`, `14`, `20`. Every one of those lives in `constants/` and none should appear here.
- Confirm the list issues a constant number of queries. 2.1 wrote it that way; a service that maps over the result and fetches topics per teacher undoes it.

## Notes

You own `routes.guest.jsx` from 1.6, so the screens in 2.5 sit naturally on top of these
endpoints. Build the endpoints to the contract, not to the screen you are picturing — 2.5
is a separate PR precisely so the payload is not shaped by one page's layout.

These routes are **not** under `/public`. `/public` is taxonomy and money — data that
changes only on a deploy and is cached accordingly (`constants/public.js`). A teacher list
changes every time someone goes online, and putting it behind the same cache headers would
serve a stale list for the rest of the day.
