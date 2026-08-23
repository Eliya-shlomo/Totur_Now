# Handoff — continue E7 (Wallet & Billing), from 7.5

**First: run `/caveman` and stay in it for the whole session.**

It is a skill in this environment — invoke it, do not imitate it. It compresses your
prose and nothing else: technical terms, file paths, API names, CLI commands, commit
type prefixes and exact error strings stay verbatim. **Commits, PR bodies and the epic
docs are written normally** — that is the skill's own boundary, and this repo's house
style is dense prose with the reasons written down. Compress what you say to the human,
not what you write into the repository.

It does not survive a context summary on its own. If you notice you have drifted back
into ordinary prose, re-invoke it rather than approximating.

You are **DEV-A (eliya)**. Rotem (DEV-B) is on E6a and has landed through 6a.5.

## Where the work is

`docs/epics/E7-wallet-billing/` — the epic README and eight PR briefs, all written.
Read the README first; it is the argument for why E7 is not what `MVP.md` §18 says it is.

| PR | State |
|---|---|
| 7.1 top-up operation | merged to `origin/main` |
| 7.2 wallet read surface | merged |
| 7.3 `POST /wallet/topup` + `wallet:updated` | merged |
| 7.4 §5.5's two refunds | **committed, not merged** — `dev-a/E7.4-remaining-refunds`, rebased onto `origin/main`, 755 tests pass |
| 7.5 wallet screen | not started ← **you are here** |
| 7.6 teacher earnings | not started |
| 7.7 out-of-credit banner | not started |
| 7.8 E7 close | not started |

The whole server side is done. `/api/v1/wallet` answers balance, ledger and top-up, and
emits `wallet:updated`. What is left is the half a human can see, plus the close.

**7.5 is unblocked and is the next PR.** 7.6 depends only on 7.2 and could go in
parallel if you want it; 7.7 needs 7.5's `wallet.api.js`.

## Before your first command

```bash
git switch main && git pull --rebase origin main
npx prisma migrate deploy --schema ./prisma/schema
npm test
```

The migrate step is not optional. 6a.4 added `questions.how_to_start` and a database
without it fails thirteen E2E tests with `The column questions.how_to_start does not
exist in the current database` — which reads like a broken merge and is not one.

## The thing most likely to waste your afternoon

**There are two databases and the tooling disagrees about which one you mean.**

| Started from | Reads | Points at |
|---|---|---|
| repo root | `.env` | local Docker, `localhost:5433/tutor_now` |
| `server/` | `server/.env` | **Neon, the hosted database** |

`scripts/reconcile.mjs` always reads the repo-root `.env`. A probe script run with a
working directory of `server/` writes to Neon, and the reconciliation you run afterwards
reports on local and says zero rows — because nothing wrote to what it looked at.

This happened twice in the previous session, in 7.3 and again in 7.4, and 7.3's commit
message carries a reconciliation claim that is true of local and not of the database its
top-ups reached. Do not repeat it.

**Verify against local, always.** Load the root `.env` explicitly:

```js
dotenv.config({ path: new URL('../.env', import.meta.url).pathname });
```

and print the host before you write anything.

**Neon carries known probe rows** — two `TOPUP` rows from 7.3, three synthetic sessions
from 7.4. The three sessions have `total_charged` with no `session_blocks`, so invariant
2 reports them on that database. They were left in place by decision: an append-only
ledger is not a thing to tidy by hand. They are recorded in `PR-7.8-e7-close.md` and are
not findings.

## How to verify without leaving rows behind

The pattern that worked, and the one to keep using: do the write inside a transaction
you then roll back. Every service in this repo takes its collaborators through the last
argument, so you can hand `terminateSession` or `topUpBalance` your own transaction:

```js
await prisma.$transaction(async (tx) => {
  /* set up, act, assert */
  throw ROLLBACK;   // a Symbol you catch outside
});
```

`npm test` is hermetic and proves the logic. It cannot prove a router is mounted, a
socket frame arrives, or raw SQL matches the real schema. Those need a real server or a
real database, and they are worth doing — 7.2's router, 7.3's `wallet:updated` frame and
7.4's three settlement branches were all confirmed that way.

## §17.5, and what was decided about it

`MVP.md` §17.5 makes `wallet.service.js` and the three critical money transactions
human-written. **7.1 and 7.4 were written by an agent at the developer's explicit
instruction**, twice, after the constraint was raised. Both commit messages say so
outright and the order table still marks both **human**. That disagreement is deliberate
and unresolved — do not quietly reconcile it in either direction.

