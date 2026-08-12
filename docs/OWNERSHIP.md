# Ownership & Conflict Avoidance

Three developers, all writing frontend and backend, all driving AI agents. That
combination produces merge conflicts unless ownership is written down. This file
is the written-down version.

## 0. The developers

| ID | Name | Scope |
|---|---|---|
| `DEV-A` | eliya | Full-stack feature slices |
| `DEV-B` | rotem | Full-stack feature slices |
| `DEV-C` | amit | Video integration — the call itself and everything that reaches it |

Assign these once and never swap them mid-epic. Every PR brief names an owner by ID.

**DEV-C is scoped, not vertical.** A and B own feature slices across the whole
product; C owns one technical surface — the video provider, room lifecycle, and the
endpoints that hand a room to a session. That surface is narrow and deep, so it does
not get split by epic. Every video file below is C's, in every epic.

---

## 1. The split model

We split **vertically** — each developer owns a complete feature slice, server
through client — not horizontally by layer. Vertical slices ship demoable value
and let both people work full-stack, which is the goal.

The cost of vertical slicing is that both people reach into the same
infrastructure files. Sections 2–4 exist to pay that cost.

**The three rules that prevent most conflicts:**

1. **One PR in flight per developer.** Not one epic — one PR. A branch older than
   24 hours is a merge problem, not a branch.
2. **A file has exactly one owner.** If a PR needs a file you do not own, you do
   not edit it. You ask the owner, and they land it as its own small PR first.
3. **Registry files are append-only.** Never reorder, never reformat, never
   "clean up while I'm here." Git merges appended lines; it does not merge
   reordered ones.

---

## 2. Hot files — the ones that actually cause conflicts

| File / area | Owner | Rule |
|---|---|---|
| `prisma/schema/*.prisma` | split by domain — see §3 | Edit only your domain file. |
| `prisma/migrations/` | anyone | New folders only; never edit an existing migration. **Never two migrations in flight at once** — announce in chat before generating one. |
| `server/src/app.js` | DEV-B | Frozen after PR 0.4. New routes go through the route registry, not here. |
| `server/src/routes/index.js` | shared | Append-only, alphabetical, one `use()` line per router. |
| `server/src/config/constants/` | shared | One file per domain (`money.js`, `matching.js`, `session.js`, `auth.js`, `llm.js`). Add a file; do not grow one shared file. `index.js` is append-only. |
| `shared/errorCodes.js` | shared | **The** source of error codes. Append-only, alphabetical within its group. `server/src/config/errors/codes.js` only re-exports it — never define a code there. |
| `server/src/config/env.js` | DEV-A | Created in 0.3. Adding a variable means adding it here **and** to `.env.example`. |
| `server/src/utils/` | DEV-A | `AppError`, `asyncHandler`, `logger`, `password` — created in 0.3, imported by everything. |
| `server/src/middlewares/` | DEV-A for `errorHandler`/`validate` (0.3); DEV-B for auth middleware (1.1) | Security-critical. Human-written per `MVP.md` §17.5. |
| `server/src/services/wallet.service.js` | DEV-B | Human-written, no agent. Per `MVP.md` §17.5. |
| `server/src/services/video.*.service.js` | DEV-C | The provider SDK lives here and nowhere else. |
| `server/src/routes/video.routes.js`, `controllers/video.*` | DEV-C | Room access endpoints. |
| `server/src/config/video.js`, video env vars | DEV-C | Provider credentials. Add to `.env.example` with the rest. |
| `client/src/components/session/VideoRoom*` | DEV-C | The embedded call surface. The screen around it belongs to the session epic's owner. |
| `client/src/router/routes.*.jsx` | split by area — see §3 | Edit only your area file. |
| `client/src/router/index.jsx` | DEV-A | **Frozen** as of PR 0.5. |
| `client/src/theme.js` | DEV-A | **Frozen** as of PR 0.5. Component-level styling lives in components. Shared values (standing badge colours, timer colours, layout sizes) live in `theme.other` — read from there, never hardcode. |
| `client/src/layouts/AppLayout.jsx` | DEV-A | The shell behind the student, teacher and admin layouts. Changing it changes all three. |
| `client/src/api/client.js` (axios) | DEV-A | Interceptors are one file, one owner. |
| `client/src/stores/` | one store, one owner | A store file is owned by whoever created it. |
| `shared/api.d.ts` | shared | Append-only, one clearly-marked section per epic. |
| `package.json` (either) | shared | See §4. |
| `.env.example` | shared | Append-only, grouped by service. |

