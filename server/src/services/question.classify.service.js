import { UNCLASSIFIED_TOPIC_ID } from '#config/constants/index.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import {
  findQuestionById,
  updateQuestionClassification,
} from '#repositories/question.repository.js';
import { getTopicTree } from '#services/topic.service.js';
import { AppError } from '#utils/AppError.js';
import { toQuestionResponse } from '#utils/questionView.js';

/**
 * Classification — reading one question back, and the student's right to disagree
 * with the machine. DEV-B's half of E3 (docs/epics/E3-question-intake/README.md →
 * "The split"). PR 3.5, MVP.md §12 and §8.1.
 *
 * Two functions, one read and one write, and everything they have in common is the
 * ownership rule below. Capture lives in `question.intake.service.js` and belongs to
 * DEV-A; the two files are never merged into one.
 *
 * **The model is not called here.** `classification.service.js` is the seam and this
 * PR is the *other* answer — what the student says instead — so nothing in this file
 * imports it, and `classificationOk` is never written. That column records whether the
 * LLM succeeded, and a question the student had to correct is still a question the
 * machine got wrong; 3.8's retro wants that number honest.
 *
 * No request or response object reaches this layer, and the controller above it
 * touches no database (CONVENTIONS.md → Server layering).
 */

/**
 * The real collaborators, replaced wholesale in tests.
 *
 * The idiom `classification.service.js` established in 3.3 and
 * `question.intake.service.js` kept in 3.4, for the same reason in all three: the
 * rules this file exists to enforce — a stranger's question is `NOT_FOUND`, an id the
 * taxonomy does not have is a `VALIDATION_ERROR` rather than a foreign-key 500, and
 * `classification_ok` is never in the written columns — are properties of what this
 * service *calls*, and a unit test cannot observe a call it cannot intercept.
 * `node --test`'s module mocking would need a flag on the root `npm test` script that
 * this PR is not allowed to touch.
 *
 * A test that overrides `findById` and forgets `loadTaxonomy` reaches the real
 * repository and fails on a missing database, so `server/tests/question.classify.test.js`
 * injects all three, every time.
 */
const defaultDeps = {
  findById: findQuestionById,
  updateClassification: updateQuestionClassification,
  loadTaxonomy: getTopicTree,
};

/**
 * `GET /questions/:id` — the question, in the shape `POST /questions` answered with.
 *
 * Not in MVP.md §12. It exists for two callers the epic README argues for: 3.7's
 * confirmation screen after a reload, and the client whose `POST /questions` timed out
 * on a cold instance while the server's work carried on. That second one only works
 * because the row is committed before the classifier runs — there is always something
 * here to come back to, even mid-classification, which is why `questionView.js`
 * defaults the two brief columns rather than emitting null.
 *
 * @param {object} input
 * @param {string} input.questionId  a uuid, already shape-checked by `questionByIdSchema`
 * @param {string} input.studentId   the caller, from `req.user.id`
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<import('@tutor/shared').QuestionResponse>}
 */
export async function getStudentQuestion({ questionId, studentId }, deps = defaultDeps) {
  const { findById } = { ...defaultDeps, ...deps };

  return toQuestionResponse(await loadOwnedQuestion({ questionId, studentId, findById }));
}

/**
 * `PATCH /questions/:id/classification` — the student overruling the model (§8.1).
 *
 * Three refusals before anything is written, in this order and for this reason:
 *
 *   1. **not yours** → `NOT_FOUND`, never `FORBIDDEN`, so the endpoint cannot be used
 *      to learn which question ids exist
 *   2. **not `PENDING` any more** → `SESSION_NOT_ACTIVE` (409). Once E5 sends an offer,
 *      a teacher has read a brief; re-topicing underneath them is a different feature
 *   3. **not a pair the taxonomy has** → `VALIDATION_ERROR`, rather than a foreign-key
 *      500 from Postgres forty milliseconds later
 *
 * Both ids are written together, never just the leaf: §9.2 scores the leaf at 1.0 and
 * the parent at 0.3, so a subtopic without its parent hands E4 half a row.
 * `estimatedLevel` is written only when the student sent one — an absent key leaves
 * the model's estimate alone rather than nulling it.
 *
 * @param {object} input
 * @param {string} input.questionId
 * @param {string} input.studentId
 * @param {number} input.topicId
 * @param {number|null} input.subtopicId  `null` is "none of these", and it is an answer
 * @param {number} [input.estimatedLevel]  3 | 4 | 5, or absent
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<import('@tutor/shared').QuestionResponse>}
 */
