# PR 2.5 — Public teacher list + profile screens

| | |
|---|---|
| **Epic** | E2 — Teacher Onboarding |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 2.3 (merged) |
| **Blocks** | 2.6 |
| **Branch** | `dev-a/E2.5-public-teacher-screens` |

## Contract implemented

`/teachers` and `/teachers/:id`, the two `Placeholder`s left in `routes.guest.jsx` since
1.6. `MVP.md` §14.1.

## Scope

The guest-facing half of the epic, on top of the endpoints you built in 2.3. No
authentication — a stranger who has never registered can browse the whole thing, which is
the point: this is the surface that convinces someone to sign up.

**The list.** A responsive grid of teacher cards with the filters from 2.3 — topic, level,
price band, online only. Filters live in the URL query string, not in component state, so a
filtered list is a link someone can send. Reading a filtered URL directly must reproduce
the same view.

Three states, using the primitives from 0.6 and not hand-rolled: `LoadingState` on first
fetch, `EmptyState` when filters match nothing (with a way to clear them — a dead end that
only offers the back button is the most common filter-UI failure), `ErrorState` with retry
on rejection.

**The card.** Name, badge, price per block, level, topic chips, an online dot. Extract it
as `TeacherCard.jsx` — 2.6 reuses it, and this is the shared-component decision the epic
README cites as the reason you own both screens.

The badge is a public claim about a person, so render all four values distinctly and label
them in Hebrew. Import the values from `TEACHER_BADGES`; do not retype the four strings.

**The profile.** One teacher: bio, topics, price with its band, level, badge, rating and
rating count. An unrated teacher shows "no ratings yet", not "0 ★" — `rating` is `null` and
zero is a different claim. A bad id renders the 404 page from 0.5, not a blank screen.

**Do not** add a "book this teacher" button. Booking is E3/E4 and does not exist. A dead
primary button on the most important screen is worse than none.

## Files you may touch

```
client/src/pages/guest/Teachers.jsx               new
client/src/pages/guest/TeacherProfile.jsx         new
client/src/components/teacher/TeacherCard.jsx     new
client/src/components/teacher/TeacherBadge.jsx    new
client/src/components/teacher/TeacherFilters.jsx  new
client/src/api/teacher.public.api.js              new
client/src/router/routes.guest.jsx                TWO lines — replace the two Placeholders
docs/epics/E2-teacher-onboarding/README.md        tick the status box
```

## Files you must NOT touch

```
client/src/router/index.jsx                       frozen since 0.5
client/src/router/routes.teacher.jsx              DEV-B edits it in 2.4
client/src/api/client.js                          single-owner — you own it, but it needs no change
client/src/api/teacher.api.js                     DEV-B's, 2.4
client/src/pages/teacher/                         DEV-B's, 2.4
client/src/components/state/                      0.6's primitives — use them, do not fork them
server/                                           nothing server-side in this PR
```

## Acceptance criteria

- [ ] `/teachers` renders logged out, in a private window
- [ ] Each filter narrows the list; combining two narrows further
- [ ] Filters appear in the URL, and pasting that URL into a new tab reproduces the view
- [ ] Filters matching nothing show `EmptyState` with a working "clear filters"
- [ ] The API failing shows `ErrorState` and retry succeeds once the API is back
- [ ] Clicking a card opens `/teachers/:id` with matching data
- [ ] An unrated teacher shows "no ratings yet" on both screens, never "0"
- [ ] All four badge values render distinctly; the strings come from `TEACHER_BADGES`
- [ ] `/teachers/<garbage>` renders the 404 page
- [ ] No email or `status` string is visible anywhere, including in devtools' network tab
- [ ] Usable at 375px: cards stack, filters collapse, nothing overflows horizontally

## Manual test

1. Private window, `https://totur-now-client-vnxx.vercel.app/teachers`, not logged in
2. Filter to band A + level 5, copy the URL, paste into another private tab → same view
3. Filter to something impossible → empty state, clear filters, list returns
4. Open a seeded teacher, then a teacher created during 2.4's test → the second shows `New` and no rating
5. `/teachers/abc` → 404 page
6. Repeat 1–4 at 375px

## Review checklist additions

- Confirm in the network tab that the payload itself carries no email and no `status`. If it does, that is a 2.3 bug and a follow-up PR there — not a client-side filter here.
- No duplicated badge or band strings. They come from `@tutor/shared` and `constants/`.

## Notes

You own `routes.guest.jsx`. Two lines change, both replacing a `Placeholder`. Do not touch
the ordering, and do not touch the `*` catch-all — it must stay last.

`TeacherCard.jsx` is deliberately built here and reused in 2.6 rather than being built
twice. That reuse is the reason the epic gives you the teacher's own profile edit screen
even though DEV-B owns the endpoint behind it.
