import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * The offer email — PR 5.6, MVP.md §18's 5.6.
 *
 * **What this file does not test, said first.** Nothing here reaches Resend, so
 * "the email arrives" is not a claim this suite makes: deliverability, the sender
 * domain and the rendered result in a real client are the brief's manual test, run
 * with a key in `.env`. `classification.test.js` draws the same line around the
 * classifier for the same reason.
 *
 * What it can test is the whole of what this PR decided: the guard, the failure
 * behaviour, and the contents of the template. The last of those is the one with a
 * product rule behind it — the review checklist says to read the email as a teacher
 * who has never seen the product, and "it says how long they have" is assertable.
 *
 * **The service is imported with no keys set**, which is the configuration Render is
 * in today and the one every developer runs. So the guard is not simulated here: it
 * is the real `isEmailConfigured`, answering `false` because `config/env.js` parsed
 * an environment with no `RESEND_API_KEY`. A test that stubbed it would be asserting
 * against its own mock.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

// Both are absent on purpose, and the assertions below depend on it. `delete` rather
// than leaving them unset, because a developer with a real key in their shell would
// otherwise run a different suite from CI — and one of these tests would try to send.
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;

const { OFFER_TTL_SECONDS, OPENING_BLOCKS, PLATFORM_FEE_PCT } =
  await import('#config/constants/index.js');
const { isEmailConfigured, resendClient } = await import('#config/resend.js');
const { offerEmail } = await import('#services/email.templates.js');
const { sendOfferEmail } = await import('#services/notification.service.js');

/** The student's, and none of it may appear in anything this file renders. */
const STUDENT_NAME = 'Yael Cohen';
const STUDENT_EMAIL = 'yael@demo.tutornow.il';

/** An `IncomingOffer`, the only shape the email renders. */
const incomingOffer = (overrides = {}) => ({
  offerId: '66666666-6666-4666-8666-666666666666',
  sessionId: '33333333-3333-4333-8333-333333333333',
  brief: 'Stuck applying the chain rule to a nested trig function.',
  howToStart: 'Name the outer function before differentiating anything.',
  topicLabel: 'כלל השרשרת',
  level: 5,
  expectedEarning: 12 * OPENING_BLOCKS * (1 - PLATFORM_FEE_PCT),
  expiresAt: new Date('2026-03-10T18:01:00Z').toISOString(),
  ...overrides,
});

/** The template's arguments, with the three nullable contract fields filled in. */
const templateInput = (overrides = {}) => ({
  teacherName: 'Dana Levi',
  topicLabel: 'כלל השרשרת',
  level: 5,
  brief: 'Stuck applying the chain rule to a nested trig function.',
  howToStart: 'Name the outer function before differentiating anything.',
  expectedEarning: 20.4,
  ttlSeconds: OFFER_TTL_SECONDS,
  teachUrl: 'http://localhost:5173/teach',
  ...overrides,
});

describe('the config guard', () => {
  it('reports email off, and builds no client, when the keys are absent', () => {
    // The arrangement `config/gemini.js` established: `null` rather than a client that
    // can only ever 401. A half-built client defers the failure to the one moment this
    // path cannot afford it — after the offer committed, inside a teacher's 60 seconds.
    assert.equal(isEmailConfigured, false);
    assert.equal(resendClient, null);
  });
});

describe('sendOfferEmail — it cannot fail the offer', () => {
  it('resolves, and sends nothing, when email is unconfigured', async () => {
    // Criterion 3 of the brief, and the one that actually runs in production today:
    // `POST /sessions/:id/offer` still answers 201 with the keys blank. `resendClient`
    // is `null` here, so a guard that did not return first would throw on `.emails`.
    await sendOfferEmail({
      to: 'dana@demo.tutornow.il',
      teacherName: 'Dana Levi',
      offer: incomingOffer(),
    });
  });

  it('resolves when there is no address to send to', async () => {
    // The contact read came back `null`, or the row has no user. The offer is already
    // committed and the socket event has already gone out; there is nothing to do.
    await sendOfferEmail({ to: null, teacherName: null, offer: incomingOffer() });
  });

  it('never rejects, whatever it is handed', async () => {
    // The contract `sockets/events.js` states for its emitters, applied to the mail
    // provider: a failure logs and returns. An offer answered with 201 must not become
    // an unhandled rejection because a notification could not be built.
    await sendOfferEmail({ to: 'dana@demo.tutornow.il', offer: incomingOffer({ brief: null }) });
  });
});

