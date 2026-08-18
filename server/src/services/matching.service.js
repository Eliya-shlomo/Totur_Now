import { MATCH_COUNT } from '#config/constants/index.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import {
  findPositiveHistoryTeacherIds,
  findQuestionForMatching,
  findWalletBalance,
} from '#repositories/matching.repository.js';
import { runOfferExpiry } from '#jobs/offer.expiry.job.js';
import { getPlatformAverages } from '#services/matching.averages.service.js';
import { resolveCandidatePool } from '#services/matching.candidates.service.js';
import { rankCandidates } from '#services/matching.scoring.js';
import { AppError } from '#utils/AppError.js';
import { toMatchesResponse } from '#utils/matchView.js';

/**
 * Which teachers this student is shown, and in what order — `GET /questions/:id/matches`.
 * PR 4.5, MVP.md §9 and §12.
 *
 * **Deliberately thin.** Every rule it applies belongs to a file that already exists:
 * the eligibility predicates are `matching.candidates.service.js`'s (4.2), the prior
 * is `matching.averages.service.js`'s (4.3), the order is `matching.scoring.js`'s
 * (4.6), and the payload shape is `matchView.js`'s. What is here is the sequence and
 * the two refusals, and nothing else should arrive.
 *
 * **Both empty pools are 200 with a `reason`, and this endpoint never throws
 * `NO_AVAILABLE_TEACHERS`** — exactly as E3 never threw `LLM_FAILED`. §9.4's own
 * pseudocode returns a reason rather than raising, an empty list is a state every list
 * in this codebase already renders, and a 402 or a 409 would make the screen show an
 * error for the product working as designed. The code exists in `shared/errorCodes.js`
 * and is read from there so the reason a client switches on and the code the catalogue
 * lists cannot drift; it is not a code this file raises. Nobody should "fix" that.
 *
 * **This file does not sort.** No `.sort(`, no comparison of scores, no `Math.max`.
 * Ordering is `matching.scoring.js`'s only job, and the single ordering operation
 * permitted here is `.slice(0, MATCH_COUNT)` on a list the scorer already ordered. If
 * the order looks wrong, that is 4.6's file.
 *
 * **`score` is dropped at the join below and reaches no payload** (§14.2 — the student
 * sees an order, not grades). `matchView.js` is never handed one.
 *
 * No request or response object reaches this layer, and the controller above it
 * touches no database (CONVENTIONS.md → Server layering).
 */

/**
 * The real collaborators, replaced wholesale in tests.
 *
 * The idiom `classification.service.js` established in 3.3, and 4.2 and 4.3 both kept.
 * Here it buys the property this PR's brief names outright: that a student who cannot
 * afford anybody reaches **neither the candidate query nor the platform aggregate**.
 * That is a fact about two calls that did not happen, and a suite running against real
 * Postgres can see an empty list but never the absence of the statements that would
 * have produced it. It is also what keeps `matching.service.test.js` runnable with no
 * database, on the root `npm test` script this PR is not allowed to touch.
 *
 * **`rankCandidates` is deliberately not in here.** Injecting it would be stubbing the
 * scorer a second time, which is the one thing 4.1, 4.3 and this PR's brief all forbid
 * by name: one stub, in the file that will hold the real thing. It is a pure function
 * with a deterministic order, so the tests below join against the real one and their
 * assertions stay true when 4.6 replaces its body.
 */
const defaultDeps = {
  findQuestion: findQuestionForMatching,
  findBalance: findWalletBalance,
  resolvePool: resolveCandidatePool,
  loadAverages: getPlatformAverages,
  findPositiveHistory: findPositiveHistoryTeacherIds,
  sweepExpiredOffers: runOfferExpiry,
};

