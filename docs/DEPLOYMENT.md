# Deployment

Both halves of the deployment are live from E0 on purpose (`MVP.md` §18/E0.7). After
this, shipping is `git push` — everything below happens on its own.

| Half | Platform | PR | Owner | Live URL |
|---|---|---|---|---|
| Client | Vercel | 0.8 | DEV-A | https://totur-now-client-vnxx.vercel.app |
| Server + database | Render + Neon | 0.9 | DEV-B | https://tutor-now-api.onrender.com |

> **Both halves were verified reachable from each other on 2026-08-12, during PR 1.7.**
> Until that day they were not. The Render service did not exist, `VITE_API_URL` on
> Vercel held the literal placeholder `https://<render-url>/api/v1` copied out of this
> file, and `CORS_ORIGINS` was still the development default. Nothing in the repo could
> have caught any of the three — they live in dashboards. If you are reading this at the
> start of an epic, spend thirty seconds on it now:
>
> ```bash
> curl https://tutor-now-api.onrender.com/health
> ```

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
| `VITE_API_URL` | `/api/v1` | `/api/v1` | **Relative since PR 6b.2** — the API is served from this origin through the rewrite below. It was the absolute Render URL until then, and that is what made the refresh cookie third-party |
| `VITE_SOCKET_URL` | `https://tutor-now-api.onrender.com` | the same, or a scratch instance | PR 6b.2. The socket cannot use the rewrite — Vercel does not carry a WebSocket upgrade — so it names the origin itself |

That is the whole list, and it is the whole list on purpose. Only `VITE_`-prefixed
variables reach the bundle, and everything with that prefix is readable by anyone who
opens devtools. **Do not add the server's keys to this project** to keep them in one
place — `DATABASE_URL`, the JWT secrets, Cloudinary, Gemini, Daily and Resend belong
to the Render service and nowhere else. One prefix rename is all that separates a key
in this list from a key in the browser.

Include `/api/v1` in the value. `client/src/api/client.js` appends only the route, so
`api.get('/auth/login')` becomes `<VITE_API_URL>/auth/login`.

**Both of these must move together with `REFRESH_COOKIE_SAMESITE` on Render.** The
three describe one arrangement: HTTP proxied through this origin, the socket going
direct, and the cookie declared same-site. Setting two of the three leaves a client
that either cannot reach the socket or hands the browser a cookie whose flag disagrees
with the request that carries it. The order that never has a broken window is: deploy
the rewrite, set `VITE_SOCKET_URL`, redeploy the client, confirm the socket connects,
*then* set `REFRESH_COOKIE_SAMESITE=lax` on Render.

`/health` is the exception and does not go through that client at all: `app.js` mounts
it at the **root**, above the versioned API, because Render polls it as infrastructure
and that contract must not move when the API version does. `api.get('/health')` would
resolve to `/api/v1/health`, which is a 404. Check it against the origin —
`https://tutor-now-api.onrender.com/health`.

Changing a variable does **not** rebuild. Vite inlines these at build time, so the old
value stays in the deployed bundle until the next deploy — redeploy after editing one.

### The API rewrite, and why the cookie needed it

`vercel.json` serves `/api/*` from this origin, proxying to the Render service, and it
is listed **before** the SPA catch-all — Vercel takes the first match, so a catch-all
above it would answer every API call with `index.html`.

This is not a performance decision. `tn_refresh` is set by the API; with the client on
`*.vercel.app` and the API on `*.onrender.com` it was a **third-party** cookie.
`SameSite=None; Secure` makes a cookie eligible to travel cross-site and does nothing
about a browser that declines to store third-party cookies at all — the default in
Safari, in Firefox's Total Cookie Protection, and in every private window. The access
token expires at fifteen minutes, `POST /auth/refresh` arrives with no cookie, and the
user is logged out. It was observed mid-session, with a meter running, on 2026-08-20.

Proxied through this origin the browser sees one site and the rule stops applying.

**The socket is deliberately not proxied.** Vercel's rewrites do not carry a WebSocket
upgrade, so Socket.IO connects straight to the Render origin via `VITE_SOCKET_URL`, and
`CORS_ORIGINS` on Render is what allows that handshake — it is still load-bearing after
the proxy, for the socket and for anyone calling the API directly.

The better answer is one registrable domain: `app.example.com` and `api.example.com`,
a plain `SameSite=Lax` cookie, no proxy hop. It needs a purchased domain, and the
rewrite is what ships without one.

