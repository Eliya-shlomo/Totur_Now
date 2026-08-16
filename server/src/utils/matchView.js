import { toTeacherCard } from '#utils/teacherView.js';

/**
 * Candidate rows → `MatchesResponse`, the one shape `GET /questions/:id/matches`
 * answers with. PR 4.5, MVP.md §12 and §14.2.
 *
 * **A serializer and not the service, for the reason `teacherView.js` gives.** Every
 * field is written out by name; never a spread of the row and never a delete. The row
 * this file receives is a candidate, which is a teacher card *plus* the ranking
 * inputs — `offersReceived`, `offersAccepted`, `ratingSum`, `subtopicStats`,
 * `topicStats`, `teacherId` — and with explicit construction a column added to
 * `teacher_profiles` in a later epic is invisible here until a human adds it. With a
 * spread it ships to the student the moment the migration lands.
 *
 * **The card is E2's, imported and never forked.** `toTeacherCard` is why 4.1
 * exported `TEACHER_VIEW` and why `findCandidates` selects through it: a match card
 * and a browse card are structurally unable to disagree about what a teacher looks
 * like. A hand-built card here would be the second definition of a teacher, which is
 * the defect class E2's retro spent a section on.
 *
 * **No score reaches this file.** §14.2 — the student sees an order, not grades — and
 * the cheapest way to keep that promise is for the number never to leave
 * `matching.service.js`, which destructures it away at the join. Nothing below reads
 * one, and nothing below is given one.
 *
 * The contract lives in `shared/api.d.ts` under `// ── E4`.
 */

/**
 * One ranked teacher — `TeacherMatch`: E2's card, plus the three things §14.2 shows
 * that a card does not carry.
 *
 * `subtopicSessions` is rounded, and only for display. `teacher_topic_stats.sessions_count`
 * is `NUMERIC(8,2)` because a rating propagates to the parent topic at
 * `PARENT_TOPIC_WEIGHT`, so the honest value is 12.6 and a card saying "solved 12.6
 * questions" is not a card. The **rate below is computed from the raw pair**, not from
 * this rounded number: rounding is a fact about the label, not about the teacher.
 *
 * `studiedWith` is carried through from the boolean the scorer was given, never
 * recomputed here. §9.2 scores that same fact as `history_bonus` and
 * `HISTORY_MIN_STARS` is what both read, so the badge and the score cannot disagree
 * about what "studied with" means. `=== true` rather than a truthiness test, because
 * the contract says boolean and a candidate that never passed through the marking
 * step should read `false` rather than `undefined`.
 *
 * @param {object} candidate a `findCandidates` row, marked with `hasPositiveHistory`
 * @returns {import('@tutor/shared').TeacherMatch}
 */
export function toTeacherMatch(candidate) {
  return {
    teacher: toTeacherCard(candidate),
    subtopicSessions: Math.round(candidate.subtopicStats?.sessionsCount ?? 0),
    subtopicResolveRate: resolveRateOf(candidate.subtopicStats),
    studiedWith: candidate.hasPositiveHistory === true,
  };
}

/**
 * The whole payload — `MatchesResponse`, including both empty answers.
 *
 * **An empty list is a value here and never an error.** `reason` is
 * `INSUFFICIENT_CREDIT`, `NO_AVAILABLE_TEACHERS` or `null`, and all three are 200.
 * The argument is written out in full at the head of `matching.service.js`; it is
 * repeated nowhere else so that there is one place to read it.
 *
 * `priceCeiling` and `walletBalance` are passed through, never recomputed. The
 * service has already resolved both — the ceiling from the band and the balance, the
 * balance from the wallet — and a serializer that did that arithmetic a second time
 * would be a second place for the affordability rule to live. They are populated in
 * the `INSUFFICIENT_CREDIT` case too: "how short am I" is the only useful thing that
 * empty state can say.
 *
 * @param {object} payload
 * @param {object[]} payload.matches  ordered candidate rows, already sliced to `MATCH_COUNT`
 * @param {import('@tutor/shared').MatchEmptyReason|null} payload.reason
 * @param {number} payload.priceCeiling
 * @param {number} payload.walletBalance
 * @returns {import('@tutor/shared').MatchesResponse}
 */
export function toMatchesResponse({ matches, reason, priceCeiling, walletBalance }) {
  return {
    teachers: matches.map(toTeacherMatch),
    reason,
    priceCeiling,
    walletBalance,
  };
}

/**
 * A teacher's resolve rate in one topic, or `null` when they have no history there.
 *
 * **`null`, never `0`.** `teacherView.js` argues this at length for `rating` and the
 * argument is identical: "resolved nothing" and "has not been asked yet" are
 * different claims, and a new teacher has not failed to resolve anything. 4.7 renders
 * the two differently and cannot do so if the server has already flattened them.
 *
 * `> 0` rather than `!== 0` guards the division. The stats columns are NUMERIC and
 * non-negative by construction, so a negative denominator is data corruption and not
 * a rate — and `-3 / -7` is a perfectly finite number that would put a lie on a card.
 * `matching.averages.service.js` makes the same call on the platform ratios.
 *
 * @param {{resolvedCount: number, sessionsCount: number}|null} [stats]
 * @returns {number|null}
 */
function resolveRateOf(stats) {
  if (!stats || !(stats.sessionsCount > 0)) return null;

  return stats.resolvedCount / stats.sessionsCount;
}
