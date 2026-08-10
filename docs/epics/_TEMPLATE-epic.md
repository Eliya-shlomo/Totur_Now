# E<n> — <Name>

| | |
|---|---|
| **Depends on** | E<n> (which PRs specifically) |
| **Blocks** | E<n> |
| **Definition of done** | <One observable sentence. Not a list of PRs — a thing a human can watch happen.> |

## The problem this epic has to solve

<Why the naive split fails here. Which files both developers would otherwise fight
over. Skip this section only if the epic is genuinely disjoint.>

## The split

| | DEV-A (eliya) | DEV-B (rotem) |
|---|---|---|
| **Slice** | | |
| **Server** | | |
| **Client** | | |
| **Filler** | | |

Both developers ship server and client work. If one column is all backend and the
other all frontend, the split is wrong — go back and cut by feature instead of layer.

## Order

| # | PR | Owner | Size | Depends on | Status |
|---|---|---|---|---|---|
| n.1 | [title](PR-n.1-slug.md) | DEV-? | S/M/L | | ☐ |

## Parallelism map

```
<ASCII graph. Make the blocking PRs and the parallel tracks obvious at a glance.>
```

## Contract freeze

<The shapes both developers code against, agreed before the parallel PRs start:
request/response bodies, socket payloads, enum values, state transitions. Changing
one of these is a chat message before the code, not after.>

## Deliberate deviations from `MVP.md` §18

| MVP said | We do | Why |
|---|---|---|

## Risks

- <Specific to this epic. Not "it might be hard".>

---

## Checklist before writing the PR briefs

- [ ] Every PR names exactly one owner
- [ ] No two in-flight PRs edit the same file
- [ ] Any shared file is either frozen, append-only, or split by domain
- [ ] Human-written items from `MVP.md` §17.5 are marked as such
- [ ] Each PR has an allowlist and a denylist
- [ ] Each PR has acceptance criteria a human can check in under five minutes
- [ ] Both developers have server and client work
- [ ] There is filler work for whoever finishes first
