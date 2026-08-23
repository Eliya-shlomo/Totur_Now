# E7 — Retro

| | |
|---|---|
| **Closed** | 2026-08-23 |
| **Verified by** | Eliya (DEV-A), local Docker Postgres `localhost:5433/tutor_now`, one machine |
| **Result** | ◐ **Closed with two defects filed and four items outstanding.** Twenty operations ran, `reconcile check` returned zero rows after every one of them, and the pass found two disagreements about §5.3's commission that no test in this repository can see |

E7 is the third single-developer epic in a row, and its closing pass is the only review
most of its code receives. `npm test` is 775 green tests against injected collaborators
and no database; it proved every service keeps the invariant it was given, and it could
not have found either of the two defects below, because both are about **which column a
query selects**.

## What §18 said E7 was, and what it turned out to be

§18 gave E7 eight rows and five of them were already merged. E6's Amendment 2 is why:
§18 wrote E6 as depending on E7, E7 did not exist, and rather than block the epic or fake
the charge, PR 6.5 built `wallet.service.js` by hand with the three operations a session
needs. By the time this epic opened, `chargeStudent`, `creditTeacher` and `refundSession`
had been spending real credits for a week.

So the epic that got built was **the half of the wallet a human can see**, plus the two
refunds §5.5 states and nobody had written:

| §18's row | What actually happened |
|---|---|
| 7.1 `wallet.service` + ledger | Existed since 6.5. E7 added a fourth operation, `topUpWallet`, human-written per §17.5 |
| 7.2 `FOR UPDATE` block charging | Existed since 6.5. Not re-done |
| 7.3 earnings + fee + commission rules | The write existed since 6.6. E7 built the **read** — `GET /wallet/earnings`, which §12 forgot to give the screen §18 promised |
| 7.4 refunds | No-show was 6.6's. **Platform failure and early exit were never written at all.** 7.4 wrote them by hand |
| 7.6 reconciliation query | Existed since 6.9, generic over `tx_type`. E7's contribution is running it after twenty operations that include top-ups, and `npm run reconcile` |

The four PRs that were genuinely new: `POST /wallet/topup` and its two reads, the wallet
screen, the earnings screen, and the out-of-credit banner §5.4 promised and E6 could not
build because nothing in the product could add credit.

## The pass — twenty operations, one sitting, one database

**Driven through HTTP against the running local server rather than through two browsers,
and that is a deviation the brief should know about.** The brief says "two browsers". The
invariant is a property of the server and the database, every operation below is a real
request through the real router with real authentication, and twenty hand-driven browser
sessions in one sitting is a pass that gets abandoned at operation twelve. The four things
that are genuinely about a *screen* — operation 13's inline top-up, operation 20's
double-press guard, and the three screen-versus-SQL reads — were done in the browser,
because a curl cannot exercise a client-side busy state and a `useRef` guard is not
reachable from a shell.

The host, printed by the harness before every check:

    database: localhost:5433/tutor_now

That line is new in this PR. §1a of the brief told the operator to "confirm the host it
connected to" against a tool that printed no host, which is how 7.3 and 7.4 each
reconciled a database their writes never reached. It is one line and it is the reason
this retro's evidence can be trusted.

### Baseline

    node scripts/reconcile.mjs baseline --save .baseline.json

    users 25 · wallets 25 · wallet_transactions 13 · teacher_profiles 16
    questions 0 · sessions 0 · session_blocks 0 · offers 0 · reviews 0
    credits held across every wallet: 744

### The operations

`node scripts/reconcile.mjs check` ran after **every** money-moving operation and returned
zero rows every time. Twenty-three checks, twenty-three passes.

