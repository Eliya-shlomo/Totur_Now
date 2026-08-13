# PR 2.4 — Onboarding stepper: topics → level → price

| | |
|---|---|
| **Epic** | E2 — Teacher Onboarding |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 2.2 (merged) |
| **Blocks** | — |
| **Branch** | `dev-b/E2.4-onboarding-stepper` |

## Contract implemented

The screen at `/teach/onboarding`. `MVP.md` §14.1 for the route, §6.1 for the level, §5.2
for the price.

## Scope

A Mantine `Stepper`, three steps, one `PATCH /teachers/me` per step. Saving per step rather
than once at the end is the point: a teacher who closes the tab after step two comes back
to step three, not to step one.

**Step 1 — topics.** The two-level tree from `GET /public/topics`, which 1.6 already
built. Parents are group headings, not selectable; only leaves are. At least one required.
`nameEn` is the label, not `nameHe` — `client/index.html` fixed the UI as English and LTR
at PR 0.5, and a Hebrew topic list would be the only Hebrew on the screen. (This line said
the opposite until 2.5 hit the same question and checked; corrected there.)

**Step 2 — level.** The values in `TEACHING_LEVELS`, labelled for a human rather than shown
as bare integers. Self-declared, and the screen should say so plainly — nobody verifies it,
and a teacher who thinks it is checked will under-declare.

**Step 3 — price.** A slider bounded by `GET /public/pricing`'s `price.min` / `price.max`,
**not** by a literal. As the teacher moves it, show which band they land in using the
`bands` array from the same payload. Never hardcode 5, 20, or a band boundary — the whole
reason `/public/pricing` exists is that the pricing page cannot lie, and this screen is
now a second pricing surface.

**Entry and exit.** On mount, `GET /teachers/me` and jump to the first incomplete step.
When `onboardingComplete` turns true, offer "go online" — one `PATCH { status: 'ONLINE' }`
— then route to `/teach`. A teacher who reaches `/teach/onboarding` already complete sees
the summary with an edit affordance, not a wizard restarting.

**Failure.** Every step handles a rejected `PATCH`: field errors from `VALIDATION_ERROR`
land inline on the offending control; anything else uses the `ErrorState` primitive from
0.6 with a retry that does not lose the step's input. A network failure must not silently
advance the stepper.

## Files you may touch

```
client/src/pages/teacher/Onboarding.jsx           new
client/src/components/teacher/TopicPicker.jsx     new
client/src/components/teacher/LevelPicker.jsx     new
client/src/components/teacher/PriceSlider.jsx     new
client/src/api/teacher.api.js                     new
client/src/router/routes.teacher.jsx              ONE line — replace the onboarding Placeholder
docs/epics/E2-teacher-onboarding/README.md        tick the status box
```

## Files you must NOT touch

```
client/src/router/index.jsx                       frozen since 0.5
client/src/router/routes.guest.jsx                DEV-A's
client/src/api/client.js                          single-owner, DEV-A
client/src/api/public.api.js                      E1's — import getTopics/getPricing, do not edit
client/src/stores/authStore.js                    DEV-B's from 1.5, but no change belongs here
client/src/pages/auth/                            1.3's
server/                                           nothing server-side in this PR
```

## Acceptance criteria

- [ ] A new teacher lands on step 1 with nothing selected
- [ ] Parent topics cannot be selected; at least one leaf is required to advance
- [ ] Each step persists on its own — reload mid-flow and the completed steps are still saved
- [ ] Reopening `/teach/onboarding` after step 2 resumes at step 3
- [ ] The price slider's bounds and band labels come from `/public/pricing`; grep the diff for `5` and `20`
- [ ] Completing all three flips the screen to the summary and offers "go online"
- [ ] "Go online" sets `status: 'ONLINE'` and the teacher then appears in `GET /teachers?onlineOnly=true`
- [ ] A rejected `PATCH` shows the field error inline and does not advance
- [ ] A student who reaches `/teach/onboarding` is redirected to `/app` — `ProtectedRoute` already does this; confirm, do not reimplement
- [ ] Usable at 375px wide

## Manual test

1. Register a fresh teacher on the deployed client
2. Pick two leaf topics, advance, close the tab
3. Reopen `/teach/onboarding` → resumes at step 2 with the topics kept
4. Finish level and price, go online
5. Open `/teachers` in a private window, no login → the new teacher is listed with the `New` badge
6. Repeat step 3 at 375px

## Review checklist additions

- No literal price bound, band boundary or level value anywhere in the diff.
- The `routes.teacher.jsx` change is exactly one line. If the diff shows reordering or reformatting, revert and redo — DEV-A edits that file in 2.6.

## Notes

The `routes.teacher.jsx` placeholder currently reads `pr="2.6"`. That is stale numbering
from the pre-8/11 version of this epic; this PR is what replaces it. Fix the line you are
replacing and leave the other four alone.

Expect a slow first `PATCH` after a quiet period — the free Render instance sleeps and the
client's timeout is 15s. That is `docs/DEPLOYMENT.md` §7, not a bug in this screen, but the
error state should be good enough that a teacher retries rather than gives up.
