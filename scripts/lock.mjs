#!/usr/bin/env node
/**
 * The teacher-lock race harness — MVP.md §11.3-A, E5's acceptance criterion.
 *
 * Two students send an offer to **one** teacher at the same instant. Exactly one gets
 * `201`; the other gets `409 TEACHER_UNAVAILABLE`. One `PENDING` offer exists
 * afterwards and the loser's session is still `PENDING`.
 *
 * ## Why this file exists rather than a test
 *
 * The lock is four lines in `session.repository.js`:
 *
 * ```sql
 * UPDATE teacher_profiles SET status = 'OFFER_LOCKED'
 *  WHERE user_id = $1 AND status = 'ONLINE'
 * ```
 *
 * ...and the `count` is checked. **Nothing in `npm test` runs it.** The suite is bare
 * `node --test` with no database, so the repository never executes; and
 * `session.offer.service.js` takes injected dependencies, so its tests stub
 * `lockTeacher` and assert the service's reaction to `locked: false` rather than what
 * produces it.
 *
 * The guarantee is not in our code at all — it is Postgres's. Under READ COMMITTED the
 * second transaction blocks on the row until the first commits, then re-evaluates its
 * `WHERE` and matches zero rows. No unit test can assert that.
 *
 * **Sequential requests pass for the wrong reason.** Fire one, wait, fire the other:
 * the second sees `OFFER_LOCKED` and correctly 409s, which proves the status check
 * works and says nothing about the lock. A build with the `WHERE` clause deleted passes
 * that test too. The two transactions have to be in flight together, which is what the
 * synchronised fire below is for.
 *
 * ## Two modes
 *
 * ```
 *   node scripts/lock.mjs teacher --email … --password …
 *   node scripts/lock.mjs student --email … --password … --teacher <id> --at <iso>
 * ```
 *
 * `teacher` is run once per round, by either operator: it logs the teacher in, puts
 * them `ONLINE`, and prints the `--teacher` id both students must use. **Both students
 * must target the same teacher or there is no race.**
 *
 * `student` is run by each operator on their own machine, with the same `--at`.
 *
 * ## The clock is the thing that will silently ruin a round
 *
 * Two machines firing on a shared timestamp are only as aligned as their clocks. A host
 * 400ms off fires 400ms late, the pair is sequential, and the round passes while
 * testing nothing. This script measures its own offset against the server's `Date`
 * header and **refuses to fire when it looks worse than `--max-skew`** (default 2s).
 *
 * That check catches the catastrophic case. Sub-second alignment relies on both hosts
 * running NTP, which is the normal state — on Windows, `w32tm /resync` if in doubt.
 */

import { OPENING_BLOCKS } from '../server/src/config/constants/session.js';

const HELP = `
lock.mjs — the teacher-lock race harness (MVP.md §11.3-A)

  node scripts/lock.mjs teacher --email <e> --password <p> [--api <url>]
  node scripts/lock.mjs student --email <e> --password <p> --teacher <uuid> --at <iso> [--api <url>]

Options
  --api        API base, default https://tutor-now-api.onrender.com/api/v1
  --email      account email
  --password   account password, default TutorNow!2026
  --teacher    the teacher's user id, printed by the 'teacher' mode  (student only)
  --at         absolute fire time, ISO 8601 — the SAME value on both hosts (student only)
  --in         seconds from now instead of --at, for a solo dry run   (student only)
  --max-skew   abort if the local clock is off by more than this many ms (default 2000)
  --force      fire anyway despite clock skew
  --help

Round, in order
  1. one operator:   node scripts/lock.mjs teacher --email dana.k@demo.tutornow.il
  2. agree an --at a couple of minutes out, in UTC
  3. both operators: node scripts/lock.mjs student --email <their own> --teacher <id> --at <that>
  4. compare: exactly one 201 and one 409 TEACHER_UNAVAILABLE
  5. before the next round the teacher is OFFER_LOCKED — reject the offer, or wait out
     OFFER_TTL_SECONDS (60s) for the expiry sweep, then re-run step 1
`;

const DEFAULT_API = 'https://tutor-now-api.onrender.com/api/v1';
const DEFAULT_PASSWORD = 'TutorNow!2026';

// ── argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  // The mode is positional and first. `--help` on its own is not a mode, so a leading
  // flag leaves `mode` undefined and falls through to the usage text rather than being
  // reported as an unknown mode — which is what a bare `--help` was doing.
  const takesMode = argv.length > 0 && !argv[0].startsWith('--');
  const mode = takesMode ? argv[0] : undefined;
  const rest = takesMode ? argv.slice(1) : argv;
  const args = { mode };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = rest[i + 1];

    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }

  return args;
}

// ── output ───────────────────────────────────────────────────────────────────

const stamp = () => new Date().toISOString().slice(11, 23);
const say = (message) => console.log(`${stamp()}  ${message}`);
const rule = () => console.log('─'.repeat(72));

function die(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

/**
 * One request. Returns the status, the parsed body and the server's `Date` header.
 *
 * Never throws on a non-2xx: every status in this script is a result rather than a
 * failure, and a `409` is the outcome half the runs are hoping for.
 */
async function call(api, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }

  return { status: response.status, body: json, date: response.headers.get('date') };
}

async function login(api, email, password) {
  const res = await call(api, '/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  if (res.status !== 200) {
    die(`login failed for ${email} — ${res.status} ${JSON.stringify(res.body?.error ?? res.body)}`);
  }

  return { token: res.body.data.accessToken, user: res.body.data.user, date: res.date };
}

// ── the clock check ──────────────────────────────────────────────────────────

/**
 * Local clock offset against the server, from the `Date` response header.
 *
 * The header has one-second resolution, so this cannot certify millisecond alignment
 * and does not claim to — it is here to catch a host that is seconds out, which is the
 * failure that silently turns a race into a sequential pair. Round-trip time is halved
 * and subtracted so a slow link is not read as skew.
 */
function clockOffsetMs(serverDate, sentAt, receivedAt) {
  if (!serverDate) return null;

  const server = new Date(serverDate).getTime();
  if (Number.isNaN(server)) return null;

  const roundTrip = receivedAt - sentAt;
  const localAtServerInstant = sentAt + roundTrip / 2;

  return Math.round(localAtServerInstant - server);
}

// ── the wait ─────────────────────────────────────────────────────────────────

/**
 * Sleeps until `target`, coarsely at first and then by spinning.
 *
 * `setTimeout` is only accurate to the event loop's next turn — tens of milliseconds
 * under load, which is the same order as the window being measured. So it sleeps to
 * 50ms short and burns the remainder in a tight loop. Wasteful for 50ms, and the
 * alternative is a fire that lands whenever the timer felt like it.
 */
async function waitUntil(target) {
  const coarse = target - Date.now() - 50;
  if (coarse > 0) await new Promise((resolve) => setTimeout(resolve, coarse));

  while (Date.now() < target) {
    // spin
  }
}

// ── mode: teacher ────────────────────────────────────────────────────────────

/**
 * Puts the teacher `ONLINE` and prints the id the students need.
 *
 * **Logging in as a teacher sets them `OFFLINE`.** Deliberate, documented in
 * `presence.service.js`, and it cost E5's verification pass an hour before anyone found
 * the documentation. So the status write is not optional setup — it is the whole point
 * of this mode, and it has to happen after the login rather than before it.
 */
async function runTeacher(args) {
  const api = args.api ?? DEFAULT_API;
  const password = args.password ?? DEFAULT_PASSWORD;

  if (!args.email) die('teacher mode needs --email');

  say(`logging in ${args.email}`);
  const { token, user } = await login(api, args.email, password);

  say('setting status ONLINE — login itself sets a teacher OFFLINE');
  const patched = await call(api, '/teachers/me', {
    method: 'PATCH',
    token,
    body: { status: 'ONLINE' },
  });

  if (patched.status !== 200) {
    die(`could not set ONLINE — ${patched.status} ${JSON.stringify(patched.body?.error)}`);
  }

  const confirmed = await call(api, '/teachers/me', { token });
  const status = confirmed.body?.data?.status;

  rule();
  console.log(`  teacher   ${user.fullName} <${user.email}>`);
  console.log(`  status    ${status}`);
  console.log(`  --teacher ${user.id}`);
  rule();

  if (status !== 'ONLINE') {
    die(
      `status reads ${status}, not ONLINE. A locked teacher races nothing — reject the open offer or wait out OFFER_TTL_SECONDS (60s), then re-run.`,
    );
  }

  console.log('\n  Give that --teacher id to BOTH students. Same teacher or there is no race.\n');
}

