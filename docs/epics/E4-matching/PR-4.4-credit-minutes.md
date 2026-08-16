# PR 4.4 — Credit-to-minutes and the price ceiling control

| | |
|---|---|
| **Epic** | E4 — Matching Engine |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 4.1 (merged). **No server dependency** — this is client-only and can land the day 4.1 does. |
| **Blocks** | 4.7 |
| **Branch** | `dev-a/E4.4-credit-minutes` |

## Contract implemented

`MVP.md` §5.4 — "always displayed in minutes" — and the price control in §14.2's mock. Two
presentational components plus one pure helper, all consumed by 4.7's screen and one of them
by E2's existing cards.

This is §18's PR 4.6, moved fourth. The selection screen consumes both components, and
"across all teacher cards" means E2's `TeacherCard.jsx`, which is DEV-A's file — landing it
last would mean 4.7 either waits or grows a second copy of the translation.

## Scope

**1. `client/src/lib/credits.js` — the translation, once.**

```js
minutesFor(balance, pricePerBlock, blockMinutes) -> number
```

`Math.floor(balance / pricePerBlock) * blockMinutes`. Whole blocks only, because a student
cannot buy four fifths of a block. Check it against §14.2's own mock before you believe it:
balance 96 at ₪16 is 6 blocks, 30 minutes; at ₪12 it is 8 blocks, 40 minutes. Both numbers are
in the mock.

Pure, no React, unit-testable, and it takes `blockMinutes` as an argument rather than
importing it — see below.

**2. `blockMinutes` comes from `GET /public/pricing`, and E4 adds no constant for it.**
`getPricing()` in `client/src/api/public.api.js` already returns `block.minutes`,
`price.min/max/default` and `bands` — server-derived from `constants/money.js` and
`constants/session.js`, unauthenticated and cached five minutes. E2's retro's third finding is
that four copies of `TEACHING_LEVELS` exist because nobody published them, and it names the
price bounds as the counter-example that works. **Do not add a fifth copy of anything.** This
PR is the third consumer of that endpoint and should read like the other two.

**3. `components/match/CreditMinutes.jsx`, new, DEV-A's.** Renders "Your credit = 30 minutes"
from a balance, a price and `block.minutes`. Three states, and the third is the one that gets
skipped:

- affordable → the minutes
- affordable but below the opening block → the student can see the teacher and cannot start
  with them. `OPENING_BLOCKS * blockMinutes` is 10 minutes; below that, say so plainly rather
  than rendering "5 minutes" next to a button that will fail
- balance 0 → "no credit", not "0 minutes"

The third state is reachable on the seed today (`ido.student`) and the second one is reachable
the moment a student spends down. Neither should be a special case invented in 4.7.

**4. `components/match/PriceCeiling.jsx`, new, DEV-A's.** §14.2's control:
`[ ₪9 ] [ ₪14 ] [ ₪20 ✓ ]`. Three rules from the mock's own design notes, and all three are
easy to lose:

- **Expressed in money, never in band letters.** "up to ₪14", not "band B". The letters are an
  implementation detail the student never needs to learn — they exist in the query string and
  nowhere on the screen.
- **It is a ceiling, not a bracket.** Picking ₪14 shows every teacher at ₪14 or less. The
  control must not read as "the ₪10–14 range", which is what a segmented control of ranges
  would imply.
- **Controlled and stateless.** The screen owns the value, because it lives in the query
  string and drives a re-fetch. A control with its own copy is a second source of truth that
  disagrees with the address bar the first time somebody presses back. This is exactly the
  arrangement `TeacherFilters.jsx` already documents.

The options come from `/public/pricing`'s `bands` — `{ key, minPrice, maxPrice }`, cheapest
first — so the control renders one button per band with `maxPrice` as its label and emits
`key`. If `money.js` grows a band D, this control grows a button and nothing else changes.

**Do not fork `TeacherFilters.jsx` and do not extend it.** It is a `Select` of band ranges for
the browse screen and it belongs to E2's list; this is a segmented control of ceilings for one
screen. Different control, same data source, no shared code beyond the endpoint.

**5. One optional line in `components/teacher/TeacherCard.jsx`.** §18's wording is "across
**all** teacher cards", and the browse list is where a guest first sees a price. The card gains
an optional `walletBalance` prop; when it is present the price row also renders
`<CreditMinutes>`, and when it is absent — every guest view, and 2.6's preview — the card is
byte-identical to today. Default it to `null` and branch on that, so no existing call site
changes.

## Files you may touch

```
client/src/lib/credits.js                           new
client/src/components/match/CreditMinutes.jsx       new
client/src/components/match/PriceCeiling.jsx        new
client/src/components/teacher/TeacherCard.jsx       one optional prop, one conditional line
client/src/pages/guest/Pricing.jsx                  ONLY if it already renders a block-minutes
                                                    literal this helper should replace
docs/epics/E4-matching/README.md                    tick the status box
```

## Files you must NOT touch

