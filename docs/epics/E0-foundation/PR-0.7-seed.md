# PR 0.7 — Seed script: topics tree + 15 demo teachers

| | |
|---|---|
| **Epic** | E0 — Foundation |
| **Owner** | DEV-A |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 0.2 |
| **Blocks** | E4 acceptance (the matching demo), E11.2 |
| **Branch** | `dev-a/E0.7-seed` |

## Contract implemented

The topic taxonomy from [`MVP.md` §7](../../MVP.md) and the demo data the matching
acceptance test in §18/E4 depends on.

## Scope

An idempotent seed script. Two parts.

**Part 1 — topics.** All 11 parent topics and every subtopic from §7, plus
`id = 0` "General / Unclassified". Two-level parent/child, stable slugs, Hebrew and
English names. This is production data, not demo data — E11's production seed reuses it.

**Part 2 — 15 demo teachers** with plausible, *differentiated* histories. This is
what makes the matching algorithm demonstrable, so the distribution matters more
than the volume:

- A spread of `price_per_block` across the ₪5–20 range and all three price bands (`MVP.md` §5.2),
  and enough variation in `sessions_count` + ratings to produce every standing badge (§6.2)
- Varied `level_max` — some 3-only, some 3–5
- Overlapping but distinct topic sets, with at least four specializing in integrals
  (subtopic 94), since that is the demo question
- `teacher_topic_stats` populated so Bayesian smoothing is observable: **at least one
  teacher with a single 5.0 rating in integrals, and one with ~4.6 across 40** — the
  E4 acceptance test asserts the second ranks above the first
- Varied `resolve_rate` and `acceptance_rate`, none of them 100%
- Two teachers with `sessions_count < 5` to exercise the new-teacher boost
- A few `ONLINE`, most `OFFLINE`; a documented helper to flip a teacher online on demand

Also seed 2–3 students with wallet balances, and one admin.

The seed never assigns an `id` — the database generates every primary key, per
`CONVENTIONS.md` § Database. Idempotency therefore upserts on the stable business key
(`topics.slug`, `users.email`), not on an id the script made up.

## Files you may touch

```
prisma/seed/index.js
prisma/seed/topics.js
prisma/seed/teachers.js
prisma/seed/students.js
prisma/seed/helpers.js
package.json            the db:seed script only
prisma.config.js        the migrations.seed key only — see note below
```

> **Amended during the PR.** The brief said `package.json#prisma.seed`. That key is
> deprecated in Prisma 7 and conflicts with `prisma.config.js`, which 0.2 introduced
> to point the CLI at the schema folder. The seed command therefore lives in
> `prisma.config.js` under `migrations.seed`, which is what makes `prisma migrate
> reset` reseed automatically.

## Files you must NOT touch

```
prisma/schema/**        DEV-B owns it — if the seed needs a schema change, ask
prisma/migrations/**
server/src/**  client/**
```

## Acceptance criteria

- [x] `npm run db:seed` succeeds on an empty database
- [x] Running it a second time does not duplicate or crash (upsert on stable keys)
- [x] Every parent topic and subtopic from `MVP.md` §7 exists, plus topic `0`
- [x] 15 teachers exist, spanning every standing badge, all three price bands, and every level cap
- [x] At least 4 teachers have integrals stats, and the 1×5.0 vs 40×4.6 pair exists
      — five do; the pair is Gil V. (1 rating, 5.00) against Dana K. (40, 4.60)
- [x] All demo users share one documented password so the demo never stalls on a login
- [x] `wallets.balance` equals the sum of that user's `wallet_transactions` for every seeded user
- [x] Seeded teacher aggregates are internally consistent — `rating_sum / rating_count`
      matches the intended average, `resolved_count <= sessions_count`

## Manual test

1. `npx prisma migrate reset` (runs the seed) → completes clean.
2. Run the seed again → no duplicates.
3. Reconciliation query from `MVP.md` §18/E7.6 → zero rows.
4. Spot-check the integrals teachers in Prisma Studio against the intended distribution.

## Notes

DEV-A owns this even though it lives in `prisma/`. It is the one deliberate crossing
in E0 (see the epic README): data authoring with no file overlap against anything
DEV-B holds at that moment, and it is how DEV-A gets fluent in the schema before E1.

Inconsistent aggregates here produce a matching algorithm that looks broken in E4
when it is not. The last acceptance item is the one that gets skipped and then costs
an afternoon.
