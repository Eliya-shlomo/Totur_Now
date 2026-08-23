# E10 — Responsive, Error UX & Polish

| | |
|---|---|
| **Depends on** | E4, E6, E8 — every screen this epic audits was built by one of them. Nothing here waits on an unmerged PR |
| **Blocks** | E11. A demo on two laptops is the first time anybody looks at this product on a phone in front of an audience |
| **Runs alongside** | 6.9, 6a.6 and 6b.4 — all three open, all three docs-only. One shared row, named below |
| **Definition of done** | A phone at 375px walks the product end to end — landing, register, ask, choose, session, rate, wallet, history — and never meets a sideways scroll, a blank screen, or silence where the server stopped answering. |

## The problem this epic has to solve

**Five of `MVP.md` §18's six E10 rows describe code that is already merged, and the sixth
describes an audit nobody has run.** This is the second epic in a row where §18's row
titles are a plan from before the code existed rather than a description of what is
missing — E8 hit it with three rows and this one has five.

That makes the first hazard of E10 the same as E8's: an agent handed §18's list builds a
second landing page beside the one from PR 1.6. The deviations table below is the whole
defence, and every row in it was checked against `main` at `78554ca` before this file was
written.

The second hazard is the opposite of the first. E10 is the only epic in the project whose
allowlists reach into **every** screen four other epics built. A responsive pass is exactly
the shape of change that arrives as a 4,000-line diff nobody can review, and CONVENTIONS'
last rule — never reformat a file you are not otherwise changing — is the line between
this epic and that diff.

### What the audit already found, before a line was written

The 375px sweep is the reason this file says what it says. Fourteen of the twenty-four
routes were measured in a real browser at 375×812 before the briefs were split:

    document.documentElement.scrollWidth === clientWidth   // 375 === 375

on `/`, `/teachers`, `/pricing`, `/login`, `/register`, `/nope-404`, `/app`, `/app/ask`,
`/app/wallet`, `/app/history`, `/teach`, `/teach/earnings`, `/teach/profile`,
`/teach/onboarding` — **no route overflowed, and no element's right edge crossed 375px on
any of them.**

That is a useful negative result and it re-shapes the epic. §18's 10.3 is written as if
the mobile pass were a hunt for broken layouts; it is not. `AppLayout` has driven the
`< 768px` branch of §14.4 since PR 0.5, Mantine's `SimpleGrid cols={{ base: 1, … }}` is
already the idiom in every grid, and the two modals (`IncomingOfferModal`, `ExtendModal`)
are already full-screen sheets below `sm`. **What has never been checked is the other three
states.** Every one of those measurements was taken on a populated screen with a live
server. Nobody has ever looked at `/app/history` at 375px while it is loading, or
`/teach/earnings` at 375px when the request fails.

So the mobile pass is a **four-state pass**, and the ten routes not in the list above are
the ones that need a live session to reach at all.

### `ErrorBoundary` catches the throw and takes the shell down with it

`App.jsx` mounts one boundary and it wraps `RouterProvider`. A render-time throw in
`Wallet.jsx` therefore unmounts the header, the sidebar, the bottom nav and the route
itself, and replaces all of it with a centred card whose only control is **Back to start**
— a full `window.location.assign('/')`.

That is the correct behaviour for a throw in the shell and the wrong behaviour for a throw
in a screen. The user loses their place, their nav, and any idea which part of the product
broke. **10.3 adds a second boundary inside the shell**, around the `Outlet`, so a screen
that throws is a screen-sized hole in a working application. The outer one stays: it is
what catches a throw in `AppLayout` itself, and something has to.

### A logged-in user who mistypes a URL is shown the guest site

`routes.guest.jsx` ends in a `*` catch-all and `router/index.jsx` puts the guest array
last, so `/app/nonsense` resolves to `NotFound` **inside `GuestLayout`**. Checked in the
browser while logged in as a teacher: guest header with **Log in** and **Sign up**, no
sidebar, no bottom nav, guest footer, and a button back to `/`.

It reads fine and it is the wrong product. Three area arrays gain a catch-all of their own
in 10.3 — one entry per file, and `router/index.jsx` stays frozen. The defect has been
there since PR 0.5 and survived five epics, because each of them tested the routes it added
rather than the route nobody adds.

