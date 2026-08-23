# Handoff — start E7 (Wallet & Billing)

**First: run `/caveman` and stay in it for the whole session.**

You are **DEV-A (eliya)**. Rotem (DEV-B) is mid-E6a. You work in parallel, on `main`
at `a0a8d78` or later.

## What you are doing

E7 is not written yet — no `docs/epics/E7-*/` folder exists. **Write the epic README and
the PR briefs first**, following `docs/epics/_TEMPLATE-epic.md` and `_TEMPLATE-pr.md`.
Match the house style: dense prose, reasons written down, allowlist + denylist per PR.

## Read before planning

- `docs/MVP.md` §18 → E7 table, **and Amendment 2 in the E6 block above it**
- `docs/MVP.md` §17.5 → what you are not allowed to write
- `docs/epics/E6b-live-path-repair/README.md` → the collision section, as a worked example

## Two things that reshape E7 from what §18 says

1. **7.1 and 7.2 mostly exist.** E6's Amendment 2 had PR 6.5 build `wallet.service.js`
   human-written with `chargeStudent`, `creditTeacher`, `refundSession`. E7 adds top-up,
   the ledger endpoints and the screens **on top of** it, not beside it.
2. **No migration needed.** `prisma/schema/wallet.prisma` already has `Wallet`,
   `WalletTransaction` (`TOPUP` is in the enum) and `Payout`. If your scoping says you
   need a schema change, **stop and ask** — §17.5 makes schema human-owned and
   migrations a two-developer agreement, and Rotem has a migration in flight in 6a.4.

## You may not write these yourself (§17.5)

| File | Rule |
|---|---|
| `wallet.service.js` | Human-written. You may write its tests |
| The three critical money transactions | Human-written, tested by hand in two browsers |

Mark those PRs **human** in the order table, the way 6a.4 is marked.

## Collisions with Rotem — two files, both append-only

Everything else is disjoint (checked against every E6a allowlist).

- **`shared/api.d.ts`** — 6a.4 adds one field *inside* `Classification`. Put E7's types in
  a new `// ── money ──` block at the end. Both append at EOF otherwise, and that is
  where git conflicts.
- **`package.json` scripts** — 6a.3 adds `bench:classify`. One line each, trivial.

`client/src/pages/teacher/**` looks like an overlap with 6a.5 but is not: 6a.5 edits
existing files, E7's earnings screen is a new one.

## Record as a deviation

§18 puts E7 on owner B. You are taking it. Say so in the epic README's deviations table.

## Known-broken, do not be surprised by it

E6b fixed three live defects; **6b.2's deployment config is not applied yet.** Until
`curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://totur-now-client-vnxx.vercel.app/api/v1/nope`
returns `404 application/json`, students on the deployed app are logged out fifteen
minutes after login. Test wallet flows locally, not there. `docs/epics/E6b-live-path-repair/PR-6b.4-e6b-close.md`
is the open PR that closes it.
