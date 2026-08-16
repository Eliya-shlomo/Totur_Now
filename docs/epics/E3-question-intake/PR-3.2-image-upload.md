# PR 3.2 — Cloudinary + image upload endpoint

| | |
|---|---|
| **Epic** | E3 — Question Intake & LLM Classification |
| **Owner** | DEV-A (eliya) |
| **Size** | M |
| **Written by** | Agent |
| **Depends on** | 3.1 (merged) |
| **Blocks** | 3.4, 3.6 |
| **Branch** | `dev-a/E3.2-image-upload` |

## Contract implemented

`POST /api/v1/questions/attachments` → `Attachment` from the epic's contract freeze.
`MVP.md` §12 ("Questions & Matching"), §4.1 (photo of the exercise).

## Scope

One authenticated endpoint that takes one image and answers with a stored, publicly readable URL.

The student picks a photo **before** the question exists, so the row it writes has
`question_id = NULL` and is bound later by `POST /questions` (3.4). That is the deviation the epic
README argues for — classification is a Vision call inside `POST /questions`, so an image attached
afterwards is an image nobody classified.

`multipart/form-data`, one file per request, field name `image`. Multer with **memory** storage
(no temp files on a free Render instance's disk), then `cloudinary.uploader.upload_stream` into a
single folder. Size cap, MIME allowlist and the folder name come from `constants/question.js` —
Multer's own `limits` and `fileFilter` cite those constants, they do not restate the numbers.

Three failures, three answers:

| Failure | Answer |
|---|---|
| No file, wrong field name, more than one file | `VALIDATION_ERROR` |
| Over the size cap, or a MIME type outside the allowlist | `VALIDATION_ERROR`, with a message naming the limit |
| Cloudinary refuses, times out, or is unconfigured | `EXTERNAL_SERVICE_ERROR` |

Multer throws its own error class, not `AppError`, and its messages (`File too large`) are not in the
project's error shape. Translate them at the middleware boundary so `errorHandler` never sees a
stranger — this is the same posture `validate.js` takes with Zod.

`config/cloudinary.js` configures the SDK once from `config/env.js` and exports the configured
instance. Nothing else in the codebase imports `cloudinary`, the same rule `OWNERSHIP.md` §2.1 sets
for the video provider.

**One dependency change: `multer`.** Announce it in chat before installing, land it in this PR, and
tell DEV-B to rebase before continuing (`OWNERSHIP.md` §4). `cloudinary` itself was installed in E0
and is already in `server/package.json`.

## Files you may touch

```
server/src/config/cloudinary.js                     new
server/src/middlewares/upload.js                    3.1's pass-through → multer + error translation
server/src/services/media.service.js                new  (upload_stream, returns { fileUrl, mimeType })
server/src/controllers/question.intake.controller.js 3.1's stub → the attachment handler only
server/src/services/question.intake.service.js      new  (records the attachment row)
server/package.json                                 multer only
package-lock.json                                   generated
docs/epics/E3-question-intake/README.md             tick the status box

# added while implementing
server/src/utils/imageType.js                       new  magic-byte MIME detection
server/tests/imageType.test.js                      new  the detector, seven cases
server/src/config/constants/question.js             one appended constant (upload timeout)
```

**Corrections to the list above.** `upload.js`, `question.intake.controller.js` and
`question.intake.schema.js` were written as "new" here, but 3.1 created all three — a
frozen router cannot import files that do not exist. This PR replaces two bodies and
does not open the schema at all: the attachment route deliberately carries no
validator, because its body is a multipart file and the rules that apply to it are
Multer's `limits` and `fileFilter`, reading the same constants a schema would have.

**`utils/imageType.js` is not optional and is the reason an acceptance criterion
passes.** "The MIME check reads the parsed type, not the filename" cannot be satisfied
by Multer's `file.mimetype`: that value comes from the multipart part's `Content-Type`
header, which the *uploader* writes. `curl -F image=@notes.txt` and every browser
derive it from the file extension, so a `.txt` renamed to `.jpg` arrives announced as
`image/jpeg` and passes a `fileFilter` check. The bytes are the only thing that cannot
lie, so three signatures are read from the buffer after Multer finishes, and
`req.file.mimetype` is overwritten with what was actually found. A pure function over a
buffer, so it gets a test rather than a manual pass.

**Why three MIME strings appear outside `constants/question.js`.** They are the keys of
the signature table, and a table that maps a type to its bytes has to name the type. The
split is still one-way and still honest: `ALLOWED_IMAGE_MIME_TYPES` decides **what is
permitted** and is the only list either check iterates; `imageType.js` only knows **how
to recognise** each one. A type added to the allowlist without a signature would be
refused by every upload, so the file asserts at boot that it can describe everything the
allowlist permits — the same posture `constants/matching.js` takes with `MATCH_WEIGHTS`.

**`CLOUDINARY_UPLOAD_TIMEOUT_MS`.** The failure table below names "times out" as an
`EXTERNAL_SERVICE_ERROR`, which requires a timeout to exist. The SDK's default is 60
seconds — longer than the client's own axios timeout, so without this the student's
request dies first and the server keeps uploading into a connection nobody is reading.

## Files you must NOT touch

```
server/src/routes/question.routes.js                frozen by 3.1 — the route and its middleware exist
server/src/repositories/question.repository.js      frozen by 3.1 — the attachment queries exist
server/src/services/classification.service.js       DEV-B's from 3.3
server/src/config/env.js                            CLOUDINARY_* is already declared and required in production
.env.example                                        already carries the three Cloudinary keys, from 0.7
server/src/app.js                                   frozen; the body-parser limit there is for JSON, not multipart
client/**                                           3.6's job
```

## Acceptance criteria

- [ ] A student uploading a small JPEG gets `201` and an `Attachment` whose `fileUrl` opens in a browser
- [ ] The created row has `question_id = NULL`
- [ ] A PDF, a `.txt` renamed to `.jpg`, and a 20 MB image are each rejected with `VALIDATION_ERROR` — the MIME check reads the parsed type, not the filename
- [ ] A request with no file returns `VALIDATION_ERROR`, not a 500
- [ ] A teacher's token returns `FORBIDDEN`; no token returns `UNAUTHORIZED`
- [ ] With `CLOUDINARY_API_SECRET` deliberately wrong, the answer is `EXTERNAL_SERVICE_ERROR` and the server stays up
- [ ] No Multer message reaches the client verbatim — every failure is in the standard error shape
- [ ] `grep -rn "cloudinary" server/src --include=*.js` matches only `config/cloudinary.js` and `services/media.service.js`
- [ ] No literal byte count or folder name outside `constants/question.js`, and no MIME string except as the **keys** of the signature table in `utils/imageType.js` — see below
- [ ] Server logs contain no API secret and no signed upload URL — but see the note on what Cloudinary's own error text does contain

## Manual test

1. `curl -H "Authorization: Bearer <student>" -F image=@exercise.jpg http://localhost:3000/api/v1/questions/attachments`
2. Open the returned `fileUrl`; confirm the image loads and the Cloudinary dashboard shows one asset in the configured folder
3. Repeat with a PDF, with a 20 MB photo, and with `-F wrongfield=@exercise.jpg`
4. `psql` → `select id, question_id from question_attachments order by id desc limit 3;` — `question_id` is null
5. Break the secret in `.env`, restart, retry, read the error code

## Review checklist additions

- Confirm memory storage, not disk. `multer({ dest: ... })` writes to a filesystem that does not survive a Render restart and fills the free tier's disk.
- Confirm the file buffer is never logged and never written to a path built from a client-supplied filename. The public id is generated server-side; the original filename is data, not a path.
- Confirm the endpoint is the only place `upload.single` appears — it is wired in 3.1's frozen router, so this PR supplies the middleware and does not re-route.

## Notes

**Why through the server rather than a signed direct-to-Cloudinary upload.** Direct upload saves the
server's bandwidth, but it needs a signature endpoint plus a second call to record the returned URL,
and that second call is a client telling the server what to store — which has to be verified against
Cloudinary anyway. Two round trips and a trust problem, to save bandwidth this project does not
spend. Through the server, the MIME and size rules are enforced in one place and the row is written
by the same request that stored the bytes.

**Why `EXTERNAL_SERVICE_ERROR` rather than `INTERNAL_ERROR`.** The code exists in
`shared/errorCodes.js` at 502 for exactly this: our code is fine, the third party is not. The client
can say "couldn't save the photo, try again" instead of "something went wrong".

**What a failed upload logs, exactly.** `media.service.js` logs `error.message` and the
folder, never the error object — the object carries the signed request that produced it,
and a signed request in a log is a credential in a log. Verified with a deliberately
wrong secret: neither `CLOUDINARY_API_KEY` nor `CLOUDINARY_API_SECRET` appears anywhere
in the output. What the message *does* carry on that one path is Cloudinary's own text,
which quotes the rejected signature digest and the string it was computed over
(`folder=…&timestamp=…`). That is a single-use SHA-1 over two public values, not the
secret and not a usable URL, and it only appears when the credentials are already
broken. Judged worth keeping, because it is also the only line that says *why* an upload
failed. If a future review disagrees, the fix is to map known vendor messages to our own
in `media.service.js` and log a code — not to stop logging the reason.

**The client will have to override the axios `Content-Type`.** `client/src/api/client.js` sets
`application/json` for every request and is DEV-A's single-owner frozen file. 3.6 deletes the header
on the one multipart call so the browser can set its own boundary. Mentioned here because the failure
shows up server-side, as a Multer parse error that reads like an upload bug.
