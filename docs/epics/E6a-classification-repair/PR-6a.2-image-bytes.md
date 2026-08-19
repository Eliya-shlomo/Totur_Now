# PR 6a.2 — Images: fetch the bytes, send `inlineData`

| | |
|---|---|
| **Epic** | E6a — Classification Repair & the Teacher Brief |
| **Owner** | DEV-B (rotem) |
| **Size** | M |
| **Written by** | Agent. |
| **Depends on** | 6a.1 (merged) |
| **Blocks** | 6a.3 |
| **Branch** | `dev-b/E6a.2-image-bytes` |

## Contract implemented

None. No endpoint, no shape, no column. This makes `MVP.md` §8.1's "student's text +
image" half true for the first time — the image half has never reached a model.

## Scope

6a.1 repaired the call. A text-only question now classifies. **A photographed one still
cannot**, and the photograph is the main path: §4.1's student says "I don't know how to
start" and the exercise is the picture.

`llm.prompt.js` builds image parts as `{ type: 'image', uri: cloudinaryUrl }` on the
belief, written into its doc comment, that "Gemini fetches public HTTPS URLs itself, so
the bytes never come back through this server". It does not. A Gemini image part carries
`inlineData` (base64 bytes) or `fileData` (a URI in Gemini's *own* Files API, not a CDN).
A public HTTPS URL in a content part is text to the model at best.

So the server fetches the bytes and inlines them. That gives up the property the comment
was proud of — and the property was never real, because the request that would have
provided it does not exist in this API. **Rewrite that paragraph** to describe what now
happens and why. Leaving prose that explains a design which never ran is how the next
reader loses another three epics.

### Where the fetching lives

`media.service.js`. It is already the only file besides `config/cloudinary.js` that knows
which image host this project uses, and it already owns the other direction — a buffer in,
a URL out. This is the same boundary, read backwards.

`llm.prompt.js` stays a pure function. It receives bytes and formats parts; it does not
perform I/O, and a prompt builder that opens sockets is the kind of thing that is
untestable a year later.

New export, roughly:

```js
export async function fetchImagesForClassification(urls, { limit, signal })
//   -> Promise<Array<{ mimeType: string, base64: string }>>
```

What it does, and each point is a requirement:

- Keeps the `https://` filter and the `MAX_IMAGES` cap that
  `llm.prompt.js:167-169` applies today. The list arrives from a database column; one bad
  row must not fail a classification.
- **Appends a Cloudinary transform** — `f_jpg,q_auto,w_1600` or equivalent — so a 12
  megapixel phone photograph does not spend the latency budget transferring bytes the
  model downsamples on arrival. This is the mitigation the epic's latency risk names.
- **Sniffs the MIME from the bytes with `detectImageMimeType` from `#utils/imageType.js`.**
  Not from the URL extension, and not from the `Content-Type` header. That utility exists,
  is tested (`imageType.test.js`), and is already what `middlewares/upload.js` trusts over
  the declared type on the way in. Trusting it on the way out too means one answer to
  "what is this image" in the whole codebase. `MIME_BY_EXTENSION` in `llm.prompt.js` goes
  away, and with it the guess its comment documents.
- Fetches with its own abort signal and a budget **well inside** `LLM_TIMEOUT_MS`. Three
  images that each take four seconds is a timeout with no request made.
- **Drops a failed image rather than throwing.** One dead URL must not fail a
  classification that had two good photographs. A dropped image is logged by count, never
  by URL — a Cloudinary URL is a pointer to a student's homework.
- Fetches the images concurrently. They are independent and the budget is shared.

### Wiring

`classifyQuestion` calls the fetcher before `buildMessages` and passes the results in.
It joins `defaultDeps` as an injected collaborator, for the same reason `loadTaxonomy` and
`createMessage` are: a test that forgot to override it would reach the network, pass for
the wrong reason on a machine with connectivity, and fail on one without.

`buildMessages` takes `images: Array<{mimeType, base64}>` instead of `imageUrls`, and
emits `{ inlineData: { mimeType, data: base64 } }` parts. Images stay **before** the text
— that ordering was right, and its comment stays.

## Files you may touch

```
server/src/services/media.service.js            the fetch, the transform, the sniff
server/src/services/llm.prompt.js               inlineData parts; delete MIME_BY_EXTENSION; rewrite the URL paragraph
server/src/services/classification.service.js   call the fetcher, add it to defaultDeps
server/tests/classification.test.js             image-part assertions, and the new injected dep
docs/epics/E6a-classification-repair/README.md  tick the status box
```

## Files you must NOT touch

```
server/src/utils/imageType.js                   reuse it; it is correct and tested
server/tests/imageType.test.js                  unchanged — the detector's contract does not move
server/src/middlewares/upload.js                the inbound path is fine
server/src/routes/question.routes.js            frozen at 3.1
server/src/controllers/**                       no controller learns that bytes exist
server/src/services/llm.prompt.js → SYSTEM_INSTRUCTIONS   prose. §17.5. 6a.4 owns it
prisma/**                                       no schema change
shared/**                                       no contract change
```

## Acceptance criteria

- [ ] A question submitted as a photograph of a Hebrew exercise, with **empty** `rawText`, classifies to a real subtopic
- [ ] Three images classify inside `LLM_TIMEOUT_MS` — measured, with the number recorded in the epic README
- [ ] One unreachable URL among three still classifies from the other two
- [ ] A non-`https` entry is dropped rather than sent
- [ ] A fourth image is not fetched — `MAX_IMAGES` still binds
- [ ] The MIME sent is what `detectImageMimeType` read from the bytes; a `.jpg` URL serving a PNG is sent as `image/png`
- [ ] No test reaches the network: the fetcher is injected, and `npm test` passes with no connectivity
- [ ] No log line carries an image URL or the student's text
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` pass

## Manual test

1. `npm run dev`, register a student
2. Photograph a real Bagrut exercise. Upload it through `POST /questions/attachments`
3. `POST /questions` with that attachment id and `rawText: ''`
4. Expect a real parent and leaf, and a Hebrew `teacherBrief` describing the exercise in
   the photograph — proof the model saw the image and not just the empty text
5. Repeat with three attachments. Time it
6. Hand-edit one attachment row to an unreachable HTTPS URL and repeat. Expect a
   classification from the surviving two, and one log line counting the drop

## Review checklist additions

- No `fetch` in `llm.prompt.js`. It is a pure function and stays one.
- No second MIME-detection implementation. If the diff adds a byte-signature table,
  `utils/imageType.js` was not reused.
- The fetch budget is derived from `LLM_TIMEOUT_MS`, not a second hardcoded number
  sitting next to it — `CONVENTIONS.md`, no magic numbers.
- The rewritten paragraph in `llm.prompt.js` says the bytes now transit this server. If
  it still claims they do not, the comment is describing the old fiction.

## Notes

**Why `inlineData` and not the Files API.** `fileData` would keep classification fast —
upload once at attachment time, send a URI later — but it means a second storage system
beside Cloudinary, a 48-hour file lifetime to reason about, and changes to PR 3.2's upload
endpoint. Inlining costs a fetch inside the request. Take the cost; revisit if 6a.3's p95
says the budget cannot hold it, and if it says so, the Files API is the answer and it is
E7's.

**Why the transform and not the original.** Cloudinary resizes at the edge for free. The
alternative is transferring 4 MB per photograph twice — CDN to server, server to Gemini,
base64 at 4/3 the size — inside an 8-second budget, for pixels the model reduces anyway.

**Why sniffing rather than the header.** A CDN's `Content-Type` is a claim, and this
codebase already decided at 3.2 that a claim about an image's type is not evidence:
`middlewares/upload.js` reads the bytes. The same rule, restated where the bytes leave.
