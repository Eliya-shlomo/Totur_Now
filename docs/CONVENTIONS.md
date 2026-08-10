# Conventions

Non-negotiable. These exist so that two developers plus their agents produce one
codebase instead of two. Every PR is reviewed against them.

## Repository layout

```
tutor_now/
├── client/          React 18 + Vite
├── server/          Node 24 + Express
├── shared/          @tutor/shared — api.d.ts, error codes. Imported by both.
├── prisma/          schema folder + migrations  (see OWNERSHIP.md §3.1)
└── docs/            this folder
```

npm workspaces at the root. `npm run dev` starts both. `npm run db:up` starts the
local Postgres 16 container (host port **5433**, not 5432 — see `docker-compose.yml`).

### Module resolution — three mechanisms, one per workspace

| Need | Mechanism | Looks like |
|---|---|---|
| client-internal | Vite alias + `client/jsconfig.json` | `import X from '@/components/X'` |
| server-internal | Node subpath imports in `server/package.json` | `import { env } from '#config/env.js'` |
| cross-workspace | real npm workspace package | `import { CODES } from '@tutor/shared'` |

The server uses `#`, not `@/`: plain Node ESM cannot resolve `@/` without a bundler
or a custom loader, whereas the `imports` field is native. Server imports keep the
`.js` extension — Node requires it.

`shared` is a real package rather than a path alias, so it needs no configuration in
Vite, Node, or the editor. Workspaces symlink it into `node_modules`.

## Server layering — the iron rules

From `MVP.md` §15.2:

1. Controllers never touch the database. Ever.
2. Services never know about `req` / `res`.
3. Every balance change goes through `wallet.service`. No exceptions.
4. Every session state change goes through `session.service`.

```
routes/ → controllers/ → services/ → repositories/ → prisma
```

A controller that imports `prisma` is a failed review. A service that takes `res`
as an argument is a failed review.

## Naming

| Thing | Convention | Example |
|---|---|---|
| Server files | `<domain>.<layer>.js` | `auth.service.js`, `wallet.repository.js` |
| Client components | `PascalCase.jsx` | `TeacherCard.jsx` |
| Client hooks | `use<Thing>.js` | `useSessionTimer.js` |
| Zustand stores | `<domain>Store.js` | `authStore.js` |
| Zod schemas | `<action>Schema` | `registerSchema` |
| DB tables / columns | `snake_case`, tables plural | `teacher_topic_stats` |
| Prisma models | `PascalCase` singular, `@@map` to the table | `model TeacherProfile { @@map("teacher_profiles") }` |
| Constants | `SCREAMING_SNAKE_CASE` | `OFFER_TTL_SECONDS` |
| Env vars | `SCREAMING_SNAKE_CASE`, service-prefixed | `ZOOM_ACCOUNT_ID` |

## No magic numbers

Every number with meaning lives in `server/src/config/constants/`. The appendix of
`MVP.md` is the initial content. A literal `60` in a service is a failed review;
it is `OFFER_TTL_SECONDS`.

## Errors

Server throws `AppError(code, message, statusCode, details)` only. Never a bare
`Error`, never `res.status(400).json(...)` inside a controller. Codes come from
`server/src/config/errors/codes.js` — the list in `MVP.md` §12 is the starting set.

Response shape, always:

```json
{ "success": false, "error": { "code": "TEACHER_UNAVAILABLE", "message": "...", "details": null } }
```

Success shape, always: `{ "success": true, "data": ... }`.

## Validation

Every endpoint gets a Zod schema in `server/src/validators/`, applied by the
`validate(schema)` middleware. Body, params, and query. No exceptions, including
for endpoints that "obviously can't fail."

## Imports

Order, separated by blank lines:

```js
// 1. node builtins
// 2. external packages
// 3. @tutor/shared
// 4. internal absolute — client: @/components, ...  server: #config/env.js, ...
// 5. relative (./ ../)
```

ESM everywhere (`"type": "module"`). Path aliases configured in both Vite and the
server so agents never write `../../../..`.

## Client

- State: Zustand. One store per domain. A store never imports another store; cross-store
  work happens in the component or a hook.
- Server calls: only through `client/src/api/`. A component never calls `axios` directly.
- Every list has an empty state. Every async view has a loading state and an error state.
  This is a review item, not a polish item.
- Mobile-first. Test at 375px before opening the PR.

## Git

**Branches:** `<dev-id>/E<epic>.<pr>-<slug>` → `dev-a/E1.2-register-endpoint`

**Commits:** Conventional Commits.

```
feat(auth): add POST /auth/register with wallet creation
fix(wallet): prevent negative balance on concurrent charge
chore(deps): add zod
docs(epics): add E2 PR briefs
```

Scopes: `auth` `teachers` `questions` `matching` `offers` `sessions` `wallet`
`ratings` `admin` `client` `server` `deps` `epics`.

**Merges:** squash into `main`. `main` is always deployable.

**Never:** force-push a shared branch, edit an existing migration, commit `.env`,
commit `node_modules`, or reformat a file you are not otherwise changing.

## Lint & format

ESLint 9 **flat config** (`eslint.config.js` at the root — not `.eslintrc.json`,
which is the legacy format and needs a compat shim on ESLint 9). Prettier alongside
it, with `eslint-config-prettier` last so the two never fight.

Both run on pre-commit via husky + lint-staged. A PR that fails lint is not reviewed.
This removes an entire class of review comment, which is the whole point.

`docs/` is in `.prettierignore` — it is hand-formatted, with ASCII diagrams and
aligned tables that Prettier reflows into noise.
