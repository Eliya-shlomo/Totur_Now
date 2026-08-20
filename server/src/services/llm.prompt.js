import { MAX_IMAGES, MIN_CONFIDENCE } from '#config/constants/index.js';

/**
 * The classification prompt. PR 3.3, MVP.md §8.1, §7, §17.5.
 *
 * **`SYSTEM_INSTRUCTIONS` below is human-written.** `MVP.md` §17.5 names LLM prompts as
 * human-authored, and this epic's review checklist says the prompt is read as prose,
 * out loud, by a person — it is the one artifact here no test covers, so changing it is
 * a review by reading and not by a green suite. Everything *around* it in this file is
 * mechanical and is not prose: rendering the taxonomy out of the database, capping
 * images, assembling content blocks.
 *
 * The file exports no request parameters and calls nothing. It turns four values into
 * the two fields `models.generateContent` wants, so that the prompt can be rewritten
 * without touching a timeout, and the timeout can be tuned without touching the prompt.
 *
 * **The taxonomy is rendered, never pasted.** §7's topic list is a database table with
 * one source (`prisma/seed/topics.js` → `topics`), and `renderTaxonomy` prints whatever
 * `getTopicTree()` returned at call time. A prompt with the topic list typed into it
 * would be a fourth copy of that table, and F1's leaf-topic cleanup would not reach it.
 * There is no topic name and no topic id anywhere in this file.
 */

/**
 * The instructions the model is given, minus the taxonomy.
 *
 * Written by DEV-B, and reviewed by reading it rather than by running anything. The
 * list below is what the epic's review checklist asks the prose to cover, kept here as
 * the thing to re-read whenever it is edited:
 *
 * - the taxonomy is **closed** — answer with the ids given and never invent one;
 * - `title` is short and human, and it is what a teacher sees in a list;
 * - `teacher_brief` says **what the student is stuck on**, not what the exercise is.
 *   A brief that restates the question has failed §8.1's intent even though every
 *   field validates, and that is the thing to read out loud before merging;
 * - `student_confirmation` is one sentence a 12th-grader would recognise as describing
 *   their own question;
 * - `difficulty`, `estimated_level` and `confidence` are judgements about the exercise,
 *   and `estimated_level` is **the model's** view, never an echo of the student's
 *   `declared_level` (§9.1 matches on the estimate — see the contract freeze);
 * - answer in the student's own language, since the text arrives in Hebrew or English;
 * - low confidence is a legitimate answer. §8.1's fallback exists precisely so the
 *   model never has to guess, and a confident wrong subtopic costs a student a wrong
 *   teacher, while a low-confidence one costs them one screen tap.
 *
 * The JSON *shape* is enforced by `validators/classification.schema.js` and does not
 * need restating here; what each field should **say** does, and that is this file's job.
 */
export const SYSTEM_INSTRUCTIONS = `You are an expert high-school mathematics pedagogical assistant classifying student questions for on-demand tutoring.

Analyze the student's question (text, handwritten exercise photos, or diagrams) and match it to our topic taxonomy.

Guidelines:
1. Closed Taxonomy:
- You must choose strictly from the provided topics and subtopics using their exact integer IDs.
- Never invent, hallucinate, or approximate topic or subtopic IDs.
- If the problem cannot be confidently mapped to a subtopic in the provided taxonomy, assign a low confidence score (below ${MIN_CONFIDENCE}) so our fallback can handle it. Low confidence is a completely valid and preferred outcome over guessing.

2. Title (title):
- A short label a teacher reads in a list of waiting questions, not a sentence and not a restatement of the exercise. Name the mathematical object and what is being asked of it.
- Keep it well under one line. If a teacher scanning ten of these could not tell yours apart, it is too vague.

3. Teacher Brief (teacher_brief):
- Write a concise, actionable summary specifically highlighting the student's core difficulty or conceptual obstacle.
- Focus on what the student is stuck on rather than merely repeating or transcribing the problem statement.

4. Student Confirmation (student_confirmation):
- Provide a single, friendly sentence that a high-school student (12th grader) will immediately recognize as clearly capturing their specific question.

5. Difficulty (difficulty):
- Rate how hard this exercise is for a student studying at the level you estimated, on a scale where 1 is a routine drill straight out of a textbook chapter and 5 is among the hardest items a Bagrut exam would ask.
- Rate the exercise, not the student. A basic question asked by a struggling student is still a 1.

6. Estimated Level (estimated_level):
- Provide your independent pedagogical evaluation of the curriculum level (3, 4, or 5 units / units of study).
- Do not blindly echo declared_level; use your own domain analysis of the mathematical depth.

7. Language:
- Detect the language of the student's input (Hebrew or English) and write title, teacher_brief and student_confirmation in that exact same language.`;

/**
 * Whether the prompt above has actually been written.
 *
 * A scaffold guard, and it fails closed: while the placeholder marker is present,
 * `classification.service.js` refuses to spend a request and falls back instead. The
 * alternative is a merge where an unfinished prompt quietly classifies every question
 * badly — valid JSON, plausible fields, nonsense answers, and nothing red anywhere.
 * Writing the prose removes the marker, and this becomes true on its own.
 */
