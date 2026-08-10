# TutorNow

A per-question, real-time tutoring marketplace. A student gets stuck, photographs the
exercise, and is on a video call with a ranked tutor in about a minute — paying only
for the minutes they use.

Full specification: [`docs/MVP.md`](docs/MVP.md).

## Getting started

Requires **Node 24** (see `.nvmrc`) and **Docker**.

```bash
npm install
npm run db:up
npm run dev
```

Client on http://localhost:5173, server on stdout (Express lands in PR 0.4).

## Scripts

| Command                                 | Does                         |
| --------------------------------------- | ---------------------------- |
| `npm run dev`                           | client + server together     |
| `npm run dev:client` / `dev:server`     | one at a time                |
| `npm run db:up` / `db:down` / `db:logs` | local Postgres 16 container  |
| `npm run lint` / `lint:fix`             | ESLint across all workspaces |
| `npm run format` / `format:check`       | Prettier                     |
| `npm run build`                         | production client build      |

## Layout

```
client/    React 18 + Vite + Mantine v7
server/    Node 24 + Express
shared/    @tutor/shared — contracts imported by both
prisma/    schema folder + migrations   (PR 0.2)
docs/      spec, conventions, ownership, epics
```

The local database listens on **5433**, not 5432 — see `docker-compose.yml` for why.

## Working on this project

Read these three before your first pull request:

| Document                                     | Why                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`docs/OWNERSHIP.md`](docs/OWNERSHIP.md)     | Who owns which file, and the rules that keep two developers out of each other's way       |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | Layering, naming, imports, git                                                            |
| [`docs/epics/`](docs/epics/)                 | One folder per epic, one brief per PR. Pick the next unclaimed PR from your epic's README |

Built by two developers working with AI coding agents. The methodology — humans own
the contracts, agents implement against them — is described in `docs/MVP.md` §17.
