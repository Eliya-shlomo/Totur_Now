import { MAX_IMAGES } from '#config/constants/index.js';

/**
 * The classification prompt. PR 3.3, MVP.md §8.1, §7, §17.5.
 *
 * **`SYSTEM_INSTRUCTIONS` below is human-written and is not finished.** `MVP.md` §17.5
 * names LLM prompts as human-authored, and this epic's review checklist says the
 * prompt is read as prose, out loud, by a person — it is the one artifact here no test
 * covers. Everything *around* it in this file is mechanical and is not prose: rendering
 * the taxonomy out of the database, capping images, assembling content blocks.
 *
 * The file exports no request parameters and calls nothing. It turns four values into
 * the two fields `messages.create` wants, so that the prompt can be rewritten without
 * touching a timeout, and the timeout can be tuned without touching the prompt.
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
 * **TODO(human): replace this placeholder before merging.** From the epic's review
 * checklist, the prose has to say at least:
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
export const SYSTEM_INSTRUCTIONS = `TODO(human): write the classification instructions here.`;

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
 * Four values in, one `messages.create` payload out.
 *
 * The images come **before** the text in the user turn, which is the documented
 * ordering for vision requests and the one the student's own question implies: §4.1's
 * example is "I don't know how to start", and the exercise itself is the photograph.
 *
 * `imageUrls` are Cloudinary URLs from `POST /questions/attachments` (3.2), sent as URL
 * sources rather than base64 — the bytes never come back through this server, and a
 * question's images are already public. Anything that is not an `https:` string is
 * dropped rather than sent: the list reaches here from a database column, and one bad
 * row must not turn every classification into a 400.
 *
 * `MAX_IMAGES` is applied here as well as at upload. The cap is a cost ceiling on this
 * exact call, and the caller is a service that could one day be handed a longer list.
 *
 * The tags around the student's values are structure, not prose — they exist so the
 * instructions above can refer to "the student's text" and mean something exact. An
 * absent `declaredLevel` omits its tag entirely rather than saying "none": a sentence
 * about what the student did not tell us is a sentence the model has to interpret.
 *
 * @param {object} input
 * @param {string} input.rawText
 * @param {string[]} [input.imageUrls]
 * @param {number|null} [input.declaredLevel]
 * @param {import('./topic.service.js').TopicNode[]} input.topicTree
 * @returns {{system: string, messages: Array<object>}}
 */
export function buildMessages({ rawText, imageUrls = [], declaredLevel = null, topicTree }) {
  const images = (imageUrls ?? [])
    .filter((url) => typeof url === 'string' && url.startsWith('https://'))
    .slice(0, MAX_IMAGES)
    .map((url) => ({ type: 'image', source: { type: 'url', url } }));

  const declared =
    declaredLevel === null || declaredLevel === undefined
      ? ''
      : `<declared_level>${declaredLevel}</declared_level>\n`;

  const text = `${declared}<student_text>\n${String(rawText ?? '')}\n</student_text>`;

  return {
    system: `${SYSTEM_INSTRUCTIONS}\n\n<taxonomy>\n${renderTaxonomy(topicTree)}\n</taxonomy>`,
    messages: [{ role: 'user', content: [...images, { type: 'text', text }] }],
  };
}