export const isPromptReady = !SYSTEM_INSTRUCTIONS.includes('TODO(human)');

/**
 * The taxonomy as the model reads it: every parent, its id, and its leaves.
 *
 * Both names are printed. Students write in Hebrew and the seed carries `nameHe` for
 * every row, so an English-only rendering would ask the model to translate before it
 * can match — a step that costs accuracy on exactly the questions this product exists
 * for.
 *
 * **Childless roots are dropped, without naming any of them.** Every answer must carry
 * a leaf `subtopic_id`, so a root with no children cannot appear in a valid answer and
 * printing it only invites one. That filter is also what removes the seeded
 * "General / Unclassified" sentinel — by shape, not by id, so this file keeps its
 * promise that no topic id is written down anywhere in it.
 *
 * @param {import('./topic.service.js').TopicNode[]} topicTree
 * @returns {string}
 */
export function renderTaxonomy(topicTree) {
  return (topicTree ?? [])
    .filter((topic) => topic.children?.length > 0)
    .map((topic) => {
      const leaves = topic.children.map(
        (child) => `    ${child.id}: ${child.nameEn} / ${child.nameHe}`,
      );

      return [`${topic.id}: ${topic.nameEn} / ${topic.nameHe}`, ...leaves].join('\n');
    })
    .join('\n');
}

/**
 * The image types Gemini names, mapped from the only thing we have here — the URL.
 *
 * `classifyQuestion` receives URLs, not attachment rows, so the stored `mimeType` from
 * 3.2 is not in reach without widening the frozen seam. The extension is what is left.
 * An unrecognised one omits `mime_type` rather than guessing: the field is optional and
 * the server sniffs the bytes, whereas a wrong declared type is an error on a photo
 * that would otherwise have classified fine.
 */
const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Four values in, one `models.generateContent` payload out.
 *
 * The images come **before** the text, which is the documented ordering for vision
 * requests and the one the student's own question implies: §4.1's example is "I don't
 * know how to start", and the exercise itself is the photograph.
 *
 * `imageUrls` are Cloudinary URLs from `POST /questions/attachments` (3.2), sent as
 * URLs rather than base64 — Gemini fetches public HTTPS URLs itself, so the bytes never
 * come back through this server, which is the property `media.service.js` was built for.
 * Anything that is not an `https:` string is dropped rather than sent: the list reaches
 * here from a database column, and one bad row must not fail every classification.
 *
 * **The paragraph above is false and 6a.2 is where it stops being false.** Gemini has
 * no image-by-URL part: a part carries `inlineData` (base64 bytes) or `fileData` (a
 * Files API URI, Gemini's own storage and not anyone's CDN), so `{ type: 'image', uri }`
 * reaches nothing. 6a.1 repaired the request around these parts and deliberately left
 * them as they were — the images are a second repair with a latency budget of their own,
 * and rewriting them here would have put two unmeasured changes in one diff. Until 6a.2
 * lands, a photographed question still classifies to the §8.1 fallback.
 *
 * `MAX_IMAGES` is applied here as well as at upload. The cap is a cost ceiling on this
 * exact call, and the caller is a service that could one day be handed a longer list.
 *
 * The tags around the student's values are structure, not prose — they exist so the
 * instructions above can refer to "the student's text" and mean something exact. An
 * absent `declaredLevel` omits its tag entirely rather than saying "none": a sentence
 * about what the student did not tell us is a sentence the model has to interpret.
 *
 * The return shape is this SDK's and not the previous request's: one `user` turn
 * carrying every part, which is what `contents` means here. `systemInstruction` stays a
 * sibling because it rides in `config`, not in the conversation.
 *
 * @param {object} input
 * @param {string} input.rawText
 * @param {string[]} [input.imageUrls]
 * @param {number|null} [input.declaredLevel]
 * @param {import('./topic.service.js').TopicNode[]} input.topicTree
 * @returns {{systemInstruction: string, contents: Array<object>}}
 */
export function buildMessages({ rawText, imageUrls = [], declaredLevel = null, topicTree }) {
  const images = (imageUrls ?? [])
    .filter((url) => typeof url === 'string' && url.startsWith('https://'))
    .slice(0, MAX_IMAGES)
    .map((url) => {
      const extension = url.split('?')[0].split('.').pop()?.toLowerCase();
      const mimeType = MIME_BY_EXTENSION[extension];

      return { type: 'image', uri: url, ...(mimeType ? { mime_type: mimeType } : {}) };
    });

  const declared =
    declaredLevel === null || declaredLevel === undefined
      ? ''
      : `<declared_level>${declaredLevel}</declared_level>\n`;

  const text = `${declared}<student_text>\n${String(rawText ?? '')}\n</student_text>`;

  return {
    systemInstruction: `${SYSTEM_INSTRUCTIONS}\n\n<taxonomy>\n${renderTaxonomy(topicTree)}\n</taxonomy>`,
    contents: [{ role: 'user', parts: [...images, { text }] }],
  };
}
