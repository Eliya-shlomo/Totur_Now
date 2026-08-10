# PR 0.3 — Server core: constants, AppError, error codes, handlers

| | |
|---|---|
| **Epic** | E0 — Foundation |
| **Owner** | DEV-B |
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
server/src/config/constants/money.js      PRICE_TIERS, PLATFORM_FEE_PCT, NEW_TEACHER_FEE_DAYS,
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

## Files you must NOT touch

```
prisma/**
client/**
server/src/app.js        (0.4 creates it)
```

## Acceptance criteria

- [ ] Every constant in the `MVP.md` appendix exists, with the exact value given there
- [ ] `constants/index.js` re-exports all domain files; importing `@/config/constants` gets everything
- [ ] Error codes live in `shared/` so the client can import the same list
- [ ] `errorHandler` output matches `MVP.md` §12 byte-for-byte in shape
- [ ] A non-operational error returns `INTERNAL_ERROR` with a generic message and logs the real one
- [ ] An operational `AppError` returns its own code, message, and `details`
- [ ] `validate()` on a bad body produces `VALIDATION_ERROR` with a per-field `details` object
- [ ] `env.js` throws at boot, with a clear message, if a required env var is missing
- [ ] `password.js` uses 12 rounds, from a constant, not a literal

## Manual test

1. Temporary throw route: `throw new AppError('TEACHER_UNAVAILABLE', 'gone', 409)` → 409 with the exact shape.
2. Temporary throw route: `throw new Error('boom')` → 500, generic message to client, full error in the log.
3. Delete a required env var, boot → clear startup failure, not a runtime surprise.

## Notes

`shared/errorCodes.js` is deliberately the single source: the client's axios
interceptor (PR 0.6) switches on these codes, and two drifting lists would be a
silent bug. From this PR onward the file is **append-only, alphabetical**
(`OWNERSHIP.md` §2).
