/**
 * The ranking seam. MVP.md §9.2 and §9.3.
 *
 * **Pure, and it stays pure.** No Prisma client, no request, no response, no clock,
 * no random, no import from a repository. It does not know `teacher_profiles`
 * exists, it reads no request and it returns no payload — it returns an order.
 *
 * 4.1 and 4.3 both check that by grepping this file for the client's import name in
 * lowercase and expecting no hits, so the sentence above spells it with a capital on
 * purpose — a header describing the rule must not be what breaks it.
 *
 * Being a pure function of its arguments is what
 * makes it the one function two developers can meet at: DEV-A builds the query that
 * produces `candidates` and the endpoint that consumes the order, DEV-B decides what
 * the order is, and neither waits on the other.
 *
 * **Created in 4.1 by DEV-A. Ownership transferred to DEV-B (rotem) at 4.3**, the same
 * handover `classification.service.js` records for its 3.1 → 3.3 move. That move has
 * happened: from here this file is DEV-B's and DEV-A does not open it again.
 *
 * `bayesian` shipped finished in 4.1 and `rankCandidates` shipped stubbed, and they
 * are different kinds of unwritten. §9.3 gives the smoothing formula in one line and
 * there was nothing left to decide, so a stub would only have been a second thing to
 * remember. §9.2 has six weighted components, three of which need smoothing against
 * a platform average that did not exist until 4.3 — that is real work, it is DEV-B's,
 * and it belongs in the file that will hold it and in no other.
 *
 * **4.3 changed this header and nothing else in the file.** It finished the other half
 * of §9.3 — `getPlatformAverages()` in `matching.averages.service.js`, the prior every
 * smoothed component in 4.6 is measured against — and pinned the arithmetic here with
 * `server/tests/matching.bayes.test.js`. It left `rankCandidates` scoring everyone at
 * zero, which is how you knew 4.3 changed no ranking. **4.6 is where the order starts
 * being real**, and `server/tests/matching.scoring.test.js` is where it is pinned.
 *
 * The averages service is deliberately *not* imported here, and this file is why. It
 * reads a database and it holds a five-minute cache; importing it would put both
 * behind a function whose whole contract is that it has neither. `rankCandidates`
 * takes its `averages` as an argument, 4.5's endpoint fetches them, and the purity
 * rule survives 4.6 unchanged.
 *
 * **4.5 is built and merged against the stub, and its diff does not change when 4.6
 * fills this in** — exactly as 3.4 was built against the fallback classifier. The
 * corollary is worth saying so that nobody "fixes" it: between 4.5 and 4.6 the
 * endpoint returns the right teachers in an arbitrary but stable order, and that is
 * correct behaviour for that week. **Do not stub the scorer a second time inside
 * 4.5.**
 *
 * **Nothing in the running product moves the numbers this function reads.**
 * `teacher_topic_stats` has one writer — the seed — until E8's review service exists,
 * `reviews` is empty so `hasPositiveHistory` is false for every real pair, and the two
 * offer counters are E5's. Everything here is correct and verifiable today, and none
 * of it will *change* until those epics land: a session finished this afternoon moves
 * no ranking. Worth knowing before someone re-runs a match after a demo session and
 * files the unchanged order as a bug.
 */

import {
  BAYES_C,
  MATCH_WEIGHTS,
  MAX_STARS,
  NEW_TEACHER_SESSIONS,
} from '#config/constants/index.js';

/**
 * @typedef {{ ratingSum: number, ratingCount: number,
 *             resolvedCount: number, sessionsCount: number }} TopicStats
 *
 * @typedef {object} MatchCandidate
 * @property {string}  teacherId
 * @property {number}  sessionsCount    teacher_profiles, all topics
 * @property {number}  resolvedCount    teacher_profiles, all topics
 * @property {number}  ratingSum        teacher_profiles, all topics
 * @property {number}  ratingCount      teacher_profiles, all topics
 * @property {number}  offersReceived
 * @property {number}  offersAccepted
 * @property {TopicStats|null} subtopicStats  the question's leaf, or null
 * @property {TopicStats|null} topicStats     the question's parent, or null
 * @property {boolean} hasPositiveHistory     this student rated them >= 4
 *
 * @typedef {{ rating: number, resolveRate: number, acceptRate: number }} PlatformAverages
 */

/**
 * Bayesian smoothing — MVP.md §9.3, and the reason the ranking is not noise.
 *
 * Without it one 5.0 rating outranks 4.6 across forty sessions, which is the single
 * acceptance criterion §18 names for this epic. With it, a teacher's own average is
 * pulled toward the platform prior by an amount that shrinks as their history grows:
 * `c` is how many ratings of the prior a teacher is credited with before their own
 * start to count.
 *
 * `count: 0` returns `prior` exactly, which is the property worth stating rather than
 * deriving — a teacher with no history is neither promoted nor punished.
 *
 * @param {{sum: number, count: number}} stats  the raw pair, not a ratio
 * @param {number} prior  the platform average this teacher is smoothed toward
 * @param {number} c      smoothing strength; `BAYES_C` from `constants/matching.js`
 * @returns {number}
 */
export function bayesian({ sum, count }, prior, c) {
  return (sum + prior * c) / (count + c);
}