| # | Operation | Result |
|---|---|---|
| 1 | Top-up avi ₪50 | `201`, balance 120 → 170 |
| 2 | Top-up ido ₪100 | `201`, balance 600 → 700 |
| 3 | Top-up avi ₪200 | `201`, balance 170 → 370 |
| 4 | Top-up `packageId: 37` | `400 VALIDATION_ERROR` — "Pick one of the top-up packages: 50, 100, 200." Balance and row count identical before and after |
| 5 | Ask → offer → accept, omer.d at ₪10 | `ACTIVE`, opening 2 blocks, 20 charged |
| 6 | Two extensions | 20 → 30 → 40, `blocks_used` 2 → 3 → 4 |
| 7 | End past the window | gross 40, fee 6, net 34 — §5.3's 15% |
| 8 | Student ends inside `NO_SHOW_WINDOW_SEC` | `student_ended`, gross 24, fee 0, net 0, **balance identical before and after** — 7.4 case 2 |
| 9 | Session with no video room, then ended | `end_reason = 'error'`, full refund — 7.4 case 1 |
| 10 | Teacher no-show reported inside the window | `NO_SHOW`, `teacher_no_show`, gross 22, fee 0, net 0, full refund — 6.6, still correct |
| 11 | Extension breaking the budget cap | `402 BUDGET_CAP_REACHED`. Balance, ledger count and `session_blocks` count all identical before and after |
| 12 | Extension the student cannot afford | `402 INSUFFICIENT_CREDIT`. Same three counts identical |
| 13 | Inline top-up inside the extend modal, then extend | ₪50 credited without leaving the page, then `blocks_used` 2 → 3, charged 24 → 36 — 7.7 |
| 14 | Session started 08:51 Israel time, teacher 72 days old | fee **0**, and provably by the clock rather than by the teacher |
| 15 | Session started 15:51 Israel time, teacher 12 days old | fee **0**, and provably by the teacher rather than by the clock |
| 16 | Ordinary session, dana.k at ₪16 | gross 32, fee 5, net 27 |
| 17 | Ordinary session, yossi.m at ₪12 | gross 36, fee 5, net 31 |
| 18 | Ordinary session, maya.l at ₪14 | gross 28, fee 4, net 24 |
| 19 | Two `POST /extend` fired together | `200` and `409 SESSION_NOT_ACTIVE` — "The session moved on while you were deciding." One block, not two: `blocks_used` 2 → 3, charged 20 → 30 |
| 20 | Package button double-clicked on `/app/wallet` | **One** `TOPUP` row. Balance 38 → 88, and the ledger gained one row, not two |

The three refusals — 4, 11 and 12 — were each measured the same way: balance, ledger row
count and `session_blocks` count captured immediately before and immediately after, and
compared. All three were byte-identical. An invariant that only holds when every request
succeeds is not an invariant.

### The final check, verbatim

    $ npm run reconcile

    > tutor-now@0.1.0 reconcile
    > node scripts/reconcile.mjs

    database: localhost:5433/tutor_now

    ✔ 1. wallets whose balance disagrees with their ledger — none
    ✔ 2. sessions whose total_charged disagrees with their blocks — none
    ✔ 3. sessions whose split does not add up — none
    ✔ 4. sessions whose ledger rows disagree with their columns — none
    ✔ 5. teachers left IN_SESSION with no session running — none

    RECONCILED — five invariants, zero rows.

### The arithmetic closes twice over

The mutation ledger says the pass added 425 credits across every wallet. The ledger rows
say the same thing from the other side:

    TOPUP             5 rows   +450
    SESSION_CHARGE   17 rows   -322
    REFUND            3 rows    +74
    TEACHER_EARNING   8 rows   +223
                              ------
                               +425

450 in, and 25 of it kept by the platform as commission — 6 + 5 + 5 + 5 + 4 across the five
chargeable sessions — which is money that leaves a student's wallet and lands in nobody's.
That is §5.3 working: `platform_fee` is a column on `sessions` and deliberately not a
wallet, because the platform is not a user. Invariant 1 is per-user and never sees it;
the totals agreeing anyway is the strongest single line of evidence in this pass.

## Two defects. Both about §5.3, both invisible to the suite

### F1 — the settlement reads the wrong `created_at`, so §5.3's free month is measured from the wrong day

`utils/commission.js` states its own contract in its header:

> `teacherCreatedAt` is the teacher's own start date, and callers pass
> `teacher_profiles.created_at` — when they became a teacher, not when the account was
> registered. A student who onboards as a teacher a year later gets their free month from
> the day they onboarded, which is what the incentive is for.

`findSessionForMeter`, the locked read every settlement makes, does not:

    LEFT JOIN users t ON t.id = s.teacher_id
    ...
    t.created_at AS "teacherCreatedAt"

`t` is `users`. The comment four lines above the join even says "the teacher's `users` row
is joined ... §5.3's rate is computed from when the teacher joined", so this is not a
typo — it is a belief that `users.created_at` *is* when the teacher joined.

**Found by accident, which is the point.** Operation 7 was set up with a teacher aged past
the thirty-day window and a `started_at` outside the quiet hours, so §5.3 should have taken
15%. It took nothing. The teacher's `teacher_profiles.created_at` was 72 days old and their
`users.created_at` was 12:

    email                   | user_created               | profile_created
    omer.d@demo.tutornow.il | 2026-08-11 12:11:02.455+00 | 2026-06-12 12:11:02.456+00