### The socket is visible on exactly one screen

`hooks/useSessionState.js` tracks `connected`, re-joins the room on reconnect and re-reads
the session — 6.8's work, and it is right. `SessionRoom.jsx` renders it as a five-word
marker beside the timer.

**Nowhere else in the product knows the socket exists.** The case §18's row 10.6 was
written for is the teacher sitting on `/teach` with `status: 'ONLINE'`, a dead socket and a
green availability toggle: they receive no `offer:new`, they are told nothing, and from
their side the platform simply has no students tonight. Meanwhile the server's atomic lock
hands the offer to them and it expires unanswered against `OFFER_TTL_SECONDS`, which costs
a real student sixty seconds.

`lib/socket.js` already reconnects — Socket.IO's own backoff, plus the `TOKEN_EXPIRED`
refresh path 5.7 wrote. §18's row says "banner + auto-reconnect" and **only the banner is
missing.**

### There is not one `Skeleton` in the client, and there is not going to be one

§18's row 10.5 says "loading skeletons". `grep -rn Skeleton client/src` returns nothing,
and E10 leaves it that way. The reason is in the contract freeze below rather than here,
because it is a decision the next person is allowed to reverse and they should find it
where the rules are.

### One component is rendered by four screens, one of which is §14.2's

`components/teacher/TeacherCard.jsx` is rendered by:

| Screen | Route | Through |
|---|---|---|
| Guest teacher list | `/teachers` | directly |
| **Teacher selection** | `/app/ask/:id/teachers` | `components/match/MatchCard.jsx` |
| Awaiting response | `/app/session/:id` in `OFFER_SENT` | `pages/student/AwaitingResponse.jsx` |
| The teacher's own profile preview | `/teach/profile` | directly |

`MVP.md` §14.2 calls the second of those "the screen that determines whether the product
works" and says it is worth more investment than any other. **A responsive tweak to
`TeacherCard` changes it, silently, from a brief that was talking about the guest list.**
Every brief in this epic that touches that file says so, and the pass in 10.6 renders all
four.

`components/offer/OfferCountdown.jsx` has the same shape at smaller stakes — two screens,
`IncomingOfferModal` and `AwaitingResponse`.

## The split

| | DEV-A (eliya) | DEV-B (rotem) |
|---|---|---|
| **Slice** | **All of E10.** The audit §18 asked for, the two things it found missing, and the two decisions it asked somebody to write down | — |
| **Server** | **None, and that is the epic's scope boundary.** See below | — |
| **Client** | Guest polish, the state contract, the error surface, the connection banner, the four-state pass on twenty-four routes | — |
| **Filler** | 10.1 and 10.4 are off the chain — either can be written on a day the audit is blocked | — |

Single-developer epic, the fifth in a row. The template's "both developers ship server and
client work" cannot be satisfied here and is not being fudged: **E10 has no server work at
all.** Every row of §18's E10 is a rendering decision, `MVP.md` §17.6 assigns "responsive,
error UX" to the client track by name, and the handoff's §6 makes opening
`server/src/services/` the signal to stop and ask.

**The two exceptions that would justify a server change, from the handoff, and neither has
been triggered so far:** a screen needing a field the API does not return, and an error
message that is unreadable because the server wrote it that way. If either turns up, it is
a PR against that endpoint's own epic and it gets its own acceptance criteria — not a
widened E10 brief.

## Order

| # | PR | Owner | Size | Depends on | Status |
|---|---|---|---|---|---|
| 10.1 | [The guest surface, judged rather than built — and the online-only ruling](PR-10.1-guest-surface.md) | DEV-A | S | — | ☑ |
| 10.2 | [The four-state contract, and the async views that are missing one](PR-10.2-state-contract.md) | DEV-A | M | — | ☑ |
| 10.3 | [A screen-sized hole instead of a blank shell — the second boundary, and the 404 in the wrong shell](PR-10.3-error-ux.md) | DEV-A | M | — | ☑ |
| 10.4 | [The teacher who cannot hear the server — a global connection banner](PR-10.4-connection-banner.md) | DEV-A | S | 10.3 (shares `AppLayout.jsx`) | ☐ |
| 10.5 | [The mobile pass — twenty-four routes, four states, one phone](PR-10.5-mobile-pass.md) | DEV-A | L | 10.1, 10.2, 10.3, 10.4 | ☐ |
| 10.6 | [E10 close: the screen inventory, and the retro](PR-10.6-e10-close.md) | DEV-A | S | 10.1–10.5 | ☐ |

