# PR 6.1 — Import the Daily video layer

| | |
|---|---|
| **Epic** | E6 — Session Lifecycle & Video |
| **Owner** | **DEV-C (amit)** — the hat, worn by the one developer. Keep the branch prefix so `git log` says which surface this touched. |
| **Size** | S |
| **Written by** | Agent, carrying existing code. **The two deletions are the reviewed part.** |
| **Depends on** | — (independent of 6.0) |
| **Blocks** | 6.3, 6.4, 6.7 |
| **Branch** | `dev-c/E6.1-daily-video-import` |

## Contract implemented

`OWNERSHIP.md` §2.1, the video seam, as two exported functions:

```js
createSessionVideo(sessionId)              → { provider, roomName, roomUrl, expiresAt }
createSessionVideoAccess({ roomName, userId, userName }) → { token, expiresAt }
```

Plus the client component the session screen mounts:

```jsx
<VideoRoom roomUrl={...} token={...} onJoined={} onLeft={} onError={} />
```

## Scope

**This PR carries code that already exists and works.** `origin/dev-c/daily-video` has
been sitting since E2: it creates private Daily rooms over REST, mints per-caller meeting
tokens, and embeds the call with `@daily-co/daily-react`'s prebuilt iframe. §18 called this
"the highest-risk PR in the project" when the provider was Zoom and the mechanism was
Server-to-Server OAuth. It is neither. **Do not rewrite it. Carry it, delete two files,
and freeze the signatures.**

**Cherry-pick, do not merge.** The branch forked at `7672853` — E2's close — so its tree
predates E3, E4 and E5 entirely. A merge brings back a three-epic-old `routes/index.js`
that would silently delete the question, matching, offer and session routers.

**What comes across:**

| From the branch | Change on the way in |
|---|---|
| `server/src/config/video.js` | The two TTLs read from `env` with the current literals as defaults |
| `server/src/services/video.daily.service.js` | Unchanged, except the missing-key path — see below |
| `server/src/services/video.service.js` | Unchanged. The two functions are already exactly the seam |
| `client/src/components/session/VideoRoom.jsx` | Unchanged. The prop signature is frozen here |
| `client/package.json` — `@daily-co/daily-js`, `@daily-co/daily-react`, `jotai` | Unchanged, plus the lockfile |
| `server/src/config/env.js` — `DAILY_API_KEY` | Plus `VIDEO_ROOM_TTL_SECONDS` and `VIDEO_TOKEN_TTL_SECONDS`, both optional coerced numbers |

**What does not, and why the second row is the reviewed part of this PR:**

| Dropped | Why |
|---|---|
| `client/src/pages/video/VideoDemoPage.jsx`, `client/src/video-demo-main.jsx`, `client/video-demo.html` | A second Vite entry point that existed to prove the component works. It did. A demo page that reaches a live provider and is reachable from the built client is a surface nobody maintains. |
| `server/src/controllers/video.controller.js`, `server/src/routes/video.routes.js`, `client/src/api/videoApi.js` | **`POST /video/access` mints a Daily token for whatever `roomName` the body carries, behind nothing but `authenticate`.** Any logged-in user can walk into any room whose name they have seen and pick their own display name doing it. The video layer cannot fix this, because fixing it means asking the database who belongs in that session, and the video layer may not read the database. So the endpoint moves to where the session is — `GET /sessions/:id/video`, PR 6.4. |
| the branch's `server/src/routes/index.js` | It reformatted an append-only registry and predates three routers. E6 appends nothing to that file: there is no `/video` mount. |

**One behavioural change, and only one.** `createVideoRoom` and `createVideoAccessToken`
currently throw a bare `Error` when the key is unset:

```js
if (!env.DAILY_API_KEY) throw new Error('DAILY_API_KEY is not configured');
```

A bare `Error` reaches `errorHandler` as a 500 with no code, which means a missing key
would fail the *accept* — turning an optional integration into a required one. It becomes
an `AppError(EXTERNAL_SERVICE_ERROR)` like every other failure in the file, so 6.3 can
catch it by code and carry on with null columns. **The degradation itself is 6.3's and
6.4's; this PR only makes it catchable.**

