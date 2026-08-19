import { getSessionView } from '#services/session.view.service.js';
import { reportSessionNoShow, terminateSession } from '#services/session.end.service.js';
import { extendSessionBlock } from '#services/session.meter.service.js';
import { submitSessionReview } from '#services/session.review.service.js';
import { getSessionVideoContext } from '#services/session.video.service.js';
import { createSessionVideoAccess } from '#services/video.service.js';
import { sendOffer as sendSessionOffer } from '#services/session.offer.service.js';

/**
 * The session surface — sending an offer, and reading the session both sides share.
 *
 * **Both handlers are filled in: `sendOffer` by 5.3, `getSession` by 5.4.**
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
 * `POST /sessions/:id/offer` — 201 `OfferResponse`. **The epic's whole risk.**
 *
 * **201 and not 200**, which is what 5.3's acceptance criteria assert and what the verb
 * means: the request creates an `offers` row that the response then identifies by id.
 * 5.1 wrote 200 in this header before the row existed; the criterion is the harder
 * contract and 5.8 reads the body either way.
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
 *
 * **Filled in by 5.3, and it opened no frozen file to do it.** One service call and the
 * envelope, exactly as this file's header promised: both announcements live in
 * `session.offer.service.js` below the commit, so there is nothing after `res` here to
 * leave as an unhandled rejection on a request that already succeeded.
 *
 * Every argument comes from somewhere the client cannot forge. `req.user.id` is the
 * token's — `sendOfferSchema` is `.strict()` and could not carry one anyway — and
 * `req.body.teacherId` is the only field the body is allowed to have. **The price is
 * not among them**, deliberately: the service reads it off the teacher's own row.
 */