### The SPA rewrite

`vercel.json` rewrites every remaining path to `/index.html`:

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

Two platforms, in this order — Render needs a connection string, so the database goes
first. Everything Render needs that can be expressed as code lives in
[`render.yaml`](../render.yaml); this section covers the rest, which is the parts a
YAML file cannot hold: the Neon project, the secrets, and what to do when something
breaks.

### 1. Neon

1. neon.tech → **New Project**. Postgres **16**, region **eu-central-1 (Frankfurt)**.
   The region has to match Render's in `render.yaml` — a cross-region hop is added to
   every query otherwise, and the matching algorithm makes several per request.
2. Keep Neon's defaults: the primary branch is `production` and the database is
   `neondb`. Neither name is read by anything — the connection string carries the
   database, and Prisma is told nothing about branches — so renaming them buys a
   mismatch with this document and nothing else.
3. Branches → **New Branch** → `scratch`, parent `production`.

The scratch branch is not decoration. It is a full copy-on-write clone of production
that costs nothing until it diverges, and it is what makes the destructive commands
safe to run: `prisma migrate reset`, a seed you are not sure about, a migration you
want to watch apply before it touches real data. Point a local `.env` at it and the
worst case is that you delete a copy.

Neon gives two connection strings per branch, and they differ by one word in the host:

```
direct  postgresql://…@ep-xxx.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require
pooled  postgresql://…@ep-xxx-pooler.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

Neon's copy button appends `&channel_binding=require`. **Drop it.** It is a libpq
parameter, and Prisma's driver is not libpq — it rejects connection-string parameters
it does not know. `?sslmode=require` on its own is what Prisma wants, and Neon requires
nothing more.

#### Pooled vs direct

**Use the direct string.** `prisma migrate deploy` takes a Postgres advisory lock for
the duration of the migration run, and PgBouncer in transaction mode hands the
underlying connection to somebody else between statements — so the lock is taken on
one connection and looked for on another. It shows up as a deploy that hangs until
Render times it out, or as `prepared statement "s0" already exists`.

The reason we can simply not use the pooler is that there is nothing to pool: the free
plan runs one instance, one Node process, one Prisma connection pool. Pooling matters
when many instances each hold connections against a Postgres `max_connections` ceiling,
which is a problem this project does not have yet.

When it does — more than one instance, or a serverless runtime — the fix is
`directUrl` in the datasource block:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooled, for queries
  directUrl = env("DIRECT_URL")     // unpooled, for migrations
}
```

That edits `prisma/schema/`, which is the highest-conflict file in the repo
(`OWNERSHIP.md` §3.1). It is a deliberate, announced change when the time comes, not
something to slip in during an unrelated PR.

`?sslmode=require` stays on the string. Neon rejects plaintext connections.

### 2. Render

Dashboard → **New → Blueprint** → connect `Eliya-shlomo/Totur_Now` → it reads
[`render.yaml`](../render.yaml) from the repo root and creates the service from it.

Creating the service by hand instead means it is not linked to the blueprint and never
picks up changes to that file — the two configurations then drift, and the one in the
repo becomes a lie that reviews are conducted against. If the service already exists
unlinked, delete it and re-create from the blueprint.

Render will prompt for every `sync: false` variable during the sync. What each one is
and where it comes from:

| Variable | Value | Where to get it |
|---|---|---|
| `DATABASE_URL` | Neon **direct** string, `production` branch | Neon → Connect → toggle **Connection pooling** off |
| `CORS_ORIGINS` | `https://<vercel-production-domain>` | The production URL from PR 0.8. No trailing slash. |
| `CLOUDINARY_*` | 3 values | cloudinary.com → Dashboard → Product Environment Credentials |
| `GEMINI_API_KEY` | the AI Studio key | aistudio.google.com → API keys. Renamed from `ANTHROPIC_API_KEY` in PR 3.3 when classification changed vendor — **an existing deployment must set the new name or it will not boot.** |
| `DAILY_API_KEY` | the Daily key | dashboard.daily.co → Developers → API keys. **Set it.** `env.js` treats it as optional and the server boots without it, but a service without this key runs every session with "No video on this session" — which is what production did from PR 6.1 until 6b.1. The boot log says so in one line; nothing else will. |
| `RESEND_API_KEY`, `EMAIL_FROM` | leave blank | E5. `env.js` treats them as optional. **When you do set `EMAIL_FROM`, see below — the obvious value does not boot.** |

