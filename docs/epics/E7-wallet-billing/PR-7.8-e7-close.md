# PR 7.8 — E7 close: the twenty-operation reconciliation pass, and the retro

| | |
|---|---|
| **Epic** | E7 — Wallet & Billing |
| **Owner** | DEV-A (eliya) |
| **Size** | S |
| **Written by** | **Human.** The pass is a person clicking; the retro is a person writing |
| **Depends on** | 7.4, 7.6, 7.7 (and 7.5, 7.3, 7.2, 7.1 through them) |
| **Blocks** | nothing |
| **Branch** | `dev-a/E7.8-e7-close` |

## Contract implemented

None. §18's acceptance criterion for E7, executed: **"after 20 mixed operations,
`wallets.balance` equals the sum of `wallet_transactions.amount` for every user. No
exceptions."**

## Scope

Five things, in this order.

### 1. Wire the harness

`scripts/reconcile.mjs` has existed since 6.9 and is invoked by typing its path. Add
`"reconcile": "node scripts/reconcile.mjs"` to the root `package.json` scripts, so the
epic's acceptance criterion is a command anyone can run rather than a path they have to
remember. **One line.** 6a.3 adds `"bench:classify"` to the same object — named in the
epic README's collision table, and whoever lands second rebases.

Confirm the harness needs nothing else. Invariant 1 is `wallets.balance = Σ
wallet_transactions.amount` and is generic over `tx_type`, so `TOPUP` and E7's refunds are
already covered by a query written before either existed. **If a new invariant is
genuinely needed, argue for it in the PR** — but the default is that E7 adds no query,
because §18's 7.6 is this file.

### 2. Run the twenty operations

Locally, two browsers, against a seeded database. **Not on the deployed application** —
see the note below. Baseline first:

```bash
node scripts/reconcile.mjs baseline --save .baseline.json
```

Twenty operations, mixed, and every category in this epic represented at least once:

| # | Operation | Covers |
|---|---|---|
| 1–3 | Three top-ups, different packages, two students | 7.3, `TOPUP` |
| 4 | A top-up with an invalid `packageId` | 7.3's allowlist. Must write nothing |
| 5–7 | A full session: accept, extend twice, end past the window | 6.5, 6.6, the normal split |
| 8 | A session ended inside `NO_SHOW_WINDOW_SEC` by the student | 7.4 case 2, full refund |
| 9 | A session run with `DAILY_API_KEY` unset, then ended | 7.4 case 1, `end_reason = 'error'` |
| 10 | A teacher no-show reported inside the window | 6.6, still correct |
| 11–12 | A session hitting the budget cap, and one hitting `INSUFFICIENT_CREDIT` | The two 402s. Both must write nothing |
| 13 | An extension bought from inside the extend modal after an inline top-up | 7.7 |
| 14–15 | A low-demand-hour session and a new-teacher session | §5.3's two zero-fee cases |
| 16–18 | Three more ordinary sessions across two teachers | Volume, and `totals` on 7.6 |
| 19 | A double-pressed extend | 6.5's `ends_at` guard. One block, not two |
| 20 | A double-pressed top-up | 7.5's busy state. One row, not two |

`node scripts/reconcile.mjs check` after **every** operation that moves money, not only at
the end. A pass that only checks at the end tells you something broke and not which
click did it.

### 3. Read the screens against the database

The pass is not only about the invariant. For three of the twenty, open
`/app/wallet` and `/teach/earnings` and check the figures against SQL by hand:

- the student's balance equals `select balance from wallets where user_id = …`
- the newest ledger row's `balanceAfter` equals that same balance
- the teacher's `totals.net` equals `select sum(amount) from wallet_transactions where user_id = … and type = 'TEACHER_EARNING'`
- a refunded session appears on neither earnings screen and as two rows summing to zero on the student's

### 4. Undo, and prove the undo

The pass writes rows. Follow E5's and E6's precedent: record the exact undo commands in
the retro, run them, then

```bash
node scripts/reconcile.mjs diff --baseline .baseline.json
```

and paste the output. **Verified by count, not by assumption** — that is 6.9's phrase and
its reasoning holds here, with the addition that this epic's rows include balances, so a
diff that shows zero row delta and a non-zero balance delta is a real finding.

### 5. The retro

