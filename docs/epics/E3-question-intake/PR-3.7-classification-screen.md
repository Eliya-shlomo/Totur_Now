# PR 3.7 — Classification confirmation screen

| | |
|---|---|
| **Epic** | E3 — Question Intake & LLM Classification |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 3.5, 3.6 (both merged) |
| **Blocks** | 3.8 |
| **Branch** | `dev-b/E3.7-classification-screen` |

## Contract implemented

`/app/ask/:id/matching` (`MVP.md` §14.1, §4.1). Consumes `GET /questions/:id` and
`PATCH /questions/:id/classification` (3.5). Renders `student_confirmation` and the override §8.1
calls for.

## Scope

The screen where the machine says what it thinks and the student is allowed to disagree.

**Two paths, one screen.** `classificationOk: true` shows the confidence-carrying version:
`studentConfirmation` as the headline, the topic and level it resolved to, and a "not quite — pick
the right one" control. `classificationOk: false` shows the honest version: we could not read this,
which topic is it? — the same control, promoted to the primary action rather than tucked under a
confirmation. **One screen, one component tree, a branch on one boolean.** Two screens would mean two
places to change when the copy changes, and the fallback path is the one nobody would remember to
update.

**The override control** is `TopicOverride.jsx`, built on E2's `components/teacher/TopicPicker.jsx` —
the same taxonomy, the same two-level shape, the same `GET /public/topics` behind it. Picking a leaf
sends **both** ids, because §9.2 scores the leaf at 1.0 and the parent at 0.3 and a half-filled row
is a half-ranked question. The level control is optional and defaults to what the classification
returned.

**Reload works.** The screen reads `GET /questions/:id` on mount rather than trusting router state.
That is the point of the endpoint: a student who refreshes, or who arrives here after their form
request timed out (3.6's recovery message), sees their question rather than an empty screen.

**Confirm moves on — to a placeholder, deliberately.** The primary action after confirming is
"find me a teacher", and that screen is `/app/ask/:id/teachers`, which E4 builds (PR 4.5). Navigate
to it; it is still a `Placeholder`. Do not build a teacher list here and do not invent an interim
screen — E4's brief is written against that route being untouched.

**States.** Loading, error (`NOT_FOUND` reads as "we couldn't find that question" with a way back to
`/app/ask`), saving-the-override, and saved. `SESSION_NOT_ACTIVE` from a `PATCH` means an offer is
already out: say so plainly and drop the override control rather than letting the student retry into
the same 409.

One line in `routes.student.jsx`: replace the `ask/:id/matching` `Placeholder`. That file is
co-edited with 3.6 by design — one line each, imports alphabetical, nothing reordered. E2's
`routes.teacher.jsx` took exactly this pattern from two developers and merged clean.

## Files you may touch

```
client/src/pages/student/Classifying.jsx            new  (the `ask/:id/matching` route)
client/src/components/question/ClassificationCard.jsx   new
client/src/components/question/TopicOverride.jsx        new
client/src/api/question.classification.api.js       new — getQuestion, patchClassification
client/src/router/routes.student.jsx                ONE line: the `ask/:id/matching` entry
docs/epics/E3-question-intake/README.md             tick the status box
```

## Files you must NOT touch

```
client/src/api/client.js                            DEV-A's single-owner file
client/src/api/question.api.js                      DEV-A's, 3.6
client/src/pages/student/Ask.jsx                    DEV-A's, 3.6
client/src/components/question/ImagePicker.jsx      DEV-A's, 3.6
client/src/components/teacher/TopicPicker.jsx       yours from 2.4 — import it, do not fork it for this screen
client/src/theme.js                                 frozen since 0.5
client/src/router/index.jsx                         frozen since 0.5
server/**                                           3.5 shipped everything this screen needs
```

## Acceptance criteria

- [ ] Arriving from 3.6's form shows the classification for the question that was just created
- [ ] Reloading the page shows the same thing — no blank screen, no dependence on router state
- [ ] A `classificationOk: true` question shows `studentConfirmation` and the resolved topic and level
- [ ] A `classificationOk: false` question shows the fallback copy with the topic picker as the primary action, and never shows "General / Unclassified" as if it were an answer
- [ ] Overriding to a different leaf persists: reload shows the new topic, and `psql` shows both `topic_id` and `subtopic_id` moved
- [ ] The picker offers leaves only — a parent row cannot be submitted (the server would reject it, and the screen should not let it get there)
- [ ] Another student's question id renders the not-found state with a route back to `/app/ask`
- [ ] A question whose session is not `PENDING` renders the explanation with no override control
- [ ] Confirming navigates to `/app/ask/:id/teachers` (still a placeholder — that is correct)
- [ ] Usable at 375px; `scrollWidth === clientWidth`
- [ ] `routes.student.jsx` changed by exactly one route line plus its import, and nothing was reordered
- [ ] `grep -rn "axios" client/src` still matches only `api/client.js`

## Manual test

1. Run the whole flow: `/app/ask` → submit with a photo → land here
2. Reload; confirm the screen re-renders from the server
3. Override the topic to something obviously different, reload, confirm it stuck; check `psql`
4. Break the classifier deliberately (unset `GEMINI_API_KEY`, restart, submit a new question) and confirm the fallback copy is what appears
5. Paste another student's question id into the URL → not-found state
6. `update sessions set status='OFFER_SENT' where question_id = ...` locally, reload → explanation, no override control
7. Confirm → `/app/ask/:id/teachers` placeholder

## Review checklist additions

- Confirm `TopicPicker` is imported from `components/teacher/`, not copied into `components/question/`. E2's best outcome was `TeacherCard` written once and read by three screens; the taxonomy picker is this epic's equivalent, and a fork here is two pickers that will disagree after F1's leaf cleanup.
- Confirm the screen never renders a raw error code. `SESSION_NOT_ACTIVE` and `NOT_FOUND` are branches with sentences, not strings on the page.
- Confirm no upload control appears here. Adding a photo after classification is a feature nobody specified, and the LLM has already run.

## Notes

**Why this screen belongs to DEV-B even though DEV-A owns the form.** It is the visible half of the
classification track: the copy, the fallback framing, and the override all have to agree with the
prompt and with `PATCH`'s rules, and those are DEV-B's files. Splitting result-rendering away from
the prompt that produced it is how the fallback path ends up worded like a bug report.

**Why the route is still called `matching`.** §14.1 names it `/app/ask/:id/matching` and E4 builds
`/app/ask/:id/teachers` next to it. Renaming a route to match what the screen ended up doing is a
change to a file both developers touch, for no user-visible gain. `routes.student.jsx` carries the
name; this PR carries the screen.

**The `TopicPicker` reuse is the one place this epic leans on E2.** It reads `GET /public/topics`,
which is cached and unauthenticated, so this screen makes two requests on mount and neither of them
is expensive. If F1's leaf-topic cleanup lands first, this screen inherits the fix for free — one
more reason not to fork the component.
