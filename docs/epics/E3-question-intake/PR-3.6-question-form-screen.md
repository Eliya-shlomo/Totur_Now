# PR 3.6 — Question form screen — text + image, camera-first

| | |
|---|---|
| **Epic** | E3 — Question Intake & LLM Classification |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 3.2, 3.4 (both merged) |
| **Blocks** | 3.7 |
| **Branch** | `dev-a/E3.6-question-form-screen` |

## Contract implemented

`/app/ask` — the screen behind "I'm stuck" (`MVP.md` §4.1, §14.1). Consumes
`POST /questions/attachments` (3.2) and `POST /questions` (3.4).

## Scope

One screen, one form, three fields: what you're stuck on, a photo, and which level you study.

**Camera-first on mobile (§14.4).** The image control is `<input type="file" accept="image/*"
capture="environment">` on small screens, so a phone opens the camera rather than a file browser.
Desktop gets the same input without `capture`. One thumbnail preview per attachment, each removable
before submit; the cap is `MAX_ATTACHMENTS` and the screen reads it from the same place the server
does rather than hardcoding a number.

**Upload happens on pick, not on submit.** Each image goes to `POST /questions/attachments` the
moment it is chosen and the returned `id` is held in form state. Submit then posts `rawText`,
`declaredLevel` and `attachmentIds`. The student spends the upload time while they are still typing,
and a failed upload is one retryable thumbnail rather than a failed submit.

**Then the wait, in place.** Submitting shows an "Analyzing your question…" state on this screen —
§4.1's 2–4 seconds — because the question id does not exist until the response returns. On success,
navigate to `/app/ask/:id/matching`, which is 3.7's screen. **This screen owns the request; DEV-B's
screen owns the result.** That is the client half of the epic's seam and it is why neither developer
needs the other's component.

**The timeout, and the recovery.** `question.api.js` sets a per-request timeout above
`LLM_TIMEOUT_MS` plus a cold-start allowance — passed as the axios per-request option, **not** by
editing `client/src/api/client.js`, which is a single-owner file frozen at 15 seconds for everything
else. Multipart requests additionally delete the instance's `Content-Type` header so the browser can
set its own boundary; a `FormData` sent as `application/json` fails server-side in a way that reads
like a Cloudinary bug. If the request times out anyway, the message says the question may have been
saved and offers a retry — it does not claim failure it cannot verify.

**Validation before the request.** Mantine form + `mantine-form-zod-resolver`, the pattern E1's auth
screens set. Mirror the server's bounds; when the server disagrees anyway, render its field errors
through the existing `ApiError`/`fieldErrors` path rather than inventing a second error surface.

**States, all four.** Idle, uploading (per thumbnail), submitting (the analyzing state), and failed —
using `components/state/{Loading,Error,Empty}State.jsx`, which already exist. Usable at 375px, and
the submit control stays reachable with the mobile keyboard open.

One line in `routes.student.jsx`: replace the `ask` `Placeholder` with the screen. Do not touch the
other entries and do not reorder — that rule survived E2 unscathed and 3.7 needs the same file.

## Files you may touch

```
client/src/pages/student/Ask.jsx                    new
client/src/components/question/ImagePicker.jsx      new
client/src/components/question/QuestionTextField.jsx new
client/src/api/question.api.js                      new — createQuestion, uploadAttachment
client/src/router/routes.student.jsx                ONE line: the `ask` entry
docs/epics/E3-question-intake/README.md             tick the status box
```

## Files you must NOT touch

```
client/src/api/client.js                            single-owner, frozen — override timeout and headers per request
client/src/theme.js                                 frozen since 0.5 — shared values live in theme.other
client/src/layouts/**                               AppLayout drives all three shells
client/src/components/question/ClassificationCard.jsx   DEV-B's, 3.7
client/src/components/question/TopicOverride.jsx        DEV-B's, 3.7
client/src/api/question.classification.api.js       DEV-B's, 3.7
client/src/pages/teacher/**, client/src/pages/guest/**  E2's
server/**                                           this PR is client-only
```

## Acceptance criteria

- [ ] `/app/ask` is reachable only as a logged-in student; a teacher hitting it is redirected by `ProtectedRoute`
- [ ] Choosing a photo uploads it immediately and shows a thumbnail; removing the thumbnail drops it from the submit
- [ ] On a phone (or a 375px viewport with touch emulation), the image control opens the camera
- [ ] An oversized or non-image file shows the server's message inline and does not clear the typed text
- [ ] Submitting with text only works; submitting with text plus two photos works
- [ ] Submitting with empty text is blocked client-side, with the message on the field
- [ ] While submitting, the screen shows the analyzing state and the submit control cannot be double-fired
- [ ] On success the app is at `/app/ask/:id/matching` with a real question id in the URL
- [ ] A deliberately slowed server (throttle to 20s) does not produce a hard axios timeout at 15s
- [ ] `scrollWidth === clientWidth` at 375px on every state
- [ ] `routes.student.jsx` changed by exactly one route line plus its import, and nothing was reordered
- [ ] `grep -rn "axios" client/src` still matches only `api/client.js`

## Manual test

1. Log in as a seeded student, open `/app` → `/app/ask`
2. Type a sentence, attach a photo of an exercise, submit; land on the matching URL and note the id
3. Repeat with no photo, and with two photos
4. Attach a PDF → inline error, typed text preserved
5. In devtools, throttle to "Slow 3G" and submit; confirm the analyzing state holds and no 15-second timeout fires
6. 375px + touch: confirm the camera opens and the page does not scroll sideways

## Review checklist additions

- Grep the diff for `timeout` — it must appear as a per-request option in `question.api.js`, never as an edit to `client.js`.
- Confirm the multipart call deletes the instance `Content-Type` rather than setting a boundary by hand.
- Confirm no classification is rendered here. If this screen displays a topic, the two screens are now both in the confirmation business and the seam has leaked.

## Notes

**Why the wait lives on this screen and not on 3.7's.** The waiting screen in §14.1 is
`/app/ask/:id/matching`, and `:id` does not exist until `POST /questions` answers. Navigating first
would mean a route with no id or a client-generated one — and `CONVENTIONS.md` is explicit that ids
come from the database. So the request is awaited here and the result is handed over by URL.

**This PR does not build the student dashboard.** `/app` is still a `Placeholder` owned by E1/E7 and
stays that way; reach `/app/ask` directly or from the nav. Widening scope into the dashboard would put
this PR in a file another epic owns.

**Prior art worth copying rather than re-deriving:** `components/auth/useAuthSubmit.js` for the
submit-and-handle-`ApiError` shape, `components/teacher/TopicPicker.jsx` for how a Mantine control
reads server data without owning it, and `lib/notify.js` for anything that should be a toast rather
than inline text.