Status: ☐ not started · ◐ partial · ☑ done. Size: S (<2h) · M (2–4h) · L (half day+).

**10.5 is last among the build PRs and that ordering is load-bearing.** The banner adds
chrome to every authenticated screen and the state contract adds a component to a dozen of
them; a 375px audit run before those land audits a product that is about to change. E8 made
the same call for the same reason — 8.2 before 8.1, so the measurement contains one change
rather than two.

**10.6 edits no code.** A close PR that edits code is a defect wearing a close PR's branch
name — E7's ruling, E8's ruling, and this epic's. `git diff --stat` on that branch shows
`docs/` only.

## Parallelism map

```
  6.9  ─┐
  6a.6 ─┼─ docs/README.md epic index ┈┈┈┈┈┈┈┈┈ one row, named below
  6b.4 ─┘                            ┊
                                     ┊
  E10  10.1  guest surface ──────────┊──┐    ← off the chain. Reads no shared component
                                     ┊  │      except TeacherCard, which it must not change
       10.2  state contract ─────────┊──┤    ← off the chain. Touches a dozen screens shallowly
                                     ┊  │
       10.3  error UX  ──┐           ┊  │
                         │ AppLayout ┊  │      ← the one file two PRs share, in this order
       10.4  banner   ───┘           ┊  │
                                     ┊  │
       10.5  the mobile pass ────────┴──┴──── 10.6  close: the inventory + retro
```

**Two real arrows.** `AppLayout.jsx` is opened by 10.3 (the boundary around `Outlet`) and
then by 10.4 (the banner above it); they are adjacent lines in one file and the second
rebases if the first is not merged. And 10.5 measures what the other four produced, so it
is genuinely last rather than conventionally last.

**10.1 and 10.2 are the filler.** Both are independent of everything, both are visible
work, and either is the thing to write on an afternoon when the audit is waiting on a live
session to reach `/app/session/:id`.

### Collision with 6.9, 6a.6 and 6b.4

All three are open, all three are DEV-A's, all three are docs-only — the same standing
situation E8 documented and resolved.

| File | Their claim | E10's claim | Rule |
|---|---|---|---|
| `docs/README.md` | the epic index, various rows | 10.6 adds and sets the E10 row | Different rows of one table. Whoever lands second rebases — E7's ruling, unchanged |
| `docs/OWNERSHIP.md` | 6a.6's `media.service.js` row | 10.6 adds the rows for whatever E10 creates, if it creates anything | Different rows, same table |
| `docs/DEPLOYMENT.md` | 6b.4's two variables and the proxy | **nothing** | No overlap, and see the risk about the deployed path |
| `client/**`, `server/**`, `prisma/**` | all three deny it outright | every code file in E10 | **Uncontested.** Checked against their allowlists |

## Contract freeze

**E10 adds no endpoint, no socket event and no column**, so there is nothing to freeze in
`shared/api.d.ts` — the file is not opened in this epic. What needs freezing instead is the
set of *client* rules five PRs are about to apply to twenty-four screens, because a rule
applied differently on screen eleven is the thing this epic exists to remove.

Changing anything below is a chat message before the code.

### 1. Four states, three components, and no fourth one

Every async view renders exactly one of these, from `components/state/`:

| State | Component | Rule |
|---|---|---|
| loading | `LoadingState` | `minHeight` set to roughly the height of the content it stands in for, so the layout does not jump when data arrives |
| error | `ErrorState` | **`onRetry` is required wherever a retry is possible**, and a retry is possible whenever the failure was a `GET`. An `ErrorState` with no way out is a dead end with a nicer icon |
| empty | `EmptyState` | Required on every list. `actionLabel` + `onAction` wherever the user can do something about it |
| populated | the screen | — |

A screen may not render its own `<Center><Loader/></Center>`. That is what these three exist
to prevent and it is a review item, not a preference.

**No `Skeleton` component is added, and `LoadingState` is declared sufficient.** The
reasoning, written down because §18 asked for skeletons and this is a deviation:

