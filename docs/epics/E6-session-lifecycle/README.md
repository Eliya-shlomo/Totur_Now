# E6 — Session Lifecycle & Video

| | |
|---|---|
| **Depends on** | E5, fully — 5.1–5.11 merged, including the two defect fixes. Nothing in E6 starts until an offer can be accepted. |
| **Blocks** | E7 (its top-up and ledger build on the wallet service 6.5 creates), E8 (its reputation surfaces read the aggregates 6.6 first writes), E10, E11 |
| **Definition of done** | A teacher accepts an offer and both people land on the same screen, **see and hear each other inside the page**, and watch one clock. Ten minutes are charged at the start. At T-60s the student is asked to extend; declining ends the session, the rating modal blocks the way out, and the credit that left the student's wallet arrives in the teacher's minus the platform's cut. |

## The problem this epic has to solve

Every epic since E3 has ended with the same sentence in a different file: *not here — E6
owns it*. There are now eleven of them, and E6 is where they all come due at once:

| Left for E6 by | What was left |
|---|---|
| `offer.respond.service.js:220` | "create the video room — not here" |
| `session.repository.js:433` | `blocks_used = 0`, `total_charged = 0` on an `ACTIVE` session |
| `sockets/rooms.js` | `session:{sessionId}` — "E6 adds the second function in the PR that emits to it" |
| `shared/socketEvents.js` | four of §13's names, unappended, because nothing emitted them |
| `jobs/index.js` | Block Warning and Session Auto-End — "writing them here would be writing two jobs against a clock that does not tick" |
| `constants/session.js` | `NO_SHOW_WINDOW_SEC` and `AUTO_AWAY_WARNING_MINUTES`, both unread |
| E5 README, gap 11 | a teacher who walks out of an `ACTIVE` session — "recorded here rather than fixed here, because a fix without E6's screen is a state change nobody can see" |
| E5 retro, item 2 | the two-machine lock run and three other deferred checks |
| `routes.student.jsx:31` | `Placeholder title="Rate this session" pr="8.4"` |
| `Session.jsx` | "`ACCEPTED` → E6's placeholder, named honestly. Not a fake session" |
| `MVP.md` §18 | E6 depending on an E7 that does not exist |

**So the risk in E6 is not any one of those. It is that there are eleven.** The naive
plan writes a `session.service.js` that four PRs open, and by 6.7 nobody can say which
PR made the meter start counting from the wrong instant.

**And E6 is genuinely smaller than §18 estimated**, for one reason worth stating before
the plan: the hard part is already written.

## What already exists, on `origin/dev-c/daily-video`

DEV-C's branch has been sitting since E2 and it works. §18 called the video PR "the
highest-risk PR in the project" when the provider was Zoom and Server-to-Server OAuth;
the provider is Daily and the whole integration is about 150 lines of `fetch`. **PR 6.1
imports it. It does not write it.**

The branch is not imported wholesale, and the parts that are dropped matter more than the
parts that are kept:

| File | E6 | Why |
|---|---|---|
| `server/src/config/video.js` | **Keep** | Two TTLs and the API base. Reads its numbers from `env` in 6.1 so they are settable. |
| `server/src/services/video.daily.service.js` | **Keep** | The only file in the server that says `api.daily.co`. One grep must return one file. |
| `server/src/services/video.service.js` | **Keep**, one addition | `createSessionVideo` and `createSessionVideoAccess` are the seam, exactly as `OWNERSHIP.md` §2.1 now names them. |
| `client/src/components/session/VideoRoom.jsx` | **Keep** | Prebuilt iframe, `useCallFrame`, join on mount, three callbacks out. The prop signature is frozen in 6.1. |
| `client/package.json` — `@daily-co/daily-js`, `@daily-co/daily-react`, `jotai` | **Keep** | `jotai` is `daily-react`'s peer dependency, not a state-management decision. §15.1 stays Zustand. |
| `server/src/config/env.js`, `.env.example` — `DAILY_API_KEY` | **Keep** | Already on `main` in `.env.example`; 6.1 adds it to the `env.js` schema and the two TTLs beside it. |
| `server/src/controllers/video.controller.js` | **Drop** | See below. |
| `server/src/routes/video.routes.js` | **Drop** | See below. |
| `client/src/api/videoApi.js` | **Drop** | Calls the two dropped endpoints. Replaced by one function in `session.api.js`. |
| `client/src/pages/video/VideoDemoPage.jsx`, `video-demo-main.jsx`, `video-demo.html` | **Drop** | A second Vite entry point that exists to prove the component works. It did. |
| the branch's edit to `server/src/routes/index.js` | **Drop, hard** | It reformatted the registry — deleted the blank lines between the `use()` calls and reindented a comment. That file is append-only *and never reformatted* (`OWNERSHIP.md` §2), and the branch predates E3, E4 and E5, so taking its version deletes three routers. E6 appends **nothing** to it: there is no `/video` mount. |