**Why no test sees it.** Every unit test injects `teacherCreatedAt` directly, so it tests
`platformFeeRate` against whatever date it was handed. The defect is entirely in which
column the SQL selects, and the only fixture where the two columns differ is one somebody
would have to construct on purpose.

**Why the seed hides it.** `prisma/seed` writes the user and the teacher profile in the
same transaction, so the two timestamps are milliseconds apart for all sixteen demo
teachers. The divergence needs a real person who registered as a student and onboarded as
a teacher later — which is exactly the path E2's onboarding stepper exists for.

**Impact.** A teacher who registered more than thirty days before they onboarded pays 15%
from their first lesson and never gets the month §5.3 buys them. A teacher who onboarded
within thirty days of registering is charged correctly. The error is always in the
platform's favour, which is the direction nobody complains about until they do.

Not fixed here. 7.8's review checklist: a defect found by the pass does not get fixed in
the PR whose reconciliation output was produced by the old code.

### F2 — the teacher is quoted three different numbers for the same session

F1 is one leg of a three-way disagreement about a rule `commission.js` was written to have
exactly one implementation of. Its header says why that matters:

> Two implementations of §5.3 is two answers to "what did I earn", and the one the teacher
> was quoted at accept time is the one that has to hold.

| Where the teacher sees it | What it uses | What it says |
|---|---|---|
| The offer email (5.6) — `session.offer.service.js:436` | `findTeacherForNotification`, which selects `teacher_profiles.created_at` | **Correct** |
| The accept modal (5.4) — `session.view.service.js:168` | `platformFeeRate({ teacherCreatedAt: new Date() })`, hardcoded | Always 0% — quotes the **gross** |
| The ledger row (6.6) — `session.repository.js:699` | `users.created_at` | F1's answer |

The modal is a known gap, stated in E5's README as its ninth and left open deliberately:
5.3 shipped `feeRateFor` resolving to `0` for everybody and 5.6 closed the email half. The
comment in `session.view.service.js` says the fix is "one argument at one call site" and it
still is. What has changed is that E7 made the third number real — before this epic
nothing was ever actually paid, so three answers cost nothing.

Filed together with F1: they are one PR, because fixing either alone leaves the other two
disagreeing.

## Three more things the pass found that are not defects

### The budget cap is a constant, and §5.1 says it is the student's

`DEFAULT_BUDGET_CAP = 40`, and there is no way to set it. `createQuestionSchema` is
`.strict()` and has three fields, none of them a cap; nothing in `client/` offers one.
§5.1 calls it "the spending ceiling a student sets per question".

It is not cosmetic. At the seeded price band of ₪5–₪20 a block, the cap decides how many
extensions a session can have before it refuses:

| Teacher's price | Opening (2 blocks) | Extensions that fit under 40 |
|---|---|---|
| ₪16 (dana.k) | 32 | **none** |
| ₪14 (maya.l) | 28 | none |
| ₪12 (yossi.m) | 24 | one |
| ₪11 (gil.v) | 22 | one |
| ₪10 (omer.d) | 20 | **two** |

Operation 5's first attempt used dana.k at ₪16 and could not be extended at all, which is
how this was found. A student who picks a teacher at the top of the band gets ten minutes
and a `402`, and the message tells them they hit "the spending limit you set" — which they
did not set, because they cannot.

Not a defect against any written contract. Named as an open item because it is a product
promise §5.1 makes that no code keeps.

### `reconcile.mjs` could not answer the question its own brief asked

Covered above. One line, added in this PR, and the only change to a 6.9 file in it.

### The teacher dashboard's badge outlived what it was apologising for

`Coming in E7` sat over a link to `/teach/earnings`, a screen 7.6 shipped. 7.6 could not
touch the file — `Dashboard.jsx` was on its denylist because 6a.5 held it — and by 7.8 6a.5
had landed and it was free. Removed, with the tile keeping its link and gaining a sentence
that says what is behind it. Verified on the running dashboard as Yossi M.

## The screens, read against SQL

Three reads, all by hand, all agreeing to the credit.

**Noya's wallet, after operations 12, 13 and 20.** The screen said `88 credits` and the
newest ledger row said `Balance 88`; `select balance from wallets` said 88. The running
total down the list — 88, 38, 50, 0, 24 — matched `balance_after` on every row. **This is
the criterion 7.5 handed forward**: the screen showing a real `SESSION_CHARGE` row,
negative and dated, with a running total that reconciles. 7.5 could not reach one without
writing a ledger row by hand. Two of them are on that screen now, from operations 12 and 13.

