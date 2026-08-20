# PR 6b.1 — Give production the video key, and refuse to start quietly without it

| | |
|---|---|
| **Epic** | E6b — Live-Path Repair |
| **Owner** | DEV-A (eliya) |
| **Size** | S |
| **Written by** | Agent. |
| **Depends on** | E6 (merged) |
| **Blocks** | 6b.4 |
| **Branch** | `dev-a/E6b.1-daily-key-production` |

## Contract implemented

None. `MVP.md` §11's video call, made to exist on the deployed application.

## Scope

`render.yaml` never declared `DAILY_API_KEY`, so the deployed API has never had one, so
`env.DAILY_API_KEY` has been undefined since PR 6.1 and `videoNotConfigured()` has fired
on every session ever started in production. It also still declares `ZOOM_ACCOUNT_ID`,
`ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` — the provider PR 6.0 migrated away from, and
which no file in `server/` reads.

Three things.

**Declare the key.** `DAILY_API_KEY` joins the `sync: false` block beside
`GEMINI_API_KEY`, with the same comment convention: Render does not read it from the
blueprint, it prompts for it. Then set it in the Render dashboard from the same account
the local `.env` uses, and redeploy. **Setting the value is the part that actually fixes
production; the YAML change is what stops it being forgotten the next time the service
is recreated.**

**Delete the Zoom variables.** Three keys for a provider that was removed two PRs ago,
sitting in the file that documents what the service needs. `OWNERSHIP.md` §2.1's rule is
that one grep for the provider returns one file; a blueprint naming the wrong provider
is that rule failing in the place a human reads first.

**Say it out loud at boot.** Add a production-only startup check that logs at `error`
when `DAILY_API_KEY` is missing — one line, at boot, naming the variable and what stops
working without it. It does **not** exit; a degraded video call is a worse product than
a dead API, and the epic's bar is that the state is impossible to miss, not impossible
to enter. `env.js` keeps `.optional()` — development without a key must keep working,
which is the property that makes `npm test` hermetic.

Where the check lives is the only real decision. It belongs beside the other boot-time
environment reasoning rather than inside `video.daily.service.js`, which is
provider-owned and must stay swappable.

## Files you may touch

```
render.yaml                            declare DAILY_API_KEY, delete the three ZOOM_* keys
.env.example                           the DAILY_API_KEY comment gains "required in production"
server/src/config/env.js               the production-only assertion, or the seam it calls
server/src/config/video.js             only if the assertion is better placed here — argue it in the PR
server/tests/config.env.test.js        new, if one does not exist: the assertion's own test
```

## Files you must NOT touch

```
server/src/services/video.daily.service.js    the provider seam. OWNERSHIP.md §2.1
server/src/services/video.service.js
server/src/services/session.video.service.js  6.4's repair path is correct and this PR proves it
client/src/components/session/VideoRoom.jsx
package.json                                  "test" stays hermetic
docs/epics/E6a-*/**                           another epic's chain
```

## Acceptance criteria

- [ ] `grep -c ZOOM render.yaml` returns `0`
- [ ] `render.yaml` declares `DAILY_API_KEY` with `sync: false`
- [ ] Booting the server in production mode with no `DAILY_API_KEY` logs one `error`-level line naming `DAILY_API_KEY`, and the process stays up and serves `/health`
- [ ] Booting in development with no key logs nothing new — `npm test` output is unchanged
- [ ] `npm test` passes with no `DAILY_API_KEY` set and no network
- [ ] On the deployed API after the key is set: a session started from a real accept has non-null `video_room_name` and `video_room_url`

## Manual test

1. `DAILY_API_KEY= NODE_ENV=production npm run start:server` — one error line, server up.
2. Same with the key set — no error line.
3. Set `DAILY_API_KEY` in the Render dashboard for `tutor-now-api`, redeploy.
4. Run one offer end to end. The session room shows a camera, not "No video on this session".
5. `select video_room_name, video_room_url from sessions order by created_at desc limit 1;` — both non-null.

## Review checklist additions

- The assertion must not read `env.DAILY_API_KEY` in a way that makes the variable
  required to the Zod schema. `optional()` in `env.js` is what keeps the test suite and
  local development runnable, and a required variable would be this PR breaking
  `npm test` to fix a deployment.
- Nothing in this PR may change what happens *after* a video failure. 6.3's swallow and
  6.4's repair are correct, and the only reason they were never seen working is that
  there was never a key.

## Notes

The log line that opened this epic — `"Video is not available right now."` with
`EXTERNAL_SERVICE_ERROR` — has two producers, `video.daily.service.js:27` and
`session.video.service.js:153`. Both are downstream of the same missing key, and the
second one only fires because the first one already did. Do not add a third sentence for
a third cause; `session.video.service.js`'s own comment explains why that file has
exactly one failure.

E6a's README makes this epic's argument in its own domain: a subsystem that fails
silently and returns plausible output is worse than one that throws. Video had the same
shape, one layer lower — every degradation path worked perfectly and none of them was
allowed to say why.