`RETRO.md`, following E5's and E6's. What §18 said E7 was, what it turned out to be, and
why — the five rows already shipped by E6, the two refunds nobody had written, and the
endpoint §12 forgot. Plus:

- The `npm run reconcile` output, verbatim.
- Anything the twenty operations found. **Especially anything they found that a test did
  not** — that is the whole argument for running them.
- The open items, if any, named as items rather than as prose.

Then the two documentation rows: `docs/README.md`'s epic index gains E7, and
`docs/OWNERSHIP.md` §2's `wallet.service.js` row gains the fact that E7 moved to DEV-A
and that `wallet.view.service.js` — reads, agent-writable — sits beside it. Both files
are also touched by 6a.6; different rows of the same tables.

## Files you may touch

```
package.json                                   ONE line: "reconcile"
docs/epics/E7-wallet-billing/RETRO.md          NEW
docs/epics/E7-wallet-billing/README.md         tick every box; paste the reconcile output
docs/README.md                                 the epic index gains E7
docs/OWNERSHIP.md                              the wallet.service.js row; wallet.view.service.js beside it
scripts/reconcile.mjs                          ONLY if a new invariant is argued for in the PR
```

## Files you must NOT touch

```
server/src/**                        if the pass finds a defect, it is its own PR with its own brief
client/src/**                        same
shared/**                            same
prisma/**                            same, and doubly so
docs/epics/E6a-*/**                  another epic's chain
docs/epics/E6b-*/**                  6b.4 is open and is DEV-A's other close. Not this one
```

## Acceptance criteria

- [ ] `npm run reconcile` exists and exits `0` on a clean database
- [ ] Twenty operations run, all categories in the table above covered
- [ ] `node scripts/reconcile.mjs check` returns **zero rows** after every money-moving operation, not only at the end
- [ ] Operations 4, 11 and 12 wrote no balance change and no ledger row — the three refusals
- [ ] Operations 19 and 20 produced one row each, not two
- [ ] The three screen-versus-SQL checks agree to the credit
- [ ] The undo ran and `diff --baseline` shows the database back at the baseline, output pasted
- [ ] `RETRO.md` exists and names every open item as an item
- [ ] `docs/README.md`'s epic index lists E7 with its split and status
- [ ] `docs/OWNERSHIP.md` records the owner change and the new read service
- [ ] Every status box in the epic README is ticked, or the unticked ones are explained in the retro

## Manual test

The scope **is** the manual test. Run it in one sitting — a pass split across two days is
a pass whose database moved in between for reasons nobody wrote down.

## Review checklist additions

- **A defect found by the pass does not get fixed in this PR.** File it, brief it, and
  land it separately. A close PR that also contains a money fix is a close PR whose
  reconciliation output was produced by different code than the one that merged.
- The undo commands go in the retro **before** they are run, not transcribed afterwards.
  E5's retro says the interesting part out loud — `truncate offers` alone leaves every
  probe session standing — and that sentence exists because somebody wrote the command
  down and then looked at it.
- `.baseline.json` is not committed.

## Notes

**Run this locally, not on the deployed application, and that is not the usual
preference.** As of the day this epic was written, **6b.2's deployment configuration is
not applied**: until

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://totur-now-client-vnxx.vercel.app/api/v1/nope
```

returns `404 application/json`, students on the deployed application are signed out
fifteen minutes after login, mid-session. A twenty-operation money pass through a session
that logs the student out halfway is a pass that measures the wrong thing.
`docs/epics/E6b-live-path-repair/PR-6b.4-e6b-close.md` is the open PR that closes it, and
it is also DEV-A's. **A deployed re-run of this pass belongs there or after it, not
here.**

**Why the twenty operations are enumerated rather than left to judgement.** §18's
criterion says "20 mixed operations" and mixed is the load-bearing word: twenty top-ups
would satisfy the letter of it and exercise one code path. The table above is chosen so
that every branch this epic wrote — and both refund branches E6 did not — appears at
least once, and so that the three operations expected to write **nothing** are checked as
carefully as the seventeen expected to write something. An invariant that only holds
when every request succeeds is not an invariant.

**What "no exceptions" is really testing.** Invariant 1 fails in exactly two ways: a
balance moved without a ledger row, or a ledger row without a balance move. Both mean a
transaction boundary is in the wrong place, and both are invisible to `npm test`, which
runs every service against injected collaborators and no database. This pass is the only
thing in the project that can see them.
