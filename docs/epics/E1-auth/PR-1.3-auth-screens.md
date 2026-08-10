# PR 1.3 — Auth screens: login + register with role selection

| | |
|---|---|
| **Epic** | E1 — Auth & Users |
| **Owner** | DEV-A |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 1.5 (needs `authStore`), 1.2 |
| **Blocks** | 1.7 |
| **Branch** | `dev-a/E1.3-auth-screens` |

## Contract implemented

`MVP.md` §14.1 routes `/login` and `/register`, and the client error UX from §15.3.

## Scope

Both auth screens, sharing one layout and one form pattern. DEV-A owns both — they
share too much markup to split across two people, and they touch no file DEV-B holds.

**Register.** Role selection first, as a visible choice between "I'm a student" and
"I want to teach" — not a dropdown buried in the form. It determines the entire
subsequent experience and it is immutable afterwards, so it deserves the visual
weight. Selecting a role reveals the role-appropriate fields: students get grade
and math level, teachers get neither (their onboarding is E2). Mantine `useForm`
with client-side validation that mirrors 1.2's Zod schema, then server-side
`VALIDATION_ERROR.details` mapped back onto the specific fields.

**Login.** Email, password, submit. A link to register. The generic
"Invalid credentials" from 1.4 is shown as-is — do not add client-side cleverness
that tells the user which half was wrong; the server is deliberately vague and the
UI must not undo that.

Both screens: submit disabled while pending, a spinner on the button, server errors
as a toast via 0.6's `notify`, field errors inline. On success, `authStore` already
holds the user, so redirect to the attempted path if there was one, otherwise to
`/app` for students and `/teach` for teachers.

Mobile-first — this is the first screen a real user sees, and they arrive on a phone.

## Files you may touch

```
client/src/pages/auth/Login.jsx
client/src/pages/auth/Register.jsx
client/src/pages/auth/RoleSelect.jsx
client/src/layouts/AuthLayout.jsx
client/src/components/auth/**
client/src/router/routes.guest.jsx        swap the two placeholders for the real pages
```

## Files you must NOT touch

```
client/src/stores/authStore.js            DEV-B — consume it, do not edit it
client/src/api/client.js  client/src/api/auth.api.js
client/src/router/index.jsx  client/src/theme.js
server/**
```

## Acceptance criteria

- [ ] Registering as a student lands on `/app`, logged in, with no second login step
- [ ] Registering as a teacher lands on `/teach`
- [ ] Role selection is a deliberate, prominent choice, and the form adapts to it
- [ ] Client-side validation matches 1.2's Zod rules (no rule the server does not enforce, and none it does that the client silently skips)
- [ ] A server `VALIDATION_ERROR` renders under the specific field, not only as a toast
- [ ] A duplicate email shows under the email field
- [ ] Login with wrong credentials shows the server's generic message; the UI adds nothing
- [ ] Submit is disabled and shows a spinner while the request is in flight; double-submit is impossible
- [ ] Both screens are usable at 375px — no horizontal scroll, tap targets at least 44px
- [ ] Both use `AuthLayout`; no duplicated layout markup
- [ ] Password fields have a visibility toggle and correct `autoComplete` attributes

## Manual test

1. Register a student with a fresh email → straight into `/app`.
2. Register with the same email again → inline error on the email field.
3. Submit an empty form → inline errors, no request sent.
4. Register as a teacher → `/teach`.
5. Log in wrong → generic message, form stays filled except the password.
6. Stop the server, submit → readable error toast, not a blank screen or a raw axios message.
7. Both screens at 375px, in a real mobile viewport.
8. Visit `/app/wallet` while logged out, log in from the redirect → land on `/app/wallet`, not `/app`.

## Notes

Step 8 verifies the handshake with 1.5's redirect logic. It is the one behavior that
spans both developers' work in this epic, so it is the one most likely to be missed
by both.

Keep client-side validation a mirror, never an extension. A rule that exists only on
the client is a rule that is not enforced.
