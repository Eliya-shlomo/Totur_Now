import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `GET /sessions/mine` — PR 8.4, MVP.md §14.1 and §12's `GET /students/me/sessions`.
 *
 * **The property this file exists for is the difference between two nulls.** A session
 * with `review: null` has not been rated and is the row the whole screen is for — §10
 * makes the rating the only edge out of `ENDED`, so that session never reached a terminal
 * state and its teacher is missing reputation it earned. A session with
 * `review: {stars: null}` *was* rated, by a student who declined to give stars, which is
 * the most common rating in the product. Flatten one into the other and the screen either
 * hides work the student still owes or nags them about work they have done.
 *
 * So the two are asserted separately, and so is the count that badges them: `unratedCount`
 * is `ENDED` with no review and nothing else — not `NO_SHOW`, which is terminal and
 * deliberately never rated, and not the length of the page, which is 20 rows out of a set
 * the student cannot see the end of.
 *
 * The second property is the paging offset, which is arithmetic and is invisible on a
 * seeded database where every student's whole history fits on one page.
 *
 * The third is what the row does *not* carry: no minutes, no `teacherEarning`, no
 * `platformFee`. `client/src/lib/credits.js` owns the minute translation for the whole
 * product and 7.6's earnings endpoint owns the teacher's side of the money, and a second
 * copy of either would be a number free to disagree with the first.
 *
 * Both collaborators arrive through the second argument, so the whole file runs with no
 * database.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, UNCLASSIFIED_TOPIC_ID } =
  await import('#config/constants/index.js');