### Why the two endpoints are deleted rather than moved

```js
// server/src/routes/video.routes.js — dev-c/daily-video
videoRoutes.use(authenticate, authorize('student', 'teacher'));
videoRoutes.post('/access', asyncHandler(createAccess));   // body: { roomName, userName }
```

`createAccess` mints a Daily meeting token for **whatever `roomName` the body says**. The
only gate is "you are logged in". Any student can mint a token for any room whose name
they have seen, walk into a stranger's lesson, and pick their own display name on the way
in. Nothing in the video layer can fix that, because fixing it means asking the database
who is in that session — and the video layer is forbidden from reading the database, for
good reasons that are not up for renegotiation here.

**So authorisation moves to where the session is.** That is `OWNERSHIP.md` §2.1 rule 3,
rewritten in this epic's planning, and PR 6.4 is the whole of it. It is also the reason
6.4 is a separate PR from 6.3 despite being about fifty lines: it is the one place in E6
where getting the check wrong is a security defect rather than a bug.

## The three seams E5 refused to cross, and how E6 crosses them

E5's README named two and its retro added a third. Each one is now a numbered PR rather
than a comment.

**1. Money.** `wallet.service.js` does not exist, and §17.5 makes it human-written when it
does. §18 wrote E6 as depending on E7 — so **6.5 creates the service**, with three
operations and nothing else: charge a student for a block, credit a teacher's earning,
refund a session. Each is one transaction against `wallets` plus one append to
`wallet_transactions`, and the invariant is §11.3's: *balance equals the sum of that
user's transactions, or there is a bug and one query finds it.* E7 adds top-up, the ledger
endpoint and the wallet screen **on top of** this service. It does not get a second one.

**2. Video.** Handled above. The seam is three named functions and one endpoint.

**3. The rating.** §10 makes `ENDED → RATED` mandatory and E8 is two epics away, so a
session would have no terminal state. **6.6 writes the `reviews` row and the four
aggregates it feeds** — `sessions_count`, `resolved_count`, `rating_sum`, `rating_count` —
and stops there. E8 keeps every screen that reads them.

That third one has a consequence worth predicting: **E4's ranking defect becomes visible
for the first time.** `globalRating` has been computed from seeded aggregates that nothing
has moved in two epics; from 6.6 onward real ratings move them. This does not make the
defect worse and E6 does not fix it — it is E8's, and it is recorded in E4's retro — but a
teacher's position changing after a demo rating is the first evidence anyone will see, and
6.9's retro should say so before somebody files it as an E6 regression.

## The column we did not rename

`teacher_profiles.zoom_personal_link` stays. It is §18's fallback — a static personal room
link — nothing reads it, nothing in E6 will, and renaming an unread column costs a
migration line for zero behaviour. That is the same ruling E5 made about `Offer.status`
staying a `VarChar`, and it is written here so the next person who greps for "zoom" knows
it was a decision.

`sessions.zoom_join_url` and `sessions.zoom_meeting_id` are different: **E6 writes both of
them**, so they carry the wrong name in every line of code from 6.3 on. They are renamed
in 6.0.

## The shared files, named up front

One developer, so this table is for review rather than for conflict — same as E5. The rule
column answers "may a later PR open this?".

