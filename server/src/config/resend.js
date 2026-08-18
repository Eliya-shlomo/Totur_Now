import { Resend } from 'resend';

import { env } from '#config/env.js';
import { logger } from '#utils/logger.js';

/**
 * The one configured Resend SDK in the process. PR 5.6, MVP.md §18's 5.6.
 *
 * Same rule as `config/db.js`, `config/cloudinary.js` and `config/gemini.js`: exactly
 * one file may import this one — `services/notification.service.js`, which sends, and
 * nothing else. A controller or a repository reaching for the mail provider is a
 * failed review, and the reason is the one `config/gemini.js` states: this project
 * sends exactly one email, and the day the provider or the sender identity changes,
 * the search for "everything that talks to the mail host" has to return one file.
 *
 * **`resend` was added in E0 and `DEPLOYMENT.md` already lists both keys as E5's.**
 * No dependency change, and none is needed — nodemailer would mean an SMTP host, a
 * second secret and a deliverability story this project has no reason to own.
 *
 * `RESEND_API_KEY` and `EMAIL_FROM` are both `optional()` in `config/env.js` and both
 * are blank on Render today. That is deliberate and it is why the guard below exists
 * rather than a `requiredInProduction` entry: an offer that 500s because a mail
 * provider is unconfigured is a worse product than an offer with no email.
 */

/**
 * Whether this process can send mail at all.
 *
 * **Both keys, not just the API key.** A client built from a valid key with no
 * `EMAIL_FROM` fails at request time with a validation error about a field the caller
 * cannot supply, which is the same round trip `isGeminiConfigured` exists to avoid.
 * Either one missing means the same thing to every caller: do not send.
 *
 * Checked before the call rather than discovered inside the SDK. A caller can act on
 * a boolean; it cannot act on a rejected promise from a client that should never have
 * been constructed.
 */
export const isEmailConfigured = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);

/**
 * The client, or `null` when unconfigured. Never construct a second one.
 *
 * `null` rather than a client that can only ever 401, for the reason
 * `config/gemini.js` gives: a half-built client defers the failure to the one moment
 * this path cannot afford it — after the offer has committed, while a teacher has
 * sixty seconds to answer.
 */
export const resendClient = isEmailConfigured ? new Resend(env.RESEND_API_KEY) : null;

/**
 * The one line that says email is off — **at startup, once, not per offer.**
 *
 * This module is imported by `notification.service.js`, which
 * `session.offer.service.js` imports, so the line is emitted while the server boots
 * and before any request arrives. A guard that logged at the call site instead would
 * be a log flood on the current deployment, where the key is blank and every offer
 * would print it: 5.6's review checklist asks about this by name.
 *
 * `info`, not `warn`. A developer without a Resend account is the normal case here —
 * every test in this repository runs with both keys absent — and a warning that fires
 * on every boot is a warning nobody reads by the time it means something.
 */
if (!isEmailConfigured) {
  logger.info('Email is disabled: RESEND_API_KEY or EMAIL_FROM is not set', {
    hasApiKey: Boolean(env.RESEND_API_KEY),
    hasFrom: Boolean(env.EMAIL_FROM),
  });
}
