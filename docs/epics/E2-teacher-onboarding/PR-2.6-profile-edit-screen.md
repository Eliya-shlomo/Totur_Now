# PR 2.6 — Teacher profile edit screen

| | |
|---|---|
| **Epic** | E2 — Teacher Onboarding |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 2.2 (merged), 2.5 (merged) |
| **Blocks** | — |
| **Branch** | `dev-a/E2.6-profile-edit-screen` |

## Contract implemented

The screen at `/teach/profile`, against DEV-B's `GET` / `PATCH /teachers/me` from 2.2.
`MVP.md` §14.1.

## Scope

Where a teacher changes what the stepper set. Same endpoint as 2.4, opposite shape: a
stepper is a one-time linear flow, this is a form a teacher returns to for a year.

**The form.** Bio, topics, level, price — all editable, all saved together on one submit,
not per field. A `PATCH` per keystroke against a sleeping free instance is a bad screen.
Reuse `TopicPicker`, `LevelPicker` and `PriceSlider` from 2.4 as they are; if one needs a
prop it does not have, that is a follow-up PR by DEV-B, not an edit here.

**The preview.** Render `TeacherCard` from your own 2.5 above the form, fed from the
current form values, so the teacher sees what a student sees while they edit. This is the
reuse the epic split was designed around — the card is built once and read by both
audiences.

**The status control.** Online / offline as a visible toggle. Only those two values;
`OFFER_LOCKED` and `IN_SESSION` are set by the matching engine and 2.2 rejects them. When
the profile carries one of those two, render the toggle disabled with an explanation rather
than hiding it — a teacher who cannot find the offline switch mid-session will close the
tab, which is worse for the platform than an explained disabled control.

**Dirty state.** A submit button that is disabled until something changes, and a
confirmation before navigating away with unsaved edits.

**Failure.** Field errors from `VALIDATION_ERROR` land inline. Everything else is
`ErrorState` with retry, and the retry must not lose what was typed.

## Files you may touch

```
client/src/pages/teacher/Profile.jsx              new
client/src/router/routes.teacher.jsx              ONE line — replace the profile Placeholder
docs/epics/E2-teacher-onboarding/README.md        tick the status box
```

## Files you must NOT touch

```
client/src/pages/teacher/Onboarding.jsx           DEV-B's, 2.4
client/src/components/teacher/TopicPicker.jsx     DEV-B's, 2.4 — import it, do not edit it
client/src/components/teacher/LevelPicker.jsx     DEV-B's, 2.4 — import it, do not edit it
client/src/components/teacher/PriceSlider.jsx     DEV-B's, 2.4 — import it, do not edit it
client/src/api/teacher.api.js                     DEV-B's, 2.4 — import getMe/updateMe, do not edit
client/src/router/index.jsx                       frozen since 0.5
server/                                           nothing server-side in this PR
```

## Acceptance criteria

- [ ] `/teach/profile` loads the teacher's current values
- [ ] Changing a value enables submit; reverting it disables submit again
- [ ] Submit sends one `PATCH` with only the changed fields
- [ ] The live preview matches what `/teachers/:id` renders after saving
- [ ] Removing a topic actually removes it — reload and confirm
- [ ] Price and level bounds come from `/public/pricing` and `TEACHING_LEVELS`; no literals in the diff
- [ ] The online/offline toggle round-trips and is reflected in `GET /teachers?onlineOnly=true`
- [ ] A profile in `OFFER_LOCKED` or `IN_SESSION` shows the toggle disabled with an explanation
- [ ] Navigating away with unsaved edits prompts
- [ ] A rejected save keeps the typed values
- [ ] A student reaching `/teach/profile` is redirected to `/app`
- [ ] Usable at 375px

## Manual test

1. Log in as a teacher who finished 2.4's stepper
2. Change bio and price, submit, reload → both persisted
3. Remove one topic, submit, reload → gone, not merged back
4. Open `/teachers/:id` in a private window → matches the preview
5. Toggle offline, refresh `/teachers?onlineOnly=true` → the teacher is absent
6. Edit a field, try to navigate away → prompted
7. Repeat 2 at 375px

## Review checklist additions

- The three pickers are imported unchanged. Any diff inside DEV-B's component files means the PR is out of bounds — file a follow-up instead.
- The `routes.teacher.jsx` change is exactly one line, and it must merge cleanly on top of 2.4's one line. If 2.4 has not merged yet, wait — do not rebase around it by editing the whole file.

## Notes

This is the one cross-track dependency in E2: your screen, DEV-B's endpoint. It is
deliberate, and it is safe as long as 2.2 is **merged** before you start. Do not stub the
endpoint locally to get ahead — that is exactly how the client's idea of the shape and the
server's drift apart, and the drift only surfaces on the deployed pair.

The `routes.teacher.jsx` placeholder currently reads `pr="2.7"`. Stale numbering from the
pre-8/11 version of the epic. Fix the line you replace, leave the rest.