| File | Rule | Set by |
|---|---|---|
| `prisma/schema/sessions.prisma` | **6.0 only.** One migration in the epic. If a second becomes necessary it is its own PR and the reason goes in this table. | 6.0 |
| `server/src/services/video.*.service.js` | **DEV-C's, imported in 6.1 and frozen after it.** No `prisma` import, ever. `getSessionVideoContext` is deliberately *not* here — it reads the database, so it is DEV-B's, in `session.video.service.js`. | 6.1 |
| `server/src/config/video.js` | **6.1 only.** The two TTLs move from literals to `env` with defaults. | 6.1 |
| `client/src/components/session/VideoRoom.jsx` | **DEV-C's, imported in 6.1.** The prop signature `{ roomUrl, token, onJoined, onLeft, onError }` is frozen at import so 6.7 can build around it. 6.7 may not edit this file — the screen goes around it. | 6.1 |
| `server/src/routes/session.routes.js` | **Unfrozen once, in 6.2, then frozen again.** Five routes appended in their final shape — `/:id/video`, `/:id/extend`, `/:id/end`, `/:id/report-no-show`, `/:id/review` — every one fully wired against a controller that throws `NOT_IMPLEMENTED`. E5 froze this file at 5.1 and E6 is the only epic that reopens it. A middleware added in 6.5 would be an edit to a frozen file. | 6.2 |
| `server/src/repositories/session.repository.js` | **E5's, and 6.2 appends the epic's whole read/write set at once.** Twelve functions exist already; the state transitions, the block writes and the video-column write are added in one PR and none is added later. This file has three PRs in its `git log` and E5's retro named that as the discipline slipping — E6 adds exactly one more. | 6.2 |
| `server/src/repositories/wallet.repository.js` | **New, and frozen after 6.5.** Balance read with a row lock, balance write, ledger append. Nothing outside `wallet.service.js` imports it. | 6.5 |
| `server/src/services/wallet.service.js` | **New in 6.5. Human-written, no agent — `MVP.md` §17.5.** Three exported functions and no fourth without a line in this table. | 6.5 |
| `server/src/sockets/rooms.js` | **6.2 only.** One appended function, `sessionRoom(sessionId)`, and the header comment predicting it is replaced with the real thing. | 6.2 |
| `server/src/sockets/events.js` | **6.2 only.** Five emitters, all shipped before any is called — the pattern 5.1 set. | 6.2 |
| `server/src/sockets/index.js` / `handlers.session.js` | **6.2.** `session:join` is the epic's one new client → server event and it is the only place a socket joins a second room. Membership is checked against the database before the join, exactly like the endpoint's check — a room name is not a capability. | 6.2 |
| `shared/socketEvents.js` | Append-only, one `E6` block, written once in 6.2. Six names. The E5 block is not edited. | 6.2 |
| `shared/api.d.ts` | Append-only, one `// ── E6` block, written once in 6.2. | 6.2 |
| `shared/errorCodes.js` | **Not touched.** `SESSION_NOT_ACTIVE`, `INSUFFICIENT_CREDIT`, `BUDGET_CAP_REACHED`, `EXTERNAL_SERVICE_ERROR` all exist with the right statuses. E6 is the first thrower of the middle two. | — |
| `server/src/config/constants/session.js` | **Not touched.** Every number E6 needs is already there: `BLOCK_MINUTES`, `OPENING_BLOCKS`, `EXTENSION_BLOCKS`, `WARNING_SECONDS`, `GRACE_SECONDS`, `NO_SHOW_WINDOW_SEC`, `AUTO_AWAY_WARNING_MINUTES`. Three of them get their first reader. | — |
| `server/src/config/constants/money.js` | **Not touched.** `DEFAULT_BUDGET_CAP` and `PLATFORM_FEE_PCT` are there. | — |
| `server/src/utils/commission.js` | **Not touched — reused.** `platformFeeRate({ teacherCreatedAt, at })` is E5's, written pure and database-free precisely so the real charge could split with the same rule the teacher was quoted at offer time. **6.5 imports it. A second implementation of §5.3 is two answers to "what did I earn".** | — |
| `server/src/jobs/` | **6.5 appends two job files and reopens `index.js` and `presence.autoAway.job.js`.** The reopen of the auto-away job is one predicate and one emit, and it is argued in 6.5's description rather than discovered in the diff. | 6.5 |
| `client/src/pages/student/Session.jsx` | **6.7 only.** 5.8 built it as a switch on offer status with E6's branch left as an honest placeholder. 6.7 fills that branch and adds nothing outside it. | 6.7 |
| `client/src/router/routes.student.jsx` | One line, one PR: 6.6 replaces the `session/:id/review` `Placeholder`. Its `pr="8.4"` is corrected in the PR that replaces it — E1's retro rule. | 6.6 |
| `client/src/router/routes.teacher.jsx` | One line, one PR: 6.7 adds the teacher's route to the same session screen. | 6.7 |
| `client/src/api/session.api.js` | Append-only, and every PR from 6.4 on appends to it. Alphabetical, one function per endpoint. | 6.4–6.6 |
| `server/src/routes/index.js` | **Not touched.** `/sessions` is already mounted, and E6 adds no router. The `dev-c` branch's version of this file is not imported. | — |

