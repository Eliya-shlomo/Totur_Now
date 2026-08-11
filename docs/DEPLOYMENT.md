# Deployment

Both halves of the deployment are live from E0 on purpose (`MVP.md` §18/E0.7). After
this, shipping is `git push` — everything below happens on its own.

| Half | Platform | PR | Owner |
|---|---|---|---|
| Client | Vercel | 0.8 | DEV-A |
| Server + database | Render + Neon | 0.9 | DEV-B |

```
        browser
           │
           ▼
  ┌──────────────────┐        CORS         ┌──────────────────┐        ┌─────────┐
  │ Vercel           │ ──────────────────► │ Render           │ ─────► │  Neon   │
  │ client/ (static) │   VITE_API_URL      │ server/ (node)   │        │ Postgres│
  └──────────────────┘                     └──────────────────┘        └─────────┘
     PR 0.8                                   PR 0.9
```

The two are deployed independently and neither blocks the other. A client deploy
cannot break the API, and an API outage shows up as an error state in the client
rather than a blank page — that is what `ErrorBoundary` and the state primitives
from 0.6 are for.

---

## Client → Vercel

### One-time project setup

Vercel's dashboard is the source of truth for everything except the routing and
caching rules, which live in [`client/vercel.json`](../client/vercel.json) so they
are reviewed like code instead of clicked into a form nobody can diff.

1. vercel.com → **Add New… → Project** → import `Eliya-shlomo/Totur_Now`.
2. Set the fields below, then **Deploy**.

| Setting | Value | Why |
|---|---|---|
| Root Directory | `client` | The repo is an npm workspace monorepo; the deployable app is one workspace. |
| Framework Preset | Vite | Vercel infers the rest from it. Already pinned in `vercel.json`. |
| Build Command | *(leave default)* | `vercel.json` sets `npm run build`. |
| Output Directory | *(leave default)* | `vercel.json` sets `dist`. |
| Install Command | *(leave default)* | See "the workspace catch" below. |
| Node.js Version | 24.x | Matches `.nvmrc` and `engines.node`. Vercel does not read `.nvmrc` — set it here. |
| Include files outside the Root Directory | **on** | Also see below. This one is not optional. |

### The workspace catch

Root Directory is `client/`, but two things the client build needs live *above* it:

- **`@tutor/shared`** is a real workspace package, symlinked into `node_modules` by
  the root `package-lock.json`. Resolving it means installing from the repo root.
- **`envDir`** in `client/vite.config.js` points at the repo root, so Vite looks
  one level up for `.env`.

Vercel handles the first automatically — it detects the root lockfile's `workspaces`
field, installs there, and then runs the build inside `client/`. It handles the
second only when **Include files outside the Root Directory in the Build Step** is
enabled. If a build fails with `Cannot find package '@tutor/shared'`, that setting
is the first thing to check.

There is no `.env` at the repo root on Vercel — it is gitignored and never uploaded.
Vite falls back to reading `VITE_`-prefixed variables straight out of the build
environment, which is exactly what the dashboard variables below are.

### Install failures

**`sh: line 1: husky: command not found` → `Command "npm install" exited with 127`**

npm runs the root `prepare` script after every install, and `prepare` was `husky`.
Husky is a devDependency and a git hook manager — the binary is not present in
Vercel's install, and there is no `.git` there to install hooks into. A failing
`prepare` aborts the whole install, so the deploy dies before the build starts.

The script is now `husky || true`, which is what husky's own docs give for CI. Hooks
still install locally, where husky is present and the exit code is zero.

**`vite: command not found`, or a missing devDependency during the build step**

Different problem, same root: devDependencies were omitted. The build genuinely needs
them — `vite` is one. Set `NPM_CONFIG_INCLUDE=dev` as a project environment variable,
or override Install Command to `npm ci --include=dev`.

### Environment variables

Project → Settings → Environment Variables. Set **per environment** — Production and
Preview get different values, because a preview build pointing at the production API
would let an unreviewed branch write to real data.

| Variable | Production | Preview | Source |
|---|---|---|---|
| `VITE_API_URL` | `https://<render-url>/api/v1` | the Render URL, or a scratch instance | PR 0.9 produces the Render URL |

That is the whole list, and it is the whole list on purpose. Only `VITE_`-prefixed
variables reach the bundle, and everything with that prefix is readable by anyone who
opens devtools. **Do not add the server's keys to this project** to keep them in one
place — `DATABASE_URL`, the JWT secrets, Cloudinary, Anthropic, Zoom and Resend belong
to the Render service and nowhere else. One prefix rename is all that separates a key
in this list from a key in the browser.

Include `/api/v1` in the value. `client/src/api/client.js` appends only the route, so
`api.get('/health')` becomes `<VITE_API_URL>/health`.

Changing a variable does **not** rebuild. Vite inlines these at build time, so the old
value stays in the deployed bundle until the next deploy — redeploy after editing one.

### The SPA rewrite

`vercel.json` rewrites every path to `/index.html`:

```json
{ "source": "/(.*)", "destination": "/index.html" }
```

Without it, a hard refresh on `/app/wallet` asks Vercel for a file at that path,
finds none, and returns a 404 — the route only exists inside React Router, which
never got the chance to load. The rewrite hands every URL to the app and lets the
router decide, including the 404 page from 0.5.

It does not swallow the assets: Vercel checks the filesystem *before* applying
rewrites, so `/assets/index-*.js` is served as the file it is. That ordering is also
why the two `headers` blocks are safe — hashed asset filenames change on every build,
so they cache for a year, while `index.html` must never be cached or a returning
visitor keeps loading the previous build's asset names.

### Preview deployments

On by default once the project is imported. Every pull request gets its own URL, which
for a two-person team is the cheapest review tool available — the other developer
checks a screen without pulling the branch.

Two URL shapes per deployment. The one worth bookmarking is the branch alias, which
survives new commits:

```
https://<project>-git-<branch>-<scope>.vercel.app     stable per branch
https://<project>-<hash>-<scope>.vercel.app           unique per deployment
```

> **Hand-off to PR 0.9.** The server's CORS whitelist is an exact-match list read from
> `CORS_ORIGINS` (`server/src/config/env.js` splits it on commas — no wildcards). The
> production origin is one string and is easy. Preview origins are not: the branch
> alias contains the branch name, so every new branch is a new origin. Give DEV-B the
> production origin now; how far to go on previews is 0.9's call, and the honest
> options are to whitelist branch aliases as they come up, or to point previews at a
> scratch API. Do not solve it by loosening the whitelist to a regex on `.vercel.app`
> — anyone can deploy a project on that domain.

### Rolling back

Deployments → find the last good one → **⋯ → Promote to Production**. It is instant:
the build already exists, so promotion only moves the alias. Reverting the commit and
pushing works too, but costs a build.

### Logs

Deployments → a deployment → **Building** for build output, **Runtime Logs** for
requests. A static site produces little of the latter; a white screen in production is
almost always a browser console error, not a Vercel one. Check devtools first.

### Verifying a deploy

1. Open the production URL on a phone. Shell renders, bottom nav present.
2. Navigate to `/app/wallet`, hard refresh. Still there, not a 404.
3. `npm run build -w client && grep -ri "sk-\|secret\|password" client/dist/` → nothing.

---

## Server → Render + Neon

> **PR 0.9, DEV-B.** Not yet written. This section covers the Render service, the Neon
> project and its scratch branch, migrations on deploy, running the seed against
> production on demand, connecting to the production database, reading logs, rolling
> back, and the free-tier cold start (~50 s on the first request after idle — warm the
> service before a demo).
>
> Append below this line; do not restructure the client half above.
