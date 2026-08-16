# PR 4.7 — Teacher selection screen

| | |
|---|---|
| **Epic** | E4 — Matching Engine |
| **Owner** | DEV-B (rotem) |
| **Size** | L |
| **Written by** | Agent, **reviewed hard** (`MVP.md` §18). §14.2 calls this "the critical screen — worth more investment than any other screen", and the review checklist additions below are longer than usual for that reason. |
| **Depends on** | 4.4, 4.5, 4.6 (all merged) |
| **Blocks** | 4.8 |
| **Branch** | `dev-b/E4.7-selection-screen` |

## Contract implemented

`/app/ask/:id/teachers` (`MVP.md` §14.1, §14.2). Consumes `GET /questions/:id/matches` (4.5)
and `GET /questions/:id` (3.5, DEV-B's own endpoint from E3). Replaces the `Placeholder` that
3.7 navigates to.

## Scope

The screen the product is judged on. §14.2's mock is the specification; read it before the
code and read it again after.

**Three requests on mount, and they are all already built.**

- `GET /questions/:id` — the topic, the subtopic and the level, for the header. DEV-B's own
  `question.classification.api.js` from 3.7; import it, do not write a second one.
- `GET /questions/:id/matches` — the list. New module, `client/src/api/matching.api.js`,
  DEV-B's, one function. The instance's 15-second timeout is right; this is a database query,
  so **no per-request override and no edit to `client.js`**.
- `GET /public/pricing` — `block.minutes` and the `bands`, for 4.4's two components. Cached,
  unauthenticated, and already wrapped by `getPricing()`.

**The header** (§14.2's top block), three lines:

- the question's topic, resolved to a name. The payload carries `topicId` and `subtopicId`, not
  names; resolve them through `GET /public/topics`, which `TopicPicker` already loads and which
  is the same cached call. Prefer the subtopic's name, fall back to the parent's, and for a
  sentinel question say something honest — "we could not read this question's topic" — rather
  than rendering "General / Unclassified" as though it were an answer. 3.7 made exactly this
  call and the wording should agree with it.
- **[edit topic]** → a `Link` to `/app/ask/:id/matching`. That screen is 3.7's, it owns the
  override, and it already exists. Do not build a second picker here.
- the balance, from `MatchesResponse.walletBalance`.

**The price control** is 4.4's `<PriceCeiling>`, controlled by this screen. The value lives in
the **query string** (`?priceBand=B`), not in component state and not in a store: a shared or
reloaded URL must restore the list the student was looking at, and `Teachers.jsx` already
establishes that pattern for the browse filters. Changing it re-calls the endpoint.

**The cards.** `components/match/MatchCard.jsx`, new, DEV-B's, composing E2's `<TeacherCard>`
rather than replacing it — E2's retro names "TeacherCard written once and read by three
screens" as that epic's best outcome, and this is the fourth screen. The card adds exactly what
§14.2's mock adds and nothing more:

| Mock line | Source |
|---|---|
| "solved 12 questions in Integrals" | `subtopicSessions` + the subtopic name |
| "✅ 91% resolved" | `subtopicResolveRate`, **omitted entirely when null** |
| "💙 studied with" | `studiedWith` |
| "₪16 / 5 min · Your credit = 30 minutes" | 4.4's `<CreditMinutes>` with `walletBalance` |
| "Top" / "Active" | already on `TeacherCard` via `badge` |
| `[ Send request ]` | the E5 seam, below |

**No score, no rank number, no "97% match", no ordinal.** §14.2: "the student sees an order,
not grades." The payload does not carry a score — 4.5 drops it at the boundary — so the only way
to break this is to invent one, e.g. by numbering the cards 1–5 or labelling the first "best
match". Do not.

**Both empty states, and they are different screens.** `EmptyState.jsx` exists and every list
has one (`CONVENTIONS.md` → Client):

- `reason: 'NO_AVAILABLE_TEACHERS'` → "nobody who teaches this is online right now." Offer the
  two things that can actually change it: raise the price ceiling (if it is not already at the
  top band — `priceCeiling` tells you), and try again. Not an error state, not a red alert.
- `reason: 'INSUFFICIENT_CREDIT'` → "your balance does not cover an opening block with anyone."
  Say what an opening block costs at the cheapest price on the platform (`price.min ×
  block.openingBlocks`, both from `/public/pricing`) so the number is concrete. Top-up is E7 and
  `/app/wallet` is still a `Placeholder` — link to it anyway; it is the right destination and it
  will fill in.

**The refresh button** (§14.2's "🔄 Show me more teachers") re-calls the endpoint with the
current band. There is no offset and no page two — `MATCH_COUNT` is 5 and the sixth-best teacher
is not a product. Its honest promise is "look again": teachers go online and offline, and from
E5 on the pool shrinks as offers are rejected. If the copy "show me more teachers" reads as a
promise of *different* teachers, prefer wording that does not.

**The other states.** Loading (the whole screen, not per card), error, and the two the server
can answer with: `NOT_FOUND` reads as "we couldn't find that question" with a way back to
`/app/ask`, and `SESSION_NOT_ACTIVE` means an offer is already out — say so plainly and drop the
card list rather than letting the student pick a second teacher into a 409. 3.7 handles the same
two codes on the previous screen; the wording should match.

**One line in `routes.student.jsx`:** replace the `ask/:id/teachers` `Placeholder`. Imports
alphabetical, nothing reordered. **This is the only E4 PR that opens that file** — unlike E3,
where 3.6 and 3.7 each took a line.

### The E5 seam

`[ Send request ]` calls one callback with a frozen signature:

```js
onChoose({ teacherId, pricePerBlock })
```

In this PR its body confirms the choice — a modal or a notification naming the teacher and the
opening-block cost — and stops. **Do not create a route for what comes next.** `POST
/sessions/:id/offer`, the atomic lock and the 60-second countdown are E5, 5.3 is human-written
per §17.5, and §14.1 has no offer screen; a route invented here is one E5 must honour or rename.
A callback is one function body E5 replaces in a file it already owns. The `sessionId` E5 will
need is already on the `QuestionResponse` this screen loaded.

Say all of that in a comment above the callback, the way 3.7's screen says why it navigates to a
placeholder.

## Files you may touch

```
client/src/pages/student/ChooseTeacher.jsx          new  (the `ask/:id/teachers` route)
client/src/components/match/MatchCard.jsx           new
client/src/api/matching.api.js                      new — one function
client/src/router/routes.student.jsx                ONE line: the `ask/:id/teachers` entry
docs/epics/E4-matching/README.md                    tick the status box
```

## Files you must NOT touch

```
client/src/api/client.js                            DEV-A's single-owner file, frozen at 15s
client/src/api/question.classification.api.js       yours from 3.7 — import getQuestion, do not fork it
client/src/api/public.api.js                        getPricing/getTopics already exist
client/src/components/match/CreditMinutes.jsx       DEV-A's, 4.4 — compose it
client/src/components/match/PriceCeiling.jsx        DEV-A's, 4.4 — compose it, controlled
client/src/components/teacher/TeacherCard.jsx       DEV-A's, 2.5/4.4 — compose it, never fork it
client/src/components/teacher/TeacherFilters.jsx    E2's browse filter, not this screen's control
client/src/components/question/**                   3.6's and 3.7's
client/src/pages/student/Ask.jsx                    DEV-A's, 3.6
client/src/pages/student/Classifying.jsx            yours from 3.7 — the [edit topic] link goes there,
                                                    that screen does not change
client/src/theme.js                                 frozen since 0.5
client/src/router/index.jsx                         frozen since 0.5
server/**                                           4.5 shipped everything this screen needs
```

## Acceptance criteria

- [ ] Confirming on 3.7's screen lands here and the list renders for the question that was just created
- [ ] Reloading shows the same thing — no blank screen, no dependence on router state
- [ ] The header shows the question's subtopic name and level, and `[edit topic]` navigates to `/app/ask/:id/matching`
- [ ] A sentinel question (`topic_id = 0`) never renders "General / Unclassified" as if it were the answer, and still lists teachers
- [ ] Pressing a different price ceiling changes the URL, re-calls the endpoint, and narrows or widens the list; **reloading that URL restores the same ceiling and the same list**
- [ ] Each card shows the price **and** the minutes the balance buys with that teacher, and the two agree with `/pricing`
- [ ] A teacher with no history in the subtopic shows no resolve-rate line at all — not "0% resolved"
- [ ] `studiedWith` renders the badge; a teacher without it renders nothing in its place
- [ ] **No score, no percentage match, no rank number, and no "best match" label anywhere on the screen**
- [ ] As `ido.student` (0 credits): the `INSUFFICIENT_CREDIT` state, naming a concrete opening-block cost, with a link to `/app/wallet`
- [ ] At band A on an integrals question: the `NO_AVAILABLE_TEACHERS` state, offering to raise the ceiling
- [ ] Another student's question id → not-found state with a route back to `/app/ask`
- [ ] A question whose session is not `PENDING` → the explanation, and no card list
- [ ] `[ Send request ]` confirms and goes nowhere. It creates no session, sends no request, and navigates to no new route
- [ ] Usable at 375px, cards full width, `scrollWidth === clientWidth`; two columns at 768px (§14.4)
- [ ] `routes.student.jsx` changed by exactly one route line plus its import, and nothing was reordered
- [ ] `grep -rn "axios" client/src` still matches only `api/client.js`
- [ ] `npm run lint`, `npx prettier --check .`, `npm run build -w client` all pass

## Manual test

1. `npm run db:up && npm run db:seed && npm run dev`. Log in as `avi.student`, run the whole flow: `/app/ask` → submit a question about integration by parts → confirm on 3.7's screen → land here
2. Press each price ceiling in turn; copy the URL after each, reload it, confirm the control and the list come back the same
3. Read one card against `GET /teachers/<that id>` in another tab — the name, badge, rating, price and topics must match
4. Log in as `ido.student`, ask a question, reach this screen → the insufficient-credit state
5. Same as `noya.student` (24 credits) → the expensive teachers are gone and the ceiling on screen explains why
6. `psql`: flip `gil.v` and `shira.g` to `ONLINE` → five cards, and Gil is not first despite his 5.0. **Set them back to `OFFLINE`**
7. `insert into reviews (session_id, student_id, teacher_id, is_resolved, stars) values (null, '<avi>', '<dana>', true, 5);` → the 💙 badge appears on Dana's card. **Delete the row**
8. Unset `GEMINI_API_KEY`, restart the server, ask a new question → a sentinel question. Reach this screen and read the header wording
9. `update sessions set status='OFFER_SENT' where question_id='<q>';` → the explanation state. **Set it back**
10. 375px and 768px on every state above, including both empty ones

## Review checklist additions

- **Read §14.2's six design decisions against the rendered screen, one at a time.** Credit always in minutes; specialty per topic, not globally; the 💙 badge; no scores; the price control expressed in money; badges say what the teacher has *done here*. Five of the six are easy to satisfy accidentally and easy to lose in a refactor.
- Confirm `TeacherCard`, `CreditMinutes` and `PriceCeiling` are **imported** from DEV-A's files, not copied into `components/match/`. A forked card is two cards that will disagree, and it is the specific outcome E2's retro celebrated avoiding.
- Confirm the price ceiling lives in the URL and that no `useState` shadows it.
- Confirm the screen never renders a raw error code. `NOT_FOUND`, `SESSION_NOT_ACTIVE`, `INSUFFICIENT_CREDIT` and `NO_AVAILABLE_TEACHERS` are four branches with four sentences.
- Confirm the two empty states are visually distinct and that neither is styled as an error. One of them is the product working exactly as designed for a student with no money.
- Confirm the send button is disabled while a request is in flight and that double-clicking it calls `onChoose` once. E5 replaces the body with something that takes a lock; a double-fire there is a real bug and this is where the guard belongs.
- Confirm no new client dependency was added. Mantine has a `SegmentedControl`, a `Badge` and a `Modal`.

## Notes

**Why this screen belongs to DEV-B even though DEV-A owns the endpoint.** It is the visible half
of the ranking. The order the student reads, the specialty line that justifies that order, and
the continuity badge all have to agree with `matching.scoring.js` — DEV-B's file — about what
made a teacher rank where they did. Splitting the explanation away from the algorithm that
produced it is how a screen ends up describing a ranking it does not implement. DEV-A's half of
this screen is the affordability language, and it arrived as two components in 4.4.

**Why three requests on mount and not one.** The question, the matches and the pricing model are
three different lifetimes: the question is stable, the matches go stale in seconds, and the
pricing model changes on a deploy and is cached for five minutes by the browser. Merging them
into one endpoint would tie the cheapest of the three to the freshness of the most volatile.
Two of the three are already cached and unauthenticated.

**Why the topic name is resolved on the client.** `MatchesResponse` carries no topic name, on
purpose: the taxonomy is already published, already cached, and already loaded by the picker
this flow uses twice. Putting the name in the match payload would be a fourth copy of a string
the client can look up for free.

**What is not real yet, and must not be faked.** `studiedWith` is `false` for every seeded pair
because nothing writes `reviews` until E8. `subtopicSessions` comes entirely from the seed and
does not move when a session completes. The send button does nothing until E5. All three are
correct states of a half-built product; rendering a plausible placeholder instead of the honest
state is how a demo becomes a lie.
