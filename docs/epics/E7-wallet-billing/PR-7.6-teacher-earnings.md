# PR 7.6 — Teacher earnings: the read, and the screen that reads it

| | |
|---|---|
| **Epic** | E7 — Wallet & Billing |
| **Owner** | DEV-A (eliya) |
| **Size** | L |
| **Written by** | Agent. |
| **Depends on** | 7.2 (the wallet router, the view service, E7's contract block) |
| **Blocks** | 7.8 |
| **Branch** | `dev-a/E7.6-teacher-earnings` |

## Contract implemented

`GET /api/v1/wallet/earnings?page&pageSize` → `EarningsResponse`, teacher-only.
`/teach/earnings` — §14.1's "Earnings breakdown", replacing the `pr="7.8"` placeholder.

**The endpoint is not in §12** — recorded in the epic README's deviations table. §18
promises the screen and §12 gives it nothing to read.

## Scope

The teacher's side of the money. §5.3 takes 15% and waives it in two cases, 6.6 wrote the
split onto every finished session, and no teacher has ever been able to see any of it.

**The read is the ledger, not the sessions table, and that decision has a reason.** The
rows on this screen are the teacher's `TEACHER_EARNING` transactions — that is the
definition of "what I earned", it is append-only, and it is what `reconcile.mjs`
invariant 1 sums the balance against. Each row's `session` relation carries the rest of
the breakdown (`total_charged`, `platform_fee`, `ended_at`) and its `question` carries
the topic for the label. A read that started from `sessions` would be a second answer to
the same question, and the two would differ on exactly the session where something went
wrong — which is the session the teacher is looking at the screen about.

So: `wallet.repository.js` gains `findTeacherEarnings`, a paged
`walletTransaction.findMany` filtered to `{ userId, type: 'TEACHER_EARNING' }`, including
the session and its question's topic, newest first — plus a count and an all-time
`_sum`. It lives beside 7.2's two reads for the same reason they are there: money reads
are one repository, and `teacher.repository.js` owns topics, stats and presence.

`wallet.view.service.js` gains the handler. It reads the balance through 7.2's existing
read rather than a second query — the balance on this screen is the same number
`GET /wallet` answers, and there is one place that answers it.

**`totals` is all-time and the response says so.** `{ gross, fee, net }` across every
finished session, not across the page. A teacher scrolling to page 3 must not watch their
lifetime earnings change.

**This route carries `authorize('teacher')`, and it is the only one on the wallet router
that carries a role gate.** `GET /wallet` deliberately does not — a teacher holds a
balance and 7.2's brief says so — but this endpoint's shape is meaningless for a student
and a `[]` would be a worse answer than a `403`. A student who calls it gets `FORBIDDEN`,
which is correct here and unlike the session endpoints' `404`: there is no id in this
URL, so nothing about anybody's data is confirmed by refusing it.

**The screen.** `/teach/earnings`, a new file — `pages/teacher/Earnings.jsx`. Four
figures at the top from `totals` and `balance`: what students paid, what the platform
took, what the teacher earned, and what is in the wallet now. Then the paged list, one
row per session: the date, the topic, the gross, the fee, the net.

**The fee column is where the screen earns its keep.** §5.3's two waivers — the first
thirty days, and the low-demand window — produce `platformFee: 0` rows sitting beside
15% rows, and a teacher who cannot see why is a teacher who thinks the platform is
inconsistent. A `0` fee is rendered as a labelled zero ("no commission"), not as a blank
or a dash. **The screen does not compute the reason** — it does not have
`teacher_profiles.created_at` or the session's hour in the right timezone, and
`utils/commission.js`'s own header says two implementations of §5.3 is two answers to
"what did I earn". It renders the number the server sent and labels the fact that it is
zero.

**A teacher with no sessions gets an empty state**, not four zeros and a blank table.
That is most teachers on the day they onboard.

## Files you may touch

```
server/src/repositories/wallet.repository.js   findTeacherEarnings: page, count, all-time sums
server/src/services/wallet.view.service.js     the handler; balance through 7.2's existing read
server/src/controllers/wallet.controller.js    one handler, no prisma
server/src/routes/wallet.routes.js             one route: authenticate, authorize('teacher'), validate
server/src/validators/wallet.schema.js         reuse 7.2's paging schema; do not write a second one
server/src/utils/walletView.js                 toEarningRecord, beside 7.2's row projection
shared/api.d.ts                                inside E7's block only, if a comment needs sharpening
server/tests/wallet.earnings.test.js           NEW. The role gate, the all-time totals, the paging
client/src/api/wallet.api.js                   one function: getEarnings
client/src/pages/teacher/Earnings.jsx          NEW. The screen
client/src/components/wallet/EarningsSummary.jsx  NEW. The four figures
client/src/components/wallet/EarningsTable.jsx    NEW. The rows, and the labelled zero fee
client/src/router/routes.teacher.jsx           the pr="7.8" placeholder becomes the screen
docs/epics/E7-wallet-billing/README.md         tick the status box
```

## Files you must NOT touch

```
server/src/services/wallet.service.js        §17.5. This PR moves no money
server/src/utils/commission.js               §5.3, written once in E5. The screen renders, it does not recompute
server/src/services/session.end.service.js   7.4's file, and the split is 6.6's
server/src/repositories/teacher.repository.js  topics, stats and presence. Money reads are the wallet's
client/src/pages/teacher/Dashboard.jsx       6a.5 has this file. Earnings.jsx is new and does not touch it
client/src/pages/teacher/Profile.jsx         same
client/src/components/nav/navItems.js        /teach/earnings has been in the nav since 0.5
client/src/router/index.jsx                  frozen at 0.5
prisma/schema/**                             every column this needs exists; 6a.4 has a migration in flight
docs/epics/E6a-*/**                          another epic's chain
```

## Acceptance criteria

- [ ] `GET /api/v1/wallet/earnings` as a teacher returns `{ balance, earnings, total, totals }`
- [ ] As a student: `403 FORBIDDEN`. With no token: `401`
- [ ] `balance` equals what `GET /wallet` returns for the same token, to the credit
- [ ] Every row's `teacherEarning` equals the `TEACHER_EARNING` ledger row's amount, and `totalCharged − platformFee === teacherEarning` on every row
- [ ] `totals.net` equals the sum of every earning ever, and does **not** change when `?page` does
- [ ] A no-show session appears nowhere — it wrote no `TEACHER_EARNING` row
- [ ] A refunded session under 7.4 appears nowhere either, for the same reason
- [ ] `/teach/earnings` renders the four figures and the paged list, and a `0` fee row is labelled rather than blank
- [ ] A teacher with no finished sessions sees an empty state
- [ ] `grep -rn "0.15\|PLATFORM_FEE" client/src/` returns nothing — the client never computes a fee
- [ ] Usable at 375px: the table becomes stacked rows, no horizontal scroll (§14.4)
- [ ] `grep -rn "prisma" server/src/controllers/wallet.controller.js` returns nothing
- [ ] `npm test` and `npm run lint` pass

## Manual test

1. Seed or run three sessions for one teacher: one normal, one in the low-demand window,
   one no-show.
2. `GET /api/v1/wallet/earnings` as that teacher — two rows, and the low-demand one has
   `platformFee: 0`.
3. Same request with a student's token — `403` in the standard error shape.
4. `/teach/earnings` in the browser: four figures, two rows, the zero fee labelled.
5. `?pageSize=1` — one row, `total` still 2, `totals` unchanged.
6. Log in as a brand-new teacher — empty state, no zeros table.
7. 375px — the rows stack.

## Review checklist additions

- **The all-time totals must be an aggregate, not a sum over the returned page.** This is
  the single easiest thing to get wrong here and the failure is invisible on page 1.
- One paging schema for the whole router. If 7.2's schema does not fit, say why in the PR
  rather than adding a second one — two paging validators is two ceilings.
- The client renders `platformFee` and never derives it. `PLATFORM_FEE_PCT` must not
  reach the client bundle (§17.4 has a line about exactly this).
- `Earnings.jsx` is a **new file** under `client/src/pages/teacher/`, which is a path on
  6a.5's allowlist as a glob. The epic README argues this is not an overlap because 6a.5
  edits existing files. If this PR finds itself opening `Dashboard.jsx` for any reason,
  stop — that is a scheduling conversation, not a merge.

## Notes

**Why not extend `GET /teachers/me`.** It is the teacher's profile record and 5.7's
dashboard reads it twice on mount already. Hanging a paged money list off it would make
`teacher.repository.js` read `wallet_transactions` and `sessions`, and would mean the
dashboard fetching an earnings page it does not render. Separate concern, separate read.

**Why `403` here and `404` on the session endpoints.** `OWNERSHIP.md` §2.1 rule 4 says a
`403` on a session id confirms the session exists. This URL has no id in it: refusing a
student tells them only that they are not a teacher, which they know. The rule is about
leaking the existence of a row, not about the status code being universally wrong.

**Payouts are not in this epic.** `payouts` exists in the schema, is written by nothing,
and §21 puts real money movement in a later phase. The screen shows what the teacher has
earned and what is in their wallet. It does not offer to pay it out, and it must not
imply that it will.
