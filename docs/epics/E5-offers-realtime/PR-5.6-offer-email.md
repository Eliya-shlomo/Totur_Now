# PR 5.6 — Email to the teacher on a new offer

| | |
|---|---|
| **Epic** | E5 — Offers & Real-Time Presence |
| **Owner** | DEV-B (rotem) |
| **Size** | S |
| **Written by** | Agent |
| **Depends on** | 5.3 |
| **Blocks** | — |
| **Branch** | `dev-b/E5.6-offer-email` |

## Contract implemented

`MVP.md` §18's 5.6 — the teacher hears about an offer even when their tab is closed. No API
surface, no socket event, no new column.

## Scope

**One email, sent after `POST /sessions/:id/offer` commits.** Subject names the topic and the
earning; the body carries the brief, the level, what they would earn, how long they have, and
one link to `/teach`. Sixty seconds is the whole window, so the email is a nudge to open the
tab — not a place to accept from. **There is no accept-by-email link**, because a link that
performs a state change from an unauthenticated click is an authorisation hole, and one that
requires a login round trip will not finish inside the TTL.

**It cannot fail the offer.** Three rules, and all three are the shape E3's classifier
fallback already established:

1. **Outside the transaction, after `COMMIT`.** `resend` is an HTTP call to a third party; a
   transaction held open across it holds the teacher lock for the duration of somebody else's
   outage.
2. **Fire and forget, with a `catch`.** The controller does not await the send before
   answering. The student's `201` does not wait on an email provider.
3. **A missing key is a log line, not an error.** `RESEND_API_KEY` and `EMAIL_FROM` are
   `optional()` in `env.js` and are blank on Render today. When either is absent, log once at
   startup and skip every send. An offer that 500s because an email provider is unconfigured
   is a worse product than an offer with no email.

**`isEmailConfigured`, checked before the call rather than discovered inside the SDK.** Same
arrangement `config/gemini.js` uses for `isGeminiConfigured`, and for the same reason: the
caller can act on a boolean and cannot act on a rejected promise from a client that should
never have been constructed.

**One template, in one file, as a function returning `{ subject, html, text }`.** Both parts,
because a text/plain fallback costs four lines and some mail clients render nothing without
it. No template engine and no `.hbs` file — this is one email and the epic has no second.

**`expectedEarning` comes from `platformFeeRate` in `utils/commission.js`**, which 5.1 wrote
and E7 will reuse. §5.3's commission is 15%, 0% for teachers inside `NEW_TEACHER_FEE_DAYS`,
and 0% during `LOW_DEMAND_HOURS`. **Do not re-derive it here**, and do not write `0.15`.

**No student PII.** The email goes to the teacher and names the topic, the level and the
brief. It does not carry the student's name, email or balance. The brief is the student's own
words when the classifier fell back, which is as close as this gets — and it is the thing the
teacher is being asked to answer, so it belongs.

## Files you may touch

```
server/src/config/resend.js                    new  — the client, or null, plus isEmailConfigured
server/src/services/notification.service.js    new  — sendOfferEmail, and the guard
server/src/services/email.templates.js         new  — one function, one email
server/src/services/session.offer.service.js   ONE call, after the commit
docs/epics/E5-offers-realtime/README.md        tick the status box

server/tests/notification.test.js              new  — the guard and the template, not the network
```

**`session.offer.service.js` is 5.3's and this PR adds one line to it.** That is the only edit,
it goes after `COMMIT`, and it is not awaited. Say so in the review notes of the PR itself so
the diff is read with that in mind.

## Files you must NOT touch

```
server/src/config/env.js                       RESEND_API_KEY and EMAIL_FROM are already declared, optional
.env.example                                   both keys are already listed
server/src/repositories/**                     this PR reads nothing new
server/src/routes/**                           no HTTP surface
server/src/sockets/**                          offer:new is 5.3's
prisma/**                                      no migration
client/**                                      nothing client-side
```

## Acceptance criteria

- [ ] With `RESEND_API_KEY` set, sending an offer delivers an email to the teacher's address
- [ ] The subject names the topic and the earning; the body carries the brief, the level, the TTL and a link to `/teach`
- [ ] **With `RESEND_API_KEY` unset, `POST /sessions/:id/offer` still answers `201`** and the offer row exists
- [ ] With the key unset, exactly one log line says so — at startup, not once per offer
- [ ] With a deliberately wrong key, the offer still answers `201` and the failure logs at warn
- [ ] The `201` is not delayed by the send — measure with the provider reachable and with it pointed at a black hole
- [ ] `DEBUG=prisma:query` shows no open transaction spanning the send
- [ ] `expectedEarning` in the email equals `pricePerBlock × OPENING_BLOCKS × (1 − platformFeeRate(...))`, and is the full amount for a teacher created yesterday
- [ ] The email contains no student name, email or balance
- [ ] Server logs contain no API key and no full email body
- [ ] `npm run lint`, `npx prettier --check .`, `npm test` all pass

## Manual test

1. Set `RESEND_API_KEY` and `EMAIL_FROM` in the repo-root `.env`, restart, send an offer. The email arrives; the numbers match the modal
2. Unset both, restart, send another offer. `201`, the row exists, the teacher's socket still gets `offer:new`, and one startup line says email is off
3. Set the key to `re_thisisnotreal`, restart, send a third. `201`, and a warn-level line naming the failure
4. Point `resend` at an unroutable host and time the request. The `201` returns in the same time as step 2
5. `grep -i "re_\|@demo.tutornow.il" server.log` — no key, and no student address

## Review checklist additions

- Confirm the send is not awaited by the request path and is outside the `$transaction` callback.
- Confirm `isEmailConfigured` is checked before the client is used, and that the client is `null` rather than half-built when the key is missing.
- Confirm the "email is off" line is emitted once at startup, not per offer. A per-offer line is a log flood on the current deployment, where the key is blank.
- Confirm no literal `0.15` and no second reading of §5.3.
- Read the rendered email as a teacher who has never seen the product. If it does not say how long they have, it is not finished.

## Notes

**Why this is a separate PR from 5.3 and not two lines inside it.** 5.3 is human-written
because it is a race condition. Mixing an email provider, a template and a config guard into
that diff makes the four lines that matter harder to find, and §17.5's rule is about attention
as much as authorship.

**Why there is no accept-by-email link.** Sixty seconds. Any flow that involves opening a mail
client, clicking, and authenticating has already lost, and an unauthenticated link that accepts
on click is a state change from a URL anyone who receives a forwarded email can perform. The
email's job is "open your tab", and it says so.

**Why `resend` and not nodemailer.** It is already a dependency, added in E0, and
`DEPLOYMENT.md` already lists `RESEND_API_KEY` and `EMAIL_FROM` as the E5 keys to fill in. No
dependency change is planned for this epic and none is needed here.

**What to do about the keys on Render.** They are blank today, which is why criterion 3 above
is the one that actually runs in production. Filling them is a dashboard change, not a code
change, and it belongs in the same sitting as 5.9's verification — note it in the retro either
way, because a value that lives only in a dashboard is exactly what E1's retro was written
about.