- A skeleton is a **second copy of a layout**, and it drifts. Every list in this product
  renders a component whose height varies with its content — a `TeacherCard` with or without
  a 💙 badge, a `HistoryRow` with or without an unfinished rating, a `LedgerList` row with or
  without a session link. A skeleton for those is a guess that goes stale the first time
  somebody adds a line to the real card, and nothing in the test suite would notice.
- The measurable thing a skeleton buys over a spinner is **avoided layout shift**, and
  `LoadingState`'s `minHeight` buys exactly that without the second copy. It is already a
  prop and already documented on the component; what is missing is that most call sites take
  the 200px default regardless of what they are standing in for. **10.2 fixes the call
  sites, not the component.**
- The thing skeletons are genuinely better at — a page-shaped shell that fills in
  progressively — needs per-region loading states, and every screen in this product loads in
  one request.

If a later epic wants skeletons it should reverse this deliberately, add **one**
`ListSkeleton` with a fixed row height, and use it only where the row height is genuinely
fixed. It should not add nineteen bespoke ones.

### 2. What a banner is allowed to render

`components/system/ConnectionBanner.jsx`, mounted once, in `AppLayout`, above the `Outlet`.

- **Authenticated shells only.** `GuestLayout` and `AuthLayout` do not mount it. A guest has
  no socket — `lib/socket.js` connects on `status === 'authenticated'` and on nothing else —
  so a banner there would be a warning about a connection the visitor never had.
- **One line, one state, no controls.** It renders when the socket is disconnected and
  disappears when it reconnects. **No "Retry" button**: Socket.IO's backoff is already
  retrying and a button that races it can only make the reconnect slower or the user's
  belief about it wrong.
- **It does not block, dim, or move the page.** It occupies layout space above the `Outlet`
  rather than floating over content, because a fixed overlay at 375px eats a quarter of the
  viewport on the one device this epic is about.
- **It is not a toast.** `lib/notify.js` is for the outcome of an action the user took;
  disconnection is a condition, conditions persist, and an unclosable toast is a banner that
  covers the screen.
- **`SessionRoom`'s inline "Reconnecting…" marker stays.** 6.8 wrote it deliberately with a
  reason on the file — the countdown keeps telling the truth while the warning and the
  extension will not arrive — and that is a statement about the meter which a global banner
  cannot make. Two indicators for one condition is a real cost and it is listed as a risk;
  the banner's wording is chosen so the pair does not read as a contradiction.

### 3. Where a breakpoint lives

`client/src/theme.js` is **frozen** (OWNERSHIP §2, since PR 0.5) and it already holds every
number this epic needs: `theme.breakpoints` for the five widths and `theme.other.layout` for
`headerHeight`, `sidebarWidth`, `bottomNavHeight`.

- Prefer Mantine's own props — `visibleFrom`, `hiddenFrom`, `cols={{ base, sm, md }}`,
  `p={{ base, sm }}`. They read from the theme and cannot drift.
- Where JavaScript genuinely needs the boundary, it is
  ``useMediaQuery(`(max-width: ${theme.breakpoints.sm})`)`` off `useMantineTheme()`, which is
  the idiom `AppLayout` already uses.
- **A literal `48em`, `768px` or `375px` in a component is a failed review.** There is
  exactly one in the client today — `components/question/ImagePicker.jsx:40`,
  `const CAMERA_BREAKPOINT = '(max-width: 48em)'` — and 10.5 removes it. It is the precise
  failure the freeze on `theme.js` exists to prevent, and it survived four epics because
  nobody was looking at breakpoints as a set.
- **Nothing is added to `theme.js`.** If a value seems to need a home there, it belongs in
  the component, and if it belongs in more than one component the answer is one component.

### 4. Which error goes where

The seam is already built and this epic applies it rather than changing it.

| Situation | Surface | Notes |
|---|---|---|
| A `GET` failed and the screen has nothing to show | `ErrorState` with `onRetry` | `error.message` is always safe to render — `api/client.js`'s interceptor guarantees it |
| An action failed and the screen still has content | `notify.apiError(error)` | Errors do not auto-close; the user may need to read them |
| A `VALIDATION_ERROR` names a field the form owns | `form.setErrors(error.details)`, under the field | The server's `fieldErrors.js` produces `{ field: sentence }` — a sentence written for a human, per §15.3 |
| A `VALIDATION_ERROR` names a field the form does not own | `notify.apiError` | A control the user cannot see cannot carry an error |
| A render threw | the nearest `ErrorBoundary` | 10.3 makes "nearest" mean the screen rather than the whole application |