Services stay suffixed by concern, as they have since E3: `session.activate.service.js`,
`session.video.service.js`, `session.meter.service.js`, `session.end.service.js`,
`session.review.service.js`. **Never one `session.service.js` that five PRs open** — which
is what §18 literally asked for in 6.2, and is the one line of §18 this epic overrules on
sight.

## What E6 inherits from E5, and when

E5 closed with two defects fixed and four checks outstanding. Its retro scheduled them
against E6's opening.

| Item | Where it lands |
|---|---|
| The two-machine lock run against Render | **Before 6.0.** Not a PR — a sitting, with `lock.sh` and a second operator. It is E5's evidence, not E6's feature, and it does not gate 6.0. |
| The deployed read-only half, cold start, Socket.IO transport through Render | Same sitting. The transport result is written into `DEPLOYMENT.md` there. **E6 has a real interest in the answer**: if Socket.IO falls back to long-polling on Render, 6.5's block warning arrives late on the deployed build and the session screen needs to say so. |
| The countdown's killed-network and nothing-sent-at-zero cases | Same sitting. |
| F4 — the header pill updating on a server-side lock | Same sitting; 5.10 has merged, so its prerequisite is met. |
| Gap 11 — a teacher who walks out of an `ACTIVE` session | **6.8.** It needed a screen to be visible on, and 6.7 builds one. |
| `AUTO_AWAY_WARNING_MINUTES`, unread since E0 and orphaned by 5.5 | **6.5.** The blocker was that appending a socket event name is a contract change rather than a job; 6.2 appends the E6 block anyway, so `teacher:away_warning` costs one line in a list that is already being written. |

### F1, F2, F3 — closed without action

Leaf topics, publishing the teacher constants, and nullable `onboarded_at`. Carried
through four epics as filler that never got a number, and E5's README said the quiet part:
*they are either scheduled into E6 with numbers or they are dead letters.*

**They are dead letters.** None of them is on E6's path, E6 has no filler slot to hide them
in — one developer is never blocked by another — and carrying them a fifth time is how a
backlog stops meaning anything. If one becomes necessary it gets a number in the epic that
needs it.

## Before anything starts

Unchanged from E5, plus one:

1. `npm run db:up` — Postgres 16 on host port **5433**
2. `DATABASE_URL` in the repo-root `.env` points at that container
3. `npm run db:migrate && npm run db:seed`
4. **A Daily account and a `DAILY_API_KEY` in `.env`.** Free tier, one key, dashboard →
   Developers → API keys. Without it every PR from 6.3 on still runs — that degradation is
   deliberate and 6.8 tests it — but nobody sees a camera.
5. The two-browser rule from E5 still holds: two *sessions*, not two tabs. A second tab
   shares `localStorage` and is therefore the same person. **And from 6.3 on it is also two
   sets of camera permissions**, so the second browser must be one you are willing to grant
   them in.

## Order

