# Handoff — build E10 (Responsive, Error UX & Polish)

Written 2026-08-23, immediately after E8 closed. Read this file top to bottom before
opening any other file. It is the brief for **one agent** taking E10 from nothing to
merged.

---

## 0. What you are building, in one sentence

**Every screen in the product is usable at 375px, and every failure path shows something a
human can read instead of a blank page** — `MVP.md` §18's E10 acceptance criterion,
unchanged.

E10 is **six PRs and an audit**, not six features. Most of what §18 lists as E10 work
already exists in the repository, shipped incidentally by earlier epics. Your first job is
to find out exactly how much, and your epic README's "Deliberate deviations from `MVP.md`
§18" table is where you write down what you found. E8 did the same thing and its README is
the model to copy.

---

## 1. Read these, in this order, before writing anything

| # | File | Why |
|---|---|---|
| 1 | `docs/CONVENTIONS.md` | Non-negotiable. Layering, naming, imports, git, lint. A PR that breaks one of these is not reviewed |
| 2 | `docs/OWNERSHIP.md` §0, §2, §3.2 | §0's new paragraph says the DEV-A/DEV-B split is historical — one developer since E5. §3.2 splits the client router by area, which is the one file E10 could otherwise fight over |
| 3 | `docs/MVP.md` §14 (screens), §18's E10 block, §17.5 | §14.1 is the screen tree you are auditing. §17.5 lists what may not be agent-written — **nothing in E10 is on that list**, which is unusual and worth knowing |
| 4 | `docs/epics/E8-ratings-reputation/README.md` | The most recent epic README. Copy its shape: contract freeze, deviations table, risks, parallelism map, checklist |
| 5 | `docs/epics/E8-ratings-reputation/RETRO.md` | Four open findings. **You are not fixing them** — see §6 below |
| 6 | `docs/epics/_TEMPLATE-epic.md` and `_TEMPLATE-pr.md` | The two shapes you are filling in |
| 7 | `docs/epics/E7-wallet-billing/RETRO.md` §"Mutation ledger" | The format your close PR's pass has to follow |

Do not skim 1 and 2. Almost every review comment this repository has ever produced is a
line in one of them.

---

## 2. Ground truth — what already exists

Verified against `main` at commit `b86a7f9`. Check each one yourself before you plan
around it; the point of the list is that §18's row titles are misleading.

