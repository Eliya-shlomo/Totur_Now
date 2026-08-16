import { UNCLASSIFIED_TOPIC_ID } from '#config/constants/index.js';

/**
 * What a question is about. MVP.md §8.1, and the seam between E3's two tracks
 * (docs/epics/E3-question-intake/README.md → "The internal seam").
 *
 * One exported function, frozen before either track started:
 *
 *   classifyQuestion({ rawText, imageUrls, declaredLevel }) -> Promise<Classification>
 *
 * **This file holds the fallback body only, and that is not throwaway code.** PR 3.3
 * (DEV-B) puts the Anthropic call in front of it and keeps everything below as the
 * `catch` branch — the §8.1 path that runs when the model fails, times out or comes
 * back under the confidence floor. Written here rather than as a TODO because 3.4 is
 * built and merged against this signature while 3.3 is still being written: a second
 * stub inside 3.4's service would be a second definition of "classification failed",
 * and two definitions of one thing drifting apart is E2's retro verbatim.
 *
 * **Ownership transfers to DEV-B when 3.3 opens.** DEV-A does not edit this file
 * again. Changing the signature is a chat message before the commit.
 *
 * Three properties this file has and must keep:
 *
 * **It never throws and never returns null.** Every input resolves to a
 * `Classification`, including an empty text, a 10k-character one and twenty images.
 * "Classification never blocks matching" is only true if the caller has nothing to
 * catch — `POST /questions` answers 201 on this path exactly as on the happy one.
 *
 * **It knows no database.** No client import, no repository import, no `questions`
 * table. It is handed strings and answers an object; the caller persists whatever
 * comes back. That is what lets DEV-B write the prompt without touching a
 * transaction and DEV-A write the transaction without waiting for a prompt.
 *
 * **It reads no request.** No request or response object reaches here — this is a
 * service (CONVENTIONS.md → Server layering), and 3.3's timeout and retry live here
 * rather than in a controller for the same reason.
 */

/**
 * Classify one question.
 *
 * The three fields on `input` are what §8.1 feeds the model. They are documented
 * here and destructured by 3.3, not by this body: an argument nothing reads is a
 * lint error rather than documentation (the same call this codebase made for 2.1's
 * stub controllers), while `input` itself is the frozen signature from the epic
 * README and does not move.
 *
 * `imageUrls` are Cloudinary URLs from `POST /questions/attachments`, uploaded
 * before the question row existed — which is why the upload endpoint comes first in
 * the epic and why an image bound after creation would be one the model never saw.
 *
 * `declaredLevel` is the student's claim (3, 4 or 5) or null. It is an input here
 * and is never the answer: `estimatedLevel` in the return value is the model's own
 * judgement, and §9.1 matches on that one.
 *
 * @param {object} input
 * @param {string} input.rawText          what the student typed
 * @param {string[]} [input.imageUrls]    stored image URLs, may be empty
 * @param {number|null} [input.declaredLevel]  3 | 4 | 5, or null
 * @returns {Promise<import('@tutor/shared').Classification>} never rejects, never null
 */
export async function classifyQuestion(input = {}) {
  return fallbackClassification(input?.rawText);
}

/**
 * The §8.1 fallback: the flow continues, the question is filed under the sentinel
 * topic, and the student is asked on the confirmation screen instead of told.
 *
 * `topicId` is the seeded "General / Unclassified" row and the one id this codebase
 * knows in advance (CONVENTIONS.md). `subtopicId` stays null rather than pointing at
 * the sentinel's children, because §9.2 scores a leaf at 1.0 — a wrong leaf is worse
 * for matching than no leaf.
 *
 * `teacherBrief` and `studentConfirmation` are both the student's own words. There is
 * no generated sentence to fall back to, and inventing one server-side would be
 * product copy in a service file; 3.7's screen reads `classificationOk: false` and
 * asks its own question around the text. `String(...)` rather than the value itself
 * because this function's whole contract is that a catastrophic input still answers:
 * an undefined `rawText` must produce a string, not a crash two layers up.
 *
 * `confidence: 0` and `classificationOk: false` are what 3.8's retro counts. Neither
 * is an error — nothing in this epic ever throws `LLM_FAILED`.
 *
 * @param {string} rawText
 * @returns {import('@tutor/shared').Classification}
 */
function fallbackClassification(rawText) {
  const text = String(rawText ?? '');

  return {
    title: null,
    topicId: UNCLASSIFIED_TOPIC_ID,
    subtopicId: null,
    difficulty: null,
    estimatedLevel: null,
    teacherBrief: text,
    studentConfirmation: text,
    confidence: 0,
    classificationOk: false,
  };
}