describe('the template — what a teacher who has never seen the product reads', () => {
  it('names the topic and the earning in the subject', () => {
    // Those are the two facts that decide whether the message is opened at all, and on
    // a phone the subject is frequently the whole email.
    const { subject } = offerEmail(templateInput());

    assert.match(subject, /כלל השרשרת/);
    assert.match(subject, /20\.4 credits/);
  });

  it('says how long they have, in both parts', () => {
    // The review checklist, verbatim: if it does not say how long they have, it is not
    // finished. `OFFER_TTL_SECONDS` imported, never typed — a test that wrote 60 would
    // pass for the wrong reason the day the appendix is tuned.
    const { html, text } = offerEmail(templateInput());

    assert.match(html, new RegExp(`${OFFER_TTL_SECONDS} seconds`));
    assert.match(text, new RegExp(`${OFFER_TTL_SECONDS} seconds`));
  });

  it('carries the brief, the level and one link to the dashboard', () => {
    const { html, text } = offerEmail(templateInput());

    for (const part of [html, text]) {
      assert.match(part, /chain rule/);
      assert.match(part, /5 units/);
      assert.match(part, /\/teach/);
    }
  });

  it('offers no way to accept from the inbox', () => {
    // Sixty seconds does not survive a mail client, a click and a login round trip —
    // and an unauthenticated link that accepted on click would be a state change
    // anyone holding a forwarded copy could perform.
    //
    // **The assertion is about links, not about words.** The footer says "you accept
    // or decline from the dashboard" on purpose, because a teacher who has never seen
    // the product needs telling where the buttons are; an earlier version of this test
    // banned the word and failed on the sentence that makes the email work. What must
    // not exist is a URL that performs anything, so: exactly one href, and it is the
    // dashboard.
    const { html, text } = offerEmail(templateInput());
    const links = html.match(/href="[^"]*"/g);

    assert.deepEqual(links, ['href="http://localhost:5173/teach"']);
    assert.doesNotMatch(text, /https?:\/\/(?!localhost:5173\/teach)/);
  });

  it('contains no student name, address or balance', () => {
    // §5.6's rule, and the manual test greps the log for the same string. The brief is
    // the student's own words and belongs — it is the thing the teacher is being asked
    // to answer — but who asked it does not.
    const { subject, html, text } = offerEmail(templateInput());

    for (const part of [subject, html, text]) {
      assert.doesNotMatch(part, new RegExp(STUDENT_NAME));
      assert.doesNotMatch(part, new RegExp(STUDENT_EMAIL));
      assert.doesNotMatch(part, /balance|credits left/i);
    }
  });

  it('renders the earning to one decimal, and trims a trailing zero', () => {
    // Display only. `commission.js` answers a rate and leaves the arithmetic to
    // whoever owns a balance; float multiplication puts 20.400000000000002 in front of
    // a teacher, and rounding it into whole credits here would be a second answer to
    // "what did I earn" from the one 5.7's modal shows.
    assert.match(offerEmail(templateInput({ expectedEarning: 20.400000000000002 })).text, /20\.4 /);
    assert.match(offerEmail(templateInput({ expectedEarning: 24 })).text, /24 credits/);
  });

  it('omits the topic and the level rather than rendering null', () => {
    // Both are nullable in the contract — a question on the sentinel topic has neither
    // — and an empty row reads as a product that lost the data.
    const { subject, html, text } = offerEmail(templateInput({ topicLabel: null, level: null }));

    assert.match(subject, /a new question/);
    assert.doesNotMatch(html, /null|Topic|Level/);
    assert.doesNotMatch(text, /null|Topic:|Level:/);
  });

  it('carries the opening move, after the brief and never before it', () => {
    // 6a.4 wrote `how_to_start` for a teacher with sixty seconds; 6a.5 renders it in
    // the modal, and this is the same brief in the same order for the teacher who
    // reads the email first. The order is asserted rather than the presence alone —
    // the opening move above the question is an answer to something not yet asked.
    const { html, text } = offerEmail(templateInput());

    for (const part of [html, text]) {
      assert.match(part, /outer function/);
      assert.ok(part.indexOf('chain rule') < part.indexOf('outer function'));
    }
  });

  it('drops the opening move rather than heading an empty block', () => {
    // Null on every fallback classification, where there is no opening move to invent
    // — the same rule the topic and the level already follow, and the same one 6a.5's
    // modal applies to the same field.
    const { html, text } = offerEmail(templateInput({ howToStart: null }));

    assert.doesNotMatch(html, /How to begin/);
    assert.doesNotMatch(text, /How to begin/);
    assert.doesNotMatch(html, /null/);
  });

  it('escapes a brief that contains markup', () => {
    // The brief is the student's raw text on the fallback path, so it is untrusted
    // input rendered into markup. It is also the practical case: a `<` in a maths
    // question is not rare, and unescaped it eats the rest of the paragraph.
    const { html } = offerEmail(templateInput({ brief: 'is 3 < x </blockquote><b>hi' }));

    assert.match(html, /3 &lt; x &lt;\/blockquote&gt;&lt;b&gt;hi/);
  });

  it('emits both parts, always', () => {
    // A text fallback costs a dozen lines and some clients render nothing without it —
    // and it is what a spam filter reads when it decides about an HTML-only message.
    const { subject, html, text } = offerEmail(templateInput());

    for (const part of [subject, html, text]) {
      assert.equal(typeof part, 'string');
      assert.ok(part.length > 0);
    }
  });
});
