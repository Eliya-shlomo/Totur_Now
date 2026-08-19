# PR 6a.1 — Repair the Gemini request, the response read, and the model id

| | |
|---|---|
| **Epic** | E6a — Classification Repair & the Teacher Brief |
| **Owner** | DEV-B (rotem) — the classification seam has been his since 3.1 |
| **Size** | M |
| **Written by** | Agent. |
| **Depends on** | E6 (merged through 6.9) |
| **Blocks** | 6a.2, 6a.4 |
| **Branch** | `dev-b/E6a.1-gemini-request-repair` |

## Contract implemented

None — no endpoint, no shape, no column changes. `classifyQuestion`'s frozen signature
from PR 3.1 is untouched, and so is `Classification`. This PR makes the existing contract
true for the first time: `MVP.md` §8.1, via `@google/genai@2.17.1`.

## Scope

Rewrite the request in `classification.service.js` against the SDK that is actually
installed. The call is `models.generateContent`, not `interactions.create`; the whole
parameter object changes with it. Everything below the call stays exactly as written —
`classificationSchema`, `isKnownPair`, the confidence floor, `fallbackClassification`,
the never-throws guarantee, the one `try` that wraps everything, the rule that no log
line carries the student's text. Those were never the problem, and a repair that also
rearranges them makes the diff unreviewable.

### The request

```js
const response = await callWithTimeout(createMessage, {
  model: LLM_MODEL,
  contents,
  config: {
    systemInstruction,
    responseMimeType: 'application/json',
    responseJsonSchema: CLASSIFICATION_OUTPUT_SCHEMA,
    maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
    thinkingConfig: { thinkingLevel: LLM_THINKING_LEVEL },
  },
}, timeoutMs);
```

`responseJsonSchema` rather than `responseSchema`: `CLASSIFICATION_OUTPUT_SCHEMA` is JSON
Schema — it carries `additionalProperties: false` and a derived `required` array — and
`responseSchema` takes Gemini's own `Schema` type. Feeding a JSON Schema to the field
that wants a `Schema` is a smaller version of the mistake this PR exists to fix.

`defaultDeps.createMessage` becomes
`(params) => geminiClient.models.generateContent(params)`. There is no second options
argument in this SDK — which is why the two bounds move.

### The timeout, in the fields this SDK has

`callWithTimeout` keeps its structure. The reasoning in its doc comment is still correct
in every particular; only the field names were invented. The `AbortController`, the
`Promise.race`, and the `finally { clearTimeout }` all stay, and the comment's argument
for each stays with them. What changes is where they ride:

- `fetchOptions: { signal }` → `config.abortSignal`
- `timeout` → `config.httpOptions.timeout`
- `maxRetries: 0` → `config.httpOptions.retryOptions` set to no retries

Which means `callWithTimeout` now merges into `params.config` rather than passing a
second argument. Keep the merge shallow and explicit; do not let it clobber the caller's
`config`.

### The response

`readJson` reads `response.text`, not `response.output_text`. It is a getter typed
`string | undefined` — a refusal or a stopped generation leaves it undefined — so the
existing `typeof text !== 'string'` guard is exactly right and needs no change beyond
the property name. Keep the `JSON.parse` throwing rather than checking: the one `catch`
above is what turns it into the fallback, and that is deliberate.

### The model id — resolve it, do not choose it

`LLM_MODEL = 'gemini-3.5-flash-lite'` is not a Gemini model. Neither is
`gemini-3.7-flash`, which the same doc comment offers as the accuracy step up. Both were
written without a request ever succeeding against either, and a third guess would join
them.

Before editing the constant, run a throwaway probe against the real key:

```js
for await (const m of await client.models.list()) console.log(m.name, m.supportedActions);
```

Take the fastest tier that supports `generateContent`, vision, and structured output —
the classification is a lookup against 43 leaves, not a problem to solve, and §4.1
promises the student 2–4 seconds. Then rewrite the doc comment above `LLM_MODEL`: keep
its framing ("this is a latency decision, and it is the human's to change"), record the
id chosen, and name the candidates rejected and why. Delete the `gemini-3.7-flash`
sentence. The comment is the only place a future reader learns which names are real.

### Two other constants, moved now rather than later

`LLM_THINKING_LEVEL = 'LOW'` — the SDK's `ThinkingLevel` enum is uppercase
(`MINIMAL | LOW | MEDIUM | HIGH`). Keep the existing comment; correct the two words it
offers as the steps up and down.