const { getStudentSessionHistory } = await import('#services/session.history.service.js');
const { toSessionHistoryRecord } = await import('#utils/sessionView.js');
const { sessionHistorySchema } = await import('#validators/session.schema.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_ID = '44444444-4444-4444-8444-444444444444';
const ENDED_AT = new Date('2026-08-21T18:30:00.000Z');

/** A row as `findStudentSessionPage` hands it over — a rated session with stars. */
const sessionRow = (over = {}) => ({
  id: 'session-1',
  status: 'RATED',
  endedAt: ENDED_AT,
  blocksUsed: 3,
  totalCharged: 36,
  teacher: { id: TEACHER_ID, fullName: 'Dana Katz' },
  question: {
    title: 'Integration by parts — choosing u and dv',
    topic: { id: 41, nameEn: 'Calculus — Integrals', nameHe: 'חדו"א — אינטגרלים' },
    subtopic: { id: 45, nameEn: 'Integration by parts', nameHe: 'אינטגרציה בחלקים' },
  },
  review: { stars: 5, isResolved: true },
  ...over,
});

/** The two reads, recording what they were asked for. */
function deps({ sessions, total, unrated = 0 } = {}) {
  const rows = sessions ?? [sessionRow()];
  const calls = [];

  return {
    calls,
    loadSessions: async (args) => {
      calls.push(['loadSessions', args]);

      return { sessions: rows, total: total ?? rows.length };
    },
    countUnrated: async (studentId) => {
      calls.push(['countUnrated', studentId]);

      return unrated;
    },
  };
}

const query = (over = {}) => ({
  studentId: STUDENT_ID,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  ...over,
});

describe('an unrated session is not an unstarred one', () => {
  it('keeps review null for a session the student closed the tab on', () => {
    // The row this screen exists to rescue. `ENDED` with no `reviews` row means §10's
    // only edge out of `ENDED` was never taken, and nothing else in the product could
    // reach that session again.
    const view = toSessionHistoryRecord(sessionRow({ status: 'ENDED', review: null }));

    assert.equal(view.review, null);
    assert.equal(view.status, 'ENDED');
  });

  it('keeps stars null on a review that was given without them', () => {
    // §6.2 makes `isResolved` the only required field, so this is the common rating
    // rather than the edge — and it is a *rated* session, terminal, with nothing owed.
    const view = toSessionHistoryRecord(sessionRow({ review: { stars: null, isResolved: false } }));

    assert.notEqual(view.review, null);
    assert.equal(view.review.stars, null);
    assert.equal(view.review.isResolved, false);
  });

  it('never coerces stars to zero, which would be the harshest rating a student can give', () => {
    const view = toSessionHistoryRecord(sessionRow({ review: { stars: null, isResolved: true } }));

    assert.notEqual(view.review.stars, 0);
  });

  it('keeps a one-star review, which a truthiness check would drop', () => {
    const view = toSessionHistoryRecord(sessionRow({ review: { stars: 1, isResolved: false } }));

    assert.equal(view.review.stars, 1);
  });
});

describe('the row a student reads', () => {
  it('carries exactly the fields SessionHistoryRecord declares', () => {
    assert.deepEqual(Object.keys(toSessionHistoryRecord(sessionRow())).sort(), [
      'blocksUsed',
      'endedAt',
      'questionTitle',
      'review',
      'sessionId',
      'status',
      'teacher',
      'topicLabel',
      'totalCharged',
    ]);
  });

  it('computes no minutes and carries none', () => {
    // Minutes are `blocksUsed × block.minutes` and `client/src/lib/credits.js` owns that
    // translation, from the `block.minutes` on `GET /public/pricing`. A server-computed
    // figure here would be a second rounding of a number the client already renders.
    const serialized = JSON.stringify(toSessionHistoryRecord(sessionRow()));

    assert.equal(/minutes/i.test(serialized), false);
  });

  it('carries none of the teacher’s side of the money', () => {
    // `teacher_earning` and `platform_fee` are on the same row in the database and they
    // belong to `GET /wallet/earnings` (7.6). A student's receipt says what the student
    // paid, and the repository does not select either column.
    const view = toSessionHistoryRecord(
      sessionRow({ teacherEarning: 30, platformFee: 6, pricePerBlock: 12 }),
    );

    assert.equal('teacherEarning' in view, false);
    assert.equal('platformFee' in view, false);
    assert.equal(view.totalCharged, 36);
  });

  it('reads totalCharged off the column rather than from blocks and a price', () => {
    // Not `blocksUsed × pricePerBlock`. `reconcile.mjs` invariant 2 already checks the
    // column agrees with `session_blocks`, and a third computation of one number is 7.9's
    // shape — one rule, three call sites, two of them wrong.
    const view = toSessionHistoryRecord(
      sessionRow({ blocksUsed: 3, totalCharged: 24, pricePerBlock: 12 }),
    );

    assert.equal(view.totalCharged, 24);
  });

  it('leaves endedAt as an ISO 8601 string in UTC, never a Date', () => {
    assert.equal(toSessionHistoryRecord(sessionRow()).endedAt, '2026-08-21T18:30:00.000Z');
  });

  it('answers endedAt null for a session that never ran', () => {
    // `CANCELLED` has no inbound edge in §10 and nothing writes it today, but it is in
    // the enum and in the contract, and a row with no `ended_at` must not become an
    // "Invalid Date" on the screen.
    const view = toSessionHistoryRecord(sessionRow({ status: 'CANCELLED', endedAt: null }));

    assert.equal(view.endedAt, null);
  });

  it('answers a NO_SHOW row with zero charged and no review', () => {
    const view = toSessionHistoryRecord(
      sessionRow({ status: 'NO_SHOW', totalCharged: 0, blocksUsed: 1, review: null }),
    );

    assert.equal(view.totalCharged, 0);
    assert.equal(view.review, null);
  });

  it('names the teacher, because a history entry without a name is a receipt', () => {
    assert.deepEqual(toSessionHistoryRecord(sessionRow()).teacher, {
      id: TEACHER_ID,
      fullName: 'Dana Katz',
    });
  });

  it('degrades a missing teacher rather than throwing on one row of a list', () => {
    // `onDelete: Restrict` means it cannot happen; a 500 in its place would blank the
    // whole history over a row nobody can delete.
    const view = toSessionHistoryRecord(sessionRow({ teacher: null }));

    assert.deepEqual(view.teacher, { id: '', fullName: '' });
  });

  it('carries the question’s own title, and null when it has none', () => {
    assert.equal(
      toSessionHistoryRecord(sessionRow()).questionTitle,
      'Integration by parts — choosing u and dv',
    );

    assert.equal(toSessionHistoryRecord(sessionRow({ question: null })).questionTitle, null);
  });
});

describe('the topic label', () => {
  it('prefers the subtopic — the more specific true thing', () => {
    assert.equal(toSessionHistoryRecord(sessionRow()).topicLabel, 'Integration by parts');
  });

  it('falls back to the parent topic when the question has no subtopic', () => {
    const row = sessionRow({
      question: {
        title: 'A question',
        topic: { id: 41, nameEn: 'Calculus — Integrals', nameHe: 'חדו"א — אינטגרלים' },
        subtopic: null,
      },
    });

    assert.equal(toSessionHistoryRecord(row).topicLabel, 'Calculus — Integrals');
  });

  it('prefers the English name, which is the rule on both sides of the wire', () => {
    const row = sessionRow({
      question: {
        title: 'A question',
        topic: null,
        subtopic: { id: 45, nameEn: 'Integration by parts', nameHe: 'אינטגרציה בחלקים' },
      },
    });

    assert.equal(toSessionHistoryRecord(row).topicLabel, 'Integration by parts');
  });

  it('falls back to Hebrew for a taxonomy row seeded without an English name', () => {
    const row = sessionRow({
      question: {
        title: 'A question',
        topic: null,
        subtopic: { id: 45, nameEn: '', nameHe: 'אינטגרציה בחלקים' },
      },
    });

    assert.equal(toSessionHistoryRecord(row).topicLabel, 'אינטגרציה בחלקים');
  });

  it('answers null for the sentinel topic, which is a real row with a real name', () => {
    // `topics` id 0 is seeded as "General / Unclassified" (§8.1's fallback), so a plain
    // name chain would put that on a chip for every question the classifier could not
    // place. The guard is on the id because the id is `0` and falsy, and `if (topic.id)`
    // reads as correct. `toTeacherReview` excludes it the same way and for the same
    // reason — the two copies name each other.
    const row = sessionRow({
      question: {
        title: 'A question',
        topic: {
          id: UNCLASSIFIED_TOPIC_ID,
          nameEn: 'General / Unclassified',
          nameHe: 'כללי / לא מסווג',
        },
        subtopic: null,
      },
    });

    assert.equal(toSessionHistoryRecord(row).topicLabel, null);
  });

  it('answers null for a row whose question has gone', () => {
    assert.equal(toSessionHistoryRecord(sessionRow({ question: null })).topicLabel, null);
    assert.equal(toSessionHistoryRecord(sessionRow({ question: {} })).topicLabel, null);
  });
});

describe('the unrated count', () => {
  it('comes from its own query rather than from the page', async () => {
    const collaborators = deps({ sessions: [sessionRow()], total: 47, unrated: 6 });

    const result = await getStudentSessionHistory(query({ pageSize: 1 }), collaborators);

    // The client holds one page and the badge is about the whole set. Derived from the
    // page it would read 1 until the student paged and then read 2, which is a badge
    // nobody would trust again.
    assert.equal(result.unratedCount, 6);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.total, 47);
  });

  it('asks for it with the caller’s own id and nothing else', async () => {
    const collaborators = deps();

    await getStudentSessionHistory(query(), collaborators);

    const [, id] = collaborators.calls.find(([name]) => name === 'countUnrated');

    assert.equal(id, STUDENT_ID);
  });

  it('is zero for a student with nothing owed, not absent', async () => {
    const collaborators = deps({ sessions: [], total: 0, unrated: 0 });

    const result = await getStudentSessionHistory(query(), collaborators);

    assert.deepEqual(result, { sessions: [], total: 0, unratedCount: 0 });
  });
});

