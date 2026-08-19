# PR 6.4 — `getSessionVideoContext` + `GET /sessions/:id/video`

| | |
|---|---|
| **Epic** | E6 — Session Lifecycle & Video |
| **Owner** | DEV-B (rotem) — **and the seam's other half is DEV-C's, called not opened** |
| **Size** | S |
| **Written by** | Agent, **reviewed as security code.** It is fifty lines and it is the one place in E6 where getting the check wrong is a breach rather than a bug. |
| **Depends on** | 6.3 |
| **Blocks** | 6.7 |
| **Branch** | `dev-b/E6.4-session-video-endpoint` |

## Contract implemented

`GET /sessions/:id/video` → `SessionVideoResponse` (`{ roomUrl, token, expiresAt }`), and
`OWNERSHIP.md` §2.1's third function:

```js
// server/src/services/session.video.service.js — DEV-B, because it reads the database
getSessionVideoContext(sessionId, userId) → { roomName, roomUrl, userName }
```

## Scope

**This PR is the replacement for the two endpoints 6.1 deleted**, and the difference between
them is the whole point. `POST /video/access` took a room name from the request body and
minted a token for it behind nothing but `authenticate`. This one takes a *session* id and
asks the database whether the caller is in it.

**`getSessionVideoContext` is DEV-B's, and the epic README says why in one line: it reads
the `sessions` table, and the video layer may not.** The seam is not "everything with the
word video in it belongs to C" — it is "the provider SDK and nothing else". A helper that
answers *may this person join* is a session-authorisation question wearing a video name.

Three things it checks, in this order, all inside one read:

1. the session exists
2. its status is `ACTIVE`
3. `userId` is its `student_id` or its `teacher_id`

**Any failure is `404 NOT_FOUND`. Never `403`, and never a different message per cause.** A
`403` on a session id confirms that the session exists, which is the leak `GET /sessions/:id`
already refuses to produce — same rule, same reason, and the two must not disagree, because a
`404` from one endpoint and a `403` from the other is an oracle. The three cases are
distinguishable in the *log*, at `warn`, with the caller's id. They are not distinguishable
over the wire.

**`ACTIVE` only.** An `ENDED` session's participants may still read `GET /sessions/:id` — they
need the summary and the rating screen — but nobody gets a fresh meeting token for a lesson
that is over. That is `SESSION_NOT_ACTIVE`'s natural home and it is still answered as `404`
here rather than `409`, because the caller might be a stranger and the distinction between
"over" and "not yours" is exactly what must not leak.

**The controller is three calls and no logic:**

```js
const ctx    = await getSessionVideoContext(sessionId, req.user.id);   // DEV-B, may 404
const access = await createSessionVideoAccess({                        // DEV-C's, 6.1's
  roomName: ctx.roomName, userId: req.user.id, userName: ctx.userName,
});
res.json({ success: true, data: { roomUrl: ctx.roomUrl, ...access } });
```

`userName` comes from the database, never from the request. The deleted endpoint took it
from the body, so a stranger could walk in *and* choose the name on the tile. It is
`users.full_name`, read in the same query as the participation check.

**Minted per call, cached nowhere.** Two people in a session get two tokens; a reload gets a
third. Anything that stored one and handed it out again is the deleted endpoint wearing a
different name.

**The repair path.** If the session is `ACTIVE` and `video_room_name` is null — 6.3's
degraded case, a Daily outage at accept time — this endpoint creates the room, persists it
through `setSessionVideoRoom`, and continues. **Once, and only when the columns are null.**
It is guarded by a conditional write so two participants pressing join in the same second do
not create two rooms and leave one of them talking to himself: the update matches on
`video_room_name IS NULL`, and the loser re-reads the winner's row.

If creation fails here too, the error is `EXTERNAL_SERVICE_ERROR` (502) — genuinely, because
this time the caller asked for a call and cannot have one. The session screen renders
everything else, which is 6.7's job.

## Files you may touch

