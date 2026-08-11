# PR 0.2 — Prisma schema folder + first migration

| | |
|---|---|
| **Epic** | E0 — Foundation |
| **Owner** | DEV-B |
| **Size** | L |
| **Written by** | **Human — no agent.** `MVP.md` §17.5 |
| **Depends on** | 0.1 |
| **Blocks** | 0.7, and every server PR in every epic |
| **Branch** | `dev-b/E0.2-prisma-schema` |

## Contract implemented

The full data model from [`MVP.md` §11.2](../../MVP.md) — 18 tables — expressed as a
Prisma **schema folder** (`OWNERSHIP.md` §3.1), plus the initial migration.

## Scope

Translate every table, enum, index, and constraint in `MVP.md` §11.2 into Prisma
models, split across domain files so that later epics edit disjoint files. Preserve
exactly: `NUMERIC(8,2)` on `teacher_topic_stats` (parent propagation is fractional —
integers would silently truncate) and the `UUID[]` on `questions.rejected_by`.

Five objects in §11.2 are not expressible in the Prisma schema language — **three**
partial indexes and **two** CHECK constraints:

| Object | Table | Definition in `MVP.md` §11.2 |
|---|---|---|
| `idx_teacher_available` | `teacher_profiles` | `(status, level_max) WHERE status = 'ONLINE'` |
| `idx_sessions_active` | `sessions` | `(status) WHERE status = 'ACTIVE'` |
| `idx_offers_pending` | `offers` | `(expires_at) WHERE status = 'PENDING'` |
| balance CHECK | `wallets` | `CHECK (balance >= 0)` |
| stars CHECK | `reviews` | `CHECK (stars BETWEEN 1 AND 5)` |

Add all five by hand-editing the generated migration SQL **before** applying it, and
leave a comment in the corresponding `.prisma` file pointing at the migration.

Model names are `PascalCase` singular with `@@map` to the snake_case table name, per
`CONVENTIONS.md`.

This PR also settles three schema-wide questions §11.2 leaves open — id generation,
nullability of defaulted columns, and referential actions where the spec is silent.
The answers are written down in **`CONVENTIONS.md` § Database** rather than here,
because every later PR is reviewed against them. Read that section before coding
against this schema.

## Files you may touch

```
prisma/schema/schema.prisma      datasource + generator only
prisma/schema/users.prisma       users, student_profiles, enum user_role
prisma/schema/teachers.prisma    topics, teacher_profiles, teacher_topics,
                                 teacher_topic_stats,
                                 enum teacher_status
prisma/schema/questions.prisma   questions, question_attachments
prisma/schema/sessions.prisma    sessions, session_blocks, offers, reviews,
                                 enum session_status
prisma/schema/wallet.prisma      wallets, wallet_transactions, payouts, enum tx_type
prisma/migrations/**             new folder only
server/src/config/db.js          PrismaClient singleton
package.json                     prisma scripts only (db:migrate, db:studio)
```

`db:seed` and the `prisma.seed` key are **not** in that list: PR 0.7 owns them, and its
own allowlist already claims them. Its `migrate reset` acceptance test needs the
`prisma.seed` key to exist alongside the script, so the two land together there rather
than being split across two PRs.

## Files you must NOT touch

```
client/**
server/src/**  except config/db.js
docs/**
```

## Acceptance criteria

- [ ] `npx prisma migrate dev` applies cleanly against an empty local Postgres 16
- [ ] `npx prisma generate` produces a client with all 18 models
- [ ] The generated migration SQL contains all three partial indexes and both CHECKs
- [ ] Every field name, type, and default matches `MVP.md` §11.2
- [ ] Nullability matches §11.2 **except** for defaulted columns, which are `NOT NULL`
      per `CONVENTIONS.md` § Database
- [ ] Every id is `@default(dbgenerated("gen_random_uuid()")) @db.Uuid`, or
      `autoincrement()` for the two `SERIAL` tables
- [ ] Every relation carries an explicit `onDelete` — `Cascade` where §11.2 writes it,
      `Restrict` where §11.2 is silent
- [ ] `teacher_topic_stats` columns are `Decimal @db.Decimal(8,2)`, not `Int`
- [ ] `questions.rejected_by` is `String[] @db.Uuid`, defaulting to `[]`
- [ ] Each domain file is independently readable — no model defined in the wrong file
- [ ] `prisma/schema/schema.prisma` contains **only** datasource + generator

## Manual test

1. `npx prisma migrate reset` then `migrate dev`. Clean apply.
2. In `psql`: `\d teacher_profiles` shows `idx_teacher_available` as a partial index.
3. `INSERT INTO wallets (user_id, balance) VALUES (gen_random_uuid(), -1);` → rejected.
4. Open Prisma Studio, confirm all 18 tables are listed.

## Review checklist additions

- Cross-check field-by-field against `MVP.md` §11.2. A wrong type here surfaces as a
  mysterious bug in E7 ten days from now.
- Confirm cascade behavior matches the spec (`ON DELETE CASCADE` where written).

## Notes

**This is the highest-leverage PR in the project.** Every agent for the next ten days
codes against the types this generates. Getting it right now is cheaper than any
migration later.

Schema changes after this PR go through DEV-B as standalone migration PRs. Only one
migration in flight at a time across the whole team — announce in chat before
generating one (`OWNERSHIP.md` §2).
