# PR 0.3 — Server core: constants, AppError, error codes, handlers

| | |
|---|---|
| **Epic** | E0 — Foundation |
| **Owner** | DEV-A (reassigned — every remaining DEV-A PR in E0 was blocked behind this one) |
| **Size** | M |
| **Written by** | **Human** (`MVP.md` §17.2 — shared contracts are human-written) |
| **Depends on** | 0.1 |
| **Blocks** | 0.4, and every server PR |
| **Branch** | `dev-b/E0.3-server-core` |

## Contract implemented

The error contract from [`MVP.md` §12](../../MVP.md) and §15.3, and the constants
table from the MVP appendix.

## Scope

Land the three things every later server PR depends on and none of them should
reinvent: the constants, the error type, and the error middleware.

Constants go in a **folder**, one file per domain, with a barrel index — not the
single `constants.js` the MVP appendix implies. Same reasoning as the schema split:
it stops being a merge conflict every time either developer adds a number.

`AppError` carries `code`, `message`, `statusCode`, `details`, and
`isOperational`. `asyncHandler` wraps controllers so rejected promises reach the
handler. `errorHandler` is the last middleware in the stack, emits the exact shape
from §12, logs non-operational errors with path and user id, and never leaks an
internal message to the client.

Also land the two small utilities that both auth slices in E1 will need, so neither
E1 PR has to create them and collide: `utils/password.js` (bcrypt hash/compare, 12
rounds) and a `validate(schema)` middleware that runs Zod against
`{ body, params, query }` and throws `VALIDATION_ERROR` with per-field `details`.

## Files you may touch

```
server/src/config/constants/index.js      barrel, append-only from here on
server/src/config/constants/session.js    BLOCK_MINUTES, OPENING_BLOCKS, EXTENSION_BLOCKS,
                                          WARNING_SECONDS, GRACE_SECONDS, OFFER_TTL_SECONDS,
                                          AUTO_AWAY_MINUTES, NO_SHOW_WINDOW_SEC
server/src/config/constants/money.js      price bounds + bands, PLATFORM_FEE_PCT, NEW_TEACHER_FEE_DAYS,
                                          LOW_DEMAND_HOURS, TOPUP_PACKAGES, DEFAULT_BUDGET_CAP
server/src/config/constants/matching.js   MATCH_COUNT, MATCH_WEIGHTS, BAYES_C,
                                          PARENT_TOPIC_WEIGHT, NEW_TEACHER_SESSIONS
server/src/config/constants/llm.js        LLM_TIMEOUT_MS, MIN_CONFIDENCE
server/src/config/errors/codes.js         the code list from MVP.md §12
server/src/config/env.js                  env loading + fail-fast validation via Zod
server/src/utils/AppError.js
server/src/utils/asyncHandler.js
server/src/utils/logger.js
server/src/utils/password.js
server/src/middlewares/errorHandler.js
server/src/middlewares/validate.js
shared/errorCodes.js                      single source, re-exported by config/errors/codes.js
```

