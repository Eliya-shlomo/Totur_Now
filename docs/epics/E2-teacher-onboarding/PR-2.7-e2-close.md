# PR 2.7 — E2 close: verification + retro

| | |
|---|---|
| **Epic** | E2 — Teacher Onboarding |
| **Owner** | DEV-A (eliya), with DEV-B for the two-machine test |
| **Size** | S |
| **Written by** | Human |
| **Depends on** | 2.2–2.6 all merged |
| **Blocks** | E4 |
| **Branch** | `dev-a/E2.7-e2-close` |

## Contract implemented

The epic's definition of done, verified rather than assumed.

## Scope

The closing PR, mirroring 1.7. It ships almost no code. Ownership alternates — DEV-B closed
E1, DEV-A closes E2 — so neither developer is the only person who has ever run the
end-to-end check.

**Before anything else**, run the deployed-environment check the E1 retro asked for. Thirty
seconds, at the *start*:

```bash
curl https://tutor-now-api.onrender.com/health
```

If that is not `{"success":true,"data":{"status":"ok","db":"ok",...}}`, stop and fix the
environment. E1 spent an entire epic on an assumption that turned out false.

**Verification.** Walk the checklist below on the deployed Vercel + Render pair, both
developers, two machines. Anything that fails is fixed here if it is small, or filed and
fixed before E4 starts if it is not.

**Documentation.** Add a teacher walkthrough to `docs/DEPLOYMENT.md` §"Verifying a
deploy" — register, onboard, go online, appear in the list — so a future deploy can be
smoke-tested by someone who did not write this epic.

**Retro.** Write `docs/epics/E2-teacher-onboarding/RETRO.md`. Answer specifically: did
freezing the repository in 2.1 prevent the E1 splice, or just move it? Did the audience cut
hold, or did the two tracks end up in each other's files anyway? Was 2.6-depends-on-2.2 a
real cost or a non-event? E1's retro is the format.

## The end-to-end checklist

Run on **production**, on two machines.

- [ ] `/health` green before starting
- [ ] Register a new teacher → lands in `/teach`
- [ ] Stepper resumes at the right step after closing the tab mid-flow
- [ ] Topics, level and price all persist; removing a topic removes it
- [ ] Price slider bounds match `GET /public/pricing`
- [ ] "Go online" → the teacher appears in `/teachers` within one refresh
- [ ] New teacher carries the `New` badge and shows no rating
- [ ] A seeded teacher with sessions carries the badge `standingOf` computes for their row
- [ ] `/teachers` browsable logged out, in a private window
- [ ] Every filter narrows; combined filters narrow further; a filtered URL is shareable
- [ ] `/teachers/:id` matches the list entry
- [ ] Editing the profile is reflected on the public profile
- [ ] Offline toggle removes the teacher from `?onlineOnly=true`
- [ ] `PATCH /teachers/me` with a student's token → `FORBIDDEN`
- [ ] `PATCH /teachers/me` with `status: 'IN_SESSION'` → `VALIDATION_ERROR`
- [ ] `PATCH /teachers/me` with `pricePerBlock: 21` → `VALIDATION_ERROR`
- [ ] No public payload contains an email, a `status`, or a private counter
- [ ] `GET /teachers` against the 15 seeded teachers issues a constant number of SQL statements
- [ ] Both screens usable at 375px
- [ ] Two teachers editing simultaneously on two machines → no cross-talk
- [ ] Server logs contain no password, hash, or token

## Files you may touch

```
docs/DEPLOYMENT.md
docs/epics/E2-teacher-onboarding/RETRO.md         new
docs/epics/E2-teacher-onboarding/README.md        tick the status boxes
server/src/config/constants/teacher.js            only if a limit is genuinely wrong
```

## Files you must NOT touch

```
Any feature file from 2.1–2.6. A bug there is a follow-up PR by that file's owner,
not a drive-by fix here.
```

## Notes

The two-machine step matters more than it looks, and for a different reason than in E1.
There it was cookie scope and CORS. Here it is stale reads: two teachers editing at once,
one going online while the other refreshes the public list. Single-machine testing cannot
produce the interleaving.

Nothing in E4 starts until every box above is ticked. The matching engine ranks teachers on
exactly the fields this epic writes — a wrong `levelMax` or a stale `status` becomes a
wrong match, and a wrong match is the one failure the product cannot recover from.