| # | PR | Size | Depends on | Status |
|---|---|---|---|---|
| 6.0 | [Migration: `zoom_*` → `video_room_name` / `video_room_url`](PR-6.0-video-columns-migration.md) | S | E5 | ☑ |
| 6.1 | [Import the Daily video layer — `video.service`, `VideoRoom.jsx`](PR-6.1-daily-video-import.md) | S | — | ☐ |
| 6.2 | [**Session state machine: transition rules, frozen routes, the E6 contract**](PR-6.2-session-state-machine.md) | **human** · L | 6.0 | ☐ |
| 6.3 | [Session activation + `createSessionVideo` persistence](PR-6.3-session-start.md) | M | 6.1, 6.2 | ☐ |
| 6.4 | [`getSessionVideoContext` + `GET /sessions/:id/video`](PR-6.4-session-video-endpoint.md) | S | 6.3 | ☐ |
| 6.5 | [**Wallet service, opening charge, extend, and the meter crons**](PR-6.5-billing-and-meter.md) | **human** · L | 6.3 | ☐ |
| 6.6 | [**Termination, no-show refund, rating → `RATED`**](PR-6.6-end-and-rating.md) | **human** · M | 6.5 | ☐ |
| 6.7 | [The session room — one screen, both roles, the call embedded](PR-6.7-session-room-ui.md) | L | 6.4, 6.5, 6.6 | ☐ |
| 6.8 | [Error-state hardening and the end-to-end lifecycle tests](PR-6.8-error-hardening-e2e.md) | M | 6.7 | ☐ |
| 6.9 | [E6 close: verification + retro](PR-6.9-e6-close.md) | **human** · S | 6.2–6.8 | ☐ |

**Three PRs are human-written and all three are money.** §17.5 names `wallet.service.js`
explicitly; 6.6 moves credit in three directions including a refund; 6.2 is the state
machine that decides when either is allowed to run, and a transition table with a missing
guard is how a session gets charged twice. 6.9 is human because a verification pass written
by the thing being verified is not a verification pass — five epics running.

**6.1 does not depend on 6.0** and is the one place in this epic where two things could
genuinely be done in either order. It is placed second because 6.3 needs both and because
a migration at the head of an epic is easier to re-run than one in the middle.

## Parallelism map

```
   6.0  migration ──┐
                    ├──► 6.2  STATE MACHINE ──┬──► 6.3 activation + room ──┬──► 6.4 video endpoint ──┐
   6.1  video       ┘         (human, L)      │            (M)             │          (S)           │
        import ─────────────────────────────────────────────┘              │                        │
          (S)                                                              │                        ├──► 6.7 ──► 6.8 ──► 6.9
                                                                           └──► 6.5 billing + meter ─┤    UI      hard-   close
                                                                                    (human, L)       │            ening
                                                                                        │            │
                                                                                        └──► 6.6 ────┘
                                                                                          end + rating
                                                                                            (human, M)

   One developer, so this is an order and not a schedule. It is drawn because the
   *joins* matter: 6.7 cannot start until all three server tracks have landed, and
   6.4 and 6.5 are genuinely independent of each other — if 6.5 stalls on the money,
   6.4 still merges and the call still works with a static timer.
```

## Contract freeze

Appended to `shared/api.d.ts` in 6.2 as one `E6` block. Changing any of it afterwards is a
note in the PR **before** the code.

