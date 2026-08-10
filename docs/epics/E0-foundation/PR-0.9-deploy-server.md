# PR 0.9 — Deploy server to Render + Neon, `.env.example`

| | |
|---|---|
| **Epic** | E0 — Foundation |
| **Owner** | DEV-B |
| **Size** | M |
| **Written by** | Agent + human (dashboard config is manual) |
| **Depends on** | 0.4 |
| **Blocks** | E11 |
| **Branch** | `dev-b/E0.9-deploy-server` |

## Contract implemented

The server half of the deployment target in `MVP.md` §15.1, and the `.env.example`
required by §17.2.

## Scope

Neon Postgres 16 (one production branch, and a second branch usable as a scratch
database), Render web service pointed at `server/`, migrations applied on deploy,
CORS whitelisting the Vercel origin from 0.8.

`.env.example` is a deliverable, not an afterthought: it lists **every** variable the
project will need across all eleven epics — database, JWT secrets, Cloudinary, Zoom,
Anthropic, Resend, CORS origins — with a comment per variable saying where to obtain
it. Agents guess env var names otherwise, and `MVP.md` §17.2 calls this out
specifically.

Two Render gotchas worth handling now rather than at 2 AM on 8/19: the free tier
spins down after inactivity, so the first request after idle takes ~50 seconds
(note it in the deployment doc and warm the service before the demo); and Render
sends SIGTERM on every deploy, which 0.4's graceful shutdown already handles.

## Files you may touch

```
render.yaml                or Render dashboard config, documented
.env.example               root — the full list
server/package.json        start / build / postinstall scripts only
docs/DEPLOYMENT.md         append the server half (DEV-A created it in 0.8)
```

## Files you must NOT touch

```
client/**
server/src/**              app config is already correct from 0.3 / 0.4
prisma/schema/**
```

## Acceptance criteria

- [ ] `GET https://<render-url>/health` returns 200 with `db: 'ok'`
- [ ] Migrations run automatically on deploy; a fresh deploy against an empty Neon branch works
- [ ] The seed can be run against production on demand (documented command, not automatic)
- [ ] CORS accepts the Vercel production and preview origins, and rejects others
- [ ] `.env.example` lists every variable for all eleven epics with a sourcing comment each
- [ ] No real secret is committed anywhere
- [ ] `docs/DEPLOYMENT.md` covers: how to deploy, how to roll back, how to read logs,
      how to connect to the production database, and the cold-start warning

## Manual test

1. `curl https://<render-url>/health` → `db: 'ok'`.
2. From the deployed client's origin, call `/health` in the browser console → no CORS error.
3. From another origin → CORS rejection.
4. Push a commit → Render redeploys, health recovers without manual steps.
5. Wait out the idle spin-down, then request → slow but successful. Confirms the behavior is understood, not broken.

## Notes

This is the PR that most reliably gets deferred and most reliably hurts. `MVP.md`
§18/E0.7 says it outright: do it now, not on day 10. Everything after this deploys
by pushing to `main`.