### 2.1 The video seam

Video is the one place where an owner's code is called by another owner's code in
every epic that uses it. So the seam is a written contract, not a convention:

**DEV-C provides** a service function that takes a session id and returns the room
access a client needs to join. **The session owner calls it** and stores whatever it
returns. Nobody outside `services/video.*` imports the provider SDK, and DEV-C does
not read or write the `sessions` table — the session owner passes in what the room
needs and persists the result.

If the shape of that return value changes, it is a chat message before the code, the
same rule as the E1 contract freeze.

Branches are `dev-c/*`. The one-PR-in-flight rule counts per developer, so three PRs
may be open at once — one each.

---

## 3. Splitting the two files that would otherwise be permanent conflicts

### 3.1 Prisma — use a multi-file schema

A single `schema.prisma` is the worst conflict surface in this project: both
developers touch it in almost every epic. Prisma supports a schema **folder**
(GA in Prisma 6; preview flag `prismaSchemaFolder` in 5.15+). Use it.

```
prisma/
├── schema/
│   ├── schema.prisma      # datasource + generator ONLY. Frozen after PR 0.2.
│   ├── users.prisma       # users, student_profiles
│   ├── teachers.prisma    # teacher_profiles, teacher_topics, teacher_topic_stats,
│   │                      #   topics
│   ├── questions.prisma   # questions, question_attachments
│   ├── sessions.prisma    # sessions, session_blocks, offers, reviews
│   └── wallet.prisma      # wallets, wallet_transactions, payouts
└── migrations/
```

Now "DEV-A adds a column to `questions`" and "DEV-B adds a column to `wallets`"
are edits to different files and merge cleanly.

Enums live in the file of the table that uses them. Cross-domain relations are
fine — Prisma resolves across files.

> If you are on Prisma 5.x, add to `schema.prisma`:
> `generator client { previewFeatures = ["prismaSchemaFolder"] }`
> and point the CLI at the folder: `prisma migrate dev --schema ./prisma/schema`.

### 3.2 Client router — split by area

```
client/src/router/
├── index.jsx           # DEV-A. Composes the arrays below. Frozen after PR 0.5.
├── routes.guest.jsx    # /, /teachers, /pricing, /login, /register
├── routes.student.jsx  # /app/*
├── routes.teacher.jsx  # /teach/*
└── routes.admin.jsx    # /admin/*
```

Owner of an area's routes = owner of the epic that built that area. Adding a
screen touches one array file, not the router.

---

## 4. Dependencies

Adding an npm package edits `package.json` and the lockfile — the lockfile is the
nastiest conflict in the repo because it is machine-generated and huge.

- **Install every known dependency in E0**, in one PR, from the stack table in
  `MVP.md` §15.1. Front-load it.
- Any later addition: **announce in chat first**, land it as its own one-line PR,
  and let the other person rebase before continuing.
- On a lockfile conflict, never hand-merge. `git checkout --theirs package-lock.json && npm install`.

---

## 5. Daily rhythm

| When | What | Duration |
|---|---|---|
| Morning | Both rebase onto `main`. Say out loud what PR you are starting and which hot files it touches. | 10 min |
| Any time | Need a file you do not own → ask in chat. Owner lands a small PR. Do not wait; work on something else meanwhile. | — |
| Evening | Merge everything mergeable. **No branch sleeps overnight.** Contract sync: did the schema, constants, error codes, or endpoint shapes change today? | 10 min |

`main` is always deployable. If it is not, fixing it is the only priority for
both people.

---

## 6. What agents are told

Every PR brief carries an explicit **Files you may touch** allowlist and a
**Do not touch** list. Pass both to the agent verbatim. An agent that wanders
outside its allowlist is the single most common source of conflicts in this
setup, and the review checklist (`MVP.md` §17.4, last item) exists to catch it.

Human-written, no agent (from `MVP.md` §17.5): `wallet.service.js`, the three
critical transactions, `prisma/schema/`, auth middleware, LLM prompts.
