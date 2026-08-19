# PR 6a.3 — The 50-question bench: fixture, harness, scored report

| | |
|---|---|
| **Epic** | E6a — Classification Repair & the Teacher Brief |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | Agent. |
| **Depends on** | 6a.2 (merged) |
| **Blocks** | 6a.6 |
| **Branch** | `dev-b/E6a.3-bagrut-bench` |

## Contract implemented

None. This PR measures; it does not fix. If it finds classification wanting, the fix is a
follow-up PR and not a widening of this one.

## Scope

The layer the repo has never had. `classification.test.js` is 548 lines and passed
through three epics in which classification returned the sentinel every single time,
because it injects `createMessage` and therefore asserts that the code builds the object
the code intends to build. Nothing in the repo requires a real request to be accepted by
a real model and answer correctly.

`npm run bench:classify` is that requirement: 50 real Bagrut questions through the real
attachment and classification path, scored.

### The fixture is images, and that is not a shortcut

The source is a merged PDF of Bagrut exam pages, 50 pages. **Its Hebrew cannot be
extracted.** The embedded fonts carry no `ToUnicode` map; `pdftotext -layout` returns
digits, Latin and whitespace, with zero Hebrew codepoints under UTF-8, CP1255, CP1252 and
Latin-1. There is no text fixture to build without a vision pass in the middle, and a
transcription step would put an LLM between the test and the thing being tested.

Images are also the honest fixture. Students photograph exercises — that is §4.1's whole
premise and 6a.2's whole subject.

1. Commit the source at `docs/fixtures/bagrut-50.pdf`.
2. `scripts/render-bagrut.mjs` renders each page to
   `docs/fixtures/bagrut-50/page-NN.png` at a sensible width. **Check for a bundled
   `pdftoppm` before adding a dependency** — `pdftotext` is already present in this
   environment and ships alongside it. Commit the rendered PNGs, so the bench reproduces
   without the renderer and so a page-rendering change shows up as a diff.
3. `scripts/classify-bench.mjs` uploads each page through the real
   `POST /questions/attachments` path, calls `classifyQuestion`, and writes
   `docs/fixtures/bagrut-50.results.json`.

### Ground truth: the model proposes, the human approves

The first run writes `docs/fixtures/bagrut-50.expected.json`, one entry per page:

```json
{
  "page": 7,
  "topicSlug": "calculus-integrals",
  "subtopicSlug": "areas-under-curves",
  "reviewed": false
}
```

The human corrects the wrong ones and flips `reviewed` to `true`.

**The scorer refuses to score against an unreviewed entry, loudly, naming the pages.**
This is the entire defence against the failure mode the epic names in its risks: model-
proposed expectations quietly becoming the definition of correct, so that a classifier
which agrees with its own past mistakes scores 100%.

**Slugs, not ids.** `prisma/seed/topics.js` states it plainly — ids are database-assigned
and the slug is the stable key. A fixture pinned to ids passes until someone reseeds.

### The report

Printed as a table, and written beside the results:

- parent-topic accuracy
- leaf (subtopic) accuracy
- **fallback rate** — the number this epic exists to drive to zero
- p50 / p95 latency
- every miss listed as `page NN → expected <slug> · got <slug>`

Misses listed individually because an aggregate says a number and the list says which
kind of mathematics the classifier cannot see. Those are different pieces of information
and only the second one is actionable.

### The threshold

**Set it in this PR, after the first scored run, and write it into the epic README beside
the run that justifies it.** A threshold chosen before any data exists is a guess wearing
a number, and this epic already has enough of those.

The one figure not up for negotiation: **fallback rate must be zero.** A page that falls
back is a page the classifier did not classify, and that is the defect.

## Files you may touch

```
scripts/render-bagrut.mjs                        PDF pages -> PNG
scripts/classify-bench.mjs                       the harness and the scorer
docs/fixtures/bagrut-50.pdf                      the source
docs/fixtures/bagrut-50/page-NN.png              the rendered pages
docs/fixtures/bagrut-50.expected.json            ground truth, human-reviewed
package.json                                     one entry: "bench:classify"
docs/epics/E6a-classification-repair/README.md   the recorded run and the chosen threshold
```

## Files you must NOT touch

```
package.json → "test"       npm test stays hermetic: no network, no database. That is why it is runnable
server/tests/**             the bench is not a unit suite and must not become one
server/src/**               this PR measures. A fix it motivates is a separate PR
prisma/**                   the taxonomy is production data; the bench reads it, never writes it
```

## Acceptance criteria

- [ ] `npm run bench:classify` runs all 50 pages and prints the scored table
- [ ] **Fallback rate is 0** — no page classifies to `topic_id = 0`
- [ ] A second run scores within a stated tolerance of the first, and the tolerance is written down
- [ ] Scoring against an unreviewed expectation is refused, naming the offending pages
- [ ] The expectation file is committed with every entry `reviewed: true`
- [ ] Misses are listed individually, by page and by slug
- [ ] p95 latency is inside `LLM_TIMEOUT_MS`, and the number is recorded
- [ ] `npm test` still passes with `GEMINI_API_KEY` unset and no network
- [ ] The threshold and the run behind it are in the epic README
- [ ] `npm run lint`, `npx prettier --check .` pass

## Manual test

1. `npm run db:up && npm run db:migrate && npm run db:seed`
2. `node scripts/render-bagrut.mjs` — 50 PNGs appear, each legible when opened
3. `npm run bench:classify` — first run writes the expectation file with
   `reviewed: false` throughout and refuses to score
4. Review all 50. Correct the wrong ones. Flip the flags
5. `npm run bench:classify` again — scores, prints the table, lists the misses
6. Run it a third time. Compare against run two, and write the observed variance into the
   epic README as the tolerance

## Review checklist additions

- No network in `server/tests/**`. If the bench leaked into the unit suite, the property
  that makes `npm test` runnable on any machine is gone.
- The scorer's refusal is a hard exit, not a warning. A warning gets scrolled past.
- Expectations reference slugs. A single numeric topic id in the fixture is a bug.
- The bench cleans up after itself, or writes to a disposable student account. It creates
  50 questions and 50 sessions through the real path.

## Notes

**Precedent.** `scripts/lock.mjs` — E5's teacher-lock race harness. Real, manual, outside
`npm test`, run against two machines. Same category: a thing that can only be proven
against reality, kept where it cannot make CI depend on reality.

**Why not gate it on `GEMINI_API_KEY` inside `npm test`.** Because then the suite's result
depends on whose machine ran it, which is precisely what `classification.test.js`
designed against when it injected `configured` rather than reading the env directly. A
suite that means different things on different machines is a suite nobody trusts on a
red run.

**What this is really for.** It is a transport-layer `isPromptReady`. That guard fails
closed when the prompt is still a placeholder, and the same class of defect one layer
down — a request no server will accept — had nothing watching it. 6a.6 writes down when
this must be run: at minimum before merging anything that touches the request shape, the
model id, or the prompt.

**Cost.** 50 vision calls per run, on a `-lite` tier. Cheap enough to run on demand,
expensive enough not to run per commit. That is also why it is a script.
