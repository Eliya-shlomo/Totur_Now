# PR 0.1 — Monorepo scaffold, dependencies, tooling

| | |
|---|---|
| **Epic** | E0 — Foundation |
| **Owner** | **Both developers, together, one machine** |
| **Size** | M (timebox: 90 minutes) |
| **Written by** | Human (agent may generate config files) |
| **Depends on** | — |
| **Blocks** | everything |
| **Branch** | `main` directly, or `setup/E0.1-scaffold` merged immediately |

## Contract implemented

The repository itself: workspace layout per `CONVENTIONS.md`, every dependency from
`MVP.md` §15.1 installed once, lint and format enforced.

## Scope

Create the npm-workspaces monorepo with `client/`, `server/`, `shared/`, `prisma/`,
`docs/`. Install **every** dependency listed in the stack table now — front-loading
this removes the lockfile as a conflict surface for the rest of the project
(`OWNERSHIP.md` §4). Configure ESLint + Prettier at the root with per-workspace
overrides, wire a pre-commit hook, and add root scripts that run client and server
together.

Module resolution must work in Vite, in the Node server, and in the editor — set up
once here so no agent ever writes `../../../..`. Three mechanisms, one per workspace;
see `CONVENTIONS.md` for the table.

## Files you may touch

```
package.json                    (root, workspaces + scripts)
package-lock.json
.gitignore .editorconfig .nvmrc
eslint.config.js .prettierrc .prettierignore
docker-compose.yml              local Postgres 16
.husky/pre-commit
client/package.json  client/vite.config.js  client/jsconfig.json
client/postcss.config.cjs  client/index.html  client/src/{main,App}.jsx
server/package.json  server/jsconfig.json  server/src/index.js
shared/package.json  shared/index.js
README.md
```

## Files you must NOT touch

```
docs/**             (already written)
```

## Dependencies to install (from MVP.md §15.1)

**client:** `react react-dom react-router-dom zustand @mantine/core @mantine/hooks
@mantine/notifications @mantine/form @mantine/dates socket.io-client axios`
dev: `vite @vitejs/plugin-react postcss postcss-preset-mantine postcss-simple-vars`

**server:** `express cors helmet express-rate-limit zod jsonwebtoken bcrypt
cookie-parser socket.io node-cron @prisma/client cloudinary @anthropic-ai/sdk
resend dotenv`
dev: `prisma`

**root dev:** `eslint @eslint/js globals prettier eslint-config-prettier
eslint-plugin-react eslint-plugin-react-hooks husky lint-staged concurrently`

> Anything discovered missing later is a **separate one-line PR, announced in chat**.
> Do not sneak dependency additions into feature PRs.

## Acceptance criteria

- [x] `npm install` at the root installs all three workspaces
- [x] `npm run dev` starts Vite and the server concurrently (server is a stub that logs)
- [x] `npm run lint` and `npm run format:check` pass on a clean tree
- [x] Pre-commit hook blocks a commit containing a lint error
- [x] `import { ... } from '@tutor/shared'` resolves in both client and server
- [x] `@/` resolves in the client, `#config/*` resolves in the server
- [x] `.gitignore` covers `node_modules`, `.env`, `dist`, `.DS_Store`
- [x] `npm run db:up` gives a healthy Postgres 16 reachable from the host
- [x] `npm audit` reports zero vulnerabilities
- [ ] Both developers have cloned the merged result and run it successfully ← **rotem**

## Manual test

1. Second developer: fresh clone, `npm install`, `npm run dev`. Works with zero extra steps.
2. Introduce a deliberate lint error, try to commit. It is blocked.
3. `npm run db:up`, then `psql -h localhost -p 5433 -U tutor -d tutor_now` (password `tutor`).

## Deviations from this brief, and why

| Brief said | Built | Why |
|---|---|---|
| `.eslintrc.json` | `eslint.config.js` | Legacy format; ESLint 9 needs a compat shim for it |
| `@shared/` alias | `@tutor/shared` workspace package | A real package needs no config in Vite, Node, or the editor |
| `@/` alias on the server | `#config/*` subpath imports | `@/` does not resolve in plain Node ESM without a bundler or loader |
| `nodemon` | `node --watch` | Native in Node 24. One less dependency |
| (not mentioned) | `postcss-preset-mantine` | Mantine v7 requires it or its mixins and breakpoints silently no-op |
| (not mentioned) | `docker-compose.yml` | 0.2 needs a database on both machines; Docker makes them identical |
| Postgres on 5432 | host port **5433** | 5432 is commonly taken by another project's container |
| React Router v6 | **v7** | v6 has an unpatched open-redirect advisory. Zero migration cost with no routes written |
| node-cron v3 | **v4** | v3 pulls a vulnerable `uuid`. Zero cost with no cron written |
| bcrypt v5 | **v6** | v5 pulls a `tar` with a critical advisory |

The last three came out of `npm audit`: the brief's dependency list produced one
critical and four moderate advisories. All were fixed by major bumps that cost
nothing at scaffold time and would have cost real work later. `MVP.md` §15.1 and
`CONVENTIONS.md` were updated in the same commit so the docs stay true.

## Open question for PR 0.5

**UI language and direction.** The product targets Israeli students — `MVP.md` §2,
₪ pricing, `topics.name_he` — which points at Hebrew and RTL. Mantine supports RTL
but it changes the provider setup and every screen's layout assumptions. `index.html`
is currently `lang="en" dir="ltr"` as a placeholder. **Decide before 0.5**; retrofitting
RTL across twenty screens later is a real cost.

## Notes

Do not start 0.2 or 0.5 before this merges. Two parallel scaffolds is a lost day and
it is the single most predictable way to lose one.
