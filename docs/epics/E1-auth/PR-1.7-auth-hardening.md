# PR 1.7 — Auth hardening + end-to-end verification

| | |
|---|---|
| **Epic** | E1 — Auth & Users |
| **Owner** | DEV-B (with DEV-A for the two-machine test) |
| **Size** | S |
| **Written by** | Human |
| **Depends on** | 1.2, 1.3, 1.4, 1.5 all merged |
| **Blocks** | E2 |
| **Branch** | `dev-b/E1.7-auth-hardening` |

## Contract implemented

The epic's definition of done, verified rather than assumed.

## Scope

The closing PR. Two halves: fix what the four feature PRs left, then prove the epic
actually works against the deployed environment.

**Hardening.** Confirm the strict rate limiter is on `/auth/login` and `/auth/register`
with sane limits and a clear `429` in the standard error shape. Confirm no auth
endpoint logs a password, a hash, or a token. Confirm CORS `credentials: true` and
the exact deployed origin — the refresh cookie does not cross origins without it.
Add the seeded demo users' credentials to `docs/DEPLOYMENT.md` so a demo never stalls
on a forgotten password.

**Verification.** Walk the checklist below on the deployed Vercel + Render pair, both
developers, two machines. Anything that fails is fixed in this PR if it is small, or
filed and fixed before E2 starts if it is not. Do not carry a known auth bug into E2 —
every later epic sits on top of this.

Then write `docs/epics/E1-auth/RETRO.md`: what conflicted, what the file-suffix split
actually bought, and what to change in how E2's briefs are written. E1 is the first
real test of this whole structure; capture what it taught before E2 is planned.

## Files you may touch

```
server/src/routes/auth.routes.js               rate limiter wiring only — otherwise still frozen
server/src/config/constants/auth.js
server/src/app.js                              CORS credentials only, if wrong
docs/DEPLOYMENT.md
docs/epics/E1-auth/RETRO.md                    new
docs/epics/E1-auth/README.md                   tick the status boxes
```

## Files you must NOT touch

```
Any feature file from 1.2–1.6. A bug there is a follow-up PR by that file's owner,
not a drive-by fix here.
```

## The end-to-end checklist

Run on **production**, on two machines.

- [ ] Register a student → lands in `/app`, logged in
- [ ] Register a teacher → lands in `/teach`
- [ ] Duplicate email → clean inline error
- [ ] `role: 'admin'` via `curl` → rejected
- [ ] Log out, log back in → works
- [ ] Refresh the page while logged in → still logged in, no flash
- [ ] Leave the tab open past the access-token TTL, then act → seamless refresh, one refresh call
- [ ] Student hits `/teach` → redirected to `/app`
- [ ] Teacher hits `/app` → redirected to `/teach`
- [ ] Anonymous hits `/app/wallet` → `/login`, and after logging in → `/app/wallet`
- [ ] Wrong password and unknown email → identical responses
- [ ] 11 rapid login attempts → `429` in the standard error shape
- [ ] Every registered user has a wallet row at balance 0
- [ ] No token in `localStorage`; refresh cookie is `HttpOnly`, `Secure`, `SameSite=None`
- [ ] Every seeded demo user can log in
- [ ] Two different users logged in on two machines simultaneously → no cross-talk
- [ ] Server logs contain no password, hash, or token

## Notes

The two-machine step matters more than it looks. Single-machine testing hides cookie
scope and CORS problems completely, and those are exactly the failures that surface
for the first time during a live demo.

Nothing in E2 starts until every box above is ticked.