```
server/src/services/session.video.service.js   new — getSessionVideoContext + the repair
server/src/controllers/session.controller.js   fill the getSessionVideo handler
server/src/repositories/session.repository.js  ONLY findSessionForVideo's body — 6.2's gap
client/src/api/session.api.js                  append getSessionVideo(sessionId)
server/tests/session.video.test.js             new — createSessionVideoAccess stubbed
docs/epics/E6-session-lifecycle/README.md      tick the status box
```

## Files you must NOT touch

```
server/src/services/video.*.service.js   6.1's, frozen. Call it; do not open it
server/src/routes/session.routes.js      frozen again after 6.2 — the route is already wired
server/src/repositories/session.repository.js  everything except findSessionForVideo's body
shared/**                                frozen at 6.2
client/src/components/session/VideoRoom.jsx    DEV-C's, and 6.7 mounts it
client/src/pages/**                      6.7's
prisma/**                                no migration
```

## Acceptance criteria

- [ ] A participant in an `ACTIVE` session gets `200` with a `roomUrl`, a `token` and an `expiresAt` roughly `VIDEO_TOKEN_TTL_SECONDS` out
- [ ] Both participants get **different** tokens for the same room, and two calls by the same person also differ
- [ ] The token actually works: pasted into `VideoRoom` or Daily's own test page, it joins
- [ ] A third user's request → `404`, with a body byte-identical to the one a nonexistent session id produces
- [ ] A nonexistent session id → `404`
- [ ] An `ENDED`, `RATED` or `NO_SHOW` session → `404`, for a participant as well as a stranger
- [ ] No token is issued anywhere without a participation check — `grep -rn "createSessionVideoAccess" server/src` returns one call site
- [ ] `userName` on the minted token is `users.full_name` from the database; nothing in the request can influence it
- [ ] An `ACTIVE` session with null video columns gets a room created on the first join, and two simultaneous joins produce **one** room, not two
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. Two browsers into an `ACTIVE` session. `GET /sessions/:id/video` from each; compare the two tokens — different
2. Register a third user, log in, and call the same URL. `404`. Diff it against the response for `…/sessions/00000000-0000-0000-0000-000000000000/video` — identical bytes
3. `update sessions set video_room_name = null, video_room_url = null where id = …`, then call from both browsers at once. One room name in the row afterwards, both callers holding tokens for it
4. End the session by hand — `update sessions set status = 'ENDED'` — and call again as a participant. `404`
5. Read the server log for steps 2 and 4: three distinguishable `warn` lines for three different causes, all of which were one response over the wire

## Review checklist additions

- **Read the failure paths first.** Every one must produce the same status, the same code and the same message. A single `403`, or one message that says "not active" and another that says "not found", is the defect.
- Confirm `userName` is not read from `req.body` or `req.query`. This is what the deleted endpoint got wrong.
- Confirm the status check is `=== 'ACTIVE'` and not `!== 'ENDED'`. An allowlist, not a denylist — `PENDING`, `OFFER_SENT`, `CANCELLED` and `NO_SHOW` must all fail closed.
- Confirm the repair write is conditional on the columns being null and that its loser re-reads rather than overwriting.
- Confirm nothing caches the token — not in a module variable, not on the row, not in a header.

## Notes

**Why this is its own PR and not four lines inside 6.3.** Because it is the security boundary
of the epic, and a boundary buried in a two-hundred-line diff about activation gets reviewed
at the same depth as the rest of that diff. Fifty lines with their own acceptance criteria
and their own denylist get read as fifty lines that matter. E5 made the same call for its
lock, for the same reason, and its retro said the lock was the epic.

**Why `404` and not `403`, one more time, because it is the thing a well-meaning later PR
will "fix".** The rule is not about being unhelpful. It is that this endpoint is reachable by
anybody with a session uuid, and uuids appear in URLs, logs and screenshots. `403` means *this
is real and you are not in it*; `404` means nothing at all. `GET /sessions/:id` already made
this choice in 5.4 and the two endpoints must agree, because a `404` from one and a `403` from
the other is an oracle built out of two individually correct decisions.

**What the video layer never learned.** It was handed a room name, a user id and a display
name, and it minted a token. It does not know there is a session, cannot check one, and is not
asked to. That is the seam holding.
