import { UNCLASSIFIED_TOPIC_ID } from '#config/constants/index.js';
import { standingOf } from '#utils/standing.js';

/**
 * The shapes a teacher row is allowed to leave the server in — `TeacherCard` and
 * `TeacherMeResponse` in `shared/api.d.ts`, and since 8.3 `TeacherReview`.
 *
 * One table, two audiences (docs/epics/E2-teacher-onboarding/README.md). A student
 * reads a stranger's card with no session at all; a teacher reads their own record
 * behind `authorize('teacher')`. Both serializations live here so that the
 * difference between them is one file a reviewer can read top to bottom, rather
 * than two controllers written a week apart by two people.
 *
 * Every field is written out by name. Never a spread of the Prisma row and never a
 * delete: with explicit construction, a column added to `teacher_profiles` in a
 * later epic is invisible until someone adds it below, and with the alternatives it
 * ships to strangers the moment the migration lands. `offersReceived`,
 * `offersAccepted`, `noShowCount` and `lastSeenAt` are on the row this function
 * receives and appear in neither output.
 */

/**
 * A teacher's topics, flattened out of the join rows Prisma returns.
 *
 * The repository selects `topics: { topic: {...} }` because `teacher_topics` is a
 * join table with its own model; the contract says `topics` is a flat array of
 * topic objects. Ordering is the query's — taxonomy id order — and is not redone
 * here.
 *
 * @param {Array<{topic: {id: number, slug: string, nameHe: string, nameEn: string}}>} [rows]
 */
function toTopics(rows = []) {
  return rows.map(({ topic }) => ({
    id: topic.id,
    slug: topic.slug,
    nameHe: topic.nameHe,
    nameEn: topic.nameEn,
  }));
}

/**
 * The teacher's average rating, or `null` if nobody has rated them.
 *
 * `null`, never `0`. They are different claims — one says "rated badly", the other
 * says "not rated yet" — and the UI renders them differently. `standingOf` already
 * refuses to hold an unrated teacher below a threshold they never had a chance to
 * meet; this is the same distinction, carried to the client.
 */
function ratingOf({ ratingSum = 0, ratingCount = 0 }) {
  return ratingCount > 0 ? ratingSum / ratingCount : null;
}

/**
 * Whether the teacher has finished onboarding (§ the epic's contract freeze).
 *
 * **Computed here and nowhere else.** Two definitions of "done" — one in the
 * stepper, one on the server — is a teacher who is finished on one screen and
 * unfinished on another. 2.2 returns this value and 2.4 only reads it.
 *
 * The test is "has at least one topic", and that is the whole test on purpose.
 * `pricePerBlock` and `levelMax` are `NOT NULL` with defaults written at
 * registration (`user.repository.js`), and `teacher_profiles` carries no
 * `updated_at`, so nothing in the schema distinguishes a teacher who chose 10
 * credits from one who was given 10 credits. Topics are the one step that leaves a
 * row behind, which makes them the only honest signal available without a schema
 * change — and the stepper writes them, so a teacher who walks all three steps
 * lands on `true` either way. Ruled on before 2.1 was written; revisit it in the
 * PR that adds a column worth reading, not in a serializer.
 */
function onboardingCompleteOf(teacher) {
  return toTopics(teacher.topics).length > 0;
}

/**
 * A teacher as a stranger sees them — `GET /teachers` and `GET /teachers/:id`.
 *
 * No `email`, no `status`, no counter except the rating pair. `status` is absent
 * rather than filtered: `OFFER_LOCKED` and `IN_SESSION` are matching-engine
 * internals (E4) and leak the platform's state to people with no session. What a
 * student needs is `isOnline`, a boolean.
 *
 * `badge` comes from `standingOf` and is computed on every read. There is no badge
 * column and there must not be one — it would be a second copy of `sessionsCount`
 * and the rating columns, free to drift from the first (§6.2).
 *
 * @param {object} teacher a `teacher_profiles` row with `user` and `topics` included
 * @returns {import('@tutor/shared').TeacherCard}
 */
