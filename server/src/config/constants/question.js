/**
 * Question intake and classification. MVP.md §7 (the taxonomy), §8.1 (the one LLM
 * call), §12 (the endpoints).
 *
 * The bounds here are shared by three consumers that must not disagree: the Zod
 * validators on `POST /questions` and `PATCH /questions/:id/classification`, the
 * Multer configuration behind the upload endpoint (PR 3.2), and the prompt's own
 * limits (PR 3.3). A number retyped in any of those three is the class of defect
 * E2 shipped three of — see docs/epics/E2-teacher-onboarding/RETRO.md.
 */

/**
 * "General / Unclassified" — the seeded sentinel topic (`prisma/seed/topics.js`).
 *
 * The only id in this codebase an application may know in advance, and
 * CONVENTIONS.md names it as the single carve-out to "the database assigns ids".
 * It exists because §8.1's fallback has to write *some* topic when the classifier
 * fails, and the flow must continue regardless.
 *
 * **Re-exported, not declared.** PR 0.5 already declared it in `constants/matching.js`
 * — §7's sentinel is read by the matching engine as well as by this epic's fallback —
 * and the epic README's risk list assumed this file would be its only home. Declaring
 * it a second time makes `constants/index.js` re-export one name from two files with
 * two different bindings, which is a hard `SyntaxError` on the first import through the
 * barrel: "conflicting star exports". Pointing at the existing binding keeps both
 * spellings valid and leaves exactly one `0` in the codebase. E4 owns `matching.js`; if
 * it ever wants the declaration to live here instead, that is a one-line move in E4's
 * own PR, and nothing that imports it changes.
 */
export { UNCLASSIFIED_TOPIC_ID } from './matching.js';

/**
 * The maths levels, 3/4/5 units, are **not** re-exported here.
 *
 * `MATH_LEVELS` already exists in `constants/user.js` as an alias of `teacher.js`'s
 * `TEACHING_LEVELS`, and a student's declared level is that same closed set —
 * `questions.declared_level` and `student_profiles.math_level` are the same scale.
 * Aliasing it a second time in this file would make `constants/index.js` re-export
 * one name from two files with two different bindings, and ES modules answer that
 * with `undefined` through the barrel's namespace and a `SyntaxError` on a named
 * import. This epic's validators (3.4, 3.5) import `MATH_LEVELS` from the barrel like
 * everyone else; the note is here so the next person does not add the alias back.
 */

/** A student may declare a level, or say nothing and let the classifier guess. */
export const DEFAULT_DECLARED_LEVEL = null;

// ── what the student types ───────────────────────────────────────────────────

/**
 * Short, because §4.1's own example is "I don't know how to start" — the question
 * is usually the photograph, and the text is the part the photograph cannot show.
 */
export const RAW_TEXT_MIN_LENGTH = 2;

/**
 * Long enough for a pasted exercise plus what the student tried; short enough that
 * the classification prompt's input stays bounded and a single request cannot
 * become the epic's token budget.
 */
export const RAW_TEXT_MAX_LENGTH = 2000;

// ── what the student photographs ─────────────────────────────────────────────

/**
 * Images per question.
 *
 * Three is a two-page exercise plus the student's own attempt. The cap is a cost
 * ceiling as much as a product one: every image is a Vision content block on the
 * classification call.
 */
export const MAX_ATTACHMENTS = 3;

/** Per image. A modern phone photo is 2–5 MB; this leaves room without inviting video frames. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Checked against the *parsed* MIME type, never the filename.
 *
 * No `image/heic`: iOS converts HEIC to JPEG when a photo goes through a file
 * input, and the classification model does not accept HEIC. If 3.8's verification
 * shows HEIC arriving anyway, the fix is a Cloudinary-side conversion in 3.2 —
 * not a wider allowlist here.
 */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Everything this epic uploads lands here, so a Cloudinary sweep never has to guess. */
export const CLOUDINARY_QUESTION_FOLDER = 'tutor-now/questions';

/**
 * How long one image may take to reach Cloudinary before the upload is abandoned.
 *
 * The SDK's own default is 60 seconds, which is not a timeout so much as a promise
 * that the student stares at a spinner for a minute and then meets the client's own
 * 15-second axios timeout anyway. Twenty seconds is a slow phone photo on a slow
 * connection and still leaves the request answerable.
 *
 * Exceeding it is an `EXTERNAL_SERVICE_ERROR` (502), not a validation error: the
 * student's file was fine, the third party was not. Added in PR 3.2 alongside the
 * two caps above so the whole upload budget reads in one place.
 */
export const CLOUDINARY_UPLOAD_TIMEOUT_MS = 20 * 1000;

/**
 * The multipart field one image arrives under, on `POST /questions/attachments`.
 *
 * Three files have to agree on this string and none of them may retype it: the
 * frozen router's `upload.single(...)` (this PR), the Multer configuration behind it
 * (3.2), and the `FormData.append` in the client's upload call (3.6). A mismatch
 * there is not a validation error — Multer simply reports no file, and the endpoint
 * fails as if the student sent nothing.
 */
export const ATTACHMENT_FIELD_NAME = 'image';

// ── what the classifier may answer ───────────────────────────────────────────

/** §8.1's `difficulty`, inclusive. Validated on the model's output and on the student's override. */
export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 5;

/** §8.1's `title` — `questions.title` is VARCHAR(160), and this is that column's width. */
export const TITLE_MAX_LENGTH = 160;

/**
 * The Cloudinary transform every classification fetch asks for. PR 6a.2.
 *
 * The bytes now transit this server on their way to the model, and the thing being
 * transferred is a phone photograph: 12 megapixels, 4 MB, twice over the wire — CDN to
 * here, here to Gemini — and base64 at 4/3 the size on the second leg, all inside
 * `LLM_TIMEOUT_MS`. The model downsamples on arrival regardless, so those pixels buy
 * latency and nothing else.
 *
 * `w_1600` is above what the vision tier reads and still legible for a handwritten
 * exercise; `q_auto` lets Cloudinary pick the quality that survives that resize; `f_jpg`
 * makes the response one format instead of three. The resize happens at the edge, on
 * Cloudinary's machines, and costs this server nothing.
 *
 * Applied by `media.service.js` only, and only to URLs that are Cloudinary's — a URL
 * from anywhere else is fetched as stored, because the transform is a path segment this
 * vendor understands and a 404 anywhere else.
 */
export const CLOUDINARY_CLASSIFICATION_TRANSFORM = 'f_jpg,q_auto,w_1600';

/**
 * Cloudinary's delivery host, which is the only place the transform above means
 * anything. Constant rather than inline so the one string that decides "is this URL
 * ours" sits beside the folder and the transform it belongs with.
 */
export const CLOUDINARY_DELIVERY_HOST = 'res.cloudinary.com';