describe('paging', () => {
  it('asks for the first page at offset zero', async () => {
    const collaborators = deps();

    await getStudentSessionHistory(query(), collaborators);

    const [, args] = collaborators.calls.find(([name]) => name === 'loadSessions');

    assert.deepEqual(args, { studentId: STUDENT_ID, skip: 0, take: DEFAULT_PAGE_SIZE });
  });

  it('computes the offset as (page - 1) × pageSize', async () => {
    const collaborators = deps();

    await getStudentSessionHistory(query({ page: 3, pageSize: 5 }), collaborators);

    const [, args] = collaborators.calls.find(([name]) => name === 'loadSessions');

    // `page × pageSize` returns page 4 to somebody who asked for page 3, and every
    // seeded student's whole history fits on page 1, so nothing else would notice.
    assert.equal(args.skip, 10);
    assert.equal(args.take, 5);
  });

  it('reports the unpaged total rather than the length of the page', async () => {
    const collaborators = deps({ sessions: [sessionRow()], total: 47 });

    const result = await getStudentSessionHistory(query({ pageSize: 1 }), collaborators);

    assert.equal(result.total, 47);
  });

  it('answers an empty history as an empty list, not as a 404', async () => {
    const collaborators = deps({ sessions: [], total: 0 });

    const result = await getStudentSessionHistory(query(), collaborators);

    // A student who has run nothing is a student, and the screen renders an empty state.
    // Every seeded student is in exactly this position: the seed writes two `PENDING`
    // sessions and no finished ones.
    assert.deepEqual(result.sessions, []);
  });
});