export function toTeacherCard(teacher) {
  return {
    id: teacher.userId,
    fullName: teacher.user.fullName,
    bio: teacher.bio,
    pricePerBlock: teacher.pricePerBlock,
    levelMax: teacher.levelMax,
    badge: standingOf(teacher),
    rating: ratingOf(teacher),
    ratingCount: teacher.ratingCount,
    topics: toTopics(teacher.topics),
    isOnline: teacher.status === 'ONLINE',
  };
}

/**
 * The teacher's own record — `GET /teachers/me` and the body of a successful
 * `PATCH`.
 *
 * A superset of the card, exactly as the contract declares it: the same fields plus
 * the four a teacher may see about themselves. Built by spreading `toTeacherCard`
 * rather than by repeating it, so the two can never disagree about what a card is.
 *
 * `email` is deliberately not here even though this is the owner reading their own
 * row. The contract has `TeacherMeResponse extends TeacherCard`, the client already
 * holds the address from `GET /auth/me`, and a field nothing renders is a field the
 * repository does not need to select.
 *
 * @param {object} teacher a `teacher_profiles` row with `user` and `topics` included
 * @returns {import('@tutor/shared').TeacherMeResponse}
 */
export function toTeacherMe(teacher) {
  return {
    ...toTeacherCard(teacher),
    status: teacher.status,
    sessionsCount: teacher.sessionsCount,
    resolvedCount: teacher.resolvedCount,
    onboardingComplete: onboardingCompleteOf(teacher),
  };
}

/**
 * One review, as a stranger sees it on a teacher's profile — PR 8.3.
 *
 * **There is no student on this shape and there is not going to be one.** Not a name,
 * not an initial, not an id, and not a commented-out line that a refactor could
 * uncomment: this serializer does not know the field exists, and the repository does not
 * select it. The endpoint is unauthenticated, so the reviews of two teachers intersected
 * would identify a student's whole term — and §6.3's rule cuts the same way, because
 * "Dana K. said this" is a claim about Dana that the page has no reason to make.
 *
 * **`stars` stays `null` and is never coerced.** `isResolved` is the only required field
 * on a review (§6.2) and `RateSession.jsx` sends stars only when the student picked
 * some, so a review without them is the common case rather than the edge. A `?? 0` here
 * would be the client-side twin of the defect `session.review.service.js` spends a
 * paragraph on: it turns "no opinion" into the worst rating a student can give.
 *
 * The topic is the question's subtopic, then its parent, then `null` — same order
 * `offerView.js` and `sessionView.js` label a session in, because the subtopic is the
 * more specific true thing.
 *
 * **The sentinel is excluded by id and not by falsiness, and it has to be excluded at
 * all because it is a real row with a real name.** `topics` id `0` is seeded as
 * "General / Unclassified" (§8.1's fallback), so a plain name chain answers that label
 * for every question the classifier could not place — a chip on a public review reading
 * *general / unclassified*, which says less than no chip at all. Found by calling the
 * endpoint rather than by any test, which is why the fixture in
 * `teacher.reviews.test.js` now carries the id.
 *
 * @param {object} review a row from `findTeacherReviewPage`
 * @returns {import('@tutor/shared').TeacherReview}
 */
export function toTeacherReview(review) {
  const question = review.session?.question;

  return {
    id: review.id,
    stars: review.stars,
    isResolved: review.isResolved,
    comment: review.comment,
    topicName: labelOf(question?.subtopic) ?? labelOf(question?.topic) ?? null,
    createdAt: review.createdAt.toISOString(),
  };
}

/**
 * One topic's label, or `null` when there is nothing worth labelling.
 *
 * `UNCLASSIFIED_TOPIC_ID` is `0` and therefore falsy, so the comparison is explicit: a
 * reader of `if (topic.id)` cannot tell that a real topic id is never zero, and the same
 * guard has to hold for an absent topic, which is the ordinary case on the sentinel path.
 */
function labelOf(topic) {
  if (!topic || topic.id === UNCLASSIFIED_TOPIC_ID) return null;

  // English first, Hebrew as the fallback — the rule `client/.../TopicPicker.js`'s
  // `topicName()` states and every label-resolving serializer on the server follows.
  // A taxonomy row seeded without an English name renders as something, not nothing.
  return topic.nameEn || topic.nameHe;
}
