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

Path aliases (`@/` inside each workspace, `@shared/` for `shared/`) must work in
Vite, in the Node server, and in the editor — configure them once here so no agent
ever writes `../../../..`.

## Files you may touch

```
package.json                    (root, workspaces + scripts)
package-lock.json
.gitignore .editorconfig .nvmrc
.eslintrc.json .prettierrc .prettierignore
.husky/pre-commit
client/package.json  client/vite.config.js  client/jsconfig.json
server/package.json  server/jsconfig.json
shared/package.json
prisma/            (folder only, empty — 0.2 fills it)
README.md
```

## Files you must NOT touch

```
docs/**             (already written)
```

## Dependencies to install (from MVP.md §15.1)

**client:** `react react-dom react-router-dom zustand @mantine/core @mantine/hooks
@mantine/notifications @mantine/form @mantine/dates socket.io-client axios`
dev: `vite @vitejs/plugin-react`

**server:** `express cors helmet express-rate-limit zod jsonwebtoken bcrypt
cookie-parser socket.io node-cron @prisma/client cloudinary @anthropic-ai/sdk
resend dotenv`
dev: `prisma nodemon`

**root dev:** `eslint prettier eslint-config-prettier eslint-plugin-react
eslint-plugin-react-hooks husky lint-staged concurrently`

> Anything discovered missing later is a **separate one-line PR, announced in chat**.
> Do not sneak dependency additions into feature PRs.

## Acceptance criteria

- [ ] `npm install` at the root installs all three workspaces
- [ ] `npm run dev` starts Vite and the server concurrently (server can be a stub that logs)
- [ ] `npm run lint` and `npm run format` pass on a clean tree
- [ ] Pre-commit hook blocks a commit containing a lint error
- [ ] `import x from '@shared/...'` resolves in both client and server
- [ ] `.gitignore` covers `node_modules`, `.env`, `dist`, `.DS_Store`
- [ ] Both developers have cloned the merged result and run it successfully

## Manual test

1. Second developer: fresh clone, `npm install`, `npm run dev`. Works with zero extra steps.
2. Introduce a deliberate lint error, try to commit. It is blocked.

## Notes

Do not start 0.2 or 0.5 before this merges. Two parallel scaffolds is a lost day and
it is the single most predictable way to lose one.
