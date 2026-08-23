#!/usr/bin/env node
/**
 * The reconciliation harness — MVP.md §11.3, and E6's closing acceptance criterion.
 *
 * ```
 *   node scripts/reconcile.mjs baseline --save .baseline.json   before the pass
 *   node scripts/reconcile.mjs check                            after every check that moves money
 *   node scripts/reconcile.mjs diff --baseline .baseline.json   after the undo
 * ```
 *
 * ## Why this is a script and not a test
 *
 * `scripts/lock.mjs`'s argument, one epic later and about the other half of §11.3. That
 * harness exists because no suite can put two transactions in flight at once; this one
 * exists because **the invariant it checks is about a database somebody has been clicking
 * at for half a day**, not about a fixture a suite built and tore down.
 * `e2e.session.lifecycle.test.js` asserts the same four properties over the rows it made
 * itself, which proves the services keep the invariant. It cannot tell you whether the
 * database you just demoed on still holds it — and E6 is the first epic where the answer
 * to that question is money rather than embarrassment.
 *
 * **Zero rows is the pass.** Every query below is written to return only what is *wrong*,
 * which is what makes "the reconciliation query returns zero rows at the end of the pass"
 * a thing an operator can paste rather than interpret. The exit code is `1` when anything
 * came back, so it can end a script.
 *
 * ## The five invariants, and what breaking each one would mean
 *
 * | # | Invariant | A row here means |
 * |---|---|---|
 * | 1 | `wallets.balance` = Σ that user's `wallet_transactions.amount` | money exists with no history, or history with no money |
 * | 2 | `sessions.total_charged` = Σ that session's `session_blocks.amount` | two correct transactions wrote the same column from different reads |
 * | 3 | `platform_fee + teacher_earning` = `total_charged` on a finished session, and both `0` on a `NO_SHOW` or one of 7.4's refunds | a refund that took a commission, or a rounding done twice |
 * | 4 | Σ that session's `SESSION_CHARGE` rows = `-total_charged`, and any session with a zero split refunds all of it | a charge with no ledger row, or a refund that was not the whole of it |
 * | 5 | no teacher is `IN_SESSION` without an `ACTIVE` session | E6's characteristic leak: a teacher invisible to E4's first hard filter for ever |
 *
 * Invariant 5 is not §11.3's and is here because it is the one E6 can break silently.
 * 6.6 releases the teacher inside the termination transaction and 6.8 deliberately leaves
 * `IN_SESSION` untouched by the presence sweep — so a session that ends by a path nobody
 * thought of leaves a teacher out of every match list, and nothing on any screen says so.
 *
 * ## `baseline` and `diff`, for the mutation ledger
 *
 * A verification pass writes rows. E5's retro carries the undo commands for its own and
 * says the interesting part out loud — `truncate offers` alone leaves every probe session
 * standing — and E6's closing criterion is that the database is back at the seed baseline
 * afterwards, **verified by count rather than by assumption**. So: `baseline --save` before
 * the pass, `diff --baseline` after the undo, and the output is the evidence.
 *
 * It counts rows and sums balances. It does not know what the seed contains, deliberately:
 * a baseline is whatever was there when you started, and a script with a table of expected
 * counts in it is a script that goes stale the first time somebody adds a demo teacher.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

const HELP = `
reconcile — MVP.md §11.3, against whatever database DATABASE_URL points at

  node scripts/reconcile.mjs check
      The five invariants. Prints only what is wrong; exits 1 if anything is.

  node scripts/reconcile.mjs baseline [--save <path>]
      Row counts per table and the total of every wallet. --save writes JSON for diff.

  node scripts/reconcile.mjs diff --baseline <path>
      Counts now, against that file. Exits 1 if anything moved — which after the
      undo is the answer you want, and before it is the mutation ledger.

Reads the repo-root .env like the server does. Never writes.
`;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: resolve(REPO_ROOT, '.env') });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — this reads the repo-root .env, like the server.');
  process.exit(2);
}

/**
 * The host and database, on every run, before anything else — PR 7.8.
 *
 * **This banner is not decoration and it is not an invariant.** There are two databases
 * in this project: the repo-root `.env` is the local Docker Postgres on `localhost:5433`,
 * and `server/.env` is the hosted Neon instance, which is what anything started with a
 * working directory of `server/` picks up. This script always reads the root one. A probe
 * that wrote to Neon and a `check` that read the local database both succeed, and the
 * pass reports zero rows because it is looking at a database nothing touched.
 *
 * That happened in PR 7.3 and again in 7.4, and 7.8's brief responded by telling the
 * operator to "confirm the host it connected to" — against a tool that printed no host.
 * One line closes it: the evidence pasted into a retro now names the database it is
 * evidence about.
 *
 * Credentials are never printed. `URL` gives up host, port and pathname and nothing else
 * is read off it.
 */
{
  const { hostname, port, pathname } = new URL(process.env.DATABASE_URL);
  console.log(`database: ${hostname}${port ? `:${port}` : ''}${pathname}\n`);
}