// ── the affordability pre-flight ─────────────────────────────────────────────

/**
 * Refuses to arm when this student cannot afford the opening block.
 *
 * **This is the trap that makes a round look like it worked when it measured nothing**,
 * and the first dry run walked straight into it. `sendOffer` checks affordability at
 * step 3 and takes the lock at step 4, so a student who is short is rejected with
 * `402 INSUFFICIENT_CREDIT` *before the lock is ever reached*. The pair then reads as
 * one `201` and one rejection — which is what a passing round looks like at a glance —
 * while only one transaction ever went near the row.
 *
 * A loser must lose with `409 TEACHER_UNAVAILABLE`. Any other rejection means the race
 * did not happen.
 *
 * `OPENING_BLOCKS` is imported rather than typed, so this agrees with the server by
 * construction. `constants/session.js` imports nothing, so it loads cleanly from here
 * despite living in another package scope.
 *
 * The balance comes from `GET /questions/:id/matches`, which reports `walletBalance`
 * because E7's `GET /wallet` does not exist yet. If that read fails for any reason this
 * warns and continues rather than aborting: an unavailable pre-flight should not stop a
 * sitting that two people scheduled.
 */
async function assertCanAffordTheRace({ api, token, teacherId, questionId, force }) {
  const teacher = await call(api, `/teachers/${teacherId}`, { token });

  if (teacher.status !== 200) {
    say(`! could not read the teacher (${teacher.status}) — skipping the affordability check`);
    return;
  }

  const pricePerBlock = teacher.body?.data?.pricePerBlock;
  const matches = await call(api, `/questions/${questionId}/matches`, { token });
  const balance = matches.body?.data?.walletBalance;

  if (typeof pricePerBlock !== 'number' || typeof balance !== 'number') {
    say('! could not read a price or a balance — skipping the affordability check');
    return;
  }

  const needed = pricePerBlock * OPENING_BLOCKS;
  say(`balance ${balance}, opening block ${needed} (${pricePerBlock} × ${OPENING_BLOCKS} blocks)`);

  if (balance >= needed) return;

  const message =
    `this student cannot afford the opening block: ${balance} < ${needed}.\n` +
    `    They would be refused 402 INSUFFICIENT_CREDIT at step 3 of sendOffer, which is\n` +
    `    BEFORE the lock at step 4 — so they never reach the race, and the round would\n` +
    `    read as one 201 and one rejection while only one transaction touched the row.\n` +
    `    Top the wallet up, or pick a teacher priced at ${Math.floor(balance / OPENING_BLOCKS)} or less.`;

  if (force) {
    say(`! ${message.split('\n')[0]} — continuing because --force`);
    return;
  }

  die(message);
}

// ── mode: student ────────────────────────────────────────────────────────────

/**
 * One side of the race: log in, create a question, arm, fire on the shared instant.
 *
 * **Everything slow happens before the fire.** `POST /questions` runs E3's classifier,
 * which is a Gemini call — seconds, and variable. Creating the session inside the timed
 * window would put that variance between the two hosts and there would be no race left
 * to measure.
 */