| §18's E10 row | What is actually in the repo | What is genuinely left |
|---|---|---|
| 10.1 Landing + pricing (guest) | `client/src/pages/guest/Landing.jsx` and `Pricing.jsx`, both routed in `router/routes.guest.jsx`, both shipped in 1.6 | Judge them against §14.1 and against 375px. Probably a polish PR, not a build PR |
| 10.2 Public online-teachers list | `pages/guest/Teachers.jsx` + `TeacherProfile.jsx` (E2, plus 8.3's reviews section), filters in `components/teacher/TeacherFilters.jsx` | §18 says **online** teachers. Check whether the guest list defaults to online-only and whether that is the right default — `findTeacherPage`'s `onlineOnly` defaults to `false` and its comment says why |
| 10.3 Mobile pass, 375px audit | `components/nav/BottomNav.jsx` and `SidebarNav.jsx` exist and work | **This is the real work of the epic.** Every screen, every state, 375px. Nobody has ever audited them as a set |
| 10.4 Global error UX | `components/ErrorBoundary.jsx`, `lib/notify.js` (`success` / `info` / `error` / `apiError`), and the server's `fieldErrors.js` → `details` contract | Inline field errors are per-form and inconsistent — find the forms that drop `details` on the floor. `ErrorBoundary` wraps the whole router in `App.jsx`, so one throwing screen blanks the entire shell including the nav; decide whether a per-area boundary is worth it, and write the reason down either way |
| 10.5 Empty states + skeletons | `components/state/EmptyState.jsx`, `ErrorState.jsx`, `LoadingState.jsx`, used by most lists | **There is not one `Skeleton` in the client.** Decide deliberately whether to add them or to declare `LoadingState` sufficient and write the reason down. Then find the lists that use none of the three |
| 10.6 Socket disconnect banner | `hooks/useSessionState.js` tracks `connected` and re-joins on reconnect — **only on the session screen** | A global banner. The teacher on `/teach` whose socket died gets no offers and no warning; that is the case this row exists for |

Two more things that are true and not obvious:

- **`client/src/theme.js` and `client/src/router/index.jsx` are frozen** (OWNERSHIP §2, since PR 0.5). Shared values live in `theme.other`. A responsive pass that hardcodes a breakpoint in a component instead of reading `theme.other` is the exact failure that freeze exists to prevent.
- **`client/src/api/client.js`'s interceptor already unwraps `{success, data}` and rejects with an `ApiError`.** Every screen's error path starts from an `ApiError` whose `.message` is safe to render. No screen should be reaching into `error.response`.

---

## 3. What to produce, in order

### 3.1 The epic docs first, code second

1. `docs/epics/E10-polish/README.md` — from `_TEMPLATE-epic.md`. Must contain:
   - a **definition of done** that is one observable sentence, not a list of PRs;
   - the **deviations table** recording everything in §2 above that §18 got wrong;
   - a **contract freeze** section — E10 adds no endpoints, so freeze the *client* contracts instead: which component owns the empty state, which owns the loading state, what a banner is allowed to render, and where a breakpoint constant lives;
   - a **risks** section that is specific. "Responsive work is fiddly" is not a risk. "Three screens render the same list component and a fix to one silently changes the other two" is;
   - the checklist at the bottom, ticked honestly.
2. One `PR-10.n-<slug>.md` per PR, from `_TEMPLATE-pr.md`. Every brief needs an **allowlist**, a **denylist**, acceptance criteria a human can check in five minutes, and a manual test.
3. Only then write code.

This ordering is not ceremony. E8's briefs are why its six PRs never touched the same file
twice, and the one file that two PRs did share was named in the README before either
started.

### 3.2 Per PR

    branch:  dev-a/E10.<n>-<slug>
    commits: Conventional Commits, scope `client` (or `server` if you truly touch it)
    merge:   git merge --no-ff into main, then push
    docs:    tick the status box in the epic README in the same PR

Run before every commit:

```bash
npm test && npx eslint client/src server/src
```

886 tests pass on `main` today. If your number is lower, you broke something; if it is
higher, say so in the commit message.

### 3.3 The close PR

`10.7` or whatever number it lands on: **a close PR that edits code is a defect wearing a
close PR's branch name.** It runs the pass, writes `RETRO.md`, updates `docs/README.md`'s
epic index row and `docs/OWNERSHIP.md` if E10 created or took over a file. `git diff
--stat` shows `docs/` only.

E10's pass is a **screen inventory**, not a database walk. Every route in
`router/routes.*.jsx`, at 375px, in four states — loading, error, empty, populated — with
the result recorded as ✅ / ❌ / ⏳ and never a blank. That table *is* the retro.

---

## 4. How to run and verify

```bash
npm run db:up
npm run db:seed
npm run dev
```

Seeded password for every demo account: `TutorNow!2026`. Emails are in
`prisma/seed/teachers.js` and `prisma/seed/students.js`.

- **Verify in the browser, never by asking the user to check.** Use the preview/browser tools: resize to 375px, read the page, screenshot the result. `document.documentElement.scrollWidth === clientWidth` is the horizontal-scroll assertion — use it on every screen rather than eyeballing.
- **Ports 3000 and 5173 may already be held by another session's dev server.** That server runs `node --watch` against this working tree, so it picks up your edits without a restart. Do not start a second one and do not edit `.claude/launch.json` to work around it.
- **A `PLATFORM_AVERAGES_CACHE_MS` style cache does not exist on any E10 path**, but the client's own state does: reload rather than trusting HMR when you are asserting a load-time behaviour.

---

## 5. Hazards — read these twice

1. **`server/.env` holds production Neon credentials and `NODE_ENV=production`.** The repo's one real env file is the **root** `.env` (local Docker, `localhost:5433`). Anything that loads `dotenv/config` with `cwd=server/` — the Prisma CLI, any scratch script — gets the cloud database instead. E8's close pass hit this and read from Neon before noticing. **Never run `npm run db:seed`, `prisma migrate`, or any script from inside `server/`.** This is E8 RETRO's finding **F5** and it is still open.
2. **The local database is not at seed state.** E8's pass left six questions, two sessions, two reviews and their ledger rows behind, and `npm run db:seed` upserts rather than deletes. If you need a clean baseline, `prisma migrate reset` is the only thing that gives you one — **ask the user before running it**, because it destroys the evidence E8's retro cites.
3. **Do not fix E8's four findings inside E10.** F1 (`newTeacherBoost` cancels 8.2's smoothing), F2 (§18's criterion measures score not position), F3 (the parent stats row never reaches the score where a leaf row exists) and F4 (`end_reason: 'error'` races the room mint) each need their own PR with its own measurement. They are listed in `docs/epics/E8-ratings-reputation/RETRO.md` § Open items.
4. **`6b.4` is still open and the deployed offer path is still broken** (`docs/README.md`, `docs/DEPLOYMENT.md`). E10 is local-first work so it is not blocked by that — but do not write anything in E10's docs that claims the deployed product works.
5. **Never reformat a file you are not otherwise changing.** A responsive pass is exactly the epic where a stray Prettier run over the whole client would bury the real diff.

---

## 6. Scope boundary

E10 is a **client** epic. If you find yourself opening `server/src/services/`, stop and ask
whether the thing you want is really a client change. Two exceptions you can expect, and
both need a line in the brief before the code:

- a screen needs a field the API does not return — that is a new PR against the endpoint's own epic, not a widening of an E10 brief;
- an error message is unreadable because the *server* wrote it that way — `MVP.md` §15.3 says the error handler owns that, and fixing it is a server PR with its own acceptance criteria.

---

## 7. Definition of done for the whole epic

- Every route in `routes.guest.jsx`, `routes.student.jsx`, `routes.teacher.jsx` and `routes.admin.jsx` renders at 375px with no horizontal scroll, in all four states.
- Every async view has a loading state, an error state with a retry, and an empty state. This is a review item, not a polish item — CONVENTIONS.md says so.
- Every failure path shows a readable message. No blank screens, no raw stack traces, no `[object Object]`.
- A socket that drops is visible to the user on every authenticated screen, not only inside a session.
- `RETRO.md` exists, carries the screen inventory table, and records what the pass did **not** cover.
- `docs/README.md`'s E10 row is accurate, including the word "provisionally" and the open count if that is what is true.

Write down what you find, including the parts that fail. E7's and E8's retros are useful
documents because their most valuable lines are the ❌ ones.