// `['warn', 'error']` rather than `config/db.js`'s default, which adds `query`: this is an
// operator's tool and its output is meant to be pasted into a retro.
const prisma = new PrismaClient({ log: ['warn', 'error'] });

/** The tables a verification pass can move. `diff` reports on exactly these. */
const COUNTED = [
  'users',
  'wallets',
  'wallet_transactions',
  'teacher_profiles',
  'questions',
  'sessions',
  'session_blocks',
  'offers',
  'reviews',
];

const [mode = 'check'] = process.argv.slice(2);

try {
  if (mode === 'check') process.exit(await check());
  else if (mode === 'baseline') process.exit(await baseline());
  else if (mode === 'diff') process.exit(await diff());
  else {
    console.log(HELP);
    process.exit(2);
  }
} finally {
  await prisma.$disconnect();
}

/**
 * The five invariants. **Every query returns only rows that are wrong.**
 *
 * @returns {Promise<number>} process exit code — `0` when every query came back empty
 */
async function check() {
  const failures = [];

  await report(failures, '1. wallets whose balance disagrees with their ledger', async () => {
    return prisma.$queryRaw`
      SELECT u.email,
             w.balance,
             COALESCE(SUM(t.amount), 0)::int AS ledger
        FROM wallets w
        JOIN users u ON u.id = w.user_id
        LEFT JOIN wallet_transactions t ON t.user_id = w.user_id
       GROUP BY u.email, w.balance
      HAVING w.balance <> COALESCE(SUM(t.amount), 0)
    `;
  });

  await report(
    failures,
    '2. sessions whose total_charged disagrees with their blocks',
    async () => {
      return prisma.$queryRaw`
      SELECT s.id,
             s.status::text,
             s.total_charged,
             COALESCE(SUM(b.amount), 0)::int AS blocks
        FROM sessions s
        LEFT JOIN session_blocks b ON b.session_id = s.id
       WHERE s.status <> 'PENDING'
       GROUP BY s.id
      HAVING s.total_charged <> COALESCE(SUM(b.amount), 0)
    `;
    },
  );

  await report(failures, '3. sessions whose split does not add up', async () => {
    // A `NO_SHOW` deliberately breaks the sum — both columns are zero while
    // `total_charged` still records what was taken and given back — so it is checked for
    // the opposite property. **A refund net of commission is the case this row catches.**
    //
    // **PR 7.4 gave `ENDED` the same shape.** §5.5's other two refunds — a session the
    // platform never provided a room for, and a student who left inside the opening
    // window — are full refunds that stay in `ENDED`, because §5.5 is a pricing rule and
    // §10's state machine has no third terminal state for "the same ending, refunded".
    // They write `0 / 0` with `total_charged` standing, exactly as a `NO_SHOW` does.
    //
    // So a zero split is exempted here rather than reported — **and invariant 4 below is
    // where it is paid for.** That row now demands that a finished session with a zero
    // split actually gave the whole charge back in the ledger, which is a stronger claim
    // than the sum this row was making: "the split adds up, or the money went back". A
    // session that simply lost its fee and earning would pass here and fail there.
    return prisma.$queryRaw`
      SELECT s.id,
             s.status::text,
             s.total_charged,
             s.platform_fee,
             s.teacher_earning
        FROM sessions s
       WHERE (s.status IN ('ENDED', 'RATED')
              AND s.platform_fee + s.teacher_earning <> s.total_charged
              AND NOT (s.platform_fee = 0 AND s.teacher_earning = 0))
          OR (s.status = 'NO_SHOW'
              AND (s.platform_fee <> 0 OR s.teacher_earning <> 0))
    `;
  });

  await report(failures, '4. sessions whose ledger rows disagree with their columns', async () => {
    return prisma.$queryRaw`
      SELECT s.id,
             s.status::text,
             s.total_charged,
             COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'SESSION_CHARGE'), 0)::int AS charged,
             COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'REFUND'), 0)::int          AS refunded,
             COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'TEACHER_EARNING'), 0)::int AS earned
        FROM sessions s
        LEFT JOIN wallet_transactions t ON t.session_id = s.id
       WHERE s.status <> 'PENDING'
       GROUP BY s.id
      HAVING COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'SESSION_CHARGE'), 0) <> -s.total_charged
          -- A refunded session gives back the whole of it, with no fee taken out.
          OR (s.status = 'NO_SHOW'
              AND COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'REFUND'), 0) <> s.total_charged)
          -- And a finished one credits the teacher exactly the earning column, once.
          OR (s.status IN ('ENDED', 'RATED')
              AND COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'TEACHER_EARNING'), 0)
                  <> s.teacher_earning)
          -- PR 7.4. A finished session with a zero split is one of §5.5's two refunds,
          -- and invariant 3 above stops checking its arithmetic on that basis. This is
          -- the check that replaces it, and it is the stricter one: the whole charge came
          -- back, to the credit. A session that merely lost its fee and earning columns
          -- has no REFUND rows and is reported here.
          OR (s.status IN ('ENDED', 'RATED')
              AND s.platform_fee = 0
              AND s.teacher_earning = 0
              AND s.total_charged > 0
              AND COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'REFUND'), 0) <> s.total_charged)
    `;
  });

  await report(failures, '5. teachers left IN_SESSION with no session running', async () => {
    return prisma.$queryRaw`
      SELECT u.email, p.status::text
        FROM teacher_profiles p
        JOIN users u ON u.id = p.user_id
       WHERE p.status = 'IN_SESSION'
         AND NOT EXISTS (
               SELECT 1 FROM sessions s
                WHERE s.teacher_id = p.user_id AND s.status = 'ACTIVE'
             )
    `;
  });

  if (failures.length === 0) {
    console.log('\nRECONCILED — five invariants, zero rows.\n');

    return 0;
  }

  console.log(`\nBROKEN — ${failures.length} of 5 invariants returned rows. Each is a defect.\n`);

  return 1;
}

