import { MIN_PRICE_PER_BLOCK, OPENING_BLOCKS, TEACHING_LEVELS } from '#config/constants/index.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { findCandidates } from '#repositories/matching.repository.js';
import { bandCeiling } from '#utils/pricing.js';

/**
 * Who is eligible, and what this student can afford. MVP.md §9.1 — DEV-A's half of
 * E4 (docs/epics/E4-matching/README.md → "The split").
 *
 * This file decides *what to ask for*; `findCandidates` in the frozen repository
 * decides how to ask. That division is the reason §9.1's six predicates are not all
 * in one place: three of them — the level fallback, the band ceiling and the wallet
 * rule — are arithmetic over a question and a balance, they have no `where` clause in
 * them, and folding them into the query would make the one branch this epic cares
 * about untestable without a database.
 *
 * **The pool does not rank.** §9.5 is explicit that availability and price are filters
 * and quality is scoring, so nothing here reads a rating, sorts, or slices to
 * `MATCH_COUNT`. `matching.scoring.js` is DEV-B's and 4.5 calls it; this function
 * hands it an unordered set.
 *
 * No request or response object reaches this layer, and it opens no transaction
 * (CONVENTIONS.md → Server layering).
 */

/** The floor of §6.1's self-declared range — the level nobody is filtered out by. */
const LOWEST_TEACHING_LEVEL = Math.min(...TEACHING_LEVELS);

/**
 * The real collaborator, replaced wholesale in tests.
 *
 * The idiom `classification.service.js` established in 3.3 and
 * `question.intake.service.js` carried into 3.4, and here it buys the one property
 * this PR's acceptance criteria name outright: that the `INSUFFICIENT_CREDIT` branch
 * runs **no candidate query at all**. That is a fact about a call that did not happen,
 * and a suite running against real Postgres can see an empty list but never the
 * absence of the statement that would have produced it.
 *
 * It is also what keeps `matching.pool.test.js` runnable with no database, on the
 * root `npm test` script this PR is not allowed to touch.
 */
const defaultDeps = { findCandidates };

/**
 * §9.1's candidate pool for one question, and the reason it is empty when it is.
 *
 * Three resolutions, then at most one query:
 *
 * ```
 * requiredLevel = estimatedLevel ?? declaredLevel ?? min(TEACHING_LEVELS)
 * affordable    = floor(walletBalance / OPENING_BLOCKS)
 * priceCeiling  = min(bandCeiling(priceBand), affordable)
 * ```
 *
 * **The wallet rule is a ceiling, and it is expressed once.** §9.1 writes it as
 * `wallet_balance >= price_per_block * 2`, which is true per row and unhelpful: it
 * cannot use `idx_teacher_available`, it re-reads a constant balance once per
 * teacher, and it makes "you cannot afford anybody" indistinguishable from "nobody is
 * online". Rearranged into a ceiling it is one integer, computed before the query, and
 * that distinction falls out for free — which is why `MatchesResponse` carries
 * `priceCeiling` at all: the screen can say *why* a teacher the student saw yesterday
 * is missing today. The `2` is `OPENING_BLOCKS` (§5.1 — the opening block is two
 * blocks, charged immediately), not a literal, and the band table is only ever read
 * through `bandCeiling` so the browse filter and the match filter cannot disagree
 * about what `'B'` means.
 *
 * **Both empty pools are a value, never a thrown error.** §9.4's own pseudocode
 * returns `{ teachers: [], reason }` rather than raising, an empty list is a state
 * every list in this codebase already renders, and a 402 or a 409 would make the
 * screen show an error for the product working as designed. `NO_AVAILABLE_TEACHERS`
 * and `INSUFFICIENT_CREDIT` both live in `shared/errorCodes.js` and **this epic throws
 * neither**, exactly as E3 never threw `LLM_FAILED`. They are read from there rather
 * than typed as strings so that the reason a client switches on and the code the
 * catalogue lists can never drift apart. Nobody should "fix" this into an exception.
 *
 * **A student who cannot afford the cheapest teacher on the platform never reaches
 * Postgres.** `affordable < MIN_PRICE_PER_BLOCK` means no price in §5.2's range clears
 * their balance, so the query has a knowable empty answer and running it would be
 * work with one possible result. The seeded `ido.student` at 0 credits is that case,
 * and it is the demo working rather than a hole in it — §5.4's top-up flow is the
 * other half of it, and it is E7, so in E4 that path ends at a sentence.
 * `priceCeiling` is still returned, because "how short am I" is the only useful thing
 * that empty state can say.
 *
 * @param {object} input
 * @param {object} input.question  a row shaped by the repository's
 *   `MATCHING_QUESTION_VIEW` — `topicId`, `subtopicId`, `estimatedLevel`,
 *   `declaredLevel` and `rejectedBy` are read, nothing else
 * @param {number|null} [input.walletBalance]  credits; `null` when the student has no
 *   wallet row, which `findWalletBalance` reports rather than flattening to `0`. Zero
 *   is the product's reading of both — you can afford nothing either way — and it is
 *   made here because this is where the affordability rule lives
 * @param {string} [input.priceBand]  `'A' | 'B' | 'C'`, validated by
 *   `matching.schema.js`. Absent means no band ceiling, only the wallet's
 * @param {typeof defaultDeps} [deps]
 * @returns {Promise<{candidates: object[], priceCeiling: number,
 *                    reason: import('@tutor/shared').MatchEmptyReason|null}>}
 */
export async function resolveCandidatePool(
  { question, walletBalance, priceBand },
  deps = defaultDeps,
) {
  const { findCandidates: findPool } = { ...defaultDeps, ...deps };

  const affordable = Math.floor((walletBalance ?? 0) / OPENING_BLOCKS);
  const priceCeiling = Math.min(bandCeiling(priceBand), affordable);

  if (affordable < MIN_PRICE_PER_BLOCK) {
    return { candidates: [], priceCeiling, reason: ERROR_CODES.INSUFFICIENT_CREDIT };
  }

  const candidates = await findPool({
    requiredLevel: question.estimatedLevel ?? question.declaredLevel ?? LOWEST_TEACHING_LEVEL,
    topicId: question.topicId,
    subtopicId: question.subtopicId,
    maxPrice: priceCeiling,
    excludeTeacherIds: toExclusionList(question.rejectedBy),
  });

  return {
    candidates,
    priceCeiling,
    reason: candidates.length === 0 ? ERROR_CODES.NO_AVAILABLE_TEACHERS : null,
  };
}

/**
 * `rejected_by` as the repository wants it: the ids, or **`undefined` and never
 * `[]`**.
 *
 * The column is `UUID[] DEFAULT '{}'`, so every question in the database has an empty
 * array on it and will until E5 writes the first rejected offer. An exclusion list
 * with nothing in it should be absent from the query rather than present and empty —
 * `undefined` is the value Prisma drops the key for, which is the same convention
 * `findTeacherPage` reads its own optional filters by, and it keeps a `NOT IN` out of
 * the plan on the one path that runs for every student today.
 */
function toExclusionList(rejectedBy) {
  return rejectedBy?.length ? rejectedBy : undefined;
}
