# PR 1.1 — Auth core: tokens, middlewares, route skeleton

| | |
|---|---|
| **Epic** | E1 — Auth & Users |
| **Owner** | DEV-B |
| **Size** | M |
| **Written by** | **Human — no agent.** `MVP.md` §17.5: auth middleware is security-critical and a subtle bug is silent |
| **Depends on** | 0.3, 0.4 |
| **Blocks** | 1.2, 1.4, 1.5 — **both developers wait on this** |
| **Branch** | `dev-b/E1.1-auth-core` |

## Contract implemented

The token strategy and JWT payload frozen in the [epic README](README.md), plus the
`authenticate` / `authorize(...roles)` middlewares from `MVP.md` §12 and §15.5.

## Scope

Three things, and deliberately nothing else.

**The token service.** Sign and verify access tokens (15 min) and refresh tokens
(7 days), from separate secrets. Helpers to set and clear the refresh cookie with the
right flags per environment — `httpOnly` and `secure` always, `sameSite: 'none'` in
production because the client and server are on different domains, `'lax'` locally.
Getting this wrong is the failure mode called out in the epic README's risk list.

**The middlewares.** `authenticate` reads the `Authorization: Bearer` header, verifies
the access token, and attaches `req.user = { id, role }` — nothing more, and no
database round-trip on every request. `authorize(...roles)` runs after it and throws
`FORBIDDEN` on a role mismatch. Both throw `AppError` with the codes from
`shared/errorCodes.js`; neither ever sends a response itself.

**The route skeleton.** Create `auth.routes.js` with all five endpoints from
`MVP.md` §12 already wired to their controller modules, and create those controller
modules as stubs that throw `NOT_IMPLEMENTED`. This is the move that keeps 1.2 and
1.4 out of each other's way: after this PR **nobody edits `auth.routes.js` again**,
and each later PR fills in files only it owns.

Also register the router in `routes/index.js` and apply the strict rate limiter from
0.4 to `/auth/login` and `/auth/register`.

## Files you may touch

```
server/src/services/auth.token.service.js
server/src/middlewares/authenticate.js
server/src/middlewares/authorize.js
server/src/routes/auth.routes.js               frozen after this PR
server/src/controllers/auth.register.controller.js    stub — DEV-A fills it in 1.2
server/src/controllers/auth.session.controller.js     stub — DEV-B fills it in 1.4
server/src/routes/index.js                     one appended line
server/src/config/constants/auth.js            token TTLs, cookie name, bcrypt rounds
shared/errorCodes.js                           append TOKEN_EXPIRED, TOKEN_INVALID
shared/api.d.ts                                append the E1 section: auth request/response types
```

## Files you must NOT touch

```
server/src/app.js                              frozen in 0.4
server/src/services/auth.register.service.js   DEV-A owns it
server/src/services/auth.session.service.js    DEV-B owns it, but in 1.4
prisma/**  client/**
```

## Acceptance criteria

- [ ] Access and refresh tokens are signed with **separate** secrets, both from env
- [ ] JWT payload is exactly `{ sub, role, iat, exp }`
- [ ] TTLs come from `config/constants/auth.js` — no literal `'15m'` in the service
- [ ] `authenticate` on a missing, malformed, or expired token throws the right
      distinct code (`UNAUTHORIZED` / `TOKEN_INVALID` / `TOKEN_EXPIRED`)
- [ ] `authenticate` performs no database query
- [ ] `authorize('teacher')` on a student's token throws `FORBIDDEN` with a 403
- [ ] Middlewares never call `res` directly — they throw
- [ ] All five auth routes exist and return `NOT_IMPLEMENTED` rather than 404
- [ ] The strict rate limiter is applied to `/auth/login` and `/auth/register`
- [ ] Refresh cookie flags differ correctly between `development` and `production`

## Manual test

1. Sign a token in a REPL, call a temporary protected route with it → passes, `req.user` correct.
2. Tamper one character of the token → `TOKEN_INVALID`, 401.
3. Sign with a 1-second TTL, wait, call → `TOKEN_EXPIRED`, 401. The distinction matters: 1.5's interceptor only refreshes on expiry.
4. Student token against an `authorize('teacher')` route → 403 `FORBIDDEN`.
5. `curl` each of the five auth routes → all return `NOT_IMPLEMENTED`, none 404.
6. 11 rapid login attempts → the 11th is rate-limited.

## Review checklist additions

- No secret has a default value in code. Missing `JWT_SECRET` must fail at boot (0.3's `env.js`).
- Read the middlewares line by line. This is one of the five human-written areas in the project.

## Notes

**Both developers are blocked until this merges.** Keep it to the skeleton. Implementing
login here because "it is right there" re-creates exactly the collision this PR exists
to prevent.

Tell DEV-A the moment it lands.
