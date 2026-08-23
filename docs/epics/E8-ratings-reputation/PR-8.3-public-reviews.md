# PR 8.3 — Reviews on the public profile: `GET /teachers/:id/reviews` and the section that renders it

| | |
|---|---|
| **Epic** | E8 — Ratings & Reputation |
| **Owner** | DEV-A (eliya) |
| **Size** | L |
| **Written by** | Agent |
| **Depends on** | E6 (6.6 merged — the `reviews` table has rows). Independent of 8.1 and 8.2 |
| **Blocks** | nothing |
| **Branch** | `dev-a/E8.3-public-reviews` |

## Contract implemented

`GET /api/v1/teachers/:id/reviews?page&pageSize` → `TeacherReviewsResponse`. Public,
unauthenticated.

**This PR opens E8's block in `shared/api.d.ts`**, whole — including `SessionHistoryRecord`,
`SessionHistoryResponse`, `TopicStatRecord` and `TeacherStatsResponse`, which 8.4 and 8.5
implement. The epic README says why: type declarations compile to nothing, and one
appended region per epic is one conflict region instead of four.

`MVP.md` §12 "Public / Guest", §6.3, §14.1's `/teachers/:id`, §18's row 8.5.

## Scope

**`reviews` has had rows since 6.6 and nothing reads them.** `GET /teachers/:id` answers a
`TeacherCard` — badge, rating average, rating count, topics, price — which is every
*number* a review produces and none of the words. This PR adds the words.

**Its own endpoint, not a field on `TeacherCard`.** Two reasons and both are structural:
`TeacherCard` is frozen in E2's README and rendered by the guest list, the guest profile
and (through `TeacherMeResponse`) the teacher's own screen, none of which wants a review
array; and reviews are paged while a card is not. `GET /teachers/:id` is untouched by this
PR.

**The route is on `teacher.routes.js`, under the public read block, declared after
`/:id`.** That file already has the `/me`-before-`/:id` ordering note and this route is
`/:id/reviews`, two segments, so it cannot be shadowed by the one-segment `/:id`. It is
**not** on `/public`: E2 already ruled that a teacher's data is not `/public` because
`/public` is taxonomy and money cached for `PUBLIC_CACHE_SECONDS`, and a teacher's review
list would be served stale.

**No student appears on the wire, and that is a decision rather than an omission.** The
`reviews` row carries `student_id`; the response does not, in any form — not a name, not
an initial, not an id. Three arguments, in order of weight:

1. **The endpoint is unauthenticated.** A public URL that maps a person to the maths they
   could not do is a privacy leak with a very ordinary shape: the reviews of two teachers
   intersected identify a student's whole term.
2. **§6.3.** The platform states only facts it can stand behind, and "Dana K. said this"
   is a claim about Dana that the page has no reason to make. The page is about the
   teacher.
3. It is one fewer field to remove later. Adding an author to a review is a product
   decision somebody can make; removing one from a URL that has been public is not.

The row carries `stars`, `isResolved`, `comment`, the question's topic label and
`created_at`. That is enough for a reader to weigh it and not enough to identify anybody.

**`stars` is nullable on the wire and the screen must render that case.** `isResolved` is
the only required field on a review (§6.2) and `RateSession.jsx` sends stars only when the
student picked some, so **a review with no stars is the common case, not the edge**. A
star row that renders `null` as zero stars is the client-side version of the defect
`session.review.service.js` is careful about, and it is the most likely bug in this PR.

**The topic label is a join, not a column.** `reviews.session_id → sessions.question_id →
questions.subtopic_id → topics.name_he/name_en`, falling back to `topic_id` and then to
null on the sentinel path. There is no `reviews.topic_id` and this PR does not add one —
see the denylist.

**The screen.** `client/src/pages/guest/TeacherProfile.jsx` gains a reviews section below
the existing card: the count and average it already has as a heading, then the list, then
"load more" or a pager consistent with `Teachers.jsx`. Empty is a first-class state
(`EmptyState`, per `CONVENTIONS.md` → Client) and it is what every seeded teacher shows,
because the seed writes aggregates and no `reviews` rows — see Notes.

## Files you may touch

