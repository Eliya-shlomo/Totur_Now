# PR 0.5 — React skeleton, Mantine theme, router shell

| | |
|---|---|
| **Epic** | E0 — Foundation |
| **Owner** | DEV-A |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 0.1 |
| **Blocks** | 0.6, every client PR |
| **Branch** | `dev-a/E0.5-react-skeleton` |

## Contract implemented

The route tree from [`MVP.md` §14.1](../../MVP.md) and the responsive breakpoints
from §14.4.

## Scope

Stand up the client shell: Mantine provider with a project theme, the notifications
host, and the router — **split into per-area route files** so that for the rest of
the project, adding a screen touches one array and never the router itself
(`OWNERSHIP.md` §3.2).

Every route in `MVP.md` §14.1 exists now, pointing at a placeholder page that renders
its own name. Placeholders are correct at this stage: they make the route tree
reviewable today, and later PRs replace one file each with zero routing changes.

Three layouts: guest (header + footer), student `AppShell` (sidebar on desktop,
bottom nav under 768px), teacher `AppShell`. `ProtectedRoute` is **not** in this PR —
it needs `authStore`, and it belongs to E1.

Mobile-first: the shell must be correct at 375px before it is correct at 1440px.

## Files you may touch

```
client/index.html
client/src/main.jsx
client/src/App.jsx
client/src/theme.js                      frozen after this PR
client/src/router/index.jsx              frozen after this PR
client/src/router/routes.guest.jsx
client/src/router/routes.student.jsx
client/src/router/routes.teacher.jsx
client/src/router/routes.admin.jsx
client/src/layouts/GuestLayout.jsx
client/src/layouts/StudentLayout.jsx
client/src/layouts/TeacherLayout.jsx
client/src/components/nav/**
client/src/pages/**                      placeholders only
```

## Files you must NOT touch

```
server/**  prisma/**  shared/**
```

## Acceptance criteria

- [x] Every route in `MVP.md` §14.1 resolves and renders a named placeholder — all 23 walked programmatically
- [x] Route definitions are split into four area files; `router/index.jsx` only composes them
- [x] Mantine theme defines the brand palette, default radius, and font once — no hardcoded colors in components
- [x] `<768px`: single column, bottom navigation
- [x] `768–1024px`: two columns, collapsible sidebar
- [x] `>1024px`: fixed sidebar
- [x] Notifications provider is mounted at the root
- [x] An unknown path renders a 404 page inside the guest layout, and does not swallow `/app`, `/teach`, `/admin`
- [x] No console errors on any route
- [x] Production build succeeds
- [ ] **Guest mobile drawer opens** — not verifiable in the automated harness, see below

## Manual test

1. Visit each of the 20+ routes. Each renders, each is named.
2. DevTools at 375px, 800px, 1440px: layout matches the table in `MVP.md` §14.4.
3. Bottom nav appears only below 768px and navigates correctly.
4. **At 375px on `/`, tap the burger — the guest drawer should slide in with four links.**

## Verification note — one item could not be automated

Step 4 is the only unverified item. The automated browser runs with the pane
backgrounded, so `document.hidden` is `true` and `requestAnimationFrame` never
fires. Mantine mounts `Drawer` content inside an rAF-driven transition, so the
drawer can never open under those conditions — the burger flips to its open state
and the drawer root renders empty.

This is a harness artifact, not a defect: the AppShell sidebar verified fine because
it is pure CSS with no transition. It still needs **five seconds of human checking**
in a real browser before this PR is called done.

## Deviations from this brief, and why

| Brief said | Built | Why |
|---|---|---|
| Three layouts | **Four** — plus `AdminLayout` | §14.1 has two `/admin` routes with nowhere to live |
| Twenty placeholder page files | **One** `<Placeholder>` component | Twenty near-identical files means twenty deletions later; a real screen now swaps one line in a route array |
| (not mentioned) | `AppLayout` behind the three role shells | Student, teacher and admin shells differ only in nav items and brand label |
| (not mentioned) | `@tabler/icons-react` added | Bottom nav at 375px is unusable without icons; canonical Mantine pairing, tree-shakes per icon |
| `<Routes>` JSX assumed | `createBrowserRouter` route objects | Plain arrays compose across four files; the JSX form does not |

**Decisions locked here:**

- **UI language: English, LTR.** Prices still render in ₪. This was PR 0.1's open question.
- **Brand colour: teal.** Purple, blue, green and yellow are reserved for teacher
  standing badges (§6.2), so the primary colour must not compete with that signal.

**One implementation trap worth recording.** The obvious AppShell config —
`breakpoint: 'md'` with `collapsed.mobile` — produces a *full-width overlay* between
768 and 1024, not the two-column layout §14.4 asks for. The fix is to keep AppShell
in desktop mode (`breakpoint: 'sm'`) and drive the collapse from `collapsed.desktop`
instead, so the sidebar stays a real 260px column that slides.

## Notes

`theme.js` and `router/index.jsx` are **frozen after this PR** (`OWNERSHIP.md` §2).
Both are single-owner files that every later client PR would otherwise touch.

Placeholder pages should be genuinely trivial — a heading with the route name. The
temptation to "start the real screen while I'm here" is how E0 slips into E4.

`theme.other` holds `badgeColors`, `timerColors` and `layout`. Later PRs read from
there rather than hardcoding a tier colour or a header height — that is what keeps
"no magic numbers" true on the client side, where `constants.js` does not reach.
