# PR 1.5 — `authStore`, `ProtectedRoute`, axios 401 refresh

| | |
|---|---|
| **Epic** | E1 — Auth & Users |
| **Owner** | DEV-B |
| **Size** | M |
| **Written by** | Agent (human reviews the refresh queue) |
| **Depends on** | 1.1, 0.6 |
| **Blocks** | 1.3, and every protected screen in every later epic |
| **Branch** | `dev-b/E1.5-auth-client-core` |

## Contract implemented

`MVP.md` §16 — "State Management: Zustand `authStore`" — and the client half of the
token strategy frozen in the [epic README](README.md).

## Scope

Client-side auth state. DEV-B owns this even though it is frontend work: it is the
mirror of the session flow DEV-B builds on the server, and the two have to agree
exactly.

**`authStore` (Zustand).** Holds `user`, `accessToken`, `status`
(`'loading' | 'authenticated' | 'anonymous'`), and the actions `login`, `register`,
`logout`, `bootstrap`. The access token lives **in memory only** — not in
`localStorage`, per `MVP.md` §15.5. Persistence across a page refresh comes from the
`httpOnly` refresh cookie, which is the whole reason for the design.

**Bootstrap.** On app mount, `status` starts `'loading'`; call refresh, then `/auth/me`.
Success → `'authenticated'`. Failure → `'anonymous'`. Nothing that depends on auth
renders during `'loading'` — otherwise every refresh flashes the login screen for a
frame, which is the single most common bug in this pattern.

**The axios refresh interceptor.** Fill the seam 0.6 left. On a 401 with
`TOKEN_EXPIRED`, call refresh once and retry the original request. Two hard
requirements: **do not** attempt refresh for a 401 coming from the refresh endpoint
itself (infinite loop), and **queue** concurrent 401s so five parallel requests
trigger one refresh, not five. On refresh failure, log out and redirect to `/login`.

**`ProtectedRoute`.** Takes an optional `role`. `'loading'` renders a spinner;
`'anonymous'` redirects to `/login` **carrying the attempted path** so post-login
lands there; wrong role redirects to that role's home (`/app` or `/teach`). Wire it
into the student, teacher, and admin route arrays.

## Files you may touch

```
client/src/stores/authStore.js
client/src/api/auth.api.js
client/src/api/client.js                     the refresh seam ONLY — nothing else in this file
client/src/router/ProtectedRoute.jsx
client/src/router/routes.student.jsx         wrap in ProtectedRoute
client/src/router/routes.teacher.jsx         wrap in ProtectedRoute
client/src/router/routes.admin.jsx           wrap in ProtectedRoute
client/src/App.jsx                           call bootstrap on mount
```

## Files you must NOT touch

```
client/src/pages/Login.jsx  client/src/pages/Register.jsx    DEV-A owns both, in 1.3
client/src/router/index.jsx  client/src/theme.js             frozen in 0.5
client/src/components/state/**                               0.6
server/**
```

## Acceptance criteria

- [ ] The access token is never written to `localStorage` or `sessionStorage` — verify in DevTools
- [ ] A page refresh while logged in keeps the user logged in, with no login-screen flash
- [ ] `status` is `'loading'` until bootstrap resolves, and nothing auth-dependent renders before then
- [ ] An expired access token triggers exactly one refresh, and the original request is retried transparently
- [ ] Five simultaneous requests hitting 401 trigger **one** refresh, not five
- [ ] A 401 from the refresh endpoint does not trigger another refresh
- [ ] Failed refresh → store cleared, redirect to `/login`
- [ ] An anonymous user hitting `/app/wallet` lands on `/login`, and after logging in lands on `/app/wallet`
- [ ] A student hitting `/teach` is redirected to `/app` — the epic's stated acceptance criterion
- [ ] `logout` clears the store, calls the endpoint, and redirects

## Manual test

1. Log in, refresh the page five times. Still logged in, no flash, every time.
2. In DevTools, confirm no token in either storage; confirm the refresh cookie is `HttpOnly`.
3. Shorten the access TTL to 10 seconds server-side, wait, click around → seamless, and the network tab shows one refresh.
4. Open a page firing several parallel requests with an expired token → one refresh call in the network tab.
5. Delete the refresh cookie, click something → redirected to `/login`.
6. Log in as a student, navigate to `/teach` → redirected to `/app`.
7. **Run 1–6 again against the deployed Vercel + Render pair**, not just locally.

## Review checklist additions

- Read the refresh queue carefully. The single-refresh guarantee is the part that
  breaks under real conditions and looks fine in a code review.
- Confirm `client.js` was touched **only** in the seam. The rest of the file is DEV-A's.

## Notes

Step 7 is not optional. Vercel and Render are different domains, so the refresh
cookie needs `sameSite: 'none'` + `secure` in production and behaves differently
locally. This is the epic's stated top risk and it fails in exactly one place: the
first time you try it in production.