**No screen reaches into `error.response`.** `api/client.js` unwraps the envelope and
rejects with an `ApiError`; a screen that digs past it is a failed review, and E10 does not
find any that do.

## Deliberate deviations from `MVP.md` §18

| §18 said | We do | Why |
|---|---|---|
| **Owner: A** | DEV-A, unchanged | Single developer since 2026-08-23; the DEV-A/DEV-B split in the older epic docs is historical (OWNERSHIP §0) |
| 10.1 Landing page + pricing page (guest), **M**, Agent | **Already merged**, PR 1.6. 10.1 judges them against §14.1 and 375px instead | Both routed in `routes.guest.jsx` since 1.6, both measured at 375px with no overflow before this file was written. Building them again would be the failure this table exists to prevent |
| 10.2 Public online-teachers list, **S**, Agent | **Already merged** — the list is 2.5's, the reviews on the profile are 8.3's. What E10 owns is the **`onlineOnly` default**, and it stays `false` | See "the online-only ruling" in [10.1](PR-10.1-guest-surface.md). §18 says "online-teachers list"; a guest who opens the page at 23:40 and is shown an empty list learns nothing about the product, and every seeded teacher is `OFFLINE` |
| 10.3 Mobile pass — bottom nav, 375px audit on every screen, **L** | Bottom nav exists (PR 0.5). The audit is **the epic**, and it is a four-state audit rather than a layout hunt | Fourteen of twenty-four routes measured clean at 375px before the briefs were split. What has never been looked at is loading, error and empty at that width |
| 10.4 Global error UX — toasts, `ErrorBoundary`, inline field errors, **M** | Toasts exist (`lib/notify.js`, four shapes). The boundary exists and is **one, around the whole router** — 10.3 adds the second. **Inline field errors are already right on every form**, and 10.3's audit says so with the table rather than inventing a defect | The real error-UX defect is elsewhere: a logged-in user who mistypes a URL under `/app`, `/teach` or `/admin` is shown the **guest** shell, because only `routes.guest.jsx` has a catch-all. Found in the browser, fixed in [10.3](PR-10.3-error-ux.md) |
| 10.5 Empty states + **loading skeletons** across all lists, **M**, Agent | The three state components exist and are used by nineteen files. **No skeleton is added**; `LoadingState`'s `minHeight` is the answer and the call sites are what 10.2 fixes | Contract freeze §1. A skeleton is a second copy of a layout that drifts, and every list here has a variable-height row |
| 10.6 Socket disconnect banner + **auto-reconnect**, **S** | The banner is new. **Auto-reconnect already exists twice** — Socket.IO's backoff and `useSessionState`'s re-join-and-refetch (6.8) — and E10 adds neither | Writing a third reconnect path would be the `PARENT_TOPIC_WEIGHT`-in-two-places problem in a place where the two copies would fight over one socket |
| Six PRs | Six PRs, five of them different work | This table is the mapping |
| §14.1's `/admin/sessions` | Three admin routes render `Placeholder` and **E10 does not build them** | They are E9's. 10.5 audits what they render *today* — a `Placeholder` is a real screen at 375px and it either fits or it does not — and 10.6's inventory marks them ⏳ with what is behind them |
| §14.4's tablet and desktop rows | **375px only.** The 768–1024 and >1024 rows are not audited | §18's acceptance criterion names one width and the definition of done above names the same one. Auditing three widths is three passes; claiming to have done it after one is worse than saying so. 10.6's retro records this as the first thing the pass did not cover |

## Risks

- **`TeacherCard` is rendered by four screens and one of them is §14.2's.** A responsive fix
  made while looking at the guest list changes the teacher selection screen, which `MVP.md`
  calls the screen that decides whether the product works, and changes `AwaitingResponse`,
  which is a screen with sixty seconds on a clock. Every brief that opens that file names all
  four; 10.6's pass renders all four.
