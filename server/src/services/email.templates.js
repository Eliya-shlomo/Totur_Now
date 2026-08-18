/**
 * The one email this product sends — PR 5.6, MVP.md §18's 5.6.
 *
 * A function returning `{ subject, html, text }`, and nothing else in the file. No
 * template engine and no `.hbs`: this is one email, the epic has no second, and a
 * rendering layer for a single template is a dependency plus a build step in exchange
 * for string interpolation.
 *
 * **Both parts, always.** A `text` fallback costs a dozen lines and some mail clients
 * render nothing without it — and the plain-text part is also what a spam filter reads
 * when it decides whether an HTML-only message is worth delivering.
 *
 * **Pure.** No `env`, no clock, no SDK. Everything it renders arrives as an argument,
 * which is what lets `notification.test.js` assert the contents of the email — and the
 * absence of the student from it — with no network and no configuration.
 *
 * **English, LTR, because the client is.** `client/index.html` is `lang="en" dir="ltr"`
 * and every screen's copy is English, including the dashboard this email links to. The
 * two Hebrew things in it are data — the topic label is `topics.name_he` and the brief
 * is the student's own words — so they carry `dir="auto"`, which lets the client
 * resolve direction from the text itself rather than mirroring the whole message.
 *
 * **No student PII, and the review checklist asks for it by name.** The teacher is
 * being asked to answer a question, so the question is here: the topic, the level and
 * the brief. Who asked it is not — no name, no address, no balance. `IncomingOffer` is
 * the only thing this renders and that shape carries none of them, so the rule holds
 * by construction rather than by remembering.
 */

/**
 * Credits, to at most one decimal, with a trailing `.0` trimmed.
 *
 * `expectedEarning` is deliberately unrounded upstream — `commission.js` answers a
 * rate and leaves the arithmetic to whoever owns a balance, so 12 × 2 × 0.85 arrives
 * here as `20.4`, and a float multiplication can arrive as `20.400000000000002`.
 * **This is display only.** The value the email quotes is the value 5.7's modal
 * quotes, because both read the same `IncomingOffer` field; nothing here rounds
 * anything E7 will later have to honour.
 */
function formatCredits(amount) {
  return Number(amount.toFixed(1)).toString();
}

/** The five characters that would otherwise let a brief close a tag or an attribute. */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * HTML-escapes a value on its way into the template.
 *
 * The brief is the student's raw text on the fallback path (`classification.service.js`
 * writes it verbatim when the classifier is down), so it is untrusted input rendered
 * into markup — the ordinary reason to escape. It is also the practical one: a `<` in
 * a maths question is not rare, and unescaped it silently eats the rest of the
 * paragraph in every mail client that renders HTML.
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * Renders the new-offer email.
 *
 * **The subject names the topic and the earning**, because those are the two facts
 * that decide whether the teacher opens the message at all — and on a phone, the
 * subject is frequently the whole email.
 *
 * **It says how long they have, twice.** Once in the body text and once beside the
 * link. 5.6's review checklist puts it plainly: read this as a teacher who has never
 * seen the product, and if it does not say how long they have, it is not finished.
 *
 * **There is no accept button, and the email says why it is not one.** Sixty seconds
 * does not survive a mail client, a click and a login round trip, and an
 * unauthenticated link that accepts on click is a state change anyone holding a
 * forwarded copy can perform. The email's job is "open your tab", so that is the only
 * thing it asks for.
 *
 * `topicLabel` and `level` are both nullable in the contract — a question on the
 * sentinel topic has neither — and each is omitted rather than rendered as an empty
 * row or as the word "null".
 *
 * @param {object} params
 * @param {string} params.teacherName            greeting only; never the student's
 * @param {string|null} params.topicLabel        `IncomingOffer.topicLabel`
 * @param {number|null} params.level             Bagrut units, §6.1
 * @param {string} params.brief                  `questions.teacher_brief`
 * @param {number} params.expectedEarning        credits, net of §5.3's commission
 * @param {number} params.ttlSeconds             `OFFER_TTL_SECONDS`
 * @param {string} params.teachUrl               absolute link to the dashboard
 * @returns {{subject: string, html: string, text: string}}
 */
export function offerEmail({
  teacherName,
  topicLabel,
  level,
  brief,
  expectedEarning,
  ttlSeconds,
  teachUrl,
}) {
  const earning = formatCredits(expectedEarning);

  const details = [
    topicLabel === null ? null : ['Topic', topicLabel],
    level === null ? null : ['Level', `${level} units`],
    ['You would earn', `${earning} credits`],
    ['Time to answer', `${ttlSeconds} seconds`],
  ].filter(Boolean);

  const parts = { teacherName, details, brief, ttlSeconds, teachUrl };

  return {
    subject: `New request: ${topicLabel ?? 'a new question'} — ${earning} credits`,
    html: renderHtml(parts),
    text: renderText(parts),
  };
}

/**
 * The HTML part.
 *
 * Inline styles and a single column, which is the boring shape that survives Gmail,
 * Outlook and a phone without a media query. No image, no web font and no tracking
 * pixel: the whole message is legible with remote content blocked, which is the
 * default in most clients for a sender the teacher has not written to.
 */
function renderHtml({ teacherName, details, brief, ttlSeconds, teachUrl }) {
  const rows = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;font-weight:600;" dir="auto">${escapeHtml(value)}</td></tr>`,
    )
    .join('');

  return [
    `<div dir="ltr" style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:520px;">`,
    `<p>Hi ${escapeHtml(teacherName)},</p>`,
    `<p>A student just sent you a request. You have <strong>${ttlSeconds} seconds</strong> to answer it.</p>`,
    `<table style="border-collapse:collapse;margin:16px 0;">${rows}</table>`,
    `<p style="margin-bottom:4px;color:#666;">What they asked:</p>`,
    `<blockquote dir="auto" style="margin:0 0 20px;padding:8px 12px;border-inline-start:3px solid #ddd;color:#333;white-space:pre-wrap;">${escapeHtml(brief)}</blockquote>`,
    `<p><a href="${escapeHtml(teachUrl)}" style="display:inline-block;padding:10px 18px;background:#1971c2;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Open your dashboard</a></p>`,
    `<p style="color:#666;font-size:13px;">You accept or decline from the dashboard — this email cannot do it for you, and the request expires ${ttlSeconds} seconds after it was sent.</p>`,
    `</div>`,
  ].join('\n  ');
}

/**
 * The `text/plain` part — the same message, same order, no markup.
 *
 * Written out rather than derived from the HTML by stripping tags: a stripper produces
 * a wall of text with the link glued to the sentence before it, and this is a dozen
 * lines.
 */
function renderText({ teacherName, details, brief, ttlSeconds, teachUrl }) {
  return [
    `Hi ${teacherName},`,
    '',
    `A student just sent you a request. You have ${ttlSeconds} seconds to answer it.`,
    '',
    details.map(([label, value]) => `${label}: ${value}`).join('\n'),
    '',
    'What they asked:',
    brief,
    '',
    `Open your dashboard: ${teachUrl}`,
    '',
    `You accept or decline from the dashboard — this email cannot do it for you, and the request expires ${ttlSeconds} seconds after it was sent.`,
  ].join('\n');
}
