#!/usr/bin/env node
/**
 * The 50-question bench — PR 6a.3. `npm run bench:classify`.
 *
 * 50 real Bagrut pages through the real attachment path and the real classifier,
 * scored against human-reviewed expectations.
 *
 * ## Why this exists and `npm test` does not cover it
 *
 * `server/tests/classification.test.js` is 548 lines and it passed through three epics
 * in which classification returned the sentinel on every single call. It injects
 * `createMessage`, so what it asserts is that the code builds the object the code
 * intends to build — a proposition that stays true while the model id is wrong, while
 * the request shape is one no server accepts, and while the images never arrive.
 * Nothing in the repo required a real request to be accepted by a real model and come
 * back with the right answer. This script is that requirement.
 *
 * It stays outside `npm test` deliberately. The suite is bare `node --test` with no
 * network and no database, which is what makes a red run mean something on any machine;
 * gating a network test on `GEMINI_API_KEY` would make the suite's result depend on
 * whose laptop ran it. `scripts/lock.mjs` is the precedent — same category, same reason.
 *
 * ## What it does, in order
 *
 *   1. registers a disposable student against a running API
 *   2. `POST /questions/attachments` for each page, over HTTP, exactly as the app does
 *   3. `classifyQuestion({ rawText: '', imageUrls, declaredLevel: null })` in process
 *   4. maps the returned ids to slugs and writes `bagrut-50.results.json`
 *   5. scores against `bagrut-50.expected.json`, or refuses to
 *   6. deletes the disposable student, which cascades to its attachment rows
 *
 * **`rawText` is empty on purpose.** The student typed nothing and photographed the
 * exercise; anything written here would be a hint the bench handed the model, and the
 * measurement would be of the hint.
 *
 * ## The refusal
 *
 * The first run has no expectations, so it writes them from what the model said, with
 * `reviewed: false` on every entry, and **exits non-zero without scoring**. It keeps
 * refusing until a human has corrected the wrong ones and flipped every flag.
 *
 * This is the entire defence against the failure the epic names in its risks: model-
 * proposed expectations quietly becoming the definition of correct, so that a
 * classifier agreeing with its own past mistakes scores 100%. A warning would be
 * scrolled past, so it is an exit.
 *
 * ## Slugs, not ids
 *
 * `prisma/seed/topics.js` says it plainly — ids are database-assigned and the slug is
 * the stable key. Expectations are pinned to slugs, and the numeric ids the classifier
 * returns are mapped through the live taxonomy before anything is compared. A fixture
 * holding a topic id passes until the day somebody reseeds.
 *
 * ## Before running
 *
 * The API must be up with a real `GEMINI_API_KEY` and real Cloudinary credentials, and
 * it must **not** be the preview-launched server — that one has no egress, so every
 * Gemini call dies as `fetch failed` and the bench reports a total classifier failure
 * that is really a network sandbox.
 *
 *   npm run db:up && npm run db:migrate && npm run db:seed
 *   npm run dev:server           # in its own terminal
 *   npm run bench:classify
 *
 * ## Cost
 *
 * 50 vision calls per run, on a `-lite` tier. Cheap on demand, not per commit — which
 * is the other reason this is a script and not a test.
 *
 *   node scripts/classify-bench.mjs [--api <url>] [--pages 1-50] [--keep] [--concurrency N]
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNCLASSIFIED_TOPIC_ID } from '../server/src/config/constants/index.js';
import { prisma, disconnectDb } from '../server/src/config/db.js';
import { isGeminiConfigured } from '../server/src/config/gemini.js';
import { classifyQuestion } from '../server/src/services/classification.service.js';
import { getTopicTree } from '../server/src/services/topic.service.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES_DIR = resolve(ROOT, 'docs/fixtures/bagrut-50');
const RESULTS_FILE = resolve(ROOT, 'docs/fixtures/bagrut-50.results.json');
const EXPECTED_FILE = resolve(ROOT, 'docs/fixtures/bagrut-50.expected.json');

const DEFAULT_API = 'http://localhost:3000/api/v1';
const BENCH_PASSWORD = 'BenchRun!2026';

const args = parseArgs(process.argv.slice(2));
const api = args.api ?? DEFAULT_API;
const pageFilter = parsePages(args.pages);
// One at a time by default. The rate limiter sits on `POST /questions`, not on the
// attachment route, so concurrency is available — but latency is one of the numbers
// being measured, and p95 taken from calls contending with each other is a p95 of the
// bench rather than of the classifier.
const concurrency = Math.max(1, Number(args.concurrency ?? 1));

async function main() {
  if (!isGeminiConfigured) {
    die('GEMINI_API_KEY is not set. Every page would fall back and the run would measure nothing.');
  }

  const files = await pageFiles();

  if (files.length === 0) die(`no PNGs in ${PAGES_DIR} — run node scripts/render-bagrut.mjs first`);

  await requireApi();

  const topicTree = await getTopicTree();
  const slugOf = slugIndex(topicTree);

  const student = await registerBenchStudent();
  say(`disposable student ${student.email}`);
  rule();

  const results = [];

  try {
    for (const batch of chunk(files, concurrency)) {
      const settled = await Promise.all(batch.map((file) => runPage(file, student.token, slugOf)));

      for (const result of settled) {
        results.push(result);
        say(line(result));
      }
    }
  } finally {
    if (!args.keep) await cleanUp(student.id);
    else say(`--keep: student ${student.id} and its rows left in place`);
  }

  rule();

  const ranAt = new Date().toISOString();

  // Written before the expectations are consulted, because both paths through
  // `loadExpected` can exit. 50 vision calls is not something to spend twice because
  // the refusal threw away the latencies on its way out — and the first run, the one
  // that is never scored, is exactly the run whose numbers are otherwise unrecoverable.
  await writeFile(RESULTS_FILE, `${JSON.stringify({ ranAt, results }, null, 2)}\n`, 'utf8');
  say(`results → ${rel(RESULTS_FILE)}`);

  const expected = await loadExpected(results);
  const report = score(results, expected);

  print(report);

  await writeFile(RESULTS_FILE, `${JSON.stringify({ ranAt, report, results }, null, 2)}\n`, 'utf8');

  say(`results and report → ${rel(RESULTS_FILE)}`);

  await disconnectDb();

  // A miss is information; a fallback is a defect. The epic exists to drive the second
  // number to zero, so it is the one that decides the exit code.
  process.exit(report.fallbacks > 0 ? 1 : 0);
}

// ── one page ─────────────────────────────────────────────────────────────────

/**
 * Upload, classify, time it.
 *
 * The elapsed time is measured around `classifyQuestion` alone and not around the
 * upload: the upload is Cloudinary's latency on a fixture that the real student has
 * already paid before the classifier starts, and `LLM_TIMEOUT_MS` bounds this call
 * rather than that one. The image fetch 6a.2 added *is* inside the measurement,
 * because it is inside the timeout too.
 */