```ts
// ── E6 ──────────────────────────────────────────────────────────────────────

/** `sessions.status`. Mirrors the Prisma enum; §10's diagram is the source. */
export type SessionStatus =
  | 'PENDING' | 'OFFER_SENT' | 'ACTIVE' | 'ENDED' | 'RATED' | 'CANCELLED' | 'NO_SHOW';

/** `sessions.end_reason`. Set on every transition into `ENDED` or `NO_SHOW`. */
export type SessionEndReason =
  | 'student_ended' | 'no_extension' | 'no_credit' | 'budget_cap'
  | 'teacher_no_show' | 'error';

/**
 * What `GET /sessions/:id` answers with once the session is `ACTIVE` or past it,
 * and what the session screen renders for **both** roles.
 *
 * One shape, two fillings. `role` tells the client which it got, and the fields the
 * other side may not see are `null` rather than absent — a missing key and a null
 * are indistinguishable to a renderer, and E5 already made the opposite call for
 * `offer:accepted`'s room URL, where the key is omitted entirely. The difference is
 * that there the absence was permanent and here it is per-caller.
 *
 * **`endsAt` is the only clock.** Absolute, server-issued, ISO 8601 UTC, recomputed
 * from on every tick. E5's countdown proved the pattern under a backgrounded tab and
 * a reload at second 30; this one is the same pattern with money behind it.
 */
export interface SessionState {
  sessionId: string;
  status: SessionStatus;
  role: 'student' | 'teacher';

  /** The other person. Never yourself. */
  counterpart: { userId: string; fullName: string; avatarUrl: string | null };

  brief: string;
  topicLabel: string | null;
  level: number | null;

  pricePerBlock: number;
  blocksUsed: number;
  totalCharged: number;
  budgetCap: number;

  /** Student only; `null` for the teacher. */
  balance: number | null;
  /** Teacher only; `null` for the student. Net of §5.3's commission. */
  teacherEarning: number | null;

  startedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  endReason: SessionEndReason | null;

  /** Whether a room exists. The URL and the token come from the video endpoint. */
  hasVideo: boolean;
  /** `true` once a review exists. The screen may not be left while this is false. */
  isRated: boolean;
}

/**
 * `GET /sessions/:id/video` — the seam, and the only way a client learns either value.
 *
 * **Minted per call and never cached server-side.** A token names one user and one
 * room and expires in an hour; two people in the same session get two different
 * tokens, and a page reload gets a third. Anything that stored one and handed it out
 * again would be the deleted `/video/access` endpoint wearing a different name.
 */
export interface SessionVideoResponse {
  roomUrl: string;
  token: string;
  /** ISO 8601, UTC. The token's expiry, not the session's. */
  expiresAt: string;
}

/** `POST /sessions/:id/extend` — one block. No body. */
export interface ExtendResponse {
  blocksUsed: number;
  endsAt: string;
  totalCharged: number;
  balance: number;
}

/** `POST /sessions/:id/review`. `stars` and `comment` are optional; `isResolved` is the KPI. */
export interface ReviewRequest {
  isResolved: boolean;
  stars?: number;
  comment?: string;
}
```

### The socket contract

Appended to `shared/socketEvents.js` in 6.2. Six names, and with them §13's catalogue is
complete except `wallet:updated`, which stays E7's because E6 has no wallet screen to
update — the session screen learns its balance from `session:extended`, which it is
already listening to.

```js
  // ── E6, server → client ────────────────────────────────────────────────────
  SESSION_BLOCK_WARNING: 'session:block_warning',
  SESSION_EXTENDED: 'session:extended',
  SESSION_ENDED: 'session:ended',
  /** The other person's last socket went away mid-session. E5 README, gap 11. */
  SESSION_PARTICIPANT_LEFT: 'session:participant_left',
  /** "Still there?" at 55 minutes. §10, and the constant's first reader. */
  TEACHER_AWAY_WARNING: 'teacher:away_warning',

  // ── E6, client → server ────────────────────────────────────────────────────
  SESSION_JOIN: 'session:join',
```

**`session:{sessionId}` is the epic's second room** and the first one that is joined rather
than assigned. That difference is the whole security question in the socket layer:
`user:{userId}` comes from the verified handshake and cannot be wrong, whereas
`session:join` carries an id from the client. **6.2 checks participation against the
database before joining, with the same rule 6.4's endpoint uses, and refuses silently.** A
room name is not a capability.

### The transition table

6.2 implements exactly this and nothing outside it. Every write to `sessions.status` goes
through one function that consults it.

| From | To | Trigger | Owner | Guard |
|---|---|---|---|---|
| `PENDING` | `OFFER_SENT` | student sends an offer | E5 5.3 | teacher lock taken |
| `OFFER_SENT` | `PENDING` | reject, or expiry | E5 5.4 / 5.5 | — |
| `OFFER_SENT` | `ACTIVE` | teacher accepts | **6.3** | offer `PENDING` and unexpired; student can afford the opening block |
| `ACTIVE` | `ENDED` | either side ends, no extension, no credit, budget cap, auto-end | **6.5, 6.6** | `end_reason` set in the same statement |
| `ACTIVE` | `NO_SHOW` | student reports, within `NO_SHOW_WINDOW_SEC` of `started_at` | **6.6** | `blocks_used = 1`; a session that was extended was not a no-show |
| `ENDED` | `RATED` | review written | **6.6** | one review per session — `reviews.session_id` is unique |
| any | `CANCELLED` | — | **nobody** | §12 has no cancel endpoint. The enum value stays unwritten in E6 and that is recorded rather than fixed. |

