# PR 6a.5 — Surfacing the brief, and the RTL the client never got

| | |
|---|---|
| **Epic** | E6a — Classification Repair & the Teacher Brief |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | Agent. |
| **Depends on** | 6a.4 (merged) |
| **Blocks** | 6a.6 |
| **Branch** | `dev-b/E6a.5-brief-ui-rtl` |

## Contract implemented

No new contract. This renders `Classification` as extended in 6a.4 — `MVP.md` §14, the
teacher's incoming-offer screen.

## Scope

Two things, and the second is older than this epic.

### 1. The brief, where the teacher decides

`client/src/components/offer/IncomingOfferModal.jsx` is where a teacher spends E5's 60
seconds. It shows the title, `teacherBrief`, `howToStart` and the topic badge, in that
order, laid out so the whole brief is readable **without scrolling** — a brief that needs
a scroll inside a countdown is a brief nobody reads.

`OfferCountdown.jsx` is untouched. The clock is E5's and it works.

When `classificationOk` is false there is no brief and `howToStart` is null. The card
says so — "not classified; the student's own words follow" and then `rawText`. It must not
render an empty block, and it must not render the label with nothing after it. The
fallback puts the student's raw text in `teacherBrief`, so a naive render shows homework
under a heading that promises a summary.

The offer email (`server/src/services/email.templates.js`, PR 5.6) carries
`teacher_brief` already and gains `how_to_start` beside it. Same brief, same order, same
`dir="auto"` treatment it already applies. A teacher who reads the email before opening
the app should not get less.

### 2. The RTL the client never got

The server side got this right at 5.6: `email.templates.js` wraps the shell in
`dir="ltr"` and marks every student-authored value `dir="auto"`, so Hebrew renders
right-to-left with its punctuation in the right place.

**The React side never did.** `client/index.html` is `<html lang="en" dir="ltr">`, and
`ClassificationCard.jsx:118-120` renders `rawText` with `whiteSpace: 'pre-wrap'` and no
`dir` at all. Every Hebrew question this product has ever shown a student has been
displayed in an LTR container — trailing punctuation in the wrong place, mixed
Hebrew-and-digits reordered. It has been wrong since 3.7 and nothing in this epic caused
it, but this is the PR that adds Hebrew prose to a second screen, so it is the PR that
fixes it.

`dir="auto"` on every element carrying student-authored or model-generated text:
`rawText`, `title`, `teacherBrief`, `howToStart`, `studentConfirmation`. `dir="auto"`
rather than `dir="rtl"` — the field may be either language, per prompt rule 7, and the
browser's first-strong-character heuristic is exactly the right answer for a string whose
direction is not known until it arrives.

The page shell stays LTR. This is not an app-wide RTL conversion, and turning one on
inside a UI PR would be a redesign wearing a bug fix's branch name.

### 3. One inconsistency to settle

`Classifying.jsx:54` builds the topic badge from `nameEn` alone, while `TopicPicker.jsx:28`
documents that `nameHe` rides along in the payload and is deliberately not rendered. A
Hebrew-speaking student is being shown "Calculus — Integrals". Pick one rule, write it in
a comment, and apply it in both places and in the new teacher card. Either answer is
defensible; three screens disagreeing is not.

## Files you may touch

```
client/src/components/offer/IncomingOfferModal.jsx     the brief, where the decision happens
client/src/components/question/ClassificationCard.jsx  dir="auto" on student-authored text
client/src/pages/student/Classifying.jsx               the badge rule
client/src/components/question/TopicPicker.jsx         the badge rule, same answer
client/src/pages/teacher/**                            the dashboard's question card, if it shows one
server/src/services/email.templates.js                 how_to_start beside teacher_brief
docs/epics/E6a-classification-repair/README.md         tick the status box
```

## Files you must NOT touch

```
client/index.html                       the shell stays dir="ltr"; app-wide RTL is not this PR
client/src/components/offer/OfferCountdown.jsx   E5's clock. Mount it; do not open it
client/src/api/**                       the payload already carries every field
server/src/**                           except email.templates.js — the data is all there
shared/**                               frozen at 6a.4
```

## Acceptance criteria

- [ ] A teacher opening an offer for a Hebrew question reads title, brief and opening move right-to-left, with punctuation in the right place
- [ ] The whole brief is readable in the modal without scrolling, at 375px and at desktop width
- [ ] An English question renders left-to-right in the same components, unchanged
- [ ] `classificationOk: false` renders a distinct state naming what happened — not a blank, and not homework under a "summary" heading
- [ ] `ClassificationCard` renders Hebrew `rawText` right-to-left; before this PR it did not
- [ ] The offer email shows the same brief in the same order
- [ ] The topic badge follows one rule across `Classifying`, `TopicPicker` and the teacher card, and a comment says which
- [ ] 375px: no horizontal overflow
- [ ] `npm run lint`, `npx prettier --check .`, `npm test`, and `npm run build` in `client/` all pass

## Manual test

1. `npm run dev`. Student submits a photographed Hebrew exercise
2. Confirmation screen: `rawText` and `studentConfirmation` render RTL
3. Teacher account goes available in a second browser, receives the offer
4. Read the modal without scrolling. Punctuation sits at the left edge of each Hebrew line
5. Let the countdown run out. The clock still behaves — nothing here touched it
6. Submit an English question. Same components, LTR, no regression
7. Unset `GEMINI_API_KEY`, submit again, take the offer: the not-classified state, with
   the student's words presented as the student's words
8. Check the offer email in both languages

## Review checklist additions

- Every field carrying student or model text has `dir="auto"`. A missed one is invisible
  in English and wrong in Hebrew, which is the half of the audience this product is for.
- `dir="auto"`, never `dir="rtl"`. A hardcoded RTL breaks the English case.
- No `direction` CSS on the shell. If the page as a whole flipped, the PR overran.
- The fallback state was tested by actually producing one, not by reasoning about it.

## Notes

**Why the client's RTL gap survived three epics.** The server got `dir="auto"` at 5.6
because an email client renders raw HTML and the mistake is obvious in a test send. The
React screens were built and reviewed in English, and every fixture in
`classification.test.js` is Hebrew while every screenshot in review was not. The bug is
only visible with real content in the real component, which is the same shape of failure
as the epic's main subject: the tests were fine, nobody looked at the real thing.

**Why 375px is called out.** Teachers accept offers on a phone. The brief grew by up to
three lines in 6a.4, inside a modal with a countdown, on the narrowest screen the project
supports — that is where "readable without scrolling" is a real constraint rather than a
formality.