async function runPage(file, token, slugOf) {
  const page = pageNumber(file);
  const attachment = await uploadAttachment(file, token);

  const startedAt = Date.now();
  const classification = await classifyQuestion({
    rawText: '',
    imageUrls: [attachment.fileUrl],
    declaredLevel: null,
  });
  const elapsedMs = Date.now() - startedAt;

  const fellBack =
    !classification.classificationOk || classification.topicId === UNCLASSIFIED_TOPIC_ID;

  return {
    page,
    file: basename(file),
    topicSlug: slugOf.get(classification.topicId) ?? null,
    subtopicSlug: slugOf.get(classification.subtopicId) ?? null,
    fellBack,
    confidence: classification.confidence,
    estimatedLevel: classification.estimatedLevel,
    difficulty: classification.difficulty,
    elapsedMs,
  };
}

/**
 * `POST /questions/attachments`, over HTTP, with the same field name the app posts.
 *
 * Over HTTP rather than by importing the service, because the route is what the
 * student's browser hits and it carries the auth, the Multer limits and the byte sniff
 * that rewrites the declared MIME type. A bench that skipped all three would be
 * measuring a path no user takes.
 */
async function uploadAttachment(file, token) {
  const bytes = await readFile(file);
  const form = new FormData();

  form.append('image', new Blob([bytes], { type: 'image/png' }), basename(file));

  const response = await fetch(`${api}/questions/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const body = await response.json().catch(() => null);

  if (response.status !== 201) {
    die(
      `upload of ${basename(file)} failed — ${response.status} ${JSON.stringify(body?.error ?? body)}`,
    );
  }

  return body.data;
}

// ── the account ──────────────────────────────────────────────────────────────

/**
 * A throwaway student per run, deleted at the end.
 *
 * Not a seeded account, because the run creates 50 attachment rows and pointing them
 * at a demo student leaves them there for every later run to wade through. The delete
 * cascades — `QuestionAttachment.uploader` is `onDelete: Cascade` — so removing the
 * user removes the rows, and one delete cannot half-clean.
 *
 * **The Cloudinary images are not removed.** This repo has no delete path for them and
 * writing one here would be new production-shaped code in a PR whose whole contract is
 * that it measures and changes nothing. 50 images per run accumulate in the account
 * and someone should clear them from the Cloudinary console periodically.
 */
async function registerBenchStudent() {
  const email = `bench-${Date.now()}@bench.tutornow.test`;

  const response = await fetch(`${api}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: BENCH_PASSWORD,
      fullName: 'Bench Run',
      role: 'student',
    }),
  });

  const body = await response.json().catch(() => null);

  if (response.status !== 201) {
    die(
      `could not register the bench student — ${response.status} ${JSON.stringify(body?.error ?? body)}`,
    );
  }

  return { id: body.data.user.id, email, token: body.data.accessToken };
}

