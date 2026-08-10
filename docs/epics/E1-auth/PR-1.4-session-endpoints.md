# PR 1.4 — `login` / `refresh` / `logout` / `me`

| | |
|---|---|
| **Epic** | E1 — Auth & Users |
| **Owner** | DEV-B |
| **Size** | M |
| **Written by** | **Human** — session handling is security-critical (`MVP.md` §17.5) |
| **Depends on** | 1.1 |
| **Blocks** | 1.7 |
| **Branch** | `dev-b/E1.4-session-endpoints` |

## Contract implemented

`POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` from
`MVP.md` §12.

## Scope

The other four auth endpoints — the session flow.

**Login.** Verify email and password with `utils/password.js`. On failure return one
generic `UNAUTHORIZED` regardless of whether the email exists; distinguishing the two
is an account-enumeration hole. Compare the password even when the user is not found,
so response timing does not leak existence either. Reject a user with
`is_active = false` (E9 blocks users by flipping it). Respond with `{ user, accessToken }`
plus the refresh cookie — **the same shape 1.2 returns**.

**Refresh.** Read the refresh token from the cookie, verify it against the refresh
secret, and issue a new access token. Rotate the refresh token and re-set the cookie.
An invalid or expired refresh token clears the cookie and returns `UNAUTHORIZED`, so
the client's interceptor has an unambiguous "log out" signal.

**Logout.** Clear the cookie. Idempotent — logging out twice is a 200, not an error.

**`GET /auth/me`.** Behind `authenticate`. Returns the user plus their role-specific
profile, and `walletBalance` for students. This is the shape frozen in the
[epic README](README.md) and it is the client's single source of truth for the
current user, so it must include everything a header or dashboard needs — one round
trip, not three.

## Files you may touch

```
server/src/services/auth.session.service.js
server/src/controllers/auth.session.controller.js      replace the 1.1 stub
server/src/validators/auth.session.schema.js
server/src/repositories/user.repository.js             extend only — DEV-A created it in 1.2
shared/api.d.ts                                        the E1 section only
```

## Files you must NOT touch

```
server/src/routes/auth.routes.js                       frozen in 1.1
server/src/services/auth.register.service.js           DEV-A
server/src/controllers/auth.register.controller.js     DEV-A
prisma/schema/**  client/**
```

## Acceptance criteria

- [ ] Wrong password and unknown email return the **same** generic `UNAUTHORIZED`
- [ ] Response time does not measurably differ between the two cases
- [ ] `is_active = false` cannot log in
- [ ] Login returns `{ user, accessToken }` field-identical to 1.2's register response
- [ ] Refresh issues a new access token **and** rotates the refresh cookie
- [ ] An expired or tampered refresh token clears the cookie and returns 401
- [ ] Logout clears the cookie and is idempotent
- [ ] `GET /auth/me` without a token → 401; with one → the full contract shape
- [ ] `GET /auth/me` for a student includes `walletBalance`; for a teacher, the teacher profile
- [ ] `password_hash` appears in no response, anywhere

## Manual test

1. Log in as a seeded user → 200, cookie set, token works against `/auth/me`.
2. Wrong password, then a nonexistent email → byte-identical error responses.
3. Call refresh with the cookie → new access token, new cookie value.
4. Call refresh with a garbage cookie → 401 and the cookie is cleared in the response.
5. Log out, then call refresh → 401.
6. Block a user in the database (`is_active = false`), attempt login → rejected.
7. Diff the login response against 1.2's register response. They must match.

## Review checklist additions

- The password comparison runs on the not-found path too. Verify it, do not assume it.
- Error messages never say "no such user" or "wrong password" — only "Invalid credentials".
- Refresh rotation actually replaces the cookie; a stale cookie must stop working.

## Notes

`user.repository.js` is created by DEV-A in 1.2 and **extended** here. That is the one
genuinely shared file in this epic. Append your functions at the bottom; do not
reorganize what is there. If 1.2 has not merged yet, wait for it rather than creating
a second repository file — this is a five-minute wait, not a fork.
