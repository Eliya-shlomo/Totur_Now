# E1 — Retro

| | |
|---|---|
| **Closed** | 2026-08-12 |
| **Verified by** | Eliya (DEV-A) and Rotem (DEV-B), two machines, against the deployed Vercel + Render pair |
| **Result** | All 17 checklist items in [PR-1.7](PR-1.7-auth-hardening.md) passed |

E1 is the first epic run through this `docs/` structure end to end. This file exists to
carry what it taught into E2, while the details are still recoverable.

## What the structure was supposed to buy

Two developers writing "auth" in the same days without editing the same files. Three
moves, from the epic README: one blocking PR freezes the route skeleton, the work is cut
by **flow** rather than by layer, and every file carries a suffix naming its flow.

## What it actually bought

**The suffix split worked where it was applied.** `auth.register.service.js` and
`auth.session.service.js` were written in parallel by two people and never conflicted
once. Same for the controllers and the validators. The extra files cost nothing and the
merges were clean.

**The frozen router worked.** `auth.routes.js` was written once in 1.1 with all five
endpoints wired against modules that did not exist yet. 1.2 and 1.4 each filled in a
controller and a schema and never opened the router. This is the single highest-value
move in the epic and it should be repeated verbatim in E2.

## What it did not buy: the repository layer

`user.repository.js` was **not** suffixed, and it is the one file both flows had to
write to — 1.2 needed a create, 1.4 needed a lookup for `/auth/me`. The merge spliced
the two versions together and produced a file that was not valid JavaScript:

```
SyntaxError: Unexpected token '{'
server/src/repositories/user.repository.js:35
```

Repaired in `3e05e3c`, PR #9.

The cost was not the fix, which was small. The cost is that **`main` did not boot at all**
for as long as it took someone to notice, and nothing in the process was watching. Two
PRs both went green in review; the breakage existed only in the merge result, which no
reviewer ever looked at.

**The lesson is not "suffix the repositories too."** It is that the suffix rule was applied
to the layers the brief happened to name — services, controllers, validators — and stopped
there, because the rule lived in prose rather than in a list of files. For E2 the epic
README names *every* shared file up front and says, per file, whether it is frozen,
append-only, or split.

## What it did not buy: the deploy

`docs/DEPLOYMENT.md` opens with "Both halves of the deployment are live from E0 on
purpose", and the whole of E1 was written on that assumption. It was not true.

- The Render service did not exist. It was created on 2026-08-12, during 1.7.
- `VITE_API_URL` on Vercel held the literal placeholder string `https://<render-url>/api/v1`,
  copied out of the docs and never replaced. Vite inlines that at build time, so it sat
  baked into the deployed bundle.
- `CORS_ORIGINS` on Render was still the development default, so the first request from
  the Vercel origin came back `403 FORBIDDEN` even after the URL was fixed.

Visible symptom for most of the epic: the pricing page rendering "Could not load pricing".
The server was fine the whole time — `GET /api/v1/public/pricing` answers correctly and
always did.

Three separate misconfigurations, none of them caught by a test, a build, or a review,
because all three live in dashboards rather than in the repo. `render.yaml` and
`vercel.json` are in git precisely so infrastructure can be reviewed — but the values
marked `sync: false` are the ones that broke, and those are exactly the ones a file
cannot hold.

**For E2:** the definition of done includes one curl against the deployed API, run on the
day the epic opens rather than on the day it closes. Not a checklist item at the end — a
gate at the start.

## Ownership drift

The plan gave PR 1.3 (auth screens) to DEV-A. It was delivered by DEV-B in PR #10, on a
branch named `dev-b/E1.3-auth-ui-nav-logout`, with a near-duplicate `dev-b/E1-auth-ui-nav-logout`
left behind on the remote.

No harm done — 1.3 touched no file DEV-A had open. But the reassignment happened in chat
and the table in the README still said DEV-A, so for a few days the written plan and the
actual work disagreed. Anyone reading the repo to find out who owned the auth screens
would have got the wrong answer.

**For E2:** an owner change is an edit to the README table in the same push as the branch.
One line, and the repo stops lying.

## Stale references

`routes.teacher.jsx` still points at PRs `2.6` and `2.7` for the onboarding and profile
screens. Those numbers come from the pre-8/11 version of E2, which had seven PRs before
the exam, academic email and document queue were cut. E2's briefs renumber them to 2.4
and 2.5, and the placeholders are updated in the PR that replaces each screen.

## Carried into E2

1. One blocking PR freezes the domain router. Same shape as 1.1.
2. The epic README lists every shared file by name with its rule, before any brief is written.
3. A deployed-environment check on day one, not day last.
4. Owner changes land in the README in the same push.