**`EMAIL_FROM` must be a bare address, not the display-name form.** Found in PR 5.9's
verification pass. Resend's own documentation writes the sender as `Name <addr@domain>`,
and `env.js` validates the variable as an email, so copying that form stops the server
at boot with no email ever attempted:

    Invalid environment. Fix .env and restart.

      EMAIL_FROM: Invalid email

Use `EMAIL_FROM=noreply@yourdomain.com`. Both this and `RESEND_API_KEY` may stay blank —
5.9 measured the whole offer flow working with the key unset, and the boot line says
`Email is disabled: RESEND_API_KEY or EMAIL_FROM is not set` when it is.

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are **not** in that list: `render.yaml`
marks them `generateValue: true`, so Render generates them and nobody ever sees them.
They are deliberately different from the local development values. Regenerating either
invalidates every token issued against it — which is the correct response to a leak,
and the reason not to do it casually.

> **Cloudinary and Gemini are required to deploy, today.**
> `requiredInProduction` in [`server/src/config/env.js`](../server/src/config/env.js)
> exits the process on boot when `NODE_ENV=production` and any of those four is
> missing, and a process that exits on boot is a service Render marks as failed. Both
> have free tiers; create the accounts now. Setting a placeholder string gets the
> service green, but it converts a startup failure you would have seen today into a
> runtime failure in E3, which is the trade the fail-fast check exists to prevent.

### 3. Migrations

`render.yaml` runs them in the build command, before the new instance starts:

```
npm ci && npx prisma migrate deploy && npx prisma generate
```

`migrate deploy` is the only migrate subcommand safe to point at production. It applies
pending migrations in order and does nothing else — it never generates a new migration
from schema drift, never prompts, and never resets. `migrate dev` does all three, which
is why it is a local-only command.

Three details that are easy to get wrong:

- **It runs from the repo root**, not from `server/`. `prisma.config.js` lives at the
  root and declares `schema: prisma/schema` and `migrations: prisma/migrations` as
  paths relative to cwd. Run the CLI from `server/` and it finds neither.
- **`NPM_CONFIG_INCLUDE=dev` is what makes the CLI exist.** Render sets
  `NODE_ENV=production`, npm reads that as `--omit=dev`, and `prisma` is a
  devDependency of the `server` workspace. Without the override the build dies on
  `prisma: not found`. This is the same failure as `vite: command not found` on Vercel,
  one section up.
- **A failed migration fails the deploy, and that is the safe outcome.** Render only
  routes traffic to a new instance after the build succeeds and the health check
  passes, so the previous instance keeps serving. A bad migration means a broken
  deploy, not a broken site.

A fresh deploy against an empty Neon branch works with no extra steps: `migrate deploy`
applies every migration from `20260810113433_init` forward.

### 4. Seeding production

Not automatic, and deliberately so. The seed is idempotent — every write upserts on a
stable business key — but automatic on every deploy means 15 demo teachers reappearing
after someone deletes them, and demo data quietly resurrecting itself is worse than
having to type a command.

The free plan has no shell, so it runs from your machine against the production
connection string:

```bash
DATABASE_URL="<neon-direct-url>" npm run db:seed
```

On Windows PowerShell:

```bash
$env:DATABASE_URL="<neon-direct-url>"; npm run db:seed
```

Set the variable **inline for that one command**. Putting the production URL in your
`.env` and forgetting it there is how a local `prisma migrate reset` ends up pointed at
production, and `reset` does not ask twice.

> **This has already happened once, and not through `reset`.** During E2's verification
> (PR 2.6) the `.env` in use held the Neon URL, so `npm run dev` served `localhost:5173`
> against production. Ordinary QA — typing in the profile form and pressing Save — changed
> the live demo teacher `dana.k@demo.tutornow.il`. Nothing warned, because from the
> application's point of view nothing was wrong.
>
> **There is exactly one `.env` and it is at the repo root.** `server/src/config/env.js`
> resolves it explicitly (`dotenv.config({ path: resolve(REPO_ROOT, '.env') })`) because the
> server's working directory is `server/`. A `server/.env` is not read by anything — if one
> exists on your machine, it is a leftover, and editing it will not change where the server
> connects.
>
> Check before you test anything that writes:
>
> ```bash
> grep DATABASE_URL .env
> ```
>
> A local URL contains `localhost:5433`. Anything with `neon.tech` in it means every form
> you submit changes production.