- **The four-state audit needs states that a seeded database will not produce.** An empty
  state on `/teach/earnings` is easy — Dana K. has no earnings and it renders correctly
  today. An **error** state at 375px is not: it needs the request to fail. The pass forces it
  by blocking the request in the browser rather than by breaking the server, and 10.5's brief
  says exactly how, because "I could not reproduce the error state" is how an epic ships
  twenty-four ✅s that mean nothing.
- **Ten of the twenty-four routes need a live session to reach.** `/app/ask/:id/matching`,
  `/app/ask/:id/teachers`, `/app/session/:id` in five distinct states, `/app/session/:id/review`
  and `/teach/session/:id` are all behind a real question, a real offer and a real accept —
  two browsers, two roles, one classifier. E6a exists because that classifier has been down
  for an entire verification pass before. The audit reaches them by walking the flow, not by
  typing a URL, and the retro records any it could not.
- **The database is not at seed state and this pass must not reset it.** E8's close left six
  questions, two sessions, two reviews and their ledger rows behind, and `npm run db:seed`
  upserts rather than deletes. `prisma migrate reset` would destroy the evidence E8's retro
  cites and it is the operator's call, not an agent's. E10 is a rendering pass: it should
  need no clean baseline, and any step that seems to need one is a step to re-think.
- **`server/.env` holds production Neon credentials and `NODE_ENV=production`.** Anything
  loading `dotenv/config` from inside `server/` reaches the cloud database rather than
  `localhost:5433`. E8's close pass hit this and read from Neon before noticing. This is E8
  RETRO's **F5**, still open, and E10 has no reason to run anything from that directory at
  all — which is the safest possible relationship to it.
- **Two indicators for one condition, on the session screen.** The global banner and 6.8's
  inline "Reconnecting…" marker both appear when the socket drops on `/app/session/:id`. The
  contract freeze keeps both and says why; the risk is that a later reader deletes one
  without reading the other's reason. Both files get a comment naming the other.
- **A responsive pass is the epic where a stray Prettier run buries the diff.** `docs/` is in
  `.prettierignore` and the client is not. Twenty-four screens times one reformat is a diff
  no review survives, and CONVENTIONS names it: never reformat a file you are not otherwise
  changing. Every brief in this epic has a denylist and the review checklist re-checks the
  diff size.
- **Nothing in E10 fixes E8's open findings, and one of them is on a screen E10 renders.**
  F1 (`newTeacherBoost` cancels 8.2's smoothing), F2, F3 and F4 each need their own PR with
  its own measurement. `MatchCard` renders the numbers F1 is about; **10.5 may not "fix the
  ordering while it is in there."**
- **`6b.4` is open and the deployed offer path is still broken.** E10 is local-first work and
  is not blocked by it, but no document in this epic may claim the deployed product works.
  The pass runs against `localhost:5173` and the retro says so.
- **`ErrorBoundary` does not catch what most failures are.** It catches render-time throws
  and not event handlers, async callbacks or rejected promises — its own header says so. An
  epic called "global error UX" that ships a second boundary and calls the error surface done
  would have improved the rarest failure in the product. The `ErrorState` / `notify.apiError`
  half of the freeze is the half that runs every day.

---

## Checklist before writing the PR briefs

- [x] Every PR names exactly one owner — DEV-A, all six
- [x] No two in-flight PRs edit the same file — **`AppLayout.jsx` is the one exception**, opened by 10.3 then 10.4, named here and in both briefs. `TeacherCard.jsx` is read by 10.1 and 10.5 and **changed by neither without the other's rows in the pass**
- [x] Any shared file is either frozen, append-only, or split by domain — `theme.js` and `router/index.jsx` frozen and unopened; `shared/api.d.ts` not opened at all; `docs/README.md` is one row
- [x] Human-written items from `MVP.md` §17.5 are marked as such — **there are none.** §17.5 names `wallet.service.js`, the three critical transactions, `prisma/schema/`, auth middleware and the LLM prompts; E10 opens no server file, so all five are out of reach by construction rather than by promise
- [x] Each PR has an allowlist and a denylist
- [x] Each PR has acceptance criteria a human can check in under five minutes
- [x] Both developers have server and client work — **not satisfiable and not fudged.** Single-developer epic with zero server work; §17.6 assigns responsive and error UX to the client track by name, and the scope boundary above is what stops it drifting
- [x] There is filler work for whoever finishes first — 10.1 and 10.2 are both off the chain