`LLM_MAX_OUTPUT_TOKENS` 1024 → 2048. 6a.4 adds a ninth field and Hebrew tokenizes worse
than English. The comment already argues that a cap which truncates mid-JSON turns a good
classification into a parse failure and a fallback; this is that argument applied. Moving
it here rather than in 6a.4 keeps the human-written PR to prose alone.

### `buildMessages`

Return `{ systemInstruction, contents }` instead of `{ systemInstruction, input }`. The
text part becomes `{ text }` and the whole list is wrapped:
`[{ role: 'user', parts: [...] }]`. Image parts are 6a.2's; leave them building whatever
they build today and let that PR replace them. **Do not touch `SYSTEM_INSTRUCTIONS`** —
that is prose, §17.5 reserves it for a human, and 6a.4 is where it changes.

## Files you may touch

```
server/src/services/classification.service.js   the request, the response read, the timeout config
server/src/services/llm.prompt.js               buildMessages return shape only — NOT the prose
server/src/config/constants/llm.js              model id, thinking level, token ceiling
server/tests/classification.test.js             the request-building assertions (:306-401)
docs/epics/E6a-classification-repair/README.md  tick the status box, record the model id chosen
```

## Files you must NOT touch

```
server/src/services/llm.prompt.js → SYSTEM_INSTRUCTIONS   prose. §17.5. 6a.4 owns it
server/src/validators/classification.schema.js            the contract was right; only its transport was wrong
server/src/services/question.intake.service.js            the caller never learns this moved — that is the seam working
server/src/config/gemini.js                               the client is correct; nothing about it was wrong
shared/**                                                 Classification is unchanged in this PR
prisma/**                                                 no schema change here
package.json                                              no dependency change — the right SDK was installed all along
```

## Acceptance criteria

- [ ] A real `POST /questions` with Hebrew text returns `classificationOk: true` and a `subtopicId` that exists in `topics`
- [ ] With `GEMINI_API_KEY` unset, the same request still returns 201 with `topicId: 0` — the fallback path is unchanged
- [ ] `classification.test.js` asserts the parameter `models.generateContent` receives, by the field names the SDK reads; the old assertions would now fail
- [ ] The model id in `constants/llm.js` is one `models.list()` returned, and its comment names the rejected candidates
- [ ] No log line carries the student's text, at any level
- [ ] Measured wall time for a text-only classification is inside §4.1's 2–4 seconds, not merely inside `LLM_TIMEOUT_MS`
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` pass

## Manual test

1. `npm run db:up && npm run db:migrate && npm run db:seed`
2. `npm run dev`, register a student
3. `POST /api/v1/questions` with `rawText: 'לא מבין איך מציבים גבולות באינטגרל'`
4. Expect the `calculus-integrals` parent and the `definite-integrals` leaf, a Hebrew
   `teacherBrief`, a Hebrew `studentConfirmation`, and `classificationOk: true`
5. Time it. Record the number in the epic README
6. Comment out `GEMINI_API_KEY`, restart, repeat step 3. Expect 201, `topicId: 0`,
   `classificationOk: false`, and the boot log line
   `classification: 'DISABLED — GEMINI_API_KEY missing'`

## Review checklist additions

- The diff below `callWithTimeout` should be near-empty. If validation, the taxonomy
  check or the fallback moved, the PR grew past its scope.
- Every doc comment that describes the old request shape is now false. Comments that
  argue *why* (the double bound, the abort signal, the cleared timer, the model being a
  latency decision) are still true and stay — update the field names inside them, keep
  the reasoning.
- One `try`. Still exactly one.

## Notes

**Why the tests passed for three epics.** `classification.test.js` injects
`createMessage`, so it asserts that the code builds the object the code intends to build.
No assertion in the repo required a real request to be accepted. That is not a gap this
PR closes — 6a.3 closes it — but it is why "the suite is green" carried no information
here, and why the acceptance criteria above are all live-call observations.

**Why no dependency change.** `@google/genai@2.17.1` was in `package.json` from
`dc17a59`. The correct SDK has been installed the entire time; only the calls into it
were imagined.

**Why `gemini-3.5-flash-lite` looked plausible.** It is the naming pattern of a real
family with a version that does not exist. So is `gemini-3.7-flash` — `3.7` is an
Anthropic version number, and the swap commit rewrote an Anthropic file. Resolve from
`models.list()`; do not pattern-match a name that reads right.
