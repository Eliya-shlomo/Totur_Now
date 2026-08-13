# E1 — Auth & Users

| | |
|---|---|
| **Depends on** | E0 (0.2, 0.3, 0.4, 0.6 merged) |
| **Blocks** | E2, E3, E7 — effectively everything |
| **Definition of done** | A student registers, logs in, refreshes the page and stays logged in. A student hitting `/teach` is redirected. A wallet exists for every registered user. |

## The problem this epic has to solve

E1 is small — five endpoints and two screens — but it is on the critical path and it
is **tightly coupled**. Both developers writing "auth" at once means both editing
`auth.service.js`, `auth.controller.js`, and `auth.routes.js` on the same afternoon.
That is the conflict the whole `docs/` structure exists to prevent.

Three moves fix it:

**1. One blocking PR lays the skeleton.** PR 1.1 creates the route file with all five
endpoints already wired, pointing at stub controller modules. After 1.1, nobody edits
`auth.routes.js` again — each later PR fills in its own controller and service files.

**2. Auth is split by *flow*, not by layer.** Registration is one vertical (server
endpoint + transaction + screen). The session flow — login, refresh, logout, me,
token storage, route protection — is the other. Each developer owns a complete flow,
server through client.

**3. Every file has a suffix.** `auth.register.service.js` and
`auth.session.service.js`, not one `auth.service.js`. Slightly more files, zero
conflicts. Worth it.

## The split

| | DEV-A | DEV-B |
|---|---|---|
| **Flow** | Registration | Session (login / refresh / logout / me) |
| **Server** | `POST /auth/register`, wallet + profile transaction | token service, auth middlewares, the other four endpoints |
| **Client** | both auth screens | `authStore`, `ProtectedRoute`, axios refresh |
| **Filler** | guest surface (pulled from E10) | auth hardening + E2E |

DEV-A owns **both** auth screens even though DEV-B owns the store behind them. Login
and register share a layout, a form style, and a submit pattern; splitting them
across two people creates conflict for no benefit, whereas the store and the screens
touch entirely different files.

## Order

| # | PR | Owner | Size | Depends on | Status |
|---|---|---|---|---|---|
| 1.1 | [Auth core: tokens, middlewares, route skeleton](PR-1.1-auth-core.md) | DEV-B · **human** | M | 0.3, 0.4 | ☑ |
| 1.2 | [`POST /auth/register` + wallet + profile transaction](PR-1.2-register-endpoint.md) | DEV-A | M | 1.1, 0.2 | ☑ |
| 1.3 | [Auth screens: login + register with role selection](PR-1.3-auth-screens.md) | DEV-A | M | 1.5 | ☑ |
| 1.4 | [`login` / `refresh` / `logout` / `me`](PR-1.4-session-endpoints.md) | DEV-B · **human** | M | 1.1 | ☑ |
| 1.5 | [`authStore`, `ProtectedRoute`, axios 401 refresh](PR-1.5-auth-client-core.md) | DEV-B | M | 1.1, 0.6 | ☑ |
| 1.6 | [Guest surface: public endpoints + landing + pricing](PR-1.6-guest-surface.md) | DEV-A | M | 0.5, 0.7 | ☑ |
| 1.7 | [Auth hardening + end-to-end verification](PR-1.7-auth-hardening.md) | DEV-B | S | 1.2–1.5 | ☑ |

## Parallelism map

```
                    ┌─ 1.5 ─────────────┬─ 1.4 ──┐         (B)
1.1 (B, blocking) ──┤                   │        ├─ 1.7 (B)
                    └─ 1.2 ─── 1.3 ─────┘        │         (A)
                                                 │
1.6 (A) ── runs in parallel from the start ──────┘
```

**1.6 exists so DEV-A is never blocked.** While DEV-B writes 1.1, DEV-A has no auth
work available — the guest surface (`GET /public/topics`, `GET /public/pricing`, the
landing and pricing pages) needs no authentication, touches no file any auth PR
touches, and is pulled forward from `MVP.md` §18/E10.1–10.2. If DEV-A finishes 1.2
before DEV-B finishes 1.4, 1.6 is where the slack goes.

## Contract freeze

These are agreed **before** 1.2 and 1.4 start, so the two flows cannot disagree:

**Token strategy.** Access token: JWT, 15 minutes, returned in the response body,
held in memory by `authStore` — never in `localStorage`. Refresh token: 7 days,
`httpOnly` + `secure` + `sameSite` cookie, never readable by JavaScript. Per
`MVP.md` §15.5.

**JWT payload.** `{ sub: userId, role, iat, exp }`. Nothing else — no email, no name.
The payload is not a profile cache.

**Register response.** `201` with `{ user, accessToken }` and the refresh cookie set,
so registration logs the user straight in. Register and login therefore return the
**same shape**, which means one client-side handler for both.

**`GET /auth/me` response.** `{ id, email, fullName, role, avatarUrl }` plus the
role-specific profile object (`studentProfile` or `teacherProfile`) and, for
students, `walletBalance`. This is the single source of the client's user object.

**Role is chosen at registration** and is immutable afterwards. There is no
role-switching in the MVP.

Any change to the four blocks above is a chat message to the other developer before
the code changes, not after.

## Deliberate deviations from `MVP.md` §18/E1

| MVP said | We do | Why |
|---|---|---|
| B does all server auth, A does all client auth | Split by flow, both full-stack | The whole point of this restructure |
| 1.6 "wallet auto-created on registration" as its own PR | Folded into 1.2 | It must be in the same transaction as user creation, so it cannot be a separate PR without being wrong |
| E10.1–10.2 in the final week | Pulled into E1 as 1.6 | Keeps DEV-A unblocked, and `MVP.md` §18/E10 warns explicitly not to defer polish |

## Risks

- **1.1 slipping blocks both developers.** Keep it to the skeleton — tokens,
  middlewares, stubs. Any temptation to also implement login belongs in 1.4.
- **The refresh-cookie flow across two origins.** Vercel and Render are different
  domains, so the refresh cookie needs `sameSite: 'none'` + `secure` in production
  and behaves differently in local development. Test it against the *deployed* pair
  before declaring 1.5 done — this fails in production and works locally, every time.
- **Divergent user shapes.** 1.2 and 1.4 both return a user object. If they differ by
  one field, the client gets a bug that looks like a caching problem. The contract
  freeze above is the mitigation; 1.7 is the check.
