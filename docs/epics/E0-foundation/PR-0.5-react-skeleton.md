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

- [ ] Every route in `MVP.md` §14.1 resolves and renders a named placeholder
- [ ] Route definitions are split into four area files; `router/index.jsx` only composes them
- [ ] Mantine theme defines the brand palette, default radius, and font once — no hardcoded colors in components
- [ ] `<768px`: single column, bottom navigation
- [ ] `768–1024px`: two columns, collapsible sidebar
- [ ] `>1024px`: fixed sidebar
- [ ] Notifications provider is mounted at the root
- [ ] An unknown path renders a 404 page inside the guest layout
- [ ] No console errors or warnings on any route

## Manual test

1. Visit each of the 20+ routes. Each renders, each is named.
2. DevTools at 375px, 800px, 1440px: layout matches the table in `MVP.md` §14.4.
3. Bottom nav appears only below 768px and navigates correctly.

## Notes

`theme.js` and `router/index.jsx` are **frozen after this PR** (`OWNERSHIP.md` §2).
Both are single-owner files that every later client PR would otherwise touch.

Placeholder pages should be genuinely trivial — a heading with the route name. The
temptation to "start the real screen while I'm here" is how E0 slips into E4.