#### Setting up the local database, once

Do this before the first verification pass of any epic that writes rows — which is every
epic from E3 on: the question intake flow creates a question, a session and attachment
rows on **every** manual run, and there is no read-only way to exercise it.

```bash
npm run db:up
```

That starts the Postgres 16 container `docker-compose.yml` already defines, on host port
**5433** — not 5432, which is commonly taken by another Postgres. Then point the root
`.env` at it:

```bash
DATABASE_URL="postgresql://tutor:tutor@localhost:5433/tutor_now?schema=public"
```

and fill it:

```bash
npm run db:migrate && npm run db:seed
```

The seeded accounts are the ones in the table below, with the same password. From then on
`npm run dev`, `npm test` and every form you submit stay on your machine.

**When you genuinely mean production, say so per command** — inline, never by editing
`.env`:

```bash
DATABASE_URL="<neon-direct-url>" npm run db:seed
```

The variable is set for that one process and is gone afterwards. A production URL that
lives in a file is a production URL you will forget is there, which is exactly how E2's
incident happened. `npm run db:migrate` and `prisma migrate reset` are **never** run this
way — see §"Migrations" for how production migrations are actually applied.

#### The demo accounts

Written down here, per PR 1.7, so a demo never stalls on a forgotten password. Every
seeded account shares one password, defined in
[`prisma/seed/helpers.js`](../prisma/seed/helpers.js):

```
TutorNow!2026
```

| Role | Email | Count |
|---|---|---|
| Student | `avi.student@demo.tutornow.il`, `noya.student@demo.tutornow.il`, `ido.student@demo.tutornow.il` | 3 |
| Teacher | `dana.k@demo.tutornow.il`, `yossi.m@demo.tutornow.il`, … `adi.f@demo.tutornow.il` | 15 |
| Admin | `admin@demo.tutornow.il` | 1 |

The full teacher list is in [`prisma/seed/teachers.js`](../prisma/seed/teachers.js). The
admin account is the only way into `/admin` — there is no route that mints an admin, the
role is set in the database, and `POST /auth/register` rejects `role: 'admin'` outright.

This password is **demo data, not a secret**. It only ever unlocks accounts on
`@demo.tutornow.il`, all of which are created by the seed and none of which belong to a
person. Treat any real account's password the way §"Environment variables" treats the
JWT secrets: never in a file, never in a commit.

### 5. Connecting to the production database

```bash
DATABASE_URL="<neon-direct-url>" npx prisma studio
```

Same inline-variable rule, same reason. Neon's own SQL Editor (Console → SQL Editor) is
the read-only-ish alternative and needs no local setup — prefer it for looking, Studio
for editing.

Never run `prisma migrate dev` or `prisma migrate reset` against a production URL.
`dev` will invent a migration from whatever drift it sees; `reset` drops the schema.

### 6. CORS

The whitelist is an exact-match list — [`env.js`](../server/src/config/env.js) splits
`CORS_ORIGINS` on commas, [`app.js`](../server/src/app.js) does an `includes` against
the result. No wildcards, no trailing slashes, scheme included.

Production is one origin and is set once. Preview deployments are the awkward half:
Vercel's branch alias contains the branch name, so every branch is a new origin. The
two honest options, both from PR 0.8's hand-off note:

- **Add branch aliases as they come up.** One dashboard edit per branch that needs to
  talk to the API, and a redeploy. Fine at this team size.
- **Point previews at a scratch API.** A second Render service on the Neon `scratch`
  branch, with a looser origin list, and `VITE_API_URL` set to it for the Preview
  environment in Vercel. More setup, no per-branch work afterwards.

Start with the first. What you must not do is widen the whitelist to a regex matching
`.vercel.app` — anyone can deploy a project on that domain, and `credentials: true` is
on, so a match means their page can make authenticated requests as your users.

### 7. Cold starts

The free plan spins the instance down after ~15 minutes without a request. The next
request wakes it, and pays for the whole boot: **roughly 50 seconds**, during which the
client shows its error state because the request has already timed out.

Nothing is broken when this happens. Handle it by hitting the health endpoint a minute
before anyone looks at the app:

```bash
curl https://tutor-now-api.onrender.com/health
```

Do it before the demo on 8/19. A second request confirms it is warm — it should return
in well under a second.

