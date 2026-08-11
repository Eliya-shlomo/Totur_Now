# PR 1.6 — Guest surface: public endpoints + landing + pricing

| | |
|---|---|
| **Epic** | E1 — Auth & Users (parallel filler, pulled from E10.1–10.2) |
| **Owner** | DEV-A |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 0.5, 0.7 |
| **Blocks** | nothing |
| **Branch** | `dev-a/E1.6-guest-surface` |

## Contract implemented

`GET /public/topics` and `GET /public/pricing` from `MVP.md` §12, and the `/` and
`/pricing` routes from §14.1. Pulled forward from `MVP.md` §18/E10.1–10.2.

## Scope

**Why this PR is in E1 at all:** while DEV-B writes 1.1, DEV-A has no auth work
available, and 1.1 blocks everything else in the epic. The guest surface needs no
authentication, touches no file any auth PR touches, and `MVP.md` §18/E10 warns
explicitly against deferring this work to the last day. It is also the natural place
for DEV-A's slack if 1.2 finishes before 1.4 does.

**Server.** Two endpoints, no auth, both cacheable. `GET /public/topics` returns the
seeded taxonomy as a nested two-level tree, not a flat list — every later consumer
(the question form, teacher topic selection, admin filters) wants the tree, and
building it once here means nobody rebuilds it three times. `GET /public/pricing`
returns the tiers from `config/constants/money.js` — the constants file is the single
source, so the pricing page can never drift from what the wallet actually charges.

**Client.** The landing page from §1's positioning: the one-line pitch, the
"stuck at 10 PM" problem, how it works in three steps, and two calls to action
(register as a student, teach with us). The pricing page renders the three tiers from
the endpoint, explains blocks (§5.1) and why they exist, and states the commission
plainly.

Static marketing copy, real data for anything numeric. No price is hardcoded in JSX —
it comes from the endpoint, which comes from the constants.

## Files you may touch

```
server/src/routes/public.routes.js
server/src/controllers/public.controller.js
server/src/services/topic.service.js
server/src/repositories/topic.repository.js
server/src/routes/index.js                     one appended line
client/src/pages/guest/Landing.jsx
client/src/pages/guest/Pricing.jsx
client/src/components/guest/**
client/src/api/public.api.js
client/src/router/routes.guest.jsx             swap the placeholders
shared/api.d.ts                                append a clearly-marked public section
```

## Files you must NOT touch

```
server/src/routes/auth.routes.js  server/src/controllers/auth.*  server/src/services/auth.*
server/src/middlewares/**
client/src/stores/**  client/src/api/client.js
client/src/router/index.jsx  client/src/theme.js
prisma/**
```

## Acceptance criteria

- [ ] `GET /public/topics` returns a nested tree: 11 parents with their subtopics, plus topic `0`
- [ ] Both endpoints work with no `Authorization` header
- [ ] Neither endpoint exposes any user data
- [ ] `GET /public/pricing` derives from `config/constants/money.js`; changing the price bounds or bands changes the response with no other edit
- [ ] The pricing page shows no hardcoded number — every price comes from the endpoint
- [ ] The landing page states the pitch, the problem, the three steps, and both CTAs
- [ ] Both pages render inside `GuestLayout` and are correct at 375px
- [ ] Both have loading and error states using 0.6's primitives
- [ ] The CTAs route to `/register` with the role preselected where that makes sense

## Manual test

1. `curl /api/v1/public/topics` with no auth → the full tree.
2. Change `MAX_PRICE_PER_BLOCK` in constants, restart, reload the pricing page → the new number appears. Revert.
3. Both pages at 375px and 1440px.
4. Stop the server, load the pricing page → error state, not a blank page.

## Notes

`topic.service.js` created here is reused by E2 (teacher topic selection) and E3
(classification). Build the tree properly — a single query plus an in-memory group,
not an N+1 — because it becomes a dependency rather than staying a marketing detail.

This PR is genuinely optional to E1's definition of done. If the schedule tightens,
it is the first thing to pause — but note that it is also the only demo-facing screen
in the first two epics.
