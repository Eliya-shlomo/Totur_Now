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
exactly: the `CHECK (balance >= 0)` on wallets, the two partial indexes
(`idx_teacher_available` on `status='ONLINE'`, `idx_sessions_active` on
`status='ACTIVE'`), `NUMERIC(8,2)` on `teacher_topic_stats` (parent propagation is
fractional — integers would silently truncate), and the `UUID[]` on
`questions.rejected_by`.

Partial indexes and the CHECK constraint are not expressible in the Prisma schema
language. Add them by hand-editing the generated migration SQL **before** applying
it, and leave a comment in the corresponding `.prisma` file pointing at the migration.

Model names are `PascalCase` singular with `@@map` to the snake_case table name, per
`CONVENTIONS.md`.

## Files you may touch

```
prisma/schema/schema.prisma      datasource + generator only
prisma/schema/users.prisma       users, student_profiles, enum user_role
prisma/schema/teachers.prisma    topics, teacher_profiles, teacher_topics,
                                 teacher_topic_stats, teacher_documents,
                                 enums teacher_status, teacher_badge, price_tier
prisma/schema/questions.prisma   questions, question_attachments
prisma/schema/sessions.prisma    sessions, session_blocks, offers, reviews,
                                 enum session_status
prisma/schema/wallet.prisma      wallets, wallet_transactions, payouts, enum tx_type
prisma/schema/exam.prisma        entrance_questions, entrance_attempts
prisma/migrations/**             new folder only
server/src/config/db.js          PrismaClient singleton
package.json                     prisma scripts only (db:migrate, db:studio, db:seed)
```

## Files you must NOT touch

```
client/**
server/src/**  except config/db.js
docs/**
```

## Acceptance criteria

- [ ] `npx prisma migrate dev` applies cleanly against an empty local Postgres 16
- [ ] `npx prisma generate` produces a client with all 18 models
- [ ] The generated migration SQL contains both partial indexes and the wallet CHECK
- [ ] Every field name, type, default, and nullability matches `MVP.md` §11.2
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