/** Runs one invariant and prints its rows, or one line saying there were none. */
async function report(failures, title, query) {
  const rows = await query();

  if (rows.length === 0) {
    console.log(`✔ ${title} — none`);

    return;
  }

  failures.push(title);
  console.log(`\n✖ ${title} — ${rows.length}`);
  console.table(rows.map(stringifyBigints));
  console.log('');
}

/** Row counts and the money, as one snapshot. */
async function baseline() {
  const counts = {};

  for (const table of COUNTED) {
    const [{ count }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "${table}"`,
    );

    counts[table] = count;
  }

  const [{ credits }] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(balance), 0)::int AS credits FROM wallets
  `;

  const snapshot = { takenAt: new Date().toISOString(), counts, credits };

  console.table(counts);
  console.log(`credits held across every wallet: ${credits}`);

  const flag = process.argv.indexOf('--save');

  if (flag !== -1 && process.argv[flag + 1]) {
    writeFileSync(process.argv[flag + 1], `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`\nsaved to ${process.argv[flag + 1]}`);
  }

  return 0;
}

/**
 * What moved since a saved baseline.
 *
 * **After the undo, anything at all is a failure** — that is the closing criterion, and
 * the reason this exits non-zero on any delta rather than printing a summary somebody has
 * to read carefully at the end of a long day.
 */
async function diff() {
  const flag = process.argv.indexOf('--baseline');

  if (flag === -1 || !process.argv[flag + 1]) {
    console.error('diff needs --baseline <path> — the file `baseline --save` wrote.');

    return 2;
  }

  const saved = JSON.parse(readFileSync(process.argv[flag + 1], 'utf8'));
  const rows = [];

  for (const table of COUNTED) {
    const [{ count }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "${table}"`,
    );

    if (count !== saved.counts[table]) {
      rows.push({
        table,
        baseline: saved.counts[table],
        now: count,
        delta: count - saved.counts[table],
      });
    }
  }

  const [{ credits }] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(balance), 0)::int AS credits FROM wallets
  `;

  if (credits !== saved.credits) {
    rows.push({
      table: 'credits held',
      baseline: saved.credits,
      now: credits,
      delta: credits - saved.credits,
    });
  }

  console.log(`baseline taken ${saved.takenAt}`);

  if (rows.length === 0) {
    console.log('\nAT BASELINE — every counted table and the credit total are where they were.\n');

    return 0;
  }

  console.log('\nNOT AT BASELINE — this is the mutation ledger, and the undo is not finished.\n');
  console.table(rows);

  return 1;
}

/** `console.table` renders a BigInt as `[object]`; every count above is an int already. */
function stringifyBigints(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'bigint' ? Number(value) : value,
    ]),
  );
}
