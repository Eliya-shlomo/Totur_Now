# E2 — Teacher Onboarding

| | |
|---|---|
| **Depends on** | E1 (1.1–1.7 merged and verified on the deployed pair) |
| **Blocks** | E4 (matching has nothing to rank until teachers carry topics, a level and a price) |
| **Definition of done** | A new teacher registers, walks a three-step stepper, and appears in the public teacher list carrying the `New` badge, their price and their topics. A student can open that teacher's profile without logging in. |

## The problem this epic has to solve

E1's problem was that both developers were writing *the same feature*. E2's is different
and easier to get wrong: the feature looks like one thing — "the teacher profile" — but it
is read by two audiences that share almost nothing.

The teacher reads and writes their own profile behind `ProtectedRoute role="teacher"`.
A student reads a stranger's profile with no session at all. Same table, opposite
requirements: one is `PATCH` with ownership checks, the other is a public list with
filters and no private fields in the payload.

The naive split is server for one person and client for the other. That produces a
teacher profile whose write path and read path were designed by two people who never
agreed on a shape, and it puts both developers in `teacher.service.js` all week.

**The cut is by audience.** DEV-B owns everything the teacher does to their own record,
server through client. DEV-A owns everything a student sees about a teacher, server
through client. The two never open the same file after 2.1.

## The shared files, named up front

The E1 retro's main finding: the suffix rule was applied to the layers the brief happened
to mention and stopped there, and the one unsuffixed file — `user.repository.js` — was the
one that broke `main`. So this list is exhaustive, and every file on it has a rule.

| File | Rule | Set by |
|---|---|---|
| `server/src/routes/teacher.routes.js` | **Frozen** after 2.1. All routes wired against stubs. | 2.1 |
| `server/src/repositories/teacher.repository.js` | **Frozen** after 2.1. Every query both audiences need is written there first. | 2.1 |
| `server/src/routes/index.js` | Append-only, one line, alphabetical | 2.1 |
| `shared/api.d.ts` | Append-only, one `// ── E2` block | 2.1 |
| `client/src/router/routes.teacher.jsx` | One line per PR: replace a `Placeholder`, never reorder | 2.4, 2.6 |
| `client/src/router/routes.guest.jsx` | One line per PR: replace a `Placeholder`, never reorder | 2.5 |
| `server/src/config/constants/teacher.js` | Append-only. 2.2 added `BIO_MAX_LENGTH`, the one bound the epic needed and the file did not have. Nothing existing is edited. | 2.2 |

Everything else is suffixed by audience: `teacher.me.controller.js` and
`teacher.public.controller.js`, `teacher.me.service.js` and `teacher.public.service.js`.
Never one `teacher.controller.js`.

## The split

| | DEV-A (eliya) | DEV-B (rotem) |
|---|---|---|
| **Slice** | What a student sees about a teacher | What a teacher does to their own record |
| **Server** | `GET /teachers`, `GET /teachers/:id`, standing badge wiring | `GET /teachers/me`, `PATCH /teachers/me`, topics, price, level, status |
| **Client** | public list + public profile (`routes.guest.jsx`), teacher's own profile edit screen | onboarding stepper (`routes.teacher.jsx`) |
| **Filler** | E2 close: verification + retro | E10.2 responsive polish, pulled forward |

DEV-A owns the **profile edit screen** even though DEV-B owns the endpoint behind it, for
the same reason DEV-A owned both auth screens in E1 while DEV-B owned the store: the edit
screen and the public profile share a field layout, a badge component and a price control.
Splitting them across two people creates conflict for no benefit.

## Order

| # | PR | Owner | Size | Depends on | Status |
|---|---|---|---|---|---|
| 2.1 | [Teacher core: frozen router, repository, serializer](PR-2.1-teacher-core.md) | DEV-B · **human** | M | E1 | ☑ |
| 2.2 | [`GET` / `PATCH /teachers/me` — profile, topics, price, level, status](PR-2.2-teacher-me-endpoints.md) | DEV-B | M | 2.1 | ☐ |
| 2.3 | [Standing badge + public teacher endpoints](PR-2.3-public-teacher-endpoints.md) | DEV-A | M | 2.1 | ☑ |
| 2.4 | [Onboarding stepper — topics → level → price](PR-2.4-onboarding-stepper.md) | DEV-B | M | 2.2 | ☐ |
| 2.5 | [Public teacher list + profile screens](PR-2.5-public-teacher-screens.md) | DEV-A | M | 2.3 | ☑ |
| 2.6 | [Teacher profile edit screen](PR-2.6-profile-edit-screen.md) | DEV-A | M | 2.2, 2.5 | ☐ |
| 2.7 | [E2 close: verification + retro](PR-2.7-e2-close.md) | DEV-A | S | 2.2–2.6 | ☐ |

## Parallelism map

```
                     ┌─ 2.2 ── 2.4 ────────────┐        (B)
2.1 (B, blocking) ───┤                         ├─ 2.7 (A)
                     └─ 2.3 ── 2.5 ── 2.6 ─────┘        (A)
```

2.1 is the only thing either developer waits on, and it is one sitting. After it merges
the two tracks touch no shared file until 2.7.