Nothing in 7.5 through 7.8 touches a §17.5 file. If you find yourself needing to,
**stop and ask** rather than assuming the earlier override extends.

## Collisions with Rotem

Predicted in the epic README and all of them held:

- **`shared/api.d.ts`** — E7's block is one `// ── E7 — money ──` section at EOF,
  opened whole by 7.2 including the shapes 7.6 still has to implement. 6a.4 edited
  *inside* `Classification` and `IncomingOffer`. No conflict. Append inside E7's block,
  never at EOF again.
- **`package.json`** — 6a.3 added `bench:classify`. 7.8 adds `reconcile`. One line each.
- **`docs/README.md`, `docs/OWNERSHIP.md`** — 6a.6 and 7.8 edit different rows of the
  same tables. Whoever closes second rebases.
- **`client/src/pages/teacher/**`** — on 6a.5's allowlist as a glob, but 6a.5 edits
  existing files and 7.6's `Earnings.jsx` is new. Not an overlap. If 7.6 finds itself
  opening `Dashboard.jsx`, that is a chat message, not a merge.

**No schema change in E7 and none is needed.** `wallet.prisma` already has everything.
`OWNERSHIP.md` §2 allows one migration in flight at a time. If your scoping says you need
a column, stop and ask.

## Two decisions from 7.2–7.4 you will trip over otherwise

**`note` is not on the wire, ever.** `wallet_transactions.note` is operator-facing text
— `'Session earning'`, `'No-show refund'` — and two independent defences keep it off the
ledger response: `LEDGER_VIEW` does not select it and `toWalletTransaction` builds the
response field by field. 7.5 renders a sentence from `type`. A screen that expects `note`
is a screen built against a field that is not coming.

**`GET /wallet` returns credits, not minutes.** Minutes are a function of a teacher's
price and the endpoint has no teacher. `client/src/lib/credits.js`'s `minutesFor` owns
the translation, floors to whole blocks, and takes `blockMinutes` from
`GET /public/pricing`. 7.5 must label the price it assumed — "≈ 40 minutes at the typical
price". A bare "≈ 40 minutes" is a promise the wallet cannot keep, and hardcoding `5` or
`[50, 100, 200]` anywhere in `client/` fails the review.

## Uncommitted and on the wrong branch

`client/vercel.json` — four `"//"` comment keys deleted from the first rewrite. Vercel's
schema sets `additionalProperties: false` on a rewrite entry, so the file failed
validation and **did not deploy**, which is very likely why 6b.2's config was never
applied and why students are still logged out mid-session. Nothing was lost: all four
paragraphs already live in `docs/DEPLOYMENT.md` under "The API rewrite, and why the
cookie needed it".

It is E6b's file sitting on E7's branch. Move it to its own branch off `main` before
committing. After it deploys:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://totur-now-client-vnxx.vercel.app/api/v1/nope
```

`404 application/json` means the rewrite is live. `200 text/html` means the SPA catch-all
is still answering `/api/*` and it has not landed.

## Known-broken, do not be surprised

Until that curl returns `404 application/json`, the deployed application signs a student
out fifteen minutes after login, mid-session. **Test wallet flows locally, not there.**
`docs/epics/E6b-live-path-repair/PR-6b.4-e6b-close.md` is the open PR that closes it.

## House style, for what you write into the repo

Read `docs/epics/E6b-live-path-repair/README.md` and any E7 brief before writing a new
one. Dense prose, reasons written down, the alternative that was rejected and why. Every
PR gets an allowlist and a denylist. Commit messages are long and argue for the decisions
rather than listing the files.

**When a brief turns out to be wrong, correct the brief.** That happened three times:
7.2's allowlist named a repository that cannot hold a paged read, 7.3 needed a read-back
the brief had not anticipated, and 7.4 had to touch `scripts/reconcile.mjs`, which its
own denylist reserved for 7.8. Each was fixed in the brief in the same commit as the
code, with the reasoning. A brief that disagrees with `main` is worse than no brief.

**When a test goes red because behaviour changed, rewrite it to the rule.** 7.4 turned an
E2E walk named "nothing else changes" into one that asserts a refund, and moved two socket
catalogue tripwires that E5 had written specifically to force this decision. Relaxing an
assertion to match new code is how a refund rule becomes a refund bug.
