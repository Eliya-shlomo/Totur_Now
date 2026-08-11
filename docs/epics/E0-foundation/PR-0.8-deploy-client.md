# PR 0.8 — Deploy client to Vercel

| | |
|---|---|
| **Epic** | E0 — Foundation |
| **Owner** | DEV-A |
| **Size** | S |
| **Written by** | Agent + human (dashboard config is manual) |
| **Depends on** | 0.6 |
| **Blocks** | E11 |
| **Branch** | `dev-a/E0.8-deploy-client` |

## Contract implemented

The client half of the deployment target in `MVP.md` §15.1.

## Scope

Get the placeholder client live on Vercel today, not on day 10. Configure the
project as a monorepo sub-app (root directory `client/`), set the SPA rewrite so
deep links like `/app/session/abc` do not 404 on refresh, and wire
`VITE_API_URL` per environment.

Enable preview deployments on pull requests — a live URL on every PR is the cheapest
review tool available to a two-person team, and it means the other developer can
check a screen without pulling the branch.

## Files you may touch

```
vercel.json                or client/vercel.json
.env.example               root — the client section only, not the server keys
docs/DEPLOYMENT.md         create — the client half
```

There is one `.env` for the whole monorepo, at the repo root (settled in the 0.3
review). `client/.env.example` does not exist, and Vite's `envDir` in
`client/vite.config.js` is what points the client at the root file.

Two consequences for this PR, both of which are easy to get wrong on Vercel:

- Vercel's root directory is `client/`, so `.env` at the repo root is **outside** it.
  Do not rely on the file being deployed — `VITE_API_URL` is set in the Vercel
  dashboard per environment, which the criteria below already require.
- Only `VITE_`-prefixed variables reach the bundle. Do not add the server's keys to
  the Vercel project to "keep them together": the client half of the deployment has
  no use for them, and every one of them would be one prefix rename away from
  shipping to the browser.

## Files you must NOT touch

```
server/**  prisma/**
```

## Acceptance criteria

- [ ] Production URL serves the app
- [ ] A hard refresh on a deep route (`/app/wallet`) loads the app, not a 404
- [ ] `VITE_API_URL` is set for production and preview, and is not committed
- [ ] Opening a PR produces a preview deployment with its own URL
- [x] `docs/DEPLOYMENT.md` records: project settings, root directory, build command,
      the env var list, and where the secrets actually live
- [x] No secret is present in the built bundle — grep `dist/` to confirm

The four unticked boxes all require the Vercel project to exist, and creating it is
the manual half of this PR (the header says so). The committed half is done and
verified: `client/vercel.json`, the `.env.example` note, and `docs/DEPLOYMENT.md`.
Tick them after following `docs/DEPLOYMENT.md` § "One-time project setup".

Two findings from building this, both recorded rather than fixed here:

- `client/src/api/client.js` is imported by nothing yet, so Rollup tree-shakes it and
  axios never enters the bundle. The secret grep therefore passes trivially today.
  The env plumbing was verified directly instead, through Vite's own `loadEnv`: the
  repo-root `.env` resolves from `client/` via `envDir`, and a variable already in the
  environment overrides it — which is the mechanism Vercel's dashboard values use.
  Re-run the grep once E1 imports the axios instance for real.
- Preview origins and CORS do not compose cleanly. See the hand-off note in
  `docs/DEPLOYMENT.md` § "Preview deployments"; it is 0.9's call, not this PR's.

## Manual test

1. Open the production URL on a phone. The shell renders, bottom nav present.
2. Navigate to a deep route, hard refresh. Still there.
3. `grep -ri "sk-\|secret\|password" client/dist/` → nothing.

## Notes

The deployed client will show placeholder pages and cannot reach the server until
0.9 lands. That is fine and expected — the point of deploying now is to find the
deployment problems now.

CORS between the two deployed origins is 0.9's job, not this PR's. Coordinate the
final origin string with DEV-B during the evening sync.
