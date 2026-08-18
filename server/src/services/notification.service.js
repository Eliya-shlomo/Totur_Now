import { OFFER_TTL_SECONDS } from '#config/constants/index.js';
import { env } from '#config/env.js';
import { isEmailConfigured, resendClient } from '#config/resend.js';
import { offerEmail } from '#services/email.templates.js';
import { logger } from '#utils/logger.js';

/**
 * Everything that leaves this server by email. PR 5.6, MVP.md §18's 5.6.
 *
 * One function today, and the file exists so that the second one — E6's "your session
 * starts now", E8's review nudge — arrives beside it rather than inside whichever
 * service happened to need it. `config/resend.js` is imported here and nowhere else.
 *
 * **Nothing in this file can fail its caller.** Every function is a side effect of a
 * transaction that has already committed, and the contract is the one
 * `sockets/events.js` states for its emitters and `classification.service.js` states
 * for the classifier: a failure logs and returns. The student's `201` is already
 * decided by the time anything here runs.
 *
 * That is a contract, not an accident, so it is defended twice — the guard and the
 * `try` below, and an un-awaited call site. Either alone would be enough on the day it
 * was written; both are what keeps it true after somebody adds a second send.
 */

/**
 * Where the teacher is sent. The dashboard, not an accept link.
 *
 * **`corsOrigins[0]`, because there is no `CLIENT_URL` and `env.js` is not this PR's
 * to open.** The CORS list is the set of origins this API answers, its first entry is
 * the client this server is deployed beside, and it is already parsed into an array by
 * `config/env.js` — `http://localhost:5173` locally and the Vercel origin on Render.
 * It is a proxy for the value we want rather than the value itself: the day a second
 * origin goes in front of that list, this link points at the wrong one, and the fix is
 * a `CLIENT_URL` variable in the PR that adds the second origin.
 *
 * The trailing slash is trimmed because `CORS_ORIGINS` is hand-written in `.env` and
 * `https://host//teach` is a 404 on some static hosts.
 */
function teachUrl() {
  return `${(env.corsOrigins[0] ?? '').replace(/\/$/, '')}/teach`;
}

/**
 * Tells a teacher, by email, that an offer is waiting — `POST /sessions/:id/offer`.
 *
 * **A nudge to open the tab, and deliberately nothing more.** Sixty seconds is the
 * whole window, which is not enough for a mail client, a click and a login round trip,
 * so the email carries no accept link. An unauthenticated URL that accepted on click
 * would also be a state change performable by anyone holding a forwarded copy — the
 * brief calls it an authorisation hole and it is exactly that.
 *
 * **It renders `IncomingOffer` and computes nothing.** The socket payload and the
 * email are the same object, so the earning the teacher reads in their inbox is the
 * earning their modal shows by construction rather than by two call sites agreeing.
 * In particular `expectedEarning` is already net of §5.3's commission — the fee rate
 * is `utils/commission.js`'s answer, resolved once in `session.offer.service.js`, and
 * the literal `0.15` appears nowhere on this path.
 *
 * Three failure modes, three different silences:
 *
 * **Unconfigured** — `RESEND_API_KEY` or `EMAIL_FROM` is blank, which is Render today.
 * Return immediately. The one line saying so was logged at startup by
 * `config/resend.js`; a line here would print on every offer.
 *
 * **No address** — the notification read came back `null`, or the row has no user. The
 * offer is committed and the socket event has already gone out; there is nothing to
 * do and nothing to alarm anybody with.
 *
 * **The provider said no** — a wrong key, a rejected sender domain, an outage.
 * `warn`, naming the failure and the recipient's session, and never the key or the
 * rendered body. The Resend SDK reports API failures in `{ error }` rather than by
 * throwing, so both shapes are handled: the returned error and the thrown one.
 *
 * @param {object} params
 * @param {string|null|undefined} params.to        the teacher's address
 * @param {string|null|undefined} params.teacherName
 * @param {import('@tutor/shared').IncomingOffer} params.offer the `offer:new` payload
 * @returns {Promise<void>} always resolves
 */
export async function sendOfferEmail({ to, teacherName, offer }) {
  if (!isEmailConfigured || !to) {
    return;
  }

  try {
    const { subject, html, text } = offerEmail({
      teacherName: teacherName ?? 'there',
      topicLabel: offer.topicLabel,
      level: offer.level,
      brief: offer.brief,
      expectedEarning: offer.expectedEarning,
      ttlSeconds: OFFER_TTL_SECONDS,
      teachUrl: teachUrl(),
    });

    const { error } = await resendClient.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
    });

    if (error) {
      logOfferEmailFailure(offer, error);
    }
  } catch (error) {
    logOfferEmailFailure(offer, error);
  }
}

/**
 * The one warn line, in one place, so both failure shapes read identically in the log.
 *
 * **`sessionId` and `offerId`, never the address and never the body.** The session id
 * is what ties this line to the request that produced it; the teacher's email address
 * in a log is the student's-PII rule applied one person over, and the rendered body
 * would put the brief — the student's own words — into an aggregator. 5.6's manual
 * test greps the log for exactly these.
 */
function logOfferEmailFailure(offer, error) {
  logger.warn('Offer email was not sent', {
    sessionId: offer.sessionId,
    offerId: offer.offerId,
    message: error?.message ?? String(error),
  });
}