**`NO_SHOW` is terminal and is not rated.** Rating somebody who never arrived produces a
review row about nothing, and `resolved_count` would take the hit. The refund is the
outcome.

## Deliberate deviations from `MVP.md` §18

| §18 said | We do | Why |
|---|---|---|
| 8 PRs, 6.1–6.8 | 10 — a migration at the head and a closing verification PR at the tail | Five-for-five on the closing PR. The migration is at the head because every PR after it writes those two columns. |
| 6.1 `zoom.service`, L, "highest-risk PR in the project" | Import Daily from `dev-c/daily-video`. **S.** | The code exists and works. §20's risk row is retired in this epic's planning. |
| Depends on E7 | **Does not.** 6.5 creates the three wallet operations a session needs | E7 does not exist and blocking on it blocks the demo's core flow. E7 builds on the service rather than beside it. |
| 6.2 "`session.service` — full state machine" | Same behaviour, **not one file.** Five services suffixed by concern | One file five PRs open is the pattern every epic since E3 has refused, and for the reason E5 wrote down: `git log --oneline -- <file>` is this project's only reviewer. |
| 6.4 extend, 6.5 crons — separate PRs | Both inside 6.5 | They are one mechanism: the cron warns at `ends_at - WARNING_SECONDS` and the endpoint is what the warning asks for. Split, the first half is untestable. |
| 6.7 student screen + 6.8 teacher screen | **One screen, one PR (6.7)**, branching on `role` | §14.3 is one layout. The two roles differ by three fields and one button, and the contract already answers both from one endpoint. Two files would be two timers. |
| Rating is E8's | The **write** is 6.6's; every read stays E8's | §10 makes `ENDED → RATED` mandatory, so without it no session has a terminal state. |
| §13's `wallet:updated` | Not appended | No wallet screen exists. `session:extended` carries the balance to the only screen that shows one. |
| §12's `POST /sessions/:id/extend` implies a body | No body | One block is the only thing an extension can buy — `EXTENSION_BLOCKS`. A quantity in the body is a way to overrun the budget cap in one request. |
| A `/app/session/:id/active` route | **No new route.** 6.7 renders the `ACTIVE` state at `/app/session/:id` | 5.8 built that file as a switch for exactly this, and §14.1 has no such route. |
| Pre-planned filler | None | One developer. F1–F3 are closed above. |

## Risks

- **A charge that runs twice.** The opening block is charged inside the activation
  transaction, and the extension inside its own. If either service is reachable from two
  paths — the endpoint and the cron, say — a retry charges again. The guard is that
  `blocks_used` is the counter and every charge is a conditional update against its current
  value, so the second one matches zero rows. **Not a `SELECT` then an `UPDATE`.** This is
  the same shape as E5's teacher lock, which is the only reason it is written down as
  already-solved rather than as new.

- **Money out with no money in.** 6.5 debits the student; 6.6 credits the teacher at the
  end. Between those two the credit exists nowhere, and a session that ends by crash never
  credits anybody. `wallet_transactions` is the audit: the reconciliation query in §11.3
  must balance after every manual test in this epic, not just at 6.9.

- **The external call inside the transaction.** `createSessionVideo` is `fetch` over the
  public internet. Inside the activation transaction it holds a row lock on the teacher and
  the session for as long as Daily takes to answer — which on a bad day is thirty seconds.
  **After `COMMIT`, always**, with the column write as a second statement. 6.3's review
  checklist has this as its first line.

- **`ends_at` moved by two writers.** The extension endpoint moves it forward; the auto-end
  cron reads it to decide whether to end. A cron that reads a stale value ends a session
  the student just paid to extend. Both go through one repository function, the cron's
  sweep is a conditional update on `ends_at` as it read it, and the emit is after commit.

