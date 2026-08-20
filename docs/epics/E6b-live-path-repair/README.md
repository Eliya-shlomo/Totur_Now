# E6b — Live-Path Repair

| | |
|---|---|
| **Depends on** | E6 (merged through 6.9) |
| **Blocks** | nothing — E7 does not wait for it |
| **Runs alongside** | E6a. See "Collision with E6a" below: two of the three defects touch no file E6a names |
| **Definition of done** | On the deployed application, in a normal browser and in a private window: a teacher sitting on `/teach/profile` sees the offer modal, a student who accepts stays signed in for the length of the session, and both participants see each other on camera. |

## The problem this epic has to solve

Three defects observed on the deployed application on 2026-08-20, between 09:04 and
09:16 local, in one end-to-end run. None of them is a regression — each one has been
true since the PR that introduced the surface, and all three were invisible to
`npm test` for the same reason: every one of them is a property of the *deployment*,
not of the code's logic.

| # | Symptom | Cause | Since |
|---|---|---|---|
| 1 | Teacher does not get the offer unless they are on `/teach` | The `offer:new` listener is mounted by `pages/teacher/Dashboard.jsx`, one route deep | PR 5.7 |
| 2 | Student is signed out mid-session | The refresh cookie is third-party and the browser drops it | PR 0.8 / 1.4 |
| 3 | "No video on this session", every session | `DAILY_API_KEY` is not declared in `render.yaml`, so production has no key | PR 6.1 |

They arrived together in one run because they compound: the video failure is why the
lesson had nothing but a clock, and the sign-out is what produced
`"Participant left a live session" … "reason":"client namespace disconnect"` on the
teacher's screen as `Avi Levi lost their connection`. Two of the three lines the run
logged are one defect wearing another's clothes.

### 1. The offer only arrives on one screen

`lib/socket.js` is correct and says so at length: one connection per tab, owned by the
auth store, "app-wide, not teacher-only", precisely so that "a teacher who navigates
away from that screen would stop hearing offers" cannot happen. The connection does
stay up. The *listener* does not — `useSocketEvent(SOCKET_EVENTS.OFFER_NEW, …)` is
called in `pages/teacher/Dashboard.jsx:91`, and `useSocketEvent` detaches on unmount by
design. A teacher on `/teach/profile` or `/teach/earnings` has a live socket receiving
`offer:new` frames that nothing is listening for.

The observed screenshot is the exact shape of it: header reads **Offer pending**, the
lock in 5.3 is held, the student's countdown is at 0:33, and the teacher is looking at
their profile page with nothing on it. 5.7's own header comment describes this failure
for the reload case and fixed it there — the server re-emits on handshake — and the
navigate-away case was never separated from it. A replay on handshake cannot help when
the socket never dropped.

**The fix is a mount point, not a mechanism.** The listener, the one-offer-at-a-time
rule and the modal move up to `layouts/TeacherLayout.jsx`, which is mounted for every
`/teach/*` route. Nothing about the socket, the payload, the countdown or the
accept/reject calls changes.

### 2. The refresh cookie is third-party, and this is not only an incognito problem

`auth.token.service.js:157-160` sets `tn_refresh` with `httpOnly`, `secure: true`,
`sameSite: 'none'`, and the comment above it reasons the choice out correctly: Vercel
and Render are different registrable domains, the refresh request is cross-site, and
`'none'` is the only value the browser will attach.

`SameSite=None; Secure` is necessary and it is not sufficient. It makes the cookie
*eligible* to be sent cross-site; it does not stop the browser from refusing to store
or send third-party cookies at all. And that refusal is the default in:

- Chrome and Edge **incognito / InPrivate** — where this was observed
- **Safari**, always, since ITP — every iOS user, on a product whose §4.1 student is
  holding a phone
- **Firefox**, Total Cookie Protection, since 2022
- Brave, and any browser with tracking protection turned up

So the access token expires at fifteen minutes, `refresh()` sends a request with no
cookie, the server answers `401`, `onAuthLost` does a full page load to `/login`, and
the student is on the login screen with a session running and a meter charging. The
9:04 login and the 9:16 login screen in the observed run are twelve minutes apart, and
the token's TTL is `ACCESS_TOKEN_TTL = '15m'`.

**The fix is to stop being third-party.** The browser's rule is about *sites*, not
origins, so nothing the server sends can opt out of it. Two ways to become first-party,
and 6b.2 takes the first:

| | What it needs | Cost |
|---|---|---|
| **Proxy the API through the client's own origin** — `/api/*` on the Vercel deployment rewritten to the Render service | `client/vercel.json`, one `VITE_API_URL` change | none, ships today |
| **One registrable domain** — `app.example.com` + `api.example.com`, `sameSite: 'lax'` | a purchased domain, DNS, two service configs | a domain, and the right answer eventually |