/**
 * The ranked pool for one question — `MatchesResponse`, always 200 for an owner of a
 * `PENDING` question.
 *
 * Six steps, in this order, and the order is the point:
 *
 *   1. the question, or `NOT_FOUND`
 *   2. the session still `PENDING`, or `SESSION_NOT_ACTIVE`
 *   3. the balance, then 4.2's ceilings and pool
 *   4. **short-circuit on any empty pool**, before the prior and before the history
 *   5. the prior (4.3) and this student's positive history, marked onto each candidate
 *   6. the scorer's order, sliced to `MATCH_COUNT`, joined back and serialized
 *
 * @param {object} input
 * @param {string} input.questionId  a uuid, already shape-checked by `matchesSchema`
 * @param {string} input.studentId   the caller, from `req.user.id`
 * @param {string} [input.priceBand] `'A' | 'B' | 'C'`; absent means no band ceiling
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<import('@tutor/shared').MatchesResponse>}
 */
export async function getQuestionMatches({ questionId, studentId, priceBand }, deps = defaultDeps) {
  const {
    findQuestion,
    findBalance,
    resolvePool,
    loadAverages,
    findPositiveHistory,
    sweepExpiredOffers,
  } = {
    ...defaultDeps,
    ...deps,
  };

  const owned = await loadOwnedQuestion({ questionId, studentId, findQuestion });
  const question = await requireMatchableSession({
    question: owned,
    questionId,
    studentId,
    findQuestion,
    sweepExpiredOffers,
  });

  // `null` — no wallet row at all — is read as zero here rather than in the
  // serializer, because `MatchesResponse.walletBalance` is a `number` and the
  // affordability rule below wants the same value. One coalesce, one number, and 4.2
  // receives exactly what the response reports.
  const walletBalance = (await findBalance(studentId)) ?? 0;
  const { candidates, priceCeiling, reason } = await resolvePool({
    question,
    walletBalance,
    priceBand,
  });

  // Every empty pool returns here, and `reason !== null` is exactly "no candidates"
  // (`matching.candidates.service.js` sets one in both cases and neither otherwise).
  // The brief requires this before the pool query for `INSUFFICIENT_CREDIT`, which 4.2
  // already does; what this line adds is that neither empty answer pays for the
  // platform aggregate or the history read either. Both are wasted work for a list
  // that is already known to be empty.
  if (reason !== null) {
    return toMatchesResponse({ matches: [], reason, priceCeiling, walletBalance });
  }

  // The two inputs the scorer needs that the pool does not carry. Independent reads,
  // so they are awaited together — and the aggregate behind `getPlatformAverages` is
  // cached for §9.4's window, so pressing the price control does not re-run it.
  const [averages, positiveHistoryIds] = await Promise.all([
    loadAverages(),
    findPositiveHistory(studentId),
  ]);

  const marked = markPositiveHistory(candidates, positiveHistoryIds);

  return toMatchesResponse({
    matches: takeRanked(marked, averages),
    reason,
    priceCeiling,
    walletBalance,
  });
}

/**
 * One question, or `NOT_FOUND` — the ownership rule, and the same one 3.5 applies.
 *
 * The repository's find deliberately does not filter on `studentId`; the comparison is
 * here, in the service, because a controller does not query and a `where` on the
 * student would make "someone else's" and "does not exist" indistinguishable.
 *
 * **`NOT_FOUND` rather than `FORBIDDEN`, and the same message for both.** `FORBIDDEN`
 * confirms the id exists. The uuid is unguessable so the leak is small, but it is free
 * to avoid.
 */
async function loadOwnedQuestion({ questionId, studentId, findQuestion }) {
  const question = await findQuestion(questionId);

  if (!question || question.studentId !== studentId) throw AppError.notFound('Question');

  return question;
}

/**
 * Only a question still waiting to be matched may be matched again — **and a session
 * that merely looks busy is swept before it is refused.**
 *
 * Once the session has left `PENDING` there is an offer out or a teacher attached, and
 * a fresh list is a way to double-book a student — precisely the invariant §9.5's "one
 * offer at a time" exists to protect and which E5's 5.3 enforces atomically. Refusing
 * here is cheap and it makes 5.3's job smaller. 3.5 refuses re-classification on the
 * same test.
 *
 * `MATCHING_QUESTION_VIEW` selects `session.status` for exactly this check, so the
 * guard costs no extra query. `SESSION_NOT_ACTIVE` is 409 in `shared/errorCodes.js`
 * and is the right shape: the request collided with a state, it did not name a missing
 * resource.
 *
 * The literal is the Prisma enum's own spelling (`prisma/schema/sessions.prisma`); a
 * constant here would be a third name for a value the database already defines. A
 * question whose session row has vanished lands here too, and deliberately: there is
 * nothing left to match, and inventing a default for a row that must exist would hide
 * a bug.
 */
