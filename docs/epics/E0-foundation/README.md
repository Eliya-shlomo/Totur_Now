# E0 — Foundation & Infrastructure

| | |
|---|---|
| **Depends on** | nothing |
| **Blocks** | everything |
| **Definition of done** | Both developers can clone, `npm install`, `npm run dev`, and hit a working health endpoint from a deployed client. A seeded database has topics and 15 demo teachers. |

## Why this epic is structured differently

E0 is the only epic where the two developers are not building features — they are
building the surfaces every later PR writes into. Splitting it vertically makes no
sense. Instead it splits by **directory**, which is the cleanest possible boundary:

- **DEV-B owns `server/` and `prisma/`.**
- **DEV-A owns `client/`.**

> **Amended mid-epic:** 0.3 moved to DEV-A. Every remaining DEV-A PR (0.6, 0.7, 0.8)
> was blocked behind a DEV-B PR, so DEV-A took the server-core PR to unblock 0.6.
> `server/src/config/`, `utils/` and `middlewares/` are therefore DEV-A's as of 0.3;
> `app.js`, routes and Prisma remain DEV-B's.

After E0, this split dissolves and both developers work full-stack. E0 is the
exception, not the pattern.

## The one blocking PR

**PR 0.1 must merge before anyone writes another line.** It creates the workspace,
installs every dependency, and lands the tooling. Two people scaffolding a monorepo
in parallel produces two monorepos.

Do 0.1 together, in one sitting, on one machine. It is ~90 minutes and it buys the
rest of the epic in parallel.

## Order

| # | PR | Owner | Size | Depends on | Status |
|---|---|---|---|---|---|
| 0.1 | [Monorepo scaffold, deps, tooling](PR-0.1-monorepo-scaffold.md) | **both, together** | M | — | ☑ in review |
| 0.2 | [Prisma schema folder + first migration](PR-0.2-prisma-schema.md) | DEV-B · **human** | L | 0.1 | ☐ |
| 0.3 | [Server core: constants, AppError, error codes, handlers](PR-0.3-server-core.md) | **DEV-A** · **human** | M | 0.1 | ☑ in review |
| 0.4 | [Express skeleton, health, security middleware, route registry](PR-0.4-express-skeleton.md) | DEV-B | S | 0.3 | ☐ |
| 0.5 | [React skeleton, Mantine theme, router shell](PR-0.5-react-skeleton.md) | DEV-A | M | 0.1 | ☑ in review |
| 0.6 | [Client core: axios, interceptor, ErrorBoundary, UI primitives](PR-0.6-client-core.md) | DEV-A | M | 0.5 | ☐ |
| 0.7 | [Seed script: topics tree + 15 demo teachers](PR-0.7-seed.md) | DEV-A | M | 0.2 | ☐ |
| 0.8 | [Deploy client → Vercel](PR-0.8-deploy-client.md) | DEV-A | S | 0.6 | ☐ |
| 0.9 | [Deploy server → Render + Neon, `.env.example`](PR-0.9-deploy-server.md) | DEV-B | M | 0.4 | ☐ |

## Parallelism map

```
        ┌─ 0.2 ─┬──────────────► 0.7 (A)     ← A crosses into prisma/ here, deliberately
0.1 ────┤   (B) │
 both   ├─ 0.3 ─┴─ 0.4 ─ 0.9    (B)
        └─ 0.5 ─── 0.6 ─ 0.8    (A)
```

0.7 is the one place a DEV-A PR depends on a DEV-B PR. It is on purpose: the seed
script is where DEV-A learns the schema and Prisma, and it is data authoring with
zero file overlap against anything DEV-B is building at that moment.

## Deliberate deviations from `MVP.md` §18

| MVP said | We do | Why |
|---|---|---|
| Single `prisma/schema.prisma` | Schema **folder**, one file per domain | It is the #1 conflict surface for two full-stack developers. See `OWNERSHIP.md` §3.1 |
| `src/utils/constants.js` | `src/config/constants/` folder, one file per domain | Same reason, smaller stakes |
| Owner B does E0 alone | 0.5–0.8 to DEV-A | Both developers are full-stack from day one |
| Deploy is one PR (0.7) | Two PRs (0.8 client, 0.9 server) | Disjoint, so they run in parallel |

## Risks in this epic

- **0.1 drifting.** It is tempting to keep polishing tooling. Timebox it to 90 minutes;
  anything missing gets added later as a one-line PR.
- **0.2 is the highest-leverage PR in the project.** Every agent codes against the types
  it generates. Human-written, per `MVP.md` §17.5. Do not rush it, and do not let an
  agent write it.
- **Deploying on day 10 instead of day 1.** 0.8 and 0.9 exist early on purpose. A
  deploy problem found on 8/19 costs the demo.
