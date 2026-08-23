# Handoff — E7, from 7.6

**First: run `/caveman` and stay in it.** It is a skill here — invoke it, don't imitate.
It compresses what you say to the human only. Technical terms, file paths, API names,
CLI commands, commit prefixes and exact error strings stay verbatim. **Commits, PR
bodies and epic docs are written normally** — this repo's house style is dense prose
with the reasons written down. It does not survive a context summary; re-invoke it if
you notice you have drifted back into ordinary prose.

You are **DEV-A (eliya)**. Rotem (DEV-B) is on E6a, landed through 6a.5.

## State

`docs/epics/E7-wallet-billing/` — README plus eight briefs. Read the README first.

| PR | State |
|---|---|
| 7.1 – 7.5 | merged and **pushed** to `origin/main` |
| 7.6 teacher earnings | **committed, not pushed** — `dev-a/E7.6-teacher-earnings`, 775 tests pass |
| 7.7 out-of-credit banner | not started ← **you are here** |
| 7.8 E7 close | not started |

`main` also carries `511442d`, the `vercel.json` fix that made 6b.2's rewrite valid.

## Before your first command

```bash
git switch main && git pull --rebase origin main
npx prisma migrate deploy --schema ./prisma/schema
npm test
```

Ask whether 7.6 should be pushed before you branch 7.7 off it or off `main`. 7.7 depends
on 7.5 only, so `main` is enough.

## The trap

**Two databases.** Repo root reads `.env` → local Docker `localhost:5433`. Anything run
with a working directory of `server/` reads `server/.env` → **Neon**.
`scripts/reconcile.mjs` always reads the root one. 7.3 and 7.4 each reconciled a database
their writes never reached.

Load the root `.env` explicitly in any probe and print the host before writing:

```js
dotenv.config({ path: new URL('../../.env', import.meta.url).pathname });
```

**Verify against local, always.** Do not edit `.env` — it is blocked, correctly. To point
the dev server at another database, add a temporary `.claude/launch.json` entry using
`env` as `runtimeExecutable`, and restore it after. 7.6 did this against a throwaway
`tutor_now_probe` database and dropped it; `.env` came out byte-identical by checksum.

## Verifying without leaving rows behind

`npm test` is hermetic and proves logic. It cannot prove a router is mounted, a socket
frame arrives, or a Prisma query matches the real schema. Those need a real server or a
real database, and they are worth doing.

Two patterns that worked:

- **Roll back.** `await prisma.$transaction(async (tx) => { …; throw ROLLBACK; })` with a
  Symbol you catch outside.
- **Throwaway database** when the code under test opens its own connection and cannot see
  an uncommitted row. Create, migrate, seed, use, drop.

Never write synthetic sessions into the dev database. A `total_charged` with no
`session_blocks` breaks `reconcile.mjs` invariant 2, and the ledger is append-only.

## Decisions that will bite

- **`note` is never on the wire.** Operator-facing text. The client builds the sentence
  from `type` — `components/wallet/txLabel.js`.
- **`GET /wallet` returns credits, not minutes.** Minutes need a teacher's price.
  `client/src/lib/credits.js` owns it. Any label must name the price it assumed.
- **No hardcoded money in `client/`.** No `5`, no `12`, no `[50, 100, 200]`. Packages and
  block economics come from `GET /public/pricing`.
- **§17.5** makes `wallet.service.js` and the three money transactions human-written.
  Nothing in 7.7 or 7.8 touches one. If you find you need to, **stop and ask**.
- **No schema change in E7 and none is needed.** 6a.4 has a migration in flight and
  `OWNERSHIP.md` §2 allows one at a time.

## House rules that are actually enforced

- **When a brief is wrong, correct the brief** in the same commit as the code, with the
  reasoning. Happened five times so far.
- **When a test goes red because behaviour changed, rewrite it to the rule.** 7.2 left an
  `authorize` tripwire in `wallet.read.test.js` naming 7.6 as the PR that had to change
  it. Relaxing an assertion to match new code is how a rule becomes a bug.
- Every PR gets an allowlist and a denylist. Commit messages argue for decisions rather
  than listing files.

## Open, not blocking you

**The deployed app is still broken and it is a dashboard problem, not a code one.** The
Vercel bundle has the absolute Render URL baked in, so 6b.2's rewrite is live and unused,
and the 15-minute mid-session logout is still there. `CORS_ORIGINS` is fine — preflight
returns `204` with the right header; the console CORS error is Render's free plan
cold-starting.

Fix is three dashboard changes, in this order:

1. Vercel: `VITE_SOCKET_URL` = `https://tutor-now-api.onrender.com` — **first**
2. Vercel: `VITE_API_URL` = `/api/v1`, redeploy
3. Render: `REFRESH_COOKIE_SAMESITE=lax`, **only after the socket is confirmed connecting**

Step 1 before step 2 is load-bearing: `socket.js` falls back to `VITE_API_URL`, and a
relative one throws, leaving the socket pointed at Vercel, which carries no WebSocket
upgrade. Recorded in `docs/DEPLOYMENT.md`.

**Test wallet flows locally, not on the deployed app**, until that lands.

## Carried into 7.8

- `/app/wallet` showing a real `SESSION_CHARGE` row — 7.5 could not reach one without a
  real session
- The teacher dashboard's "Coming in E7" badge — `pages/teacher/Dashboard.jsx` was on
  7.6's denylist because 6a.5 held it

Both are already in `PR-7.8-e7-close.md`'s acceptance criteria.