**2.6 depends on 2.2**, which is the one cross-track edge. It is a client screen against a
merged endpoint, so DEV-A is never blocked on unmerged work — if 2.2 is not in yet, 2.6
waits and DEV-A picks up the filler. Do not stub the endpoint locally to get ahead; that is
how the two shapes drift apart.

## Contract freeze

Agreed before 2.2 and 2.3 start. Appended to `shared/api.d.ts` in 2.1 as one `E2` block.
Changing any of these afterwards is a chat message **before** the code.

```ts
// ── E2 ──────────────────────────────────────────────────────────────────────

/** A teacher as a stranger sees them. No email, no status, no counters. */
export interface TeacherCard {
  id: string;
  fullName: string;
  bio: string | null;
  pricePerBlock: number;
  levelMax: number;
  /** Computed by `utils/standing.js`, never stored. */
  badge: 'NEW' | 'ACTIVE' | 'EXPERIENCED' | 'TOP';
  /** null until the teacher has been rated at least once. Not 0. */
  rating: number | null;
  ratingCount: number;
  /** Leaf topics only, in the taxonomy's own order. */
  topics: Array<{ id: number; slug: string; nameHe: string; nameEn: string }>;
  isOnline: boolean;
}

/** `GET /teachers` — the public list. */
export interface TeacherListResponse {
  teachers: TeacherCard[];
  total: number;
}

/** `GET /teachers/me` — the teacher's own record. Superset of TeacherCard. */
export interface TeacherMeResponse extends TeacherCard {
  status: 'OFFLINE' | 'ONLINE' | 'OFFER_LOCKED' | 'IN_SESSION';
  sessionsCount: number;
  resolvedCount: number;
  /** True until topics, levelMax and pricePerBlock have all been set once. */
  onboardingComplete: boolean;
}

/** `PATCH /teachers/me`. Every field optional — the stepper sends one step at a time. */
export interface TeacherUpdateRequest {
  bio?: string | null;
  pricePerBlock?: number;   // 5–20, §5.2
  levelMax?: number;        // 3 | 4 | 5, §6.1
  topicIds?: number[];      // leaf topics only, replaces the whole set
  status?: 'OFFLINE' | 'ONLINE';
}
```

Four decisions inside that block, so nobody relitigates them mid-epic:

**`badge` is computed, never stored.** `utils/standing.js` already exists and already does
this. There is no badge column and there must not be one — it would be a second copy of
`sessionsCount` and the rating columns, free to drift from the first.

**`rating` is `null`, not `0`, for an unrated teacher.** They are not the same claim, and
the UI renders them differently. `standingOf` already makes this distinction.

**`status` is not in `TeacherCard`.** A student sees `isOnline`, a boolean. `OFFER_LOCKED`
and `IN_SESSION` are matching-engine internals and leak the platform's state to strangers.

**`PATCH` accepts a partial and `topicIds` replaces the whole set.** The stepper sends one
step at a time; a merge-append would make removing a topic impossible.

## Deliberate deviations from `MVP.md` §18

| MVP said | We do | Why |
|---|---|---|
| 4 PRs (2.1–2.4) | 7 PRs (2.1–2.7) | MVP's 2.1 bundles the frozen skeleton with the CRUD. E1 proved the skeleton has to be its own merged PR before anything parallel starts. |
| Owner: B for the epic | Split A/B by audience | An epic with one owner leaves the other developer on filler for three days. The read surface is a genuine vertical. |
| — | 2.7 added | E1 had no closing PR in `MVP.md` either; 1.7 is why the deployment misconfiguration was found at all. |
| `routes.teacher.jsx` says PR `2.6` / `2.7` for these screens | 2.4 and 2.6 | Stale numbering from the pre-8/11 version of E2, before the exam, academic email and document queue were cut (§6.1). Each PR fixes its own line. |

## Risks

- **`GET /teachers` is the first list endpoint in the project and the first N+1 risk.**
  Topics are a join table. Fetching teachers and then topics per teacher is 1 + N queries
  against a free Neon instance. 2.1 writes the query with the include, once, in the frozen
  repository, so 2.3 cannot get this wrong.
- **`onboardingComplete` is derived, and the derivation must live in exactly one place.**
  Two definitions of "done" — one in the stepper, one on the server — is a teacher who is
  finished on one screen and unfinished on another. It is computed server-side in 2.1's
  serializer, and the client only reads it.
- **The 5–20 price bound exists in three places**: the Zod validator, the `CHECK`
  constraint in the migration, and `money.js`. They must agree. `constants/money.js` is the
  source; the other two cite it. Nobody hardcodes `5` or `20` in a new file.
- **Cold starts will look like bugs during the stepper.** A free Render instance that has
  slept answers the first `PATCH` in 30–60s, past the client's 15s timeout. Expect at least
  one "my step didn't save" report that is not a bug. `docs/DEPLOYMENT.md` §7 covers it.

---

## Checklist before writing the PR briefs

- [x] Every PR names exactly one owner
- [x] No two in-flight PRs edit the same file
- [x] Any shared file is either frozen, append-only, or split by domain
- [x] Human-written items from `MVP.md` §17.5 are marked as such — 2.1
- [x] Each PR has an allowlist and a denylist
- [x] Each PR has acceptance criteria a human can check in under five minutes
- [x] Both developers have server and client work
- [x] There is filler work for whoever finishes first