async function cleanUp(userId) {
  await prisma.user.delete({ where: { id: userId } });
  say(`cleaned up: student ${userId} and its attachment rows`);
}

// ── expectations ─────────────────────────────────────────────────────────────

/**
 * The ground truth, or the refusal.
 *
 * Missing file: write one from this run with every `reviewed` false, and exit. Present
 * but unreviewed: name the pages, and exit. There is no third path where a run scores
 * against something no human has looked at.
 */
async function loadExpected(results) {
  const raw = await readFile(EXPECTED_FILE, 'utf8').catch(() => null);

  if (raw === null) {
    const seeded = results
      .map(({ page, topicSlug, subtopicSlug }) => ({
        page,
        topicSlug,
        subtopicSlug,
        reviewed: false,
      }))
      .sort((a, b) => a.page - b.page);

    await writeFile(EXPECTED_FILE, `${JSON.stringify(seeded, null, 2)}\n`, 'utf8');

    die(
      [
        `wrote ${rel(EXPECTED_FILE)} from this run — ${seeded.length} entries, all reviewed: false`,
        '',
        '  This run is NOT scored. What the model said is a proposal, not the answer.',
        '',
        '  Open each page in docs/fixtures/bagrut-50/, check the two slugs against it,',
        '  correct the wrong ones, then set "reviewed": true on every entry and run again.',
      ].join('\n'),
    );
  }

  const expected = JSON.parse(raw);
  const unreviewed = expected.filter((entry) => entry.reviewed !== true).map((entry) => entry.page);

  if (unreviewed.length > 0) {
    die(
      [
        `${unreviewed.length} of ${expected.length} expectations are still unreviewed — refusing to score.`,
        '',
        `  pages: ${unreviewed.join(', ')}`,
        '',
        `  Check each against docs/fixtures/bagrut-50/page-NN.png, fix the slug if it is`,
        `  wrong, then set "reviewed": true in ${rel(EXPECTED_FILE)}.`,
      ].join('\n'),
    );
  }

  return new Map(expected.map((entry) => [entry.page, entry]));
}

// ── scoring ──────────────────────────────────────────────────────────────────

function score(results, expected) {
  const misses = [];
  let parentHits = 0;
  let leafHits = 0;
  let fallbacks = 0;

  for (const result of results) {
    const want = expected.get(result.page);

    if (result.fellBack) fallbacks += 1;
    if (!want) continue;

    const parentOk = want.topicSlug === result.topicSlug;
    const leafOk = parentOk && want.subtopicSlug === result.subtopicSlug;

    if (parentOk) parentHits += 1;
    if (leafOk) leafHits += 1;

    if (!leafOk) {
      misses.push({
        page: result.page,
        expected: `${want.topicSlug} / ${want.subtopicSlug}`,
        got: `${result.topicSlug} / ${result.subtopicSlug}`,
        parentOk,
      });
    }
  }

  const latencies = results.map((result) => result.elapsedMs).sort((a, b) => a - b);

  return {
    pages: results.length,
    parentAccuracy: ratio(parentHits, results.length),
    leafAccuracy: ratio(leafHits, results.length),
    fallbacks,
    fallbackRate: ratio(fallbacks, results.length),
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    misses,
  };
}

/**
 * The nearest-rank percentile, on a sorted array.
 *
 * Nearest-rank rather than interpolated because 50 samples do not justify inventing a
 * latency between two that were measured, and because a p95 that is a real observed
 * request is the one worth comparing against `LLM_TIMEOUT_MS`.
 */
function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;

  const rank = Math.ceil(fraction * sorted.length);

  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const ratio = (part, whole) => (whole === 0 ? 0 : Number((part / whole).toFixed(4)));
