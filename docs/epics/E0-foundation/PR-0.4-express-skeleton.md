# PR 0.4 — Express skeleton, health, security middleware, route registry

| | |
|---|---|
| **Epic** | E0 — Foundation |
| **Owner** | DEV-B |
| **Size** | S |
| **Written by** | Agent (human reviews the security config) |
| **Depends on** | 0.3 |
| **Blocks** | 0.9, every server route PR |
| **Branch** | `dev-b/E0.4-express-skeleton` |

## Contract implemented

`GET /health`, the `/api/v1` base path from `MVP.md` §12, and the security posture
from §15.5.

## Scope

Assemble `app.js`: Helmet, CORS with an explicit origin whitelist from env, JSON
body limit, cookie-parser, request logging, rate limiting, the versioned router, a
404 handler, and `errorHandler` last.

The critical piece is the **route registry**. `app.js` mounts exactly one router:
`routes/index.js`, which is an append-only list of one line per domain router. This
is what lets both developers add endpoints for the next ten days without ever
touching `app.js` again.

Rate limiting: a strict limiter reserved for auth routes and question creation
(per §15.5) and a loose global one. Export both; do not apply the strict one here —
the auth epic wires it to its own routes.

## Files you may touch

```
server/src/app.js
server/src/server.js               http server boot, graceful shutdown
server/src/routes/index.js         the registry — append-only from here on
server/src/routes/health.routes.js
server/src/middlewares/rateLimit.js
server/src/middlewares/notFound.js
```

## Files you must NOT touch

```
server/src/config/**       (0.3 owns it)
server/src/utils/**        (0.3 owns it)
prisma/**  client/**
```

## Acceptance criteria

- [ ] `GET /health` returns `{ success: true, data: { status: 'ok', db: 'ok', uptime } }`
- [ ] The health check actually pings the database, and reports `db: 'down'` without crashing
- [ ] All feature routes will mount under `/api/v1`
- [ ] CORS rejects an origin not in the whitelist; the whitelist comes from env
- [ ] Helmet is enabled
- [ ] An unknown path returns the standard error shape with `NOT_FOUND`
- [ ] `errorHandler` is the last middleware registered
- [ ] `routes/index.js` is a flat, alphabetical, one-line-per-router list
- [ ] Server shuts down cleanly on SIGTERM (Render sends it on every deploy)

## Manual test

1. `curl localhost:3000/health` → 200 with `db: 'ok'`.
2. Stop Postgres, `curl` again → still 200, `db: 'down'`. The process is alive.
3. `curl -H "Origin: https://evil.com"` → CORS rejection.
4. `curl localhost:3000/api/v1/nope` → 404 in the standard error shape.

## Notes

**`app.js` is frozen after this PR** (`OWNERSHIP.md` §2). Every later route goes into
the registry. If you find yourself needing to edit `app.js` in E3, stop and ask
whether the thing belongs in a router instead — it almost always does.
