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
server/src/middlewares/upload.js                    new  (multer instance + error translation)
server/src/services/media.service.js                new  (upload_stream, returns { fileUrl, mimeType })
server/src/controllers/question.intake.controller.js new (the attachment handler only)
server/src/services/question.intake.service.js      new  (records the attachment row)
server/src/validators/question.intake.schema.js     new
server/package.json                                 multer only
package-lock.json                                   generated
docs/epics/E3-question-intake/README.md             tick the status box
```

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
- [ ] No literal byte count, MIME string or folder name in the diff outside `constants/question.js`
- [ ] Server logs contain no API secret and no signed upload URL

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

**The client will have to override the axios `Content-Type`.** `client/src/api/client.js` sets
`application/json` for every request and is DEV-A's single-owner frozen file. 3.6 deletes the header
on the one multipart call so the browser can set its own boundary. Mentioned here because the failure
shows up server-side, as a Multer parse error that reads like an upload bug.
