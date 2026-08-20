# PR 6b.4 — E6b close: the three-defect walk, on the deployed app

| | |
|---|---|
| **Epic** | E6b — Live-Path Repair |
| **Owner** | DEV-A (eliya) |
| **Size** | S |
| **Written by** | Agent. |
| **Depends on** | 6b.1, 6b.2, 6b.3 (all merged and deployed) |
| **Blocks** | — |
| **Branch** | `dev-a/E6b.4-e6b-close` |

## Contract implemented

None. The epic's definition of done, observed rather than asserted.

## Scope

One walk on the **deployed** application, run by a human, in a **private window on both
sides**, and a retro.

The private window is not a stress test, it is the configuration all three defects were
found in and the one that most resembles a first-time user: no stored session, no
warmed cache, third-party cookies blocked. A walk in a normal signed-in window would
pass today for reasons that have nothing to do with this epic's fixes.

The walk is the one from `MVP.md` §4.1, end to end, with the teacher parked somewhere
other than the dashboard on purpose. Twenty minutes wall-clock, so that the access
token's fifteen expires inside the session rather than after it — an hour of debugging
was spent on a symptom that only appears after minute fifteen, and a five-minute walk
would have missed all of it.

The retro records what the three defects had in common, which is the only thing about
this epic worth carrying to E7: all three passed every test in the repository, and all
three were properties of the deployment rather than of the logic. Two of them lived in
`render.yaml` and `vercel.json` — files no test imports and no review checklist opens.

## Files you may touch

```
docs/epics/E6b-live-path-repair/README.md    status column → ☑
docs/epics/E6b-live-path-repair/RETRO.md     new
docs/DEPLOYMENT.md                           the two variables and the proxy, if they are not recorded there
```

## Files you must NOT touch

```
server/**
client/**
shared/**
render.yaml
client/vercel.json
docs/epics/E6a-*/**
```

A close PR that edits code is a fourth defect wearing a close PR's branch name. If the
walk fails, the fix is a commit on the PR that owns the file.

## Acceptance criteria

- [ ] The full walk below completes, in private windows, on the deployed application
- [ ] Neither participant is signed out at any point during a 20-minute session
- [ ] Both participants see and hear each other
- [ ] The teacher was not on `/teach` when the offer arrived
- [ ] `RETRO.md` exists and names, for each defect, the layer that would have caught it and why nothing did
- [ ] `docs/DEPLOYMENT.md` records `DAILY_API_KEY`, the socket origin variable, and the `/api` rewrite

## Manual test

The walk, in order, both windows private:

1. Student registers or logs in. Submits a question with a **photograph** of an exercise.
2. Student picks a teacher and sends the request.
3. **The teacher is sitting on `/teach/profile`.** The modal appears there.
4. Teacher accepts. Both land in the session room.
5. **Both cameras are live.** No "No video on this session".
6. Leave it running **20 minutes**. Neither side is signed out; neither side sees "lost their connection"; the clock and the charge both advance.
7. End the session. Student rates. Wallet and earnings both move.

Note what is still wrong. E6a owns the classification; if the topic badge reads
"General / Unclassified", that is expected here and is not this epic's failure.

## Review checklist additions

- Every criterion above must be checked against the deployed URLs, not `localhost`. The
  whole epic is about the difference.
- The retro must not be written before the walk. It is the record of an observation.

## Notes

E6's own close (6.9) is still open, and its verification is the same shape as this one.
Do not merge the two: 6.9 answers whether the session lifecycle was built, and this
answers whether the deployment lets it run. Both were true of E6 at once and the second
one is the one that had never been asked.