The socket keeps going direct to the Render origin. Vercel's rewrites do not carry a
WebSocket upgrade, and the socket does not need the cookie — `lib/socket.js` presents
the access token in the handshake `auth` callback, which is why this split works at all.

### 3. Production has never had a Daily key

The log line is exact:

```
{"level":"error","message":"Video is not available right now.","code":"EXTERNAL_SERVICE_ERROR"}
```

That sentence has exactly two producers, and both are reached by the same road.
`video.daily.service.js:27` is `videoNotConfigured()` — thrown when `env.DAILY_API_KEY`
is falsy, before a socket is opened. `session.video.service.js:153` is 6.4's repair
path giving up after `attachSessionVideo` failed for that reason.

`env.js:80` has `DAILY_API_KEY: z.string().optional()`, so the server boots happily
without it. `render.yaml` declares `CLOUDINARY_*`, `GEMINI_API_KEY`, `RESEND_API_KEY`,
and `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` — three variables for
the provider PR 6.0 migrated *away* from — and no `DAILY_API_KEY` at all. The key is in
the local `.env`, which is why the failure has never been seen in development.

The degradation chain is working exactly as designed, which is why nothing looked
broken: 6.3 accepts the offer anyway rather than 500ing on a video outage, 6.4 tries to
repair on first join, 6.7 renders "No video on this session" and keeps the clock
running. Every layer did its job. There was simply never a key, and no layer's job is to
say so.

**The fix is one `render.yaml` entry and one startup assertion.** The assertion is the
part worth arguing for: a paid product whose main surface is a video call should not
start in production silently missing the credential for it. E6a's README makes the same
argument one layer up — the classifier "never threw, never returned null, never blocked
matching … also never classified anything, and nothing anywhere said so."

## Collision with E6a

The question this epic was created to answer. Checked file by file against E6a's
shared-files table and every PR allowlist.

| E6b PR | Files | E6a claims them? |
|---|---|---|
| 6b.1 video key | `render.yaml`, `.env.example`, `server/src/config/env.js`, `server/src/config/video.js` | **No.** E6a touches no deployment config and no `video.*` file |
| 6b.2 first-party session | `client/vercel.json`, `client/src/api/client.js`, `server/src/app.js` (CORS), `server/src/services/auth.token.service.js` | **No.** E6a touches no auth file and no client transport |
| 6b.3 offer anywhere | `client/src/layouts/TeacherLayout.jsx`, new `client/src/components/offer/OfferHost.jsx`, `client/src/pages/teacher/Dashboard.jsx` | **One file.** `pages/teacher/**` is on 6a.5's allowlist. `layouts/` and the new file are not, and `IncomingOfferModal.jsx` is **not edited** by this PR — only mounted somewhere else |

**Verdict: 6b.1 and 6b.2 are disjoint and start immediately, in parallel with E6a.**

**6b.3 overlaps 6a.5 in `Dashboard.jsx` and in nothing else.** The stated rule is to
defer a colliding PR until E6a closes, and the schedule below records that as the
default. The cheaper option, and the recommendation: **land 6b.3 before 6a.1 starts.**
E6a is at zero PRs merged and 6a.5 is five deep in its chain. A change that lands on
`main` today is not a collision for a branch that has not been cut — it is just the
`main` 6a.5 starts from. Deferring buys nothing and costs a teacher every offer that
arrives while they are on the wrong tab, for the length of an epic.

## The split

| | DEV-A (eliya) | DEV-B (rotem) |
|---|---|---|
| **Slice** | The two defects E6a cannot touch — deployment and the session that will not stay signed in | E6a, unchanged. Picks up 6b.3 when its own chain allows, or takes it first if the recommendation above is accepted |
| **Server** | 6b.1 `render.yaml` + the startup assertion; 6b.2 CORS and the cookie's `sameSite` under a proxied origin | — |
| **Client** | 6b.2 `VITE_API_URL` and the Vercel rewrite | 6b.3 the offer host in `TeacherLayout` |
| **Filler** | 6b.4's verification walk | — |

This is not the usual two-developer feature split; it is a three-bug repair scheduled
around a single-developer epic already in flight. The column that matters is the one
that keeps DEV-B's E6a chain uninterrupted.

## Order