describe('whose sessions they are', () => {
  it('filters both reads by the caller’s own id', async () => {
    const collaborators = deps();

    await getStudentSessionHistory(query(), collaborators);

    // There is no id in the path — the student is the token — so this is not a check
    // that refuses another student's rows, it is the reason they are never selected.
    for (const [, args] of collaborators.calls) {
      assert.equal(typeof args === 'string' ? args : args.studentId, STUDENT_ID);
    }
  });
});

describe('sessionHistorySchema', () => {
  const parse = (query = {}) => sessionHistorySchema.parse({ body: {}, params: {}, query }).query;

  const rejects = (query = {}, params = {}) =>
    sessionHistorySchema.safeParse({ body: {}, params, query }).success === false;

  it('defaults the paging so the service never branches on “did they say”', () => {
    assert.deepEqual(parse(), { page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('coerces the query string, which has no types of its own', () => {
    assert.deepEqual(parse({ page: '2', pageSize: '5' }), { page: 2, pageSize: 5 });
  });

  it('caps an over-eager pageSize rather than rejecting it', () => {
    assert.equal(parse({ pageSize: '1000' }).pageSize, MAX_PAGE_SIZE);
  });

  it('rejects page 0, which is a request for a page that does not exist', () => {
    assert.equal(rejects({ page: '0' }), true);
  });

  it('rejects an invented filter rather than ignoring it', () => {
    // A dropped filter is worse than a rejected one — it looks like the data is wrong.
    assert.equal(rejects({ status: 'ENDED' }), true);
  });

  it('rejects a studentId on the query string', () => {
    // Nobody should be sending one, and a parameter nothing reads is the friendlier
    // failure only until somebody believes it worked.
    assert.equal(rejects({ studentId: TEACHER_ID }), true);
  });

  it('takes no params at all, which is the authorisation decision written down', () => {
    assert.equal(rejects({}, { id: 'session-1' }), true);
  });
});

describe('the route, the repository and the wiring', () => {
  const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

  it('declares GET /mine above GET /:id', async () => {
    // Express walks the stack in order and `/:id` matches one segment, so a `/mine`
    // below it would be validated by `sessionByIdSchema`'s uuid check and answer
    // `400 VALIDATION_ERROR` — a failure that reads like a client bug. This is the one
    // ordering mistake in this PR that produces a confusing error rather than an obvious
    // one, which is why it is asserted rather than reviewed.
    const routes = await read('../src/routes/session.routes.js');

    assert.ok(routes.indexOf("'/mine'") < routes.indexOf("'/:id'"));
  });

  it('gates the route on the student role', async () => {
    const routes = await read('../src/routes/session.routes.js');
    const mine = routes.slice(routes.indexOf("'/mine'"), routes.indexOf("'/:id'"));

    // A teacher's finished sessions are `GET /wallet/earnings` (7.6). Without the gate a
    // teacher's token would get an empty list, which looks like a working screen.
    assert.match(mine, /authorize\('student'\)/);
    assert.match(mine, /authenticate/);
  });

  it('selects neither the teacher’s earning nor the platform fee', async () => {
    const repository = await read('../src/repositories/session.repository.js');
    const page = repository.slice(
      repository.indexOf('export async function findStudentSessionPage'),
    );

    assert.equal(/teacherEarning/.test(page), false);
    assert.equal(/platformFee/.test(page), false);
  });

  it('opens no transaction and takes no tx — this PR writes nothing', async () => {
    const repository = await read('../src/repositories/session.repository.js');
    const page = repository.slice(
      repository.indexOf('export async function findStudentSessionPage'),
    );

    // The two reads are the only functions in that file that take no `tx`. A `tx`
    // parameter here would be a read borrowing somebody else's transaction for a
    // snapshot it does not need.
    assert.equal(/function findStudentSessionPage\([^)]*\},\s*tx/.test(page), false);
    assert.equal(/countUnratedStudentSessions\(studentId, tx\)/.test(page), false);

    const service = await read('../src/services/session.history.service.js');

    assert.equal(/\$transaction|prisma/.test(service), false);
  });
});