- **The Daily key is unset on Render today.** Every session from 6.3 on would then activate
  with null room columns. That is the designed degradation and 6.8 tests it explicitly, but
  it is also exactly how a demo fails silently — the session looks fine and there is simply
  no camera. 6.9's checklist confirms the key is set in the Render dashboard before the
  deployed run, and `DEPLOYMENT.md` gets the line.

- **Two participants, one room, `max_participants: 2`.** A student who opens the session on
  a phone and a laptop consumes both slots and locks the teacher out of their own lesson.
  Daily enforces this and the server cannot see it happen; the screen has to say something
  useful when the join is refused, which is 6.7's `onError` callback and 6.8's test.

- **The rating modal is a trap if it can be dismissed.** §10 makes it mandatory and the
  route is `/app/session/:id/review`. If a student can navigate away, the session sits in
  `ENDED` for ever and the teacher's aggregates never move. It blocks; the way out is
  submitting it.

- **Nothing in this epic is reviewed by a second person.** Fifth epic running, and the
  three human-written PRs move real credit. 6.9 is not paperwork.

## Test strategy

Three layers, and the epic's history says which one actually finds things.

**Unit — the arithmetic and the guards.** Everything with a number in it, and nothing that
needs a database:

- `commission.js` is already covered by E5's four cases and is not re-tested.
- The block maths: opening cost is `OPENING_BLOCKS × pricePerBlock`, an extension is
  `EXTENSION_BLOCKS × pricePerBlock`, `ends_at` moves by `EXTENSION_BLOCKS × BLOCK_MINUTES`.
  No literal `2`, `5` or `10` appears in a test either.
- The transition table, as a table-driven test. Every illegal pair returns
  `SESSION_NOT_ACTIVE`; the legal ones are asserted one by one. **This is the test that
  makes 6.2's file worth being its own PR.**
- The budget-cap and affordability predicates, at their boundaries: exactly at the cap,
  one credit under, one over.

**Integration — the transactions, against the real database.** Every one asserts the
ledger, not just the balance:

- Activation: session `ACTIVE`, `blocks_used = 1`, `total_charged = OPENING_BLOCKS ×
  price`, one `SESSION_CHARGE` row, balance down by exactly that, `ends_at` ten minutes out.
- Extension: the same, one block at a time, until the cap refuses.
- End: teacher credited net of the fee, one `TEACHER_EARNING` row, `platform_fee +
  teacher_earning = total_charged`.
- No-show: refund of everything charged, one `REFUND` row, balance back to where it started.
- **The reconciliation query after each**: every wallet's balance equals the sum of its
  transactions.
- Video: `createSessionVideo` stubbed. **No test in this repository calls Daily.** A test
  suite that needs an API key is a suite that fails in CI and gets skipped.

**Manual — where every defect in five epics has actually been found.** Two browsers, two
people, cameras on. The full list is 6.9's, but three of them run the day their PR merges
rather than at the end:

| Run it when | What |
|---|---|
| 6.3 merges | Accept an offer with `DAILY_API_KEY` **unset**. The session must still go `ACTIVE`. |
| 6.5 merges | Watch the meter to T-60s with the tab backgrounded. The warning arrives, the numbers are right, and the charge on extending matches what the modal said. |
| 6.7 merges | Two browsers, two cameras, one room. Then reload one of them at T-30s. |

**What is deliberately not tested automatically.** Daily's API, the prebuilt iframe, camera
permissions, and Socket.IO transport through Render. All four are manual, all four are in
6.9's checklist, and pretending otherwise with a mock would produce four green tests that
prove nothing about the thing that breaks.

---

## Checklist before writing the PR briefs

- [x] Every PR names exactly one owner, and the hat it is wearing
- [x] The shared-file table says, per file, whether a later PR may open it
- [x] Human-written items from `MVP.md` §17.5 are marked — 6.2, 6.5, 6.6, and 6.9's pass
- [x] Each PR has an allowlist and a denylist
- [x] Each PR has acceptance criteria a human can check in under five minutes
- [x] There is a closing verification PR, and it carries E5's four deferred items
- [x] Exactly one migration is planned, and the columns it renames are named
- [x] The `dev-c/daily-video` inventory says keep or drop for every file on the branch
- [x] The three seams E5 refused to cross each have a number
- [x] F1–F3 are closed rather than carried a fifth time
