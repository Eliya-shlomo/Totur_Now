# PR 6a.6 — E6a close: bench re-run, verification, retro

| | |
|---|---|
| **Epic** | E6a — Classification Repair & the Teacher Brief |
| **Owner** | DEV-B (rotem) |
| **Size** | S |
| **Written by** | Agent. |
| **Depends on** | 6a.3, 6a.5 (both merged) |
| **Blocks** | E7 |
| **Branch** | `dev-b/E6a.6-e6a-close` |

## Contract implemented

None.

## Scope

Run the epic end to end, record what actually happened, and write `RETRO.md`.

### The checklist

**The repair**

- [ ] `POST /questions` with Hebrew text classifies to a real subtopic, `classificationOk: true`
- [ ] The same with one photograph and empty `rawText`
- [ ] The same with three photographs, inside `LLM_TIMEOUT_MS`
- [ ] `GEMINI_API_KEY` unset: 201, `topicId: 0`, `classificationOk: false`, boot warning present
- [ ] One unreachable image URL among three still classifies
- [ ] The model id in `constants/llm.js` is one `models.list()` returns

**The bench**

- [ ] `npm run bench:classify` across all 50 pages. **Output pasted verbatim into the epic README**
- [ ] Fallback rate is 0
- [ ] Accuracy at or above the threshold 6a.3 recorded
- [ ] p50 and p95 recorded, and p95 inside `LLM_TIMEOUT_MS`
- [ ] Run twice; variance inside the tolerance 6a.3 wrote down
- [ ] Every expectation entry is `reviewed: true`

**The brief**

- [ ] Hebrew question, Hebrew brief; English question, English brief
- [ ] Ten `howToStart` values read as opening moves, not solutions
- [ ] `teacherBrief` + `howToStart` lands in 3–5 lines
- [ ] Fallback path: `howToStart` is null and the teacher card says why
- [ ] No truncation at 2048 output tokens across a full bench run

**The screens**

- [ ] Teacher reads the brief RTL in the offer modal without scrolling, at 375px
- [ ] English renders LTR, unchanged
- [ ] `ClassificationCard` renders Hebrew `rawText` RTL
- [ ] The offer email carries the same brief
- [ ] Topic badge follows one rule in all three places

**The repo**

- [ ] `npm run lint`, `npx prettier --check .`, `npm test`, `npm run build` in `client/`
- [ ] `npm test` passes with `GEMINI_API_KEY` unset and no network
- [ ] One new migration; no existing migration edited
- [ ] Every status box in the epic README is ☑
- [ ] `docs/README.md`'s epic index is current — **it still lists E3 as "not started" and stops at E4**, so E5, E6 and E6a are all missing from it
- [ ] `docs/OWNERSHIP.md` names `media.service.js`'s new outbound direction

### `RETRO.md`

Established shape: `# E6a — Retro`, question-shaped H2s — "Did the seam hold?", "What is
not verified", "The checklist, as run", "Carried into E7".

**"Did the seam hold?" has an unusually clear answer this time,** and the retro should
give it plainly. The seam held perfectly and that is the problem. `classifyQuestion`'s
frozen one-argument signature meant the vendor swap touched the client, the request shape
and the constants and nothing else — exactly as designed, and the E3 retro says so with
some pride. It also meant a completely dead classifier was invisible from every direction:
the caller got a valid `Classification`, the schema layer never ran, the tests passed, the
endpoint returned 201. A seam that isolates failure this well needs something on the far
side of it that fails loudly, and there was nothing.

Three items the retro must name plainly:

1. **How a total failure shipped and survived three epics.** `classification.test.js` is
   548 lines covering every fallback mode, and green throughout. It injects
   `createMessage`, so it asserts the code builds the object the code intends. Nothing
   required a real request to be accepted. `isPromptReady` was built to fail closed at the
   prose layer against precisely this class of defect; the transport layer had no
   equivalent. `bench:classify` is now that equivalent — **and the retro states the rule:
   it runs before merging anything that touches the request shape, the model id, or the
   prompt.**
2. **The fallback rate is still not observable in production.** Nothing counts
   `classificationOk: false` in aggregate. E3's retro noted the fallback firing twice in
   development and it read as noise; a rate would have read as an outage. Every question
   in every environment fell back for three epics and no number anywhere moved. **Carry
   to E7 as a named item**, with the shape it should take: a counter, an alert threshold,
   and the `topic_id = 0` share of recent questions on whatever admin surface E7 builds.
3. **Two model names were written into a constant without either ever being called.** So
   was an entire request shape, and an image-delivery mechanism the API does not have.
   The common factor is not carelessness — the code is careful, the comments argue their
   decisions well — it is that nothing in the loop between writing and merging required
   the external system to agree. Name it as a process finding, not a personal one.

Also record, because the numbers are the epic's actual product: the model chosen and what
was rejected, the measured latency for text and for three images, the bench's accuracy and
threshold, and the observed run-to-run variance.

## Files you may touch

```
docs/epics/E6a-classification-repair/RETRO.md    new
docs/epics/E6a-classification-repair/README.md   tick every box; paste the bench output
docs/README.md                                   the epic index, three epics behind
docs/OWNERSHIP.md                                media.service.js now fetches as well as uploads
docs/fixtures/bagrut-50.results.json             the closing run
```

## Files you must NOT touch

```
server/**       if verification finds a defect, it is a new PR, not a widening of this one
client/**       same
prisma/**       same
scripts/**      the bench is run here, not edited here
```

## Acceptance criteria

- [ ] Every box above is ticked or explicitly listed under "What is not verified"
- [ ] `RETRO.md` exists and answers all four questions
- [ ] The bench output in the epic README is a real paste, not a summary
- [ ] The fallback-rate observability gap is carried into E7 by name
- [ ] `docs/README.md`'s epic index is current through E6a

## Manual test

The end-to-end walk, on a clean database:

1. `npm run db:up && npm run db:migrate && npm run db:seed`
2. `npm run dev`
3. Register a student. Photograph a real Bagrut exercise. Submit it through `/app/ask`
4. Confirmation screen: a real subtopic, in Hebrew, rendered right-to-left. **Not
   "General / Unclassified"** — the sentence this epic exists to make true
5. Teacher account goes available in a second browser. Take the offer. Read the 3–5 line
   brief inside the countdown, at 375px
6. `npm run bench:classify`
7. `npm test` with `GEMINI_API_KEY` unset and the network off

## Review checklist additions

- An unticked box is written into "What is not verified" with a reason. A quietly dropped
  one is how E2 closed "provisionally — 4 items open".
- The bench output is pasted, not paraphrased. The next person to debug this needs the
  numbers, not an adjective.

## Notes

**Why the close PR carries this much retro guidance.** E6a is a repair epic, and repair
epics are where a project either learns the lesson or files it. The defect was not hard
to find once someone looked at the SDK — it was hard to *notice*, for three epics, across
a review process that is otherwise careful and a test suite that is otherwise thorough.
The retro is the only artifact that carries that forward.