Do not paper over it with an external uptime pinger every 5 minutes. Render's free plan
counts instance hours, and a service kept awake 24/7 burns the monthly allowance in
about three weeks — trading a 50-second cold start for a hard stop.

### 8. Rolling back

Service → **Events** → find the last good deploy → **Rollback to this deploy**. Render
redeploys that commit; it takes a build, unlike Vercel's instant alias move.

**A rollback does not undo migrations.** Migrations are forward-only here: there are no
down-migrations, and `migrate deploy` has no revert. So rolling back application code
across a migration leaves old code talking to a newer schema. Additive migrations (new
table, new nullable column) survive that fine; a rename or a drop does not.

The practical rule: if a deploy contains a destructive migration, fixing forward is
safer than rolling back. Write the compensating migration and deploy it.

### 9. Logs

Service → **Logs** is live tail, and `logger` from 0.3 writes structured JSON, so the
filter box searches the fields. Service → **Events** is the deploy history — build
output, health check failures, restarts, OOM kills.

Two log lines are worth recognising:

- `SIGTERM received — shutting down` — normal. Render sends SIGTERM on every deploy;
  0.4's graceful shutdown drains in-flight requests, disconnects Prisma, and exits 0.
  It should be followed by `Shutdown complete` well within 10 seconds.
- `Health check: database unreachable` at warn level — the health endpoint reports
  `db: 'down'` and still returns 200, on purpose. It means Neon is unreachable, not
  that this instance is unhealthy; a 500 here would make Render restart the instance on
  every database blip and turn a recoverable outage into a restart loop.

### 10. Verifying a deploy

```bash
curl https://tutor-now-api.onrender.com/health
```

Expect `{"success":true,"data":{"status":"ok","db":"ok","uptime":N}}`. `db: "down"`
means the instance is fine and `DATABASE_URL` is not — wrong string, or the pooled one.

From the deployed client's origin, in the browser console:

```js
await fetch('https://tutor-now-api.onrender.com/health').then((r) => r.json());
```

No CORS error. Then the same call from any other origin — this page, for instance —
should fail with a CORS error in the console, and the server logs a 403. Both halves
matter: a whitelist that accepts everything passes the first test too.

Finally, push a commit to `main` and watch Events: build, migrate, health check, traffic
swap, with no manual step anywhere.

#### The teacher walkthrough

`/health` proves the process is up. This proves the product works, and it is the smoke
test to run after any deploy that touched teachers — written for someone who did not build
E2. Ten minutes, all on the deployed pair.

**Read-only, safe on production.** Nothing here writes:

```bash
API=https://tutor-now-api.onrender.com/api/v1

curl -s "$API/teachers" | head -c 200                     # a list, with topics inline
curl -s "$API/teachers?level=5&band=B&onlineOnly=true"     # filters compose and narrow
curl -s "$API/teachers?level=6"                            # VALIDATION_ERROR naming `level`
curl -s "$API/public/pricing"                              # the slider's bounds come from here
```

The list payload must contain **no** `email`, no `status`, and no counter except the rating
pair. That is the one assertion worth making by eye every time: `status` is a
matching-engine internal, and the serializer omits it by construction rather than by a
filter a refactor could drop.

Then, logged out, in a private window:

1. <https://totur-now-client-vnxx.vercel.app/teachers> renders without a session.
2. Apply topic, level, price and "online now". Each narrows; combined they narrow further.
3. Copy the filtered URL into a new tab — the controls come back set. The filters live in
   the query string, so a filtered list is shareable.
4. Open a teacher. `/teachers/:id` matches its list entry field for field.
5. A teacher with no ratings shows `NEW` and "No ratings yet", never `0.0 ★`.

**Writes — run these against a local database unless you mean to change production.**
See the warning in §4: `server/.env` is the only thing that decides which database
`npm run dev` talks to.

1. Register a teacher at `/register`, choose **Teacher**. You land in `/teach`.
2. `/teach/onboarding`: pick topics → level → price. Each step saves on its own, so close
   the tab after step 2 and reopen the URL — the stepper resumes at step 3.
3. Finish, then "Go online". The teacher appears in `/teachers` on the next refresh, and in
   `?onlineOnly=true`.
4. `/teach/profile`: change the bio and the price, save once. The preview card and
   `/teachers/:id` in a private window agree.