**Yossi's earnings.** The screen said gross ₪36, fee ₪5, net ₪31, wallet ₪31.
`select sum(amount) ... where type = 'TEACHER_EARNING'` said 31, and `select balance` said
31. One session row, for operation 17.

**The refunded session is on neither earnings screen.** Yossi has two sessions in the
database — operation 8's, refunded in full, and operation 17's. `/teach/earnings` lists
one. On the student's side the same session is two rows summing to zero:

    SESSION_CHARGE  -24  balance_after 676
    REFUND          +24  balance_after 700

Both carrying the same `session_id`, both rendered by `txLabel.js` as "Session" and
"Refund" from `type` alone — `note` never left the server, which is the decision 7.2 made
and the first time anybody has watched it hold on a screen.

## Mutation ledger

Every hand-written row and every hand-set column this pass made, so it can be re-run. The
undo commands were written here **before** they were run.

| # | Mutation | Why | Undo |
|---|---|---|---|
| 1 | 13 questions, 13 sessions, 17 `session_blocks`, 11 offers | Twenty operations need sessions, and every category in the table needs its own | delete the questions — `sessions.question_id` is `ON DELETE CASCADE` |
| 2 | 33 `wallet_transactions` rows, +425 credits across five wallets | The pass **is** these rows | delete the rows the pass wrote, then re-derive every balance from the surviving ledger |
| 3 | `teacher_profiles.status` → `ONLINE` for five teachers, via `PATCH /teachers/me` | A seeded teacher is `OFFLINE` and matching's first hard filter excludes them, so no offer can be sent | set them back to `OFFLINE` |
| 4 | `users.created_at` and `teacher_profiles.created_at` moved back 60 days for dana.k, yossi.m, maya.l, omer.d | Every seeded teacher joined 12 days ago and `NEW_TEACHER_FEE_DAYS` is 30, so **the 15% branch of §5.3 is unreachable with seed data**. Both columns, because of F1 | add the 60 days back to both columns |
| 5 | `sessions.started_at` set to `now() - 18 hours` on the chargeable sessions, and `now() - 1 hour` on operation 14 | §5.3 resolves the rate at `started_at`, the quiet window is 06:00–14:00 Israel time, and the pass ran at 09:40 — so with a live clock **every session in it would have been commission-free** and operations 14 to 18 would have proved nothing | the sessions are deleted |
| 6 | `sessions.ends_at` pushed forward on four sessions | The block warning fires 60 seconds before `ends_at` and the auto-end sweep closes the session `GRACE_SECONDS` after it. Operation 13 needs the modal open and the session alive long enough to answer it | the sessions are deleted |

**Write `ends_at` truncated to milliseconds or the extend endpoint refuses.**
`date_trunc('milliseconds', now() + interval '58 seconds')`, never a bare `now() +
interval`. `extendSessionBlock` reads the session before `BEGIN`, keeps `expectedEndsAt`,
and matches on it in the `UPDATE`'s `WHERE`; Prisma hands back a millisecond-precision
`Date` and Postgres stores microseconds, so a hand-written `.991599` never matches `.991`
and every extend answers `409 SESSION_NOT_ACTIVE` on a session that is plainly `ACTIVE`.
Two of this pass's 409s were that, and neither was a defect.

### The undo, as run

    docker exec tutor_now_db psql -U tutor -d tutor_now -c "
      DELETE FROM wallet_transactions WHERE created_at >= '2026-08-23 06:35:54+00';
      DELETE FROM questions;
      UPDATE wallets SET balance = COALESCE(
        (SELECT SUM(t.amount) FROM wallet_transactions t WHERE t.user_id = wallets.user_id), 0);
      UPDATE teacher_profiles SET status = 'OFFLINE' WHERE status <> 'OFFLINE';
      UPDATE users SET created_at = created_at + interval '60 days'
       WHERE email IN ('dana.k@demo.tutornow.il','yossi.m@demo.tutornow.il',
                       'maya.l@demo.tutornow.il','omer.d@demo.tutornow.il');
      UPDATE teacher_profiles SET created_at = created_at + interval '60 days'
       WHERE user_id IN (SELECT id FROM users WHERE email IN
                        ('dana.k@demo.tutornow.il','yossi.m@demo.tutornow.il',
                         'maya.l@demo.tutornow.il','omer.d@demo.tutornow.il'));
    "

