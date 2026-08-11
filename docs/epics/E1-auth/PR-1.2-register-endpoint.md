# PR 1.2 — `POST /auth/register` + wallet + profile transaction

| | |
|---|---|
| **Epic** | E1 — Auth & Users |
| **Owner** | DEV-A |
| **Size** | M |
| **Written by** | Agent (human reviews the transaction) |
| **Depends on** | 1.1, 0.2 |
| **Blocks** | 1.3, 1.7 |
| **Branch** | `dev-a/E1.2-register-endpoint` |

## Contract implemented

`POST /auth/register` from `MVP.md` §12, and `MVP.md` §18/E1.6 (wallet auto-created
on registration), which is folded in here because it must share the transaction.

## Scope

Registration, end to end on the server.

Validate with Zod: email, password (minimum length, from a constant), full name,
role restricted to `student | teacher` — **`admin` must be rejected**, since an
open endpoint that mints admins is the kind of hole that ships. Role-conditional
fields: a student may send `grade` and `mathLevel`; a teacher sends neither.

Then, in **one Prisma transaction**: create the `users` row with a bcrypt hash from
0.3's `password.js`, create the matching `student_profiles` or `teacher_profiles` row,
and create the `wallets` row at balance 0. All three or none — a user without a wallet
breaks the matching hard filter in E4 in a way that is very hard to trace back here.

Teacher rows are created with the defaults from `MVP.md` §11.2:
`price_per_block = 10`, `status = OFFLINE`, `level_max = 3`. Those defaults come from
`DEFAULT_PRICE_PER_BLOCK` in `config/constants/money.js` and `DEFAULT_LEVEL_MAX` in
`config/constants/teacher.js`, not from literals. There is no badge column — standing
is computed by `#utils/standing.js` (§6.2), and a brand-new teacher computes to `NEW`.

Respond `201` with `{ user, accessToken }` and the refresh cookie set, using 1.1's
token service — the shape frozen in the [epic README](README.md), identical to login's.

Duplicate email returns a clean `VALIDATION_ERROR` on the email field, not a raw
Prisma `P2002`.

## Files you may touch

```
server/src/services/auth.register.service.js
server/src/repositories/user.repository.js
server/src/controllers/auth.register.controller.js     replace the 1.1 stub
server/src/validators/auth.register.schema.js
shared/api.d.ts                                        the E1 section only
```

## Files you must NOT touch

```
server/src/routes/auth.routes.js                       frozen in 1.1
server/src/services/auth.token.service.js              DEV-B
server/src/services/auth.session.service.js            DEV-B
server/src/middlewares/**                              DEV-B
prisma/schema/**                                       need a change? ask DEV-B
client/**
```

## Acceptance criteria

- [ ] A student registration creates exactly three rows: `users`, `student_profiles`, `wallets`
- [ ] A teacher registration creates `users`, `teacher_profiles` (with spec defaults), `wallets`
- [ ] `role: 'admin'` in the body is rejected by validation
- [ ] All three inserts are in one transaction — a forced failure on the third leaves zero rows
- [ ] The password hash is bcrypt at 12 rounds via `utils/password.js`; the plaintext appears nowhere in logs
- [ ] `password_hash` is not in the response
- [ ] Duplicate email → `VALIDATION_ERROR` with `details.email`, not a 500 and not a Prisma code
- [ ] Response is `201 { user, accessToken }` **plus** the refresh cookie
- [ ] The `user` object is field-identical to what `POST /auth/login` returns in 1.4
- [ ] `wallets.balance` starts at 0 and no `wallet_transactions` row is created

## Manual test

1. Register a student → 201, three rows present, cookie set in the response headers.
2. Register a teacher → `teacher_profiles.price_per_block = 10`, `status = OFFLINE`, and `standingOf()` on the new row returns `NEW`.
3. Register the same email twice → clean field-level validation error.
4. `role: 'admin'` → rejected.
5. Temporarily throw inside the transaction after the user insert → no orphan `users` row remains.
6. Diff your response body against 1.4's login response. Any difference is a bug in one of the two.

## Review checklist additions

- The transaction is real (`prisma.$transaction`), not three sequential awaits with hope.
- No teacher default is a literal. They come from the constants folder.

## Notes

Wallet creation lives here rather than in its own PR — as a separate PR it would
necessarily be non-transactional, which is precisely the bug. `MVP.md` §18 lists it
as 1.6; that is the one item in E1 we deliberately merge.

The last acceptance item is the epic's stated risk: two endpoints returning
almost-identical user objects. Compare them side by side before opening the PR.