```
shared/api.d.ts                                   APPEND: the whole `// ── E8 ──` block at EOF
server/src/repositories/review.repository.js      findReviewPage — its own prisma client, no tx
server/src/services/teacher.public.service.js     listTeacherReviews: not found is NOT_FOUND, not []
server/src/controllers/teacher.public.controller.js  one handler, no prisma
server/src/validators/teacher.public.schema.js    page/pageSize, same bounds as teacherListSchema
server/src/routes/teacher.routes.js               one route under the public block
server/src/utils/teacherView.js                   toTeacherReview — the serializer, and the student is not in it
server/tests/teacher.reviews.test.js              NEW. Serializer, paging, the null-stars row, the sentinel label
client/src/api/teacher.public.api.js              getTeacherReviews
client/src/pages/guest/TeacherProfile.jsx         the section
client/src/components/teacher/ReviewList.jsx      NEW. List + one row. Renders null stars as no stars
docs/epics/E8-ratings-reputation/README.md        tick the status box
```

## Files you must NOT touch

```
server/src/repositories/teacher.repository.js   TeacherCard's reads. This PR does not grow the card
server/src/utils/standing.js                    the badge is computed from counters 6.6 already writes
server/src/services/teacher.me.service.js       the teacher's own record is 8.5's, and it is a different shape
server/src/services/session.review.service.js   8.1's. This PR reads reviews, it does not write them
server/src/services/matching.*.js               a review on a profile changes no ranking
prisma/schema/**                                there is no reviews.topic_id and this PR does not add one
server/src/routes/index.js                      /teachers is already mounted
client/src/components/teacher/TeacherCard.jsx   the list cell, and it stays a summary
docs/epics/E6a-*/**  docs/epics/E6b-*/**        other epics' chains
```

## Acceptance criteria

- [ ] `GET /api/v1/teachers/<id>/reviews` with **no token** returns `200` and `{ reviews, total }`
- [ ] The response contains **no** `studentId`, `studentName`, `student` or any field derived from one — `grep -i student` over the response body is empty
- [ ] A review written with no stars comes back as `stars: null`, and the screen renders it as a review with a comment and **no star row** — not as zero stars
- [ ] A review on an unclassified question comes back with `topicName: null` and the row renders without a topic chip
- [ ] `?page=2&pageSize=5` pages correctly, newest first, and `total` is the whole set rather than the page
- [ ] `pageSize=1000` is rejected by the validator with `400 VALIDATION_ERROR` — the same bound `teacherListSchema` uses
- [ ] A **student's** user id returns `404 NOT_FOUND` in the standard shape, never a 500 and never an empty list
- [ ] A non-existent uuid returns `404 NOT_FOUND`; a non-uuid returns `400 VALIDATION_ERROR`
- [ ] A seeded teacher with no `reviews` rows shows the empty state, and the rating average above it still reads from the aggregates — the two do not have to agree, and the screen does not claim they do
- [ ] `npm test` passes
- [ ] The E8 block in `shared/api.d.ts` is appended at EOF, after E7's block, and nothing above it changed — `git diff shared/api.d.ts` shows additions only

## Manual test

1. `npm run db:up && npm run db:seed && npm run dev`.
2. Run one session to a rating, with a comment and 4 stars.
3. Log out entirely. Open `/teachers/<that teacher's id>` as a stranger. The review is
   there, with the topic and the date, and **no name**.
4. Rate a second session with **no stars** and a comment. Reload: the second row shows
   the comment and no stars, and does not show ☆☆☆☆☆.
5. `/teachers/<a seeded teacher with no reviews>` — the empty state, and the ⭐ average
   above it still shows the seeded number.
6. Open the profile of a **student's** id — `404`, rendered as `NotFound`, not a crash.
7. 375px: the review rows wrap, `document.body.scrollWidth === document.body.clientWidth`.

## Review checklist additions

- **Grep the serializer for `student`.** `toTeacherReview` must not have the field at all
  — not commented out, not `undefined`. A serializer that mentions it is one refactor from
  emitting it, and this URL is public.
- **The list must page.** An unbounded read of every review a popular teacher ever
  received is both a slow screen and a denial-of-service shape on an unauthenticated
  endpoint. The default `pageSize` is `teacherListSchema`'s, not a larger one because
  "reviews are small".
- `comment` is unmoderated student text rendered on a public page. It must be rendered as
  **text**, never as HTML or markdown — React escapes by default and nothing in this PR
  may reach for `dangerouslySetInnerHTML`.
- No `prisma` import in the controller or the service — `CONVENTIONS.md` layering. The
  repository owns the client.
- The `shared/api.d.ts` append is at EOF and inside one marked block. E7's block above it
  is not edited, reordered or reformatted.

## Notes

**The seed writes aggregates and no `reviews` rows, so every seeded teacher's profile is
empty and their star average is not.** That is correct and it looks broken. `teachers.js`
derives `rating_sum` and `rating_count` from its `stats` fixtures precisely so E4's
ranking is verifiable without a review table — and E4's retro already records `reviews`
being empty as the reason `studiedWith` is false for every real pair. The screen must not
paper over it: the average is what the platform computed from its history, the list is
what students wrote, and on seeded data there is history and no writing. A demo shows real
reviews only for sessions actually run.

**Why `total` is the whole set rather than the page.** It is the number beside the stars
in the heading, and a heading that changes when you page is a heading nobody trusts. Same
call `TeacherListResponse` made in 2.3 and `WalletTransactionsResponse` made in 7.2.

**Moderation is E9 and this PR should not invent half of it.** §18's E9 has the admin
surface; nothing in E8 filters, flags or hides a comment. The mitigations that belong
*here* are the two above — paging, and rendering as text — and the honest statement of the
rest is in the epic README's risks. A half-built profanity filter in a serializer is worse
than none, because it makes the next person believe the problem was handled.

**§12 calls this `GET /public/teachers/:id` and it is not there.** E2's 2.3 put the public
teacher reads on `/teachers` and wrote down why: `/public` is cached taxonomy and pricing,
and a teacher's data goes stale within a minute. This PR follows the router that exists
rather than the table in §12, and the epic README records it as a deviation.
