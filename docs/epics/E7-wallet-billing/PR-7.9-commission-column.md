# PR 7.9 — §5.3 has three implementations and two of them are wrong

| | |
|---|---|
| **Epic** | E7 — Wallet & Billing |
| **Owner** | DEV-A (eliya) |
| **Size** | S |
| **Written by** | Agent, from 7.8's findings |
| **Depends on** | nothing. It is a two-line fix and a test that would have caught it |
| **Blocks** | a deployed re-run of 7.8's pass |
| **Branch** | `dev-a/E7.9-commission-column` |
| **Found by** | PR 7.8's twenty-operation pass. See `RETRO.md`, F1 and F2 |

## Contract implemented

None new. `MVP.md` §5.3, which is already implemented once correctly and twice not.

## The defect

`utils/commission.js` is one pure function and its header says why it is only one:

> Two implementations of §5.3 is two answers to "what did I earn", and the one the teacher
> was quoted at accept time is the one that has to hold.

There are three call sites and they disagree.

| Call site | What it passes as `teacherCreatedAt` | Answer |
|---|---|---|
| `session.offer.service.js:436` — the offer email (5.6) | `findTeacherForNotification`'s `teacher_profiles.created_at` | **Correct** |
| `session.view.service.js:168` — `IncomingOffer.expectedEarning`, the accept modal (5.4) | a hardcoded `new Date()` | Always `0`. Quotes the **gross** |
| `session.repository.js:699` — `findSessionForMeter`, every settlement (6.6) | `t.created_at` where `t` is **`users`** | The account's registration date, not the teacher's start date |

### F1 — the settlement reads `users.created_at`

`commission.js` states the contract in the parameter's own doc comment:

> `teacherCreatedAt` is the teacher's own start date, and callers pass
> `teacher_profiles.created_at` — when they became a teacher, not when the account was
> registered. A student who onboards as a teacher a year later gets their free month from
> the day they onboarded, which is what the incentive is for.

`findSessionForMeter` joins `users`:

```sql
LEFT JOIN users t ON t.id = s.teacher_id
...
t.created_at AS "teacherCreatedAt"
```

The comment above the join reads "The teacher's `users` row is joined for
`platformFeeRate`'s `teacherCreatedAt` — §5.3's rate is computed from when the teacher
joined". So this is a belief rather than a slip, and the fix has to correct the sentence
as well as the column.

**Who it hurts.** A teacher who registered as a student and onboarded as a teacher more
than thirty days later is charged 15% from their first lesson and never receives the free
month §5.3 buys. E2's onboarding stepper is exactly that path. The error is always in the
platform's favour.

**Why the suite is green.** Every test injects `teacherCreatedAt` directly, so it exercises
`platformFeeRate` against a date the test chose. The defect is entirely in which column
the SQL selects. **Why the seed hides it.** `prisma/seed` writes the user and the profile
in the same transaction, so both timestamps are milliseconds apart for all sixteen demo
teachers.

### F2 — the accept modal quotes the gross

`session.view.service.js:168` hardcodes `new Date()`, so `expectedEarning` is the gross for
everybody. This is E5's ninth gap, stated in that epic's README, left open deliberately
because 5.3 shipped before `findTeacherForNotification` existed and 5.6 only closed the
email half. The comment there says the fix is "one argument at one call site" and it still
is.

It stopped being harmless when E7 made the third number real money. Before this epic
nothing was ever paid, so three answers cost nothing.

## Reproduction

```bash
docker exec tutor_now_db psql -U tutor -d tutor_now -c "
  UPDATE users SET created_at = created_at - interval '60 days'
   WHERE email = 'omer.d@demo.tutornow.il';"
```

Run a session with that teacher, set `started_at` outside the quiet window
(`date_trunc('milliseconds', now() - interval '18 hours')`), end it. `platform_fee` is 15%
of the gross. Now move the 60 days from `users` to `teacher_profiles` instead and repeat:
`platform_fee` is `0`, which is the wrong answer for the same teacher.

## Scope

Three changes and one test file.

1. **`session.repository.js`** — `findSessionForMeter` joins `teacher_profiles` for
   `created_at` instead of `users`. The `FOR UPDATE OF s` argument in the header still
   holds and still needs saying: the joined row must not be locked. The paragraph naming
   `users` is corrected in the same commit.
2. **`session.view.service.js`** — `teacherView` takes the teacher's `teacher_profiles.created_at`
   and passes it. Whether that arrives through the existing session read or through
   `findTeacherForNotification`'s repository function is the implementer's call; the second
   is already written and already returns the right column.
3. **A test that fails before either fix.** Both defects are about *which column*, so a
   test that injects a date cannot see them. This needs a repository-level test against a
   real row where `users.created_at` and `teacher_profiles.created_at` differ — the one
   fixture nobody would build by accident, which is the whole reason both survived six
   epics.

## Files you may touch

```
server/src/repositories/session.repository.js   the join, and the paragraph that argues for it
server/src/services/session.view.service.js     one argument at one call site
server/tests/**                                 the test that would have caught it
docs/epics/E7-wallet-billing/README.md          tick the box
```

## Files you must NOT touch

```
server/src/utils/commission.js       §5.3 is correct. It is the callers that are wrong
server/src/services/wallet.service.js   §17.5, and nothing here moves money
prisma/**                            no column changes and none needed
client/**                            the screens render what the server sends
```

## Acceptance criteria

- [ ] A teacher whose `users.created_at` is 60 days old and whose
      `teacher_profiles.created_at` is 5 days old is charged **no** commission
- [ ] A teacher whose `users.created_at` is 5 days old and whose
      `teacher_profiles.created_at` is 60 days old **is** charged 15%
- [ ] `IncomingOffer.expectedEarning` for the second teacher is the net, not the gross
- [ ] The offer email and the accept modal and the ledger row all answer the same number
      for the same session — the property `commission.js`'s header was written to protect
- [ ] The new test fails on `main` and passes on the branch
- [ ] `npm test` green, `npm run lint` clean

## Notes

**Do not fix this inside a close PR.** 7.8's review checklist says a close PR that also
contains a money fix is a close PR whose reconciliation output was produced by different
code than the one that merged. That is why this is a separate brief.

**The third implementation is the one to keep.** `session.offer.service.js` already reads
the right column through a repository function written for exactly this. Two call sites
move toward it; none of them gets a fourth arithmetic.