| # | PR | Owner | Size | Depends on | Status |
|---|---|---|---|---|---|
| 6b.1 | [Give production the video key, and refuse to start quietly without it](PR-6b.1-daily-key-production.md) | DEV-A | S | E6 | ☐ |
| 6b.2 | [First-party session: proxy the API, keep the cookie](PR-6b.2-first-party-session.md) | DEV-A | M | E6 | ☐ |
| 6b.3 | [The offer reaches the teacher wherever they are](PR-6b.3-offer-anywhere.md) | DEV-B | S | E6 · **schedule vs 6a.5** | ☐ |
| 6b.4 | [E6b close: the three-defect walk, on the deployed app](PR-6b.4-e6b-close.md) | DEV-A | S | 6b.1, 6b.2, 6b.3 | ☐ |

Status: ☐ not started · ◐ partial · ☑ done. Size: S (<2h) · M (2–4h) · L (half day+).

## Parallelism map

```
  E6a  6a.1 ─ 6a.2 ─ 6a.3 ─┐
         └──── 6a.4 ─ 6a.5 ─┴─ 6a.6        (DEV-B, untouched)
                       ▲
                       │ only overlap: Dashboard.jsx
                       │
  E6b  6b.3  offer host ┘   ← land BEFORE 6a.1, or after 6a.6

       6b.1  daily key      ─┐              (DEV-A, no overlap, start now)
       6b.2  first-party     ─┼─ 6b.4  close
                              ┘
```

## Contract freeze

No contract changes. No new endpoint, no new socket event, no schema change, no column.
Every payload in this epic already exists and is already correct — `offer:new` carries
what the modal needs, `GET /sessions/:id/video` returns what `VideoRoom.jsx` reads, and
`POST /auth/refresh` works whenever the cookie reaches it. Three defects, and not one of
them is a missing contract.

The one thing that is frozen and must be stated: **`shared/api.d.ts` is not opened by
this epic.** E6a appends to it in 6a.4. Two epics appending to one contract file is the
merge nobody wants for a bug fix that needs no contract at all.

## Deliberate deviations from `MVP.md` §18

| §18 said | We do | Why |
|---|---|---|
| E7 follows E6, then E6a | E6b runs beside E6a | §18 planned features, not the deployment. These three make the E6 that §19's 8/17 checkpoint calls "a full session end to end" untrue on the deployed application, whatever the test suite says |
| §15.5 freezes the token strategy: access token in memory, refresh in an `httpOnly` cookie | Unchanged — the *transport* moves, the strategy does not | The strategy is right. It was deployed across two sites, which is the one arrangement in which a browser is allowed to throw the cookie away |
| §17.4's review is the quality gate | Plus a deployed-application walk in 6b.4 | All three defects pass every unit test in the repo. Two of them are `render.yaml` and `vercel.json` — files no test imports |

## Risks

- **The proxy hides a CORS bug rather than fixing it.** Once `/api` is same-origin,
  `CORS_ORIGINS` stops being exercised by the browser, and a later direct call would
  fail in a way nothing catches. 6b.2 keeps the Render origin working directly and says
  so in a test, rather than letting the proxy become load-bearing by accident.
- **Vercel rewrites do not upgrade WebSockets.** The socket must keep pointing at the
  Render origin. `socketOrigin()` derives it from `VITE_API_URL`, which 6b.2 changes —
  so the socket's origin has to be given its own variable in the same PR or the socket
  silently tries to connect to Vercel. This is the one way 6b.2 can break something that
  currently works.
- **The startup assertion can take production down.** A hard exit on a missing
  `DAILY_API_KEY` turns a degraded video call into a dead API. 6b.1 asserts at boot in
  production only, logs at `error`, and the epic's own bar is that it must be impossible
  to *not notice* — not that it must be impossible to run.
- **Third-party cookies may already be blocked for the teacher too.** The observed run
  caught the student because the student's window was incognito. Nothing makes the
  teacher's browser different. 6b.2 fixes both, and 6b.4 verifies both, in a private
  window on purpose.
- **`Dashboard.jsx` is the one file two epics want.** Named here so it is a scheduling
  decision made once, in writing, rather than a merge conflict discovered by whoever
  rebases second.

---

## Checklist before writing the PR briefs

- [x] Every PR names exactly one owner
- [x] No two in-flight PRs edit the same file — within E6b, disjoint; across epics, the single `Dashboard.jsx` overlap is named and scheduled
- [x] Any shared file is either frozen, append-only, or split by domain — `shared/api.d.ts` is frozen for this epic
- [x] Human-written items from `MVP.md` §17.5 are marked as such — none; no prompt prose and no money in this epic
- [x] Each PR has an allowlist and a denylist
- [x] Each PR has acceptance criteria a human can check in under five minutes
- [x] Both developers have server and client work — DEV-A has both in 6b.1/6b.2; DEV-B's 6b.3 is client-only because the server side of offer delivery is already correct
- [x] There is filler work for whoever finishes first — 6b.4's walk