```
client/src/api/client.js                            DEV-A's single-owner file, frozen at 15s.
                                                    /public/pricing needs no override.
client/src/api/public.api.js                        getPricing() already exists — call it
client/src/components/teacher/TeacherFilters.jsx    E2's browse filter. Not this control.
client/src/components/teacher/TeacherBadge.jsx      E2's
client/src/components/match/MatchCard.jsx           DEV-B's, 4.7
client/src/pages/student/ChooseTeacher.jsx          DEV-B's, 4.7
client/src/router/routes.student.jsx                4.7's one line. This PR adds no route.
client/src/theme.js                                 frozen since 0.5
server/**                                           nothing server-side in this PR
```

## Acceptance criteria

- [ ] `minutesFor(96, 16, 5) === 30` and `minutesFor(96, 12, 5) === 40` — §14.2's own two numbers
- [ ] `minutesFor(24, 16, 5) === 5`, and `CreditMinutes` renders the below-opening-block state for it rather than "5 minutes"
- [ ] `minutesFor(0, 10, 5) === 0`, and the component says "no credit"
- [ ] `grep -rn "= 5" client/src/lib/credits.js` finds no block length — `blockMinutes` is a parameter
- [ ] `grep -rn "₪9\|₪14\|₪20\|'A'\|'B'\|'C'" client/src/components/match/PriceCeiling.jsx` finds no band table — the options come from `/public/pricing`
- [ ] `PriceCeiling` renders three buttons on today's `money.js` and emits `'A' | 'B' | 'C'`; the labels are prices
- [ ] The word "band" appears nowhere a user can read it
- [ ] `PriceCeiling` holds no state: passing the same `value` twice renders the same thing, and clicking calls `onChange` without re-rendering itself first
- [ ] `TeacherCard` with no `walletBalance` renders exactly as it did before this PR — check `/teachers` and `/teachers/:id` logged out, and 2.6's profile preview
- [ ] Both components usable at 375px; `scrollWidth === clientWidth`
- [ ] `grep -rn "axios" client/src` still matches only `api/client.js`
- [ ] `npm run lint`, `npx prettier --check .`, `npm test`, `npm run build -w client` all pass

## Manual test

1. `npm run dev`. Open `/pricing` and read the block length and the three band ceilings off the page — those are the numbers the new components must agree with
2. Render both components on a scratch route or in `/teachers` temporarily with hardcoded props, at balances 120, 24 and 0 and at prices 5, 12 and 20. Remove the scratch wiring before committing
3. `/teachers` and `/teachers/:id` logged out → confirm no minutes line appears anywhere
4. `/teach/profile` (2.6's live preview) → confirm the card is unchanged
5. 375px on all three screens; check `document.documentElement.scrollWidth === clientWidth`
6. Edit `PRICE_BANDS` in `server/src/config/constants/money.js` locally to add a band D, restart the server, reload → the control has four buttons. **Revert the edit.**

## Review checklist additions

- Confirm nothing in this PR hardcodes 5 minutes, ₪5–20, or the band ceilings. This is the exact debt E2's retro logged as its third finding, and E4 is the epic that would have made it a fifth copy.
- Confirm `TeacherCard`'s diff is additive and guarded. A card that renders differently for guests because of an E4 change is an E2 regression found by nobody.
- Confirm the price control's copy never uses "band", "tier", or a letter. §14.2 is explicit and it is a product decision, not a wording preference.
- Confirm `credits.js` has a unit test and that it lives in `server/tests/`… **it does not** — `npm test` only runs `server/tests/**`. Say so: this helper's correctness is checked by the acceptance criteria above and by 4.8, and the two mock-derived numbers are asserted in the PR description. Do not add a client test runner in this PR.

## Notes

**Why credit-to-minutes is DEV-A's and not the screen owner's.** It is the visible half of
DEV-A's slice. The same developer owns the wallet ceiling on the server (`floor(balance /
OPENING_BLOCKS)`), the `priceCeiling` in the response, and the sentence a student reads about
what their money buys. Splitting "what you can afford" from "how long that lasts" across two
people is how the endpoint and the label end up disagreeing about whether a block is five
minutes.

**Why the helper takes `blockMinutes` instead of importing it.** There is no client constants
module and there should not be one — the whole point of `/public/pricing` is that the page
cannot lie, because the number it renders is the number the wallet charges from. A helper that
imported a client-side `5` would reintroduce the drift the endpoint exists to prevent, and it
would do it in the one place where being wrong costs the student money.

**Why `TeacherCard` gains a prop rather than the match screen getting its own card.** E2's
retro names `TeacherCard` written once and read by three screens as the epic's best outcome.
4.7's `MatchCard` composes it — card plus the three match-specific facts — rather than
replacing it, which is why this PR's change is a prop and not a fork.

**`minutesFor` floors, and that is a product decision.** Rounding up would tell a student with
₪23 at ₪12 a block that they have 10 minutes when they have 5 and cannot extend. Floor, and
let the below-opening-block state say the honest thing.