/**
 * The rating pair `topic_fit` is smoothed from, and §9.2's fallback: the question's
 * leaf topic, then its parent, then nothing at all.
 *
 * **The parent row is read and never re-weighted.** `PARENT_TOPIC_WEIGHT` describes
 * how a session *writes* into the parent's stats — the seed's `deriveTopicStats` does
 * exactly that, and E8's review service will do the same — so by the time this
 * function reads the row, the discount is already in the numbers. Applying it a second
 * time would be invisible: everything still ranks in a plausible order, just wrong.
 * This file deliberately does not import that constant, so it cannot.
 *
 * That the specialist still outranks the generalist is a consequence rather than a
 * knob. The parent row carries a fraction of its children's rating count, so `bayesian`
 * pulls it further toward the platform prior than a leaf row of the same quality.
 *
 * Both null answers `{sum: 0, count: 0}`, which `bayesian` turns into the prior
 * exactly — "we know nothing about them here", neither promoted nor punished. The
 * fallback is structural: it picks a *row*, so a leaf that exists but carries no
 * ratings stops the chain and smooths to the prior rather than reaching past itself
 * for its parent's history.
 *
 * @param {MatchCandidate} candidate
 * @returns {{sum: number, count: number}} the pair `bayesian` takes, never a ratio
 */
function topicRatingPair({ subtopicStats, topicStats }) {
  const stats = subtopicStats ?? topicStats;

  return stats ? { sum: stats.ratingSum, count: stats.ratingCount } : { sum: 0, count: 0 };
}

/**
 * §9.2's six components for one candidate, each in `[0, 1]` before any weight touches
 * it.
 *
 * **Keyed by `MATCH_WEIGHTS`'s own keys**, because `rankCandidates` reduces over that
 * object rather than adding six terms. A seventh component is then a change in
 * `constants/matching.js` and one line here, and a mistyped weight cannot produce a
 * total that nobody notices for three epics.
 *
 * The two things most likely to be got wrong, stated rather than left in the
 * arithmetic:
 *
 * - `topicFit` is a rating and is divided by `MAX_STARS`. The two rates are already
 *   fractions and are divided by nothing. Five components in the unit interval and one
 *   on the star scale presents as "the algorithm really likes topical teachers", which
 *   is also what it is supposed to do — which is why it gets its own test.
 * - smoothing takes a numerator and a denominator, never a pre-divided ratio:
 *   `{sum: resolvedCount, count: sessionsCount}`. §9.3 says the two rates are "smoothed
 *   identically", and that is what identically means.
 *
 * `globalRating` is the one component §9.2 leaves unsmoothed — it is already an average
 * over the teacher's whole history, so §9.3's small-sample problem is much weaker there
 * than inside a single subtopic. Unrated scores zero rather than the prior, which is
 * §9.2's own wording, and such a teacher recovers far more on `topicFit`.
 *
 * Every field is defaulted, so a row arriving without a column scores instead of
 * answering `NaN` — a `NaN` score sorts unpredictably and silently, which is the worst
 * failure this function has.
 *
 * @param {MatchCandidate} candidate
 * @param {PlatformAverages} averages
 * @returns {Record<keyof MATCH_WEIGHTS, number>}
 */
function componentsOf(candidate, averages) {
  const {
    ratingSum = 0,
    ratingCount = 0,
    resolvedCount = 0,
    sessionsCount = 0,
    offersAccepted = 0,
    offersReceived = 0,
    hasPositiveHistory = false,
  } = candidate;

  return {
    topicFit: bayesian(topicRatingPair(candidate), averages.rating, BAYES_C) / MAX_STARS,
    globalRating: ratingCount > 0 ? ratingSum / ratingCount / MAX_STARS : 0,
    resolveRate: bayesian(
      { sum: resolvedCount, count: sessionsCount },
      averages.resolveRate,
      BAYES_C,
    ),
    acceptanceRate: bayesian(
      { sum: offersAccepted, count: offersReceived },
      averages.acceptRate,
      BAYES_C,
    ),
    history: hasPositiveHistory ? 1 : 0,
    newTeacherBoost: sessionsCount < NEW_TEACHER_SESSIONS ? 1 : 0,
  };
}

/**
 * One candidate's §9.2 score: the weighted sum, written as a reduction over
 * `MATCH_WEIGHTS` rather than as six additions.
 *
 * No weight appears in this file as a literal, so retyping one here is not a mistake
 * that can be made. The weights sum to 1 — `constants/matching.js` asserts it at boot —
 * and every component is in `[0, 1]`, so the result is too.
 *
 * @param {MatchCandidate} candidate
 * @param {PlatformAverages} averages
 * @returns {number} in `[0, 1]`
 */
function scoreOf(candidate, averages) {
  const components = componentsOf(candidate, averages);

  return Object.entries(MATCH_WEIGHTS).reduce(
    (total, [component, weight]) => total + weight * components[component],
    0,
  );
}

/**
 * The order the selection screen renders — best first. MVP.md §9.2.
 *
 * **It returns `{teacherId, score}` pairs and not the candidate rows**, so that it
 * cannot quietly become the serializer. The caller already holds the rows; it joins
 * this order back onto them and hands them to `toTeacherCard`. A scoring function
 * that returned cards would be a scoring function two people edit. The score itself
 * reaches no client — §14.2 says the student sees an order, not grades.
 *
 * **Total, and deterministic.** It answers for an empty array, for a candidate with
 * every stat at zero, and for a platform with no history at all. Ties break on
 * `teacherId` ascending — which matters more than it sounds, because on a fresh
 * database every candidate scores identically, and a nondeterministic sort would make
 * the price control and "show me more teachers" both look broken.
 *
 * @param {MatchCandidate[]} candidates
 * @param {PlatformAverages} averages  the smoothing prior, fetched by the caller
 * @returns {Array<{teacherId: string, score: number}>} sorted, best first
 */
export function rankCandidates(candidates, averages) {
  return candidates
    .map((candidate) => ({
      teacherId: candidate.teacherId,
      score: scoreOf(candidate, averages),
    }))
    .sort((a, b) => b.score - a.score || a.teacherId.localeCompare(b.teacherId));
}
