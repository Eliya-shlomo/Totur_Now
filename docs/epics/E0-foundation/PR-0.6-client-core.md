# PR 0.6 — Client core: axios, interceptor, ErrorBoundary, UI primitives

| | |
|---|---|
| **Epic** | E0 — Foundation |
| **Owner** | DEV-A |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 0.5 (and 0.3 for `shared/errorCodes.js`) |
| **Blocks** | 0.8, every client PR that calls the server |
| **Branch** | `dev-a/E0.6-client-core` |

## Contract implemented

The client half of the error contract in [`MVP.md` §15.3](../../MVP.md).

## Scope

The API layer and the error surface — the second half of the client foundation.

One axios instance with `baseURL` from env and `withCredentials` for the refresh
cookie. A response interceptor normalizes every server response: on success return
`data.data`; on failure throw a client-side `ApiError` carrying `code`, `message`,
and `details` from the server's envelope, with a sane fallback when the server is
unreachable and there is no envelope at all.

Leave a documented, empty seam for 401 refresh handling. **Do not implement refresh
here** — it needs `authStore` and belongs to E1.5. Implementing it now means E1.5
rewrites this file, which is exactly the conflict this structure avoids.

Then the pieces every screen needs and no screen should invent: an `ErrorBoundary`
at the root, a `notify` helper wrapping Mantine notifications so error toasts look
identical everywhere, and three primitives — `<LoadingState/>`, `<ErrorState/>`,
`<EmptyState/>` (icon, message, optional CTA). Their existence is what makes
"every list has an empty state" a review item rather than a wish.

## Files you may touch

```
client/src/api/client.js               the axios instance + interceptor
client/src/api/ApiError.js
client/src/lib/notify.js
client/src/components/ErrorBoundary.jsx
client/src/components/state/LoadingState.jsx
client/src/components/state/ErrorState.jsx
client/src/components/state/EmptyState.jsx
client/src/App.jsx                     mount ErrorBoundary only
client/.env.example
```

## Files you must NOT touch

```
client/src/theme.js  client/src/router/index.jsx     frozen in 0.5
client/src/stores/**                                 E1 creates these
server/**  prisma/**
```

## Acceptance criteria

- [ ] All server calls go through the single axios instance; nothing imports `axios` directly
- [ ] A success response resolves to the payload, not the `{ success, data }` envelope
- [ ] A server error rejects with `ApiError` carrying the server's `code`, `message`, `details`
- [ ] A network failure with no envelope still produces an `ApiError` with a readable message
- [ ] `ApiError` codes are compared against the imported `shared/errorCodes.js` — no string literals
- [ ] The 401-refresh seam exists, is commented, and is a no-op that E1.5 fills in
- [ ] A thrown render error shows the ErrorBoundary fallback with a recovery action, not a blank page
- [ ] The three state primitives render correctly at 375px

## Manual test

1. Point the client at a stopped server → readable error toast, no blank screen, no raw axios message.
2. Temporary component that throws in render → ErrorBoundary fallback appears; the rest of the app is unaffected.
3. Hit `/health` through the client instance → resolves to the payload object directly.

## Notes

`client/src/api/client.js` is a **single-owner file, DEV-A** (`OWNERSHIP.md` §2).
E1.5 is the one exception — it fills the refresh seam — and that is written into the
E1.5 brief so it is not a surprise.