async function runStudent(args) {
  const api = args.api ?? DEFAULT_API;
  const password = args.password ?? DEFAULT_PASSWORD;
  const maxSkew = Number(args['max-skew'] ?? 2000);

  if (!args.email) die('student mode needs --email');
  if (!args.teacher) die('student mode needs --teacher <uuid> — run the teacher mode first');
  if (!args.at && !args.in)
    die('student mode needs --at <iso> (or --in <seconds> for a solo dry run)');

  const fireAt = args.in ? Date.now() + Number(args.in) * 1000 : new Date(args.at).getTime();

  if (Number.isNaN(fireAt)) die(`--at is not a date I can read: ${args.at}`);

  // 1 — login, and measure the clock while we are here
  const sentAt = Date.now();
  const { token, user, date } = await login(api, args.email, password);
  const receivedAt = Date.now();

  say(`logged in as ${user.fullName} (${user.role})`);

  if (user.role !== 'student')
    die(`${args.email} is a ${user.role}. Only a student sends an offer.`);

  const skew = clockOffsetMs(date, sentAt, receivedAt);

  if (skew === null) {
    say('! server sent no Date header — clock offset unknown, firing blind');
  } else {
    say(
      `clock offset vs server: ${skew > 0 ? '+' : ''}${skew}ms (local ${skew > 0 ? 'ahead' : 'behind'})`,
    );

    if (Math.abs(skew) > maxSkew && !args.force) {
      die(
        `local clock is ${skew}ms off the server, over --max-skew ${maxSkew}ms.\n` +
          `    Two hosts firing on a shared timestamp are only as aligned as their clocks;\n` +
          `    this far out the pair goes sequential and the round proves nothing.\n` +
          `    Sync the clock (Windows: w32tm /resync) and retry, or pass --force.`,
      );
    }
  }

  // 2 — the session, created now so the fire carries nothing but the offer
  say(
    'creating a question (runs the classifier — this is the slow part, deliberately before the fire)',
  );

  const created = await call(api, '/questions', {
    method: 'POST',
    token,
    body: { rawText: `Lock race harness — ${user.email} — ${new Date().toISOString()}` },
  });

  if (created.status !== 201) {
    die(`could not create a question — ${created.status} ${JSON.stringify(created.body?.error)}`);
  }

  const sessionId = created.body.data.sessionId;
  const questionId = created.body.data.id;
  say(`session ${sessionId} is PENDING`);

  // 3 — affordability, because a student who cannot pay never reaches the lock
  await assertCanAffordTheRace({
    api,
    token,
    teacherId: args.teacher,
    questionId,
    force: args.force,
  });

  // 4 — armed
  const untilFire = fireAt - Date.now();

  if (untilFire <= 0) {
    die(
      `--at is ${-untilFire}ms in the past. Both operators need a value still ahead of them; pick one a couple of minutes out.`,
    );
  }

  rule();
  console.log(`  student   ${user.email}`);
  console.log(`  session   ${sessionId}`);
  console.log(`  teacher   ${args.teacher}`);
  console.log(
    `  fire at   ${new Date(fireAt).toISOString()}  (in ${(untilFire / 1000).toFixed(1)}s)`,
  );
  rule();

  await waitUntil(fireAt);

  // 4 — the fire. Nothing between the clock and the request.
  const t0 = Date.now();
  const result = await call(api, `/sessions/${sessionId}/offer`, {
    method: 'POST',
    token,
    body: { teacherId: args.teacher },
  });
  const elapsed = Date.now() - t0;

  // 5 — the result
  const code = result.body?.error?.code ?? null;
  const offerId = result.body?.data?.offerId ?? null;
  const verdict =
    result.status === 201
      ? 'WON  — 201, offer created'
      : code === 'TEACHER_UNAVAILABLE'
        ? 'LOST — 409 TEACHER_UNAVAILABLE (the lock refused it, which is the pass)'
        : `UNEXPECTED — ${result.status} ${code ?? ''}`;

  rule();
  console.log(`  ${verdict}`);
  console.log(`  status    ${result.status}${code ? `  ${code}` : ''}`);
  if (offerId) console.log(`  offerId   ${offerId}`);
  console.log(`  session   ${sessionId}`);
  console.log(
    `  fired     ${new Date(t0).toISOString()}  (${t0 - fireAt >= 0 ? '+' : ''}${t0 - fireAt}ms vs target)`,
  );
  console.log(`  round trip ${elapsed}ms`);
  rule();

  console.log(`
  Compare with the other operator. The round passes when:

    · exactly one 201 and one 409 TEACHER_UNAVAILABLE
    · both 'fired' lines are within ~100ms of each other — further apart and the
      pair went sequential and this round measured nothing
    · one PENDING offer on the teacher, and the loser's session still PENDING

  Anything else — two 201s above all — is the defect this harness exists to find.
`);

  process.exit(result.status === 201 || code === 'TEACHER_UNAVAILABLE' ? 0 : 1);
}

// ── entry ────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.mode || args.mode === 'help') {
  console.log(HELP);
  process.exit(args.mode ? 0 : 1);
}

if (args.mode === 'teacher') await runTeacher(args);
else if (args.mode === 'student') await runStudent(args);
else die(`unknown mode '${args.mode}'. Expected 'teacher' or 'student'. --help for usage.`);