async function requireMatchableSession({
  question,
  questionId,
  studentId,
  findQuestion,
  sweepExpiredOffers,
}) {
  if (question.session?.status === 'PENDING') return question;

  // The session says an offer is out. It may not be: `sessions.status` is moved by
  // 5.5's tick, and the tick is allowed to be late — Render sleeps the instance, and
  // even awake it runs every `CRON_TICK_SECONDS`. E5's rule for exactly this is
  // "correctness on the read, timeliness on the tick", and `GET /sessions/:id` has
  // obeyed it since 5.4 while this read still trusted the column.
  //
  // What that costs is the student's whole recovery: their awaiting screen resolves
  // the moment the countdown hits zero, they press **Choose another teacher**, and this
  // endpoint answers 409 for an offer that has been dead for three seconds. The screen
  // they land on says the question is already with a teacher, which is neither true nor
  // actionable.
  //
  // So the sweep is run on demand before refusing. It is 5.5's own tick, and running it
  // here is safe for the reason the job's header gives: the status change is a
  // conditional `updateMany`, so a tick that overlaps the scheduler's finds nothing to
  // do and emits nothing. The ordinary case sweeps one row, on a request that is about
  // to run a ranking query anyway.
  await sweepExpiredOffers();

  const swept = await loadOwnedQuestion({ questionId, studentId, findQuestion });

  if (swept.session?.status === 'PENDING') return swept;

  throw new AppError(
    ERROR_CODES.SESSION_NOT_ACTIVE,
    'This question has already been sent to a teacher, so its match list is closed.',
  );
}

/**
 * §9.2's `history_bonus` on every candidate — the scorer's input, and the same fact
 * `TeacherMatch.studiedWith` carries to the screen.
 *
 * A `Set` and one pass, from the single query `findPositiveHistoryTeacherIds` already
 * ran. A `some` clause per candidate would put a subquery on the hot path for a fact
 * that is one small array, which is the N+1 this codebase has now avoided four times.
 *
 * The flag is always a boolean, never absent: `MatchCandidate.hasPositiveHistory` is
 * typed `boolean` at the seam, and a scorer weighing `undefined` would produce `NaN`
 * for a teacher this student has simply never met.
 */
function markPositiveHistory(candidates, positiveHistoryIds) {
  const studiedWith = new Set(positiveHistoryIds);

  return candidates.map((candidate) => ({
    ...candidate,
    hasPositiveHistory: studiedWith.has(candidate.teacherId),
  }));
}

/**
 * The scorer's order, cut to `MATCH_COUNT`, joined back onto the rows this service
 * already holds.
 *
 * `rankCandidates` returns `{teacherId, score}` pairs and not rows, so that it cannot
 * quietly become the serializer. **`score` is destructured away in the `.map` below
 * and exists nowhere after this line** — §14.2's "no algorithm scores on screen" is
 * kept by the number never leaving this function, rather than by a serializer
 * remembering to omit it.
 *
 * `.slice` is the only ordering operation in this file, and it runs *after* the
 * scorer rather than instead of it. No pagination and no `limit` parameter:
 * `MATCH_COUNT` is the contract, and §12's "re-callable = show me more teachers" means
 * re-running the query as teachers go online and offers are rejected. Widening the
 * pool is the price control's job.
 *
 * A `teacherId` the scorer invented is not defended against here. It cannot happen
 * with a function that maps over these same rows, and swallowing it — with a
 * `filter(Boolean)` — would turn a bug in 4.6 into a teacher who silently disappears
 * from a list of five.
 */
function takeRanked(candidates, averages) {
  const byTeacherId = new Map(candidates.map((candidate) => [candidate.teacherId, candidate]));

  return rankCandidates(candidates, averages)
    .slice(0, MATCH_COUNT)
    .map(({ teacherId }) => byTeacherId.get(teacherId));
}
