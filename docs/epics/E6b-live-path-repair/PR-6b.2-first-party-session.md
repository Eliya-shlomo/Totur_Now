# PR 6b.2 — First-party session: proxy the API, keep the cookie

| | |
|---|---|
| **Epic** | E6b — Live-Path Repair |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent. |
| **Depends on** | E6 (merged) |
| **Blocks** | 6b.4 |
| **Branch** | `dev-a/E6b.2-first-party-session` |

## Contract implemented

None. `MVP.md` §15.5's token strategy, unchanged, delivered over a transport the browser
does not throw away.

## Scope

The refresh cookie is set correctly and the browser refuses to keep it. Client on
`*.vercel.app`, API on `*.onrender.com` — different registrable domains, so `tn_refresh`
is a **third-party** cookie, and third-party cookies are blocked by default in Chrome
incognito, in Safari always, and in Firefox's Total Cookie Protection.
`SameSite=None; Secure` makes the cookie *eligible* to travel cross-site; it does not
override a browser that declines to store it. Fifteen minutes later the access token
expires, `refresh()` sends no cookie, the server answers `401`, and `onAuthLost` sends a
student with a live meter to the login screen.

**Make the API first-party.** A rewrite in `client/vercel.json` maps `/api/*` on the
Vercel deployment to the Render service, and `VITE_API_URL` becomes the relative
`/api/v1`. Every HTTP call is then same-origin, `tn_refresh` is a first-party cookie on
the site the user is actually looking at, and no tracking protection anywhere has an
opinion about it.

**The socket does not go through the proxy, and this is the one way this PR can break
something that works.** Vercel's rewrites do not carry a WebSocket upgrade.
`socketOrigin()` in `lib/socket.js` derives the socket's origin from `VITE_API_URL`, and
its `catch` already returns `window.location.origin` for a relative base — which, after
this change, is Vercel, which cannot serve the socket. So the socket needs its own
variable, `VITE_SOCKET_URL`, holding the Render origin, with `socketOrigin()` reading it
and falling back to today's behaviour when it is unset. The socket does not need the
cookie: `lib/socket.js` presents the access token through its `auth` callback, which is
why splitting the two transports is possible at all.

**`sameSite` follows the deployment, and both arrangements stay supported.** Once the
API is same-origin in production, `'lax'` is correct and tighter. But the Render origin
must keep working when called directly — a QA session against the API, a second client,
the fallback if the proxy is ever removed. So the value is driven by an explicit
variable rather than by `env.isProduction`, defaulting to today's behaviour, and
`app.js`'s CORS list keeps the Vercel origin.

Everything else about the strategy is unchanged: access token in memory, refresh token
`httpOnly` and never readable by JavaScript, rotation on every refresh, one in-flight
refresh shared by every caller.

**The custom-domain answer is better and is not this PR.** `app.example.com` plus
`api.example.com` is one site, a plain `SameSite=Lax` cookie, and no proxy hop. It needs
a purchased domain. Note it in the PR body as the follow-up; ship the rewrite today.

## Files you may touch

```
client/vercel.json                              the /api rewrite to the Render service
client/src/lib/socket.js                        socketOrigin() reads VITE_SOCKET_URL
client/src/api/client.js                        only if the base URL needs the relative case handled
server/src/services/auth.token.service.js       refreshCookieOptions(): sameSite from a variable
server/src/config/env.js                        the new variable, optional, defaulting to today
server/src/app.js                               the CORS comment, if the origin list's reasoning moves
.env.example                                    VITE_SOCKET_URL, and the sameSite variable
render.yaml                                     the sameSite variable, if it needs declaring
server/tests/auth.token.test.js                 the cookie options under each arrangement
```

## Files you must NOT touch

```
client/src/stores/authStore.js         the strategy is right. Only its transport moves
server/src/controllers/auth.*.js       the refresh flow is correct and unchanged
server/src/services/auth.session.service.js
client/src/pages/teacher/**            6a.5's and 6b.3's ground
client/src/components/offer/**
shared/api.d.ts                        frozen for this epic — E6a appends to it in 6a.4
```

## Acceptance criteria

- [ ] In a **private/incognito window** on the deployed client: log in, wait past the access token's 15 minutes with the tab open, and the user is still signed in
- [ ] In the same window, DevTools → Application → Cookies shows `tn_refresh` under the **client's own origin**
- [ ] `POST /auth/refresh` in the network tab is a same-origin request and returns `200` with a new access token
- [ ] The socket connects and stays connected — `offer:new` still raises the teacher's modal, and the session clock still ticks
- [ ] Calling the Render origin directly with `Origin: <vercel url>` still passes CORS and still sets a usable cookie
- [ ] `npm test` passes; the cookie-options test asserts both arrangements

## Manual test

1. Open the deployed client in a **private window**. Log in as a student.
2. DevTools → Application → Cookies. `tn_refresh` is listed under the client's origin, `HttpOnly` and `Secure` ticked.
3. Start a session with a teacher. Leave both windows open for **20 minutes**.
4. The student is still signed in, the clock is still running, the teacher never sees "lost their connection".
5. Reload the student tab. Still signed in — bootstrap's refresh found the cookie.
6. Repeat steps 1–2 in **Safari**. Same result.

## Review checklist additions

- The socket's origin must be asserted, not assumed. A test or a logged line proving the
  socket is pointed at the Render origin and not at Vercel — this is the failure mode
  that would ship looking fine on a fast local network and break on the deployed app.
- `refreshCookieOptions()` must stay one function feeding both `setRefreshCookie` and
  `clearRefreshCookie`. Its comment explains why: a cookie's identity is name + domain +
  path, and a `clearCookie` that disagrees leaves a logged-out user logged in.
- No behaviour may be gated on `env.isProduction` where a deployment can differ from it.
  That coupling is what made the original `sameSite` line correct in reasoning and wrong
  in effect.

## Notes

The comment above `refreshCookieOptions()` reasons the cross-site case out correctly and
reaches the only conclusion available at that layer. `SameSite=None` is genuinely the
right value *given* two sites. The defect is one level up: the two-site arrangement
itself, chosen in PR 0.8 and 0.9 when the client and the API were deployed to whichever
platform was free, and never revisited when a refresh cookie became load-bearing.

Nothing here is incognito-specific, and the epic README says why at length. Safari has
blocked third-party cookies by default for years, and §4.1's student is on a phone.
Every iOS user of this product is signed out fifteen minutes after logging in.