Added by the review pass (PR #2), same scope:

```
server/src/config/constants/app.js        TIMEZONE
server/src/utils/time.js                  currentHour(), isLowDemandHour()
server/src/utils/fieldErrors.js           moved out of errorHandler.js
```

## Files you must NOT touch

```
prisma/**
client/**
server/src/app.js        (0.4 creates it)
```

## Acceptance criteria

Verified by a throwaway harness that mounted a minimal Express app and exercised the
real middleware chain — 16/16 assertions passed.

- [x] Every constant in the `MVP.md` appendix exists, with the exact value given there
- [x] `constants/index.js` re-exports all domain files; one import gets everything
- [x] Error codes live in `shared/` so the client can import the same list
- [x] `errorHandler` output matches `MVP.md` §12 byte-for-byte in shape
- [x] A non-operational error returns `INTERNAL_ERROR` with a generic message and logs the real one
- [x] An operational `AppError` returns its own code, message, and `details`
- [x] `validate()` on a bad body produces `VALIDATION_ERROR` with a per-field `details` object
- [x] `env.js` exits at boot, naming the variable, if config is missing or malformed
- [x] `password.js` uses 12 rounds, from a constant, not a literal
- [x] Async rejections reach the error handler via `asyncHandler`
- [x] Prisma `P2002` becomes a field-level `VALIDATION_ERROR`, not a 500
- [x] `MATCH_WEIGHTS` sum to exactly 1.0
- [x] Logger redacts passwords, hashes and tokens at any nesting depth

## Manual test

1. `throw new AppError(ERROR_CODES.TEACHER_UNAVAILABLE, 'gone')` → 409, exact shape, no status literal needed.
2. `throw new Error('boom')` → 500, generic message to the client, full stack in the log.
3. Break a required env var, boot → exits 1 with the variable named. Verified for a
   short secret, a malformed `DATABASE_URL`, and production missing its service keys.

## Deviations from this brief, and why

| Brief said | Built | Why |
|---|---|---|
| (not listed) | `constants/auth.js` | PR 1.1 needs every value in it; creating it there means an E1 PR editing `constants/` instead of importing from it |
| (not listed) | `ERROR_STATUS` map in `shared/` | Status is a property of the code, not of the call site. `new AppError(TEACHER_UNAVAILABLE, '...')` no longer repeats `409` everywhere |
| (not listed) | `AppError.notFound()` etc. | Shorthands for the codes thrown most often |
| (not listed) | `burnPasswordComparison()` | See below |
| (not listed) | Prisma error translation in `errorHandler` | `P2002` reaching the client as a 500 is the default outcome otherwise |
| (not listed) | `.env.example` | Brief assigns it to 0.9, but `env.js` is meaningless without the list it validates against |
| `logger.js` unspecified | Redacting structured logger | Passwords and tokens in logs are the easiest security mistake to make and the hardest to notice |

**Two worth explaining.**

`burnPasswordComparison()` runs a bcrypt compare against a throwaway hash. PR 1.4
requires login to answer identically for a wrong password and an unknown email —
but without this, the unknown-email path skips bcrypt entirely and returns
measurably faster, which is an account-enumeration oracle. Identical response
bodies are not enough; the timing has to match too. Verified: the two paths are
within 2× of each other.

`MATCH_WEIGHTS` throws at import time if the weights do not sum to 1.0. A typo
there does not crash anything — it silently skews every ranking, and E4's
acceptance test would fail for reasons that look like a scoring bug.

## Amended after review (PR #2)

The brief above records what was built. This section records what the review
changed, because three of the four would have surfaced as bugs in a later epic
rather than here.

| Was | Is | Why it mattered |
|---|---|---|
| `LOW_DEMAND_HOURS` in "server local time" | `TIMEZONE` + `utils/time.js`, resolved through `Intl` | Local time is Israel on a laptop and UTC on Render. The commission-free window would have been correct in development and three hours wrong in production — the worst kind of bug, because nothing fails |
| `NO_AVAILABLE_TEACHERS` → 404 | → 409 | Nothing is missing when the matcher returns empty. It is a state the request collided with, and one that may differ a minute later. `MVP.md` §9 already returns it as a `reason` on an otherwise-normal result |
| `fieldErrors` exported from `errorHandler.js` | `utils/fieldErrors.js` | `validate()` imported it from another middleware. E3's classifier needs the same function inside a *service*, and a service importing a middleware is the direction that eventually closes into a cycle — which in ESM fails as `undefined` at call time, not at import |
| `import 'dotenv/config'` | path resolved from `import.meta.url` | `dotenv` resolves against cwd, and `npm run dev -w server` sets cwd to `server/`. The root `.env` was never found. Nothing had caught it because 0.3 ships no entry point — PR 0.4 would have been the first to run it, and would have looked broken |

Also settled here: **one `.env` for the whole monorepo, at the repo root.**
`client/.env.example` is folded into the root one and Vite's `envDir` points at it.
Sharing the file with the server is safe because Vite exposes only the `VITE_`
prefix — the server's keys beside it are unreachable, not merely unused. PR 0.8's
brief carries the Vercel-specific consequences.

Two more from the same review, applied without changing behaviour: `validate()`
passes `configurable` and `enumerable` explicitly when redefining `req.query`
(both default to `false`, which made a second `validate()` on one route throw),
and `ERROR_STATUS` groups the three 409s together.

Deliberately **not** changed: the bcrypt `hashSync` at module load. It costs ~300ms
of boot once and buys the timing equalizer described above.

## Notes

`shared/errorCodes.js` is deliberately the single source: the client's axios
interceptor (PR 0.6) switches on these codes, and two drifting lists would be a
silent bug. From this PR onward the file is **append-only, alphabetical**
(`OWNERSHIP.md` §2).

The 0.1 scaffold's `config/scaffold.js` is deleted here — `config/` is real now.

**Unblocks 0.6 immediately.** 0.4 also depends on this and is still DEV-B's.
