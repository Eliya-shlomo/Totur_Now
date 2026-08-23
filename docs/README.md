# TutorNow — Documentation

## What lives here

| Path | Purpose |
|---|---|
| [`MVP.md`](MVP.md) | The product specification. Source of truth for *what* we build. |
| [`OWNERSHIP.md`](OWNERSHIP.md) | File ownership map + conflict-avoidance rules. Read before your first PR. |
| [`CONVENTIONS.md`](CONVENTIONS.md) | Naming, folder rules, imports, commits, branches. |
| [`epics/`](epics/) | One folder per epic. Each contains a `README.md` (the epic) and one file per PR. |

## How the docs drive the work

```
docs/epics/E1-auth/README.md          ← the epic: goal, slices, order, done criteria
docs/epics/E1-auth/PR-1.1-....md      ← one PR brief per file
```

A PR brief is the contract handed to an AI agent. It states which files may be
touched, which files must not be, and what "done" means. Per `MVP.md` §17.3, the
**human writes the brief, the agent implements it, the human reviews it.**

## Working loop

1. Pick the next unclaimed PR in your epic's `README.md` order table.
2. Read its PR brief. Read `OWNERSHIP.md` for any file it touches that you do not own.
3. `git switch main && git pull --rebase && git switch -c <dev>/E1.2-register-endpoint`
4. Hand the PR brief to the agent as its prompt.
5. Review against the checklist in `MVP.md` §17.4.
6. Squash-merge. Tick the box in the epic README. Same day.

## Epic index

| Epic | Split | Status | Folder |
|---|---|---|---|
| E0 — Foundation & Infrastructure | by directory: B `server/`+`prisma/`, A `client/` | done | [`E0-foundation/`](epics/E0-foundation/) |
| E1 — Auth & Users | by flow: A registration, B session | done | [`E1-auth/`](epics/E1-auth/) |
| E2 — Teacher Onboarding | by audience: A public read, B the teacher's own record | closed provisionally — 4 items open | [`E2-teacher-onboarding/`](epics/E2-teacher-onboarding/) |
| E3 — Question Intake & LLM Classification | by seam: A capture, B classification | not started | [`E3-question-intake/`](epics/E3-question-intake/) |
| E4 — Matching | by seam: A the pool, B the score | done | [`E4-matching/`](epics/E4-matching/) |
| E5 — Offers & Realtime | single developer: B | done | [`E5-offers-realtime/`](epics/E5-offers-realtime/) |
| E6 — Session Lifecycle | single developer: B | 6.9 open | [`E6-session-lifecycle/`](epics/E6-session-lifecycle/) |
| E6a — Classification Repair & the Teacher Brief | single developer: B | 6a.1–6a.5 merged, 6a.6 open | [`E6a-classification-repair/`](epics/E6a-classification-repair/) |
| E6b — Live-Path Repair | by defect: A deployment, B offer delivery | 6b.1–6b.3 merged, 6b.4 open — the deployed path is still broken and it is a dashboard change, see [`DEPLOYMENT.md`](DEPLOYMENT.md) | [`E6b-live-path-repair/`](epics/E6b-live-path-repair/) |
| E7 — Wallet & Billing | single developer: A | closed provisionally — 20-operation pass ran clean, 2 defects filed as 7.9, 4 items open | [`E7-wallet-billing/`](epics/E7-wallet-billing/) |
| E8–E11 | not written yet | — | — |

DEV-A is eliya, DEV-B is rotem — see [`OWNERSHIP.md`](OWNERSHIP.md) §0.

Epics are written **two at a time**, not all upfront. Writing E4's PR briefs before
E1 has merged means rewriting them.