The TTLs get one sentence each in `video.js`, because the numbers are load-bearing and
non-obvious: the **room** outlives any session including extensions and exists so an
abandoned room does not live for ever; the **token** is minted on every join and is short
because it is the only thing standing between a leaked URL and a stranger in the lesson.
`ends_at` ends a session. Daily does not.

## Files you may touch

```
server/src/config/video.js                       new — from the branch, TTLs via env
server/src/config/env.js                         DAILY_API_KEY + two TTLs, optional
server/src/services/video.daily.service.js       new — from the branch
server/src/services/video.service.js             new — from the branch
client/src/components/session/VideoRoom.jsx      new — from the branch, unchanged
client/package.json                              three dependencies
package-lock.json                                the lockfile that follows
.env.example                                     already carries the block; confirm it matches env.js
server/tests/video.service.test.js               new — fetch stubbed, never called for real
docs/epics/E6-session-lifecycle/README.md        tick the status box
```

## Files you must NOT touch

```
server/src/routes/index.js                  no /video mount, and never the branch's version
server/src/routes/**                        6.2 owns the only route change in this epic
server/src/repositories/**                  the video layer does not read the database
prisma/**                                   6.0's
client/src/pages/**                         6.7's
client/vite.config.js                       the demo entry point is dropped, not registered
```

## Acceptance criteria

- [ ] `grep -rn "api.daily.co" server/src` returns exactly one file: `video.daily.service.js`
- [ ] `grep -rn "prisma\|repository" server/src/services/video.*.js` returns nothing
- [ ] There is no route under `/video` — `curl -i localhost:3000/api/v1/video/access` is `404`
- [ ] `server/src/routes/index.js` is byte-identical to `main`'s
- [ ] With `DAILY_API_KEY` unset, `createSessionVideo('x')` rejects with an `AppError` carrying `EXTERNAL_SERVICE_ERROR` — not a bare `Error`, not a 500
- [ ] With the key set, calling `createSessionVideo` by hand once returns a `roomUrl` that opens in a browser
- [ ] `VideoRoom.jsx`'s props are exactly `{ roomUrl, token, onJoined, onLeft, onError }` and the file is unchanged from the branch
- [ ] The client builds — `npm run build` in `client/` — with no unresolved `daily-co` or `jotai` import
- [ ] No test in the suite makes a network call to Daily
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. Put a real `DAILY_API_KEY` in `.env` and restart the server
2. `node --input-type=module -e "import('./server/src/services/video.service.js').then(m=>m.createSessionVideo('probe')).then(console.log)"` — a room name and a URL come back
3. Open the `roomUrl` in a browser. Daily says the room is private and refuses without a token — **that is the pass**, not a failure
4. Comment the key out, restart, run step 2 again: an `AppError` with `EXTERNAL_SERVICE_ERROR`, and the server did not fall over
5. `curl -i localhost:3000/api/v1/video/rooms -X POST` → `404`

## Review checklist additions

- Confirm the two deleted endpoints are actually deleted and not just unmounted. An unmounted router is one appended line away from being live again.
- Confirm `jotai` is in `client/package.json` as a real dependency and is not imported by any of our own code. It is `daily-react`'s peer, not a state-management decision — §15.1 stays Zustand, and a reader who finds `jotai` in the manifest deserves the comment saying why.
- Confirm the TTL defaults still equal the branch's literals — 86400 and 3600. This PR makes them settable; it does not change them.
- Confirm `max_participants: 2` is still on the room-creation body. It is the only thing stopping a third person walking in, and its cost is written up in 6.7.

## Notes

**Why the video layer may not read the database, restated in the PR that could most easily
break the rule.** It has nothing to do with layering purity. The rule is what makes the
*grep* meaningful: one file says `api.daily.co`, no file in `services/video.*` says
`prisma`, and those two facts together mean the provider can be swapped by rewriting one
file. The moment the video service reads `sessions`, it owns a slice of session semantics
and the swap becomes an epic.

**Why `createSessionVideo` takes a `sessionId` it does not use.** It validates that one was
passed and otherwise ignores it — the room is not named after the session and Daily is
never told the id exists. It stays in the signature because the seam is "give me a session,
get me a room": the day rooms are named or tagged per session, the signature does not
change and no caller moves. It costs one unused parameter and buys the seam a future.
