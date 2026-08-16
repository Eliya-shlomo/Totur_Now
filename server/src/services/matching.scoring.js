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
 * **Created in 4.1 by DEV-A. Ownership transfers to DEV-B at 4.3**, the same handover
 * `classification.service.js` records for its 3.1 → 3.3 move. After this PR DEV-A
 * does not open this file.
 *
 * `bayesian` ships finished and `rankCandidates` ships stubbed, and they are
 * different kinds of unwritten. §9.3 gives the smoothing formula in one line and
 * there is nothing left to decide, so a stub would only be a second thing to
 * remember. §9.2 has six weighted components, three of which need smoothing against
 * a platform average that does not exist until 4.3 — that is real work, it is
 * DEV-B's, and it belongs in the file that will hold it and in no other.
 *
 * **4.5 is built and merged against the stub, and its diff does not change when 4.6
 * fills this in** — exactly as 3.4 was built against the fallback classifier. The
 * corollary is worth saying so that nobody "fixes" it: between 4.5 and 4.6 the
 * endpoint returns the right teachers in an arbitrary but stable order, and that is
 * correct behaviour for that week. **Do not stub the scorer a second time inside
 * 4.5.**
 */

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
 * The order the selection screen renders — best first.
 *
 * **This is the stub.** Every candidate scores `0` and the list comes back sorted by
 * `teacherId` ascending: the real signature, the real return type, a deterministic
 * order, and no scoring. 4.6 replaces this body with §9.2's six weighted components
 * and changes nothing else about the file.
 *
 * **It returns `{teacherId, score}` pairs and not the candidate rows**, so that it
 * cannot quietly become the serializer. The caller already holds the rows; it joins
 * this order back onto them and hands them to `toTeacherCard`. A scoring function
 * that returned cards would be a scoring function two people edit.
 *
 * **Total, and deterministic.** It answers for an empty array, for a candidate with
 * every stat at zero, and for a platform with no history at all. Ties break on
 * `teacherId` ascending — which matters more than it sounds, because on a fresh
 * database every candidate scores identically, and a nondeterministic sort would make
 * the price control and "show me more teachers" both look broken.
 *
 * @param {MatchCandidate[]} candidates
 * @param {PlatformAverages} averages  unused by the stub; 4.6's smoothing prior
 * @returns {Array<{teacherId: string, score: number}>} sorted, best first
 */
// eslint-disable-next-line no-unused-vars -- the signature is frozen; 4.6 reads `averages`
export function rankCandidates(candidates, averages) {
  return candidates
    .map((candidate) => ({ teacherId: candidate.teacherId, score: 0 }))
    .sort((a, b) => a.teacherId.localeCompare(b.teacherId));
}