5. Untick a topic, save, reload. It is gone rather than merged back — `topicIds` replaces
   the whole set.
6. Switch availability off. The teacher disappears from `?onlineOnly=true` immediately.
7. Repeat step 4 at 375px. No horizontal scrolling on either screen.

Authorisation, with a student's token — all three must fail:

```bash
ST=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"avi.student@demo.tutornow.il","password":"TutorNow!2026"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])")

curl -s $API/teachers/me -H "Authorization: Bearer $ST"                    # FORBIDDEN
curl -s -X PATCH $API/teachers/me -H "Authorization: Bearer $ST" \
  -H 'Content-Type: application/json' -d '{"bio":"x"}'                     # FORBIDDEN
```

And with a teacher's token, three rejections that protect the matching engine and the
wallet — `{"status":"IN_SESSION"}`, `{"pricePerBlock":21}`, `{}` — each a
`VALIDATION_ERROR` naming the field.

### 11. Socket.IO transport

**Measured on 2026-08-19 against the deployed build: WebSocket. It upgrades.**

This was E5's one real unknown. Nothing before E5 opened a persistent connection to the
deployed API, and a fallback to long-polling was a plausible outcome that the retro said
should be known rather than discovered during a demo. It is now known.

What the teacher dashboard produced, DevTools → **Network** → **WS**, at
`/teach` on the deployed client:

```
socket.io/?EIO=4&transport=websocket&sid=ZnNKv9qZHYS4sser…   101   websocket
```

Three things in that line are the result, and all three have to be there:

- **`101`** — Switching Protocols. The upgrade was accepted. Render's free plan does not
  strip it.
- **`transport=websocket`** — not `transport=polling`.
- **`sid=…`** — this request carries the session id from the *earlier* polling handshake,
  which is what makes it an upgrade rather than a separate connection. Socket.IO always
  opens on polling and upgrades a moment later, so **one polling request before this one
  is correct and is not a fallback.** The fallback is polling that never stops.

**`Size 0.0 kB` and `Time: Pending` are also correct** and are the thing most likely to
be misread as a hang. A live WebSocket has no response body and does not complete; the
frames are under its **Messages** tab, not in the size column.

#### Why this was worth measuring

E6's meter is built on it. `session:block_warning` fires at `ends_at - WARNING_SECONDS`
and asks the student to spend money inside a 60-second window, so an event delivered a
polling interval late is a modal that arrives with less time on it than the server thinks
it has. On WebSocket that gap is gone and 6.7's screen can treat the clock as live.

**Had it read polling, the consequence was a product change and not a tuning knob**: the
session screen would have had to say its countdown may lag, and 6.5's warning would have
needed to fire earlier to compensate. It does not, so neither does.

#### Re-checking it

Worth re-running after any change to the Render service, the client's socket options, or
a move off the free plan.

1. Warm the instance first — `curl https://tutor-now-api.onrender.com/health` twice. A
   cold-start timeout on the first request looks exactly like a transport failure.
2. Log in on the deployed client **as a teacher**. The teacher dashboard is what opens the
   socket; a student's screen does not.
3. DevTools → Network → **WS** filter → reload with it open.
4. Read the three fields above.

Do not measure this from a local `npm run dev`. Local hits Express directly with nothing
in front of it, so it will read `websocket` regardless of what the deployed path does —
the whole question is what Render's proxy layer permits.

### Troubleshooting

| Symptom | Cause |
|---|---|
| Socket connects but events arrive seconds late; Network → WS shows repeating `transport=polling` and no `101` | The WebSocket upgrade is being refused somewhere in front of the app. §11. Re-check after a warm-up; if it persists, E6's block warning arrives late and the session screen must say so |
| `prisma: not found` in build | `NPM_CONFIG_INCLUDE=dev` missing |
| `Could not find a schema.prisma` | Build command running from `server/`, not the repo root |
| Build hangs at `migrate deploy` | Pooled connection string — switch to direct |
| Deploy succeeds, service unhealthy, `Missing in production: …` in logs | `requiredInProduction` in `env.js`; set the Cloudinary / Gemini keys (`GEMINI_API_KEY`, renamed in 3.3) |
| `Cannot find package '@tutor/shared'` | Installing inside `server/` instead of the workspace root |
| Health check times out, no app logs | Not binding to Render's `PORT` — do not set `PORT` yourself |
| First request after a quiet hour takes ~50 s | Cold start, expected. §7. |