const percent = (value) => `${(value * 100).toFixed(1)}%`;

/**
 * The table, then every miss on its own line.
 *
 * Both, because they are different pieces of information: the aggregate says how bad,
 * and the list says which kind of mathematics the classifier cannot see. Only the
 * second one can be acted on.
 */
function print(report) {
  console.log('');
  console.log('  ── bench:classify ────────────────────────────────────────');
  console.log(`  pages                 ${report.pages}`);
  console.log(`  parent-topic accuracy ${percent(report.parentAccuracy)}`);
  console.log(`  leaf accuracy         ${percent(report.leafAccuracy)}`);
  console.log(
    `  fallback rate         ${percent(report.fallbackRate)}  (${report.fallbacks} pages)`,
  );
  console.log(`  p50 latency           ${report.p50Ms}ms`);
  console.log(`  p95 latency           ${report.p95Ms}ms`);
  console.log('  ──────────────────────────────────────────────────────────');

  if (report.misses.length === 0) {
    console.log('  no misses');
    console.log('');
    return;
  }

  console.log(`  ${report.misses.length} misses`);

  for (const miss of report.misses) {
    const mark = miss.parentOk ? 'leaf ' : 'topic';
    console.log(`  ${mark}  page ${pad(miss.page)} → expected ${miss.expected} · got ${miss.got}`);
  }

  console.log('');
}

// ── plumbing ─────────────────────────────────────────────────────────────────

async function pageFiles() {
  const names = await readdir(PAGES_DIR).catch(() => []);

  return names
    .filter((name) => name.endsWith('.png'))
    .map((name) => resolve(PAGES_DIR, name))
    .filter((file) => pageFilter === null || pageFilter.includes(pageNumber(file)))
    .sort((a, b) => pageNumber(a) - pageNumber(b));
}

const pageNumber = (file) => Number(basename(file).replace(/\D/g, ''));

/** `id -> slug` for the whole taxonomy, parents and subtopics in one map. */
function slugIndex(topicTree) {
  const index = new Map();

  for (const parent of topicTree) {
    index.set(parent.id, parent.slug);

    for (const child of parent.children ?? []) index.set(child.id, child.slug);
  }

  return index;
}

/**
 * Fails now, with the URL, rather than 50 identical connection errors later.
 *
 * `/health` is mounted at the root and not under `/api/v1` — `app.js` says why: a
 * probe should not be behind the versioned prefix. So the origin is taken off the API
 * base rather than the path being appended to it.
 */
async function requireApi() {
  const reachable = await fetch(new URL('/health', api))
    .then((response) => response.ok)
    .catch(() => false);

  if (!reachable) {
    die(
      [
        `no API at ${api}`,
        '',
        '  Start it in its own terminal:  npm run dev:server',
        '  Not under the preview runner — that server has no egress and every Gemini',
        '  call dies as `fetch failed`, which looks exactly like a broken classifier.',
      ].join('\n'),
    );
  }
}

function chunk(items, size) {
  const batches = [];

  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));

  return batches;
}

function parsePages(value) {
  if (!value || value === true) return null;

  const [from, to] = String(value).split('-').map(Number);

  return Number.isFinite(to) ? range(from, to) : [from];
}

/**
 * A declaration rather than a `const` arrow, and that is load-bearing: `--pages` is
 * parsed at the top of the file, while the module is still initialising, so an arrow
 * down here is still in its temporal dead zone when `parsePages` reaches for it.
 */
function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const next = argv[i + 1];

    if (next === undefined || next.startsWith('--')) {
      parsed[token.slice(2)] = true;
    } else {
      parsed[token.slice(2)] = next;
      i += 1;
    }
  }

  return parsed;
}

const pad = (page) => String(page).padStart(2, ' ');
const rel = (file) => file.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, '').replaceAll('\\', '/');

function line(result) {
  const verdict = result.fellBack ? 'FALLBACK' : `${result.topicSlug} / ${result.subtopicSlug}`;

  return `page ${pad(result.page)}  ${String(result.elapsedMs).padStart(5)}ms  ${verdict}`;
}

function say(message) {
  console.log(`  ${message}`);
}

const rule = () => console.log('  ' + '─'.repeat(58));

function die(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

// Last line in the file, and not next to the argument parsing where it reads more
// naturally: half the helpers below are `const` arrows, and a top-level `await main()`
// above them runs before those bindings are initialised. The first version of this
// script died in the temporal dead zone on its own `--pages` flag.
await main();