export async function sendOffer(req, res) {
  const offer = await sendSessionOffer({
    sessionId: req.params.id,
    studentId: req.user.id,
    teacherId: req.body.teacherId,
  });

  res.status(201).json({ success: true, data: offer });
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
 *
 * **Filled in by 5.4, and it opened no frozen file to do it.** One service call and
 * the envelope, and the caller's id comes from the token rather than from anything
 * the request could carry — `sessionByIdSchema` is `.strict()` with an empty body, so
 * the id in the path is the only thing this handler reads off the wire.
 */
export async function getSession(req, res) {
  const session = await getSessionView({
    sessionId: req.params.id,
    userId: req.user.id,
  });

  res.json({ success: true, data: session });
}

// ── E6 ───────────────────────────────────────────────────────────────────────
//
// Five handlers, **all of them shipped in 6.2 throwing `NOT_IMPLEMENTED` and all five
// filled in by the time 6.6 landed** — the video endpoint by 6.4, extend by 6.5, and the
// three below it by 6.6. They exist in 6.2 so that none of those PRs had to open
// `session.routes.js`, which E5 froze at 5.1 and E6 unfroze exactly once. A controller
// created by the PR that fills it in is a controller the router had to be edited to
// reach. 2.1, 3.1, 4.1 and 5.1 all made this call, and none of the PRs that followed
// them touched a frozen file — nor did 6.4, 6.5 or 6.6.
//
// **The arrangement worked and the ledger is worth keeping.** Every one of the five is
// one service call and an envelope. Not one of them reads a second row, branches on a
// role, or computes anything: the shapes were decided in 6.2 and the three PRs that
// arrived later were consumers of that decision rather than three separate inventions
// of what a session looks like on the wire.
//
// The doc comment on each still names the PR that filled it in and the decisions that
// were already made about it, which is what those PRs read instead of inventing one.

/**
 * §11.2's reason for a session somebody chose to end, **whichever side pressed it.**
 *
 * The enumeration has no `teacher_ended` value and inventing one is a migration: the
 * column says why the session is over, not who was holding the mouse. The actor is on the
 * emit and in the log, which is where 6.6 put it.
 */
const STUDENT_ENDED = 'student_ended';

/**
 * `GET /sessions/:id/video` — the room and a freshly minted token. **6.4.**
 *
 * `authenticate` and no `authorize`, like `GET /sessions/:id` above and for the same
 * reason: both participants join the same call, so the rule is about a row and not a
 * role. A role gate here would either lock out half the participants or say nothing.
 *
 * 6.4 is three calls and no logic — `getSessionVideoContext(sessionId, req.user.id)`,
 * then DEV-C's `createSessionVideoAccess`, then the envelope. Two things it must get
 * right, both already decided:
 *
 * **Every failure is `404`.** Not yours, not `ACTIVE`, does not exist — one status, one
 * code, one message. `403` on a session id confirms the session is real, and a `404`
 * from `GET /sessions/:id` beside a `403` from here is an oracle built out of two
 * individually correct decisions. The three causes are distinguishable in the log, at
 * `warn`, and nowhere else.
 *
 * **`userName` comes from the database.** It is what goes on the tile, and the endpoint
 * 6.1 deleted took it from the request body — so a stranger could walk in *and* choose
 * the name they walked in under.
 *
 * **Filled in by 6.4, and it opened no frozen file to do it.** Nothing here reads
 * `req.body` or `req.query` — `sessionByIdSchema` is `.strict()` with an empty body, so
 * the id in the path and the id in the token are the only two things this handler takes
 * off the wire, and neither the room name nor the display name is among them.
 */
export async function getSessionVideo(req, res) {
  const context = await getSessionVideoContext(req.params.id, req.user.id);

  const access = await createSessionVideoAccess({
    roomName: context.roomName,
    userId: req.user.id,
    userName: context.userName,
  });

  res.json({
    success: true,
    data: {
      roomUrl: context.roomUrl,
      token: access.token,
      // **The one transformation in this handler.** `SessionVideoResponse` types
      // `expiresAt` as ISO 8601 and DEV-C's seam answers in epoch seconds, which is what
      // Daily's `exp` property is. The conversion is here rather than in
      // `video.service.js` because that file is frozen at 6.1 and provider-shaped by
      // design, and rather than in the service because `getSessionVideoContext` never
      // sees a token — `OWNERSHIP.md` §2.1 gives it three fields and none of them is
      // this one.
      expiresAt: new Date(access.expiresAt * 1000).toISOString(),
    },
  });
}

/**
 * `POST /sessions/:id/extend` — one more block. **6.5.**
 *
 * `authorize('student')`, because only a student can spend.
 *
 * **No body, and the validator enforces it.** One block — `EXTENSION_BLOCKS` — is the
 * only thing an extension can buy. A quantity in the body is a way to overrun the
 * budget cap in one request.
 *
 * 6.5's service is one transaction: lock the session, assert `ACTIVE`, check the cap
 * *before* the charge, charge, then `extendSession` matching on `ends_at` as it was
 * read. `assertTransition` is not called — this is `ACTIVE` → `ACTIVE`, which is not an
 * edge — and the `ends_at` match is what makes a double-tapped button buy one block
 * instead of two.
 *
 * **Filled in by 6.5, and it opened no frozen file to do it.** One service call and the
 * envelope. The caller is `req.user.id` rather than anything the request carries, and
 * there is no third argument: the quantity is `EXTENSION_BLOCKS` and a body that could
 * name one would be a way to overrun the budget cap in a single request.
 */
export async function extendSession(req, res) {
  const extended = await extendSessionBlock({
    sessionId: req.params.id,
    studentId: req.user.id,
  });

  res.json({ success: true, data: extended });
}

/**
 * `POST /sessions/:id/end` — either side stops the session. **6.6.**
 *
 * **`authenticate` and no `authorize`, deliberately, and it is the third route in this
 * file to make that call.** Either participant may end a session. §11.2's `end_reason`
 * enumeration has no `teacher_ended` value and inventing one is a migration, so both
 * sides write `student_ended`: the column says *why* the session is over, not who was
 * holding the mouse. The actor is not lost — the emit carries it and the log records
 * it.
 *
 * 6.6's service is the one path that writes `ENDED`, and 6.5's auto-end cron is rewired
 * to call it rather than the repository directly. Fee at `started_at` and not at
 * `ended_at`: §5.3's low-demand window is `[6, 14)`, and a session that begins at 13:55
 * must not become chargeable halfway through.
 */
export async function endSession(req, res) {
  const ended = await terminateSession({
    sessionId: req.params.id,
    endReason: STUDENT_ENDED,
    actorId: req.user.id,
  });

  res.json({ success: true, data: ended });
}

/**
 * `POST /sessions/:id/report-no-show` — the teacher never arrived. **6.6.**
 *
 * `authorize('student')`. The teacher cannot report their own absence, and nobody else
 * is in the session.
 *
 * Two guards beyond the state machine, both 6.6's: within `NO_SHOW_WINDOW_SEC` of
 * `started_at`, and `blocks_used` still at the opening block — a session that was
 * extended was not a no-show. The outcome is a full refund with no fee and no earning,
 * and `sessions_count` does not move, because nobody taught anything.
 *
 * **`NO_SHOW` is terminal and is not rated.** 6.7's screen sends the student back to
 * the match list rather than to a rating modal.
 */
export async function reportNoShow(req, res) {
  const reported = await reportSessionNoShow({
    sessionId: req.params.id,
    studentId: req.user.id,
  });

  res.json({ success: true, data: reported });
}

/**
 * `POST /sessions/:id/review` — the rating, and the session's terminal state. **6.6.**
 *
 * `authorize('student')`. §10 makes the rating mandatory and `ENDED` → `RATED` is the
 * only way out of an ended session, so without this write no session ever reaches a
 * terminal state.
 *
 * **The write only. Every read of these columns stays E8's.** 6.6 inserts the review,
 * moves `resolved_count`, `rating_sum` and `rating_count` on the teacher, and sets the
 * session `RATED`. `reviews.session_id` is `UNIQUE`, which is the database saying one
 * review per session.
 *
 * **A review with no stars must not move `rating_count`.** That is how an average
 * becomes wrong, and it is one `??` away from being wrong.
 */
export async function submitReview(req, res) {
  const rated = await submitSessionReview({
    sessionId: req.params.id,
    studentId: req.user.id,
    isResolved: req.body.isResolved,
    stars: req.body.stars,
    comment: req.body.comment,
  });

  res.json({ success: true, data: rated });
}