**`delete from questions` is the whole of it and `truncate offers` is not**, which E5's
retro already said and which is still the obvious wrong thing to reach for. `offers` has
the foreign key to `sessions`, not the reverse, so truncating offers leaves every session
standing. The questions are the root.

**Balances are re-derived rather than restored from a snapshot**, and that is deliberate:
`UPDATE wallets SET balance = SUM(ledger)` is invariant 1 written as an assignment, so the
undo cannot leave the database in a state the harness would then report. It works because
the baseline itself satisfied invariant 1 — which the pass confirmed before it started.

**Two things the undo does not restore, on purpose.** `teacher_profiles.last_seen_at` moved
when the teachers went online, and `wallets.updated_at` moved when balances did. Both are
clock readings rather than state, neither is counted by `diff`, and re-writing a timestamp
to a value it never held is a worse lie than leaving it.

### After the undo

    $ node scripts/reconcile.mjs diff --baseline .baseline.json

    database: localhost:5433/tutor_now

    baseline taken 2026-08-23T06:35:54.886Z

    AT BASELINE — every counted table and the credit total are where they were.

    $ echo $?
    0

And the invariants again on the restored database, because a diff that shows zero row
delta and a wrong balance would be a real finding and the count alone cannot see it:

    ✔ 1. wallets whose balance disagrees with their ledger — none
    ✔ 2. sessions whose total_charged disagrees with their blocks — none
    ✔ 3. sessions whose split does not add up — none
    ✔ 4. sessions whose ledger rows disagree with their columns — none
    ✔ 5. teachers left IN_SESSION with no session running — none

    RECONCILED — five invariants, zero rows.

Verified by count, not by assumption — 6.9's phrase, and this epic adds the second half of
it, because these rows include balances.

## Open items

1. ~~**F1 — the settlement reads `users.created_at` where §5.3 means
   `teacher_profiles.created_at`.**~~ **Closed by 7.9.** `findSessionForMeter` joins
   `teacher_profiles` now.
2. ~~**F2 — `IncomingOffer.expectedEarning` is the gross for everybody.**~~ **Closed by
   7.9**, through the read 5.6 already had. Open since E5, where it was that epic's ninth
   gap; it became worth fixing when E7 made the difference real money. Both are held by
   `server/tests/commission.column.test.js`, which is the first fixture in the repo whose
   `users.created_at` and `teacher_profiles.created_at` are deliberately months apart —
   the reason neither defect was visible to a green suite.
3. **The budget cap has no setter.** §5.1 says the student sets it; `DEFAULT_BUDGET_CAP` is
   40 and nothing writes it. At ₪14 a block or more the cap forbids every extension.
4. **The deployed application has not run this pass and must not yet.** 6b.2's rewrite is
   live and unused because the Vercel bundle has the absolute Render URL baked in, so a
   student on the deployed application is signed out fifteen minutes after login,
   mid-session. A twenty-operation money pass through a session that logs the student out
   halfway measures the wrong thing.
   `docs/epics/E6b-live-path-repair/PR-6b.4-e6b-close.md` is the open PR that closes it and
   it is also DEV-A's. Until

       curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
         https://totur-now-client-vnxx.vercel.app/api/v1/nope

   returns `404 application/json`, a deployed re-run belongs there, not here.
5. **Neon still carries three probe sessions from 7.4 and two probe top-ups from 7.3.** Left
   in place by decision — an append-only ledger is not a thing to tidy by hand. The three
   sessions have `total_charged` with no `session_blocks` rows and break invariant 2 on that
   database. If this pass is ever run against Neon, those five rows are known and are not
   findings.

## What one epic of money cost, in plain words

**A verification pass found what tests could not, sixth epic running.** 775 tests pass, and
they pass on a codebase where the platform's commission is computed from the wrong column.
Both defects are one word each — `users` instead of `teacher_profiles`, `new Date()`
instead of an argument — and both are unreachable from a suite that injects its
collaborators, because the mistake is not in the logic. It is in what the logic is handed.

**The invariant held twenty-three times out of twenty-three, including the three times
nothing was supposed to happen.** That is the part worth keeping. `wallet.service.js` was
written by hand under §17.5, every balance change in this epic goes through it, and the
one thing that could have gone wrong — a balance moving without a ledger row, or a row
without a balance move — did not, once, across five wallets, three refund branches, two
concurrency races and two deliberate `402`s.