export async function overrideQuestionClassification(
  { questionId, studentId, topicId, subtopicId, estimatedLevel },
  deps = defaultDeps,
) {
  const { findById, updateClassification, loadTaxonomy } = { ...defaultDeps, ...deps };

  const question = await loadOwnedQuestion({ questionId, studentId, findById });

  assertSessionIsPending(question);
  await assertPairIsInTaxonomy({ topicId, subtopicId, loadTaxonomy });

  const updated = await updateClassification(question.id, {
    topicId,
    subtopicId,
    // Spread rather than `estimatedLevel: estimatedLevel ?? undefined`, so the key is
    // absent from `data` instead of present-and-undefined. Prisma treats the two the
    // same today; a reader checking this call against the schema should not have to
    // know that.
    ...(estimatedLevel === undefined ? {} : { estimatedLevel }),
  });

  return toQuestionResponse(updated);
}

/**
 * One question, or `NOT_FOUND` — the ownership rule both endpoints share.
 *
 * The repository's find deliberately does not filter on `studentId`; the check is
 * here, in the service, because a controller does not query and a `where` clause
 * would make "someone else's" and "does not exist" indistinguishable to any later
 * caller that needs them apart (an admin screen, E4's matching).
 *
 * **`NOT_FOUND` rather than `FORBIDDEN`, and the same message for both.** `FORBIDDEN`
 * confirms the id exists. The uuid is unguessable so the leak is small, but it is free
 * to avoid, and the same rule applies to sessions in E6.
 */
async function loadOwnedQuestion({ questionId, studentId, findById }) {
  const question = await findById(questionId);

  if (!question || question.studentId !== studentId) throw AppError.notFound('Question');

  return question;
}

/**
 * Only a question still waiting to be matched may be re-classified.
 *
 * `QUESTION_VIEW` selects `session.status` for exactly this check, so the guard costs
 * no extra query. `SESSION_NOT_ACTIVE` is 409 in `shared/errorCodes.js` and is the
 * right shape: the request collided with a state, it did not name a missing resource.
 *
 * The literal is the Prisma enum's own spelling (`prisma/schema/sessions.prisma`),
 * which is also what the repository writes when it creates the row. A constant here
 * would be a third name for a value the database already defines.
 *
 * A question whose session vanished cannot be re-classified either — there is nothing
 * left to match, and inventing a default for a row that must exist would hide a bug.
 */
function assertSessionIsPending(question) {
  if (question.session?.status === 'PENDING') return;

  throw new AppError(
    ERROR_CODES.SESSION_NOT_ACTIVE,
    'This question has already been sent to a teacher, so its topic can no longer be changed.',
  );
}

/**
 * Does this pair name real rows, and is the parent really the parent?
 *
 * The taxonomy is the authority, never a hardcoded range: §7's tree is seeded and F1
 * is about to move rows inside it, so a validator carrying its own idea of which ids
 * are leaves is a validator that goes stale the week after it is written. This is the
 * disagreement E2 shipped between its seed and `assertLeafTopics`, and the epic exists
 * partly not to repeat it on the question side.
 *
 * **This re-asks 3.3's question rather than calling its `isKnownPair`.** That function
 * is private to `classification.service.js`, which this PR's denylist forbids opening,
 * and it answers a narrower question: the model must always produce a leaf, while the
 * student is explicitly allowed not to. The two rules differ, so one shared predicate
 * would need a flag, and both callers read the same source of truth — `getTopicTree()`
 * — which is where the actual duplication risk was.
 *
 * Three shapes are legal:
 *
 *   - a leaf, with its own parent as `topicId`
 *   - `null`, with a parent that exists — "I know the area, not the exercise". §9.2
 *     scores that parent at 0.3, so it is worth strictly more than nothing
 *   - `null`, with `UNCLASSIFIED_TOPIC_ID` — "none of these", which is also exactly
 *     what §8.1's fallback stored, so the student can leave it as it is
 *
 * Everything else is one `VALIDATION_ERROR` naming the field the student can act on.
 */
async function assertPairIsInTaxonomy({ topicId, subtopicId, loadTaxonomy }) {
  if (subtopicId === null && topicId === UNCLASSIFIED_TOPIC_ID) return;

  const topicTree = await loadTaxonomy();
  const parent = (topicTree ?? []).find((topic) => topic.id === topicId);

  if (!parent) {
    throw AppError.validation('That topic does not exist.', {
      topicId: 'Pick a topic from the list.',
    });
  }

  if (subtopicId === null) return;

  const isChild = (parent.children ?? []).some((child) => child.id === subtopicId);

  if (!isChild) {
    throw AppError.validation('That subtopic does not belong to that topic.', {
      // A parent id sent as a subtopic lands here too, and deliberately reads the same
      // way: it is not one of this topic's leaves, whatever else it is.
      subtopicId: 'Pick one of that topic’s subtopics, or send null.',
    });
  }
}
