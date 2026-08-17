import { AppError } from '#utils/AppError.js';

/**
 * The session surface — sending an offer, and reading the session both sides share.
 *
 * **Both handlers are stubs. `sendOffer` is filled in by 5.3, `getSession` by 5.4.**
 * Written here, in the blocking PR, so that neither of those opens the frozen router:
 * a controller created by the PR that fills it in is a controller the router had to
 * be edited to reach. 2.1, 3.1 and 4.1 all made this call, and none of the PRs that
 * followed them touched a frozen file.
 *
 * Each handler will call one service function and write the envelope, nothing else
 * (`CONVENTIONS.md` → Server layering). This file imports no database client, and the
 * services it will call take no `req`.
 *
 * Two services, not one, and both suffixed by concern:
 * `session.offer.service.js` (5.3) and `offer.respond.service.js` (5.4). Never one
 * `session.service.js` that four PRs open — the suffix rule is now about being able
 * to read `git log --oneline -- <file>` and see one PR.
 */

/**
 * `POST /sessions/:id/offer` — 200 `OfferResponse`. **The epic's whole risk.**
 *
 * 5.3's service is one transaction and the order inside it is the design:
 *
 *   1. `findSessionForOffer(id)`; missing, or another student's, is `NOT_FOUND` and
 *      never `FORBIDDEN` — `FORBIDDEN` would confirm the id exists (3.5's rule)
 *   2. session not `PENDING` → `SESSION_NOT_ACTIVE`, 409. A reload re-enables E4's
 *      per-card buttons, so a second **Send request** is a real request, and without
 *      this it is a way to double-book a student
 *   3. `findWalletBalance` ≥ `pricePerBlock × OPENING_BLOCKS` → else
 *      `INSUFFICIENT_CREDIT`, 402. A read, not a write: E4 applied the ceiling when
 *      the list was built, and the balance could have moved since
 *   4. `lockTeacherForOffer(teacherId, tx)` — the conditional `updateMany` from
 *      `ONLINE` to `OFFER_LOCKED`, and **the `count` is checked**. Zero means
 *      somebody else won: `TEACHER_UNAVAILABLE`, 409
 *   5. `createOffer` with `expiresAt = now + OFFER_TTL_SECONDS`, then
 *      `setSessionOfferSent`
 *
 * Step 4 is four lines and no test that runs requests in sequence exercises it.
 * Under READ COMMITTED the second transaction blocks on the row until the first
 * commits, then re-evaluates its `WHERE` and matches zero rows. **Two browsers, the
 * day 5.3 merges** — not at 5.9.
 *
 * The email (5.6) and the `offer:new` emit are side effects of the *committed*
 * transaction, never steps inside it. An offer that 500s because Resend is down is a
 * worse product than an offer with no email.
 */
export async function sendOffer() {
  throw AppError.notImplemented('POST /sessions/:id/offer');
}

/**
 * `GET /sessions/:id` — the session, shaped for whoever is asking.
 *
 * **`authenticate` without `authorize`, deliberately.** Both the student and the
 * teacher read this row, and which one you are decides what you may see, so the
 * check is `req.user.id === session.studentId || === session.teacherId` inside the
 * service and `NOT_FOUND` for anyone else. A role gate on the route could not
 * express that, and a stranger who gets `FORBIDDEN` has learned the id is real.
 *
 * 5.4 answers the teacher's side with `IncomingOffer` and the student's with the
 * session's own state. The two shapes are in the contract freeze; the branch between
 * them is the service's.
 */
export async function getSession() {
  throw AppError.notImplemented('GET /sessions/:id');
}
