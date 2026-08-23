import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * `GET /teachers/me/stats` — PR 8.5, MVP.md §12's "Per-topic ratings" row.
 *
 * **The property this file exists for is that a fraction survives the whole path.** A
 * parent topic accumulates at `PARENT_TOPIC_WEIGHT`, so 42 leaf sessions is 12.6 parent
 * ones and 5 stars on a leaf is 1.5 rating-sum on its parent. Every layer between the
 * column and the screen is a place that fraction can be rounded away or coerced into a
 * string, and each of those is invisible in a browser — `12.6` and `13` both look like a
 * working screen, and only one of them agrees with the number `matching.scoring.js` ranks
 * the teacher on. That agreement is the entire reason the endpoint exists.
 *
 * So three things are asserted separately and none of them is the same assertion twice:
 *
 * **The record is JSON-safe.** `teacher_topic_stats` is four `NUMERIC(8,2)` columns and
 * Prisma hands those over as `Decimal`, which `res.json` renders as
 * `{"s":1,"e":0,"d":[…]}` — a number-shaped hole in the contract that no type checker on
 * this codebase would catch. The round-trip below has teeth, and the last case in that
 * block is what proves it does.
 *
 * **`rating` is `null` at zero and a real average at a fraction.** `null` and `0` are
 * different claims — "not rated yet" against "rated badly" — and the fractional case is
 * the one a parent row actually hits: `1.5 / 0.3` is `5`, which is the stars the student
 * gave, propagated and then divided back out.
 *
 * **`isLeaf` is `parent_id IS NULL` inverted**, because the screen groups on it and a
 * flat list that cannot tell a taught topic from a propagated one shows "Calculus: 12.6
 * sessions" beside the 42 sessions it was derived from.
 *
 * What is **not** here is the `Decimal` → `number` conversion itself. It lives in
 * `findTeacherTopicStats`, which is one `prisma` call and a `map`, and reaching it means
 * a database; the round-trip assertions below are written against that function's stated
 * contract, and step 3 of the PR brief's manual test is what checks the contract holds.
 *
 * The one read arrives through the second argument (3.3's idiom), so the whole file runs
 * with no database.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { PARENT_TOPIC_WEIGHT } = await import('#config/constants/index.js');
const { getMyTopicStats } = await import('#services/teacher.me.service.js');
const { toTopicStatRecord } = await import('#utils/teacherView.js');
const { teacherStatsSchema } = await import('#validators/teacher.me.schema.js');

const TEACHER_ID = '44444444-4444-4444-8444-444444444444';

/**
 * The leaf a teacher actually taught, as `findTeacherTopicStats` hands it over — four
 * `number`s and the topic, `parentId` included for `isLeaf`.
 */
const leafRow = (over = {}) => ({
  topic: {
    id: 45,
    slug: 'integration-by-parts',
    nameHe: 'אינטגרציה בחלקים',
    nameEn: 'Integration by parts',
    parentId: 41,
  },
  ratingSum: 200,
  ratingCount: 42,
  resolvedCount: 40,
  sessionsCount: 42,
  ...over,
});

/**
 * The parent of that leaf, holding exactly what §9.3 propagates to it: the same figures
 * at `PARENT_TOPIC_WEIGHT`, which is where every fraction in this file comes from.
 */
const parentRow = (over = {}) => ({
  topic: {
    id: 41,
    slug: 'calculus-integrals',
    nameHe: 'חדו"א — אינטגרלים',
    nameEn: 'Calculus — Integrals',
    parentId: null,
  },
  ratingSum: 200 * PARENT_TOPIC_WEIGHT,
  ratingCount: 42 * PARENT_TOPIC_WEIGHT,
  resolvedCount: 40 * PARENT_TOPIC_WEIGHT,
  sessionsCount: 42 * PARENT_TOPIC_WEIGHT,
  ...over,
});

/** The one read, recording the id it was asked for. */
function deps(rows = [leafRow(), parentRow()]) {
  const calls = [];

  return {
    calls,
    loadStats: async (teacherId) => {
      calls.push(teacherId);

      return rows;
    },
  };
}

describe('toTopicStatRecord — the shape a teacher reads their own numbers off', () => {
  it('carries the stored fraction rather than a rounded one', () => {
    const record = toTopicStatRecord(parentRow());

    // 42 × 0.3. The screen may round this; the endpoint may not, or the teacher's own
    // figures stop agreeing with the ones the matching engine ranks them on.
    assert.equal(record.sessionsCount, 12.6);
    assert.equal(record.resolvedCount, 12);
  });

  it('is JSON-safe — every numeric field survives the wire as a number', () => {
    const record = toTopicStatRecord(leafRow());

    assert.deepEqual(JSON.parse(JSON.stringify(record)), record);

    for (const field of ['sessionsCount', 'resolvedCount', 'rating', 'ratingCount']) {
      assert.equal(typeof record[field], 'number', `${field} must be a number`);
    }
  });

  it('has teeth: a Decimal that reached this layer would not survive that round-trip', () => {
    // What `Prisma.Decimal` does to a response, in the smallest object that does it.
    // The conversion is `findTeacherTopicStats`'s job and this is the failure it
    // prevents — asserted here so that the round-trip above is not a test of nothing.
    const decimalLike = { s: 1, e: 1, d: [12, 6], toJSON: undefined };
    const record = toTopicStatRecord(leafRow({ sessionsCount: decimalLike }));

    assert.notEqual(typeof record.sessionsCount, 'number');
  });

  it('reports a parent as not a leaf, and the topic under it as one', () => {
    assert.equal(toTopicStatRecord(parentRow()).isLeaf, false);
    assert.equal(toTopicStatRecord(leafRow()).isLeaf, true);
  });

  it('answers null for an unrated topic, never 0', () => {
    const record = toTopicStatRecord(leafRow({ ratingSum: 0, ratingCount: 0, sessionsCount: 3 }));

    // Taught three times and rated none of them. `0` would read as three one-star
    // sessions — `TeacherCard` states the same rule and `ratingOf` is the same function.
    assert.equal(record.rating, null);
    assert.equal(record.ratingCount, 0);
    assert.equal(record.sessionsCount, 3);
  });

  it('divides a propagated fraction back into the stars the student gave', () => {
    const record = toTopicStatRecord(
      parentRow({ ratingSum: 5 * PARENT_TOPIC_WEIGHT, ratingCount: PARENT_TOPIC_WEIGHT }),
    );

    // One 5-star review on a leaf, seen from its parent: 1.5 ÷ 0.3. The weight cancels,
    // which is why `matching.scoring.js` may read this row without knowing about it.
    assert.equal(record.rating, 5);
  });

  it('carries the topic name pair and no rating sum', () => {
    const record = toTopicStatRecord(leafRow());

    assert.deepEqual(
      Object.keys(record).sort(),
      [
        'isLeaf',
        'nameEn',
        'nameHe',
        'ratingCount',
        'rating',
        'resolvedCount',
        'sessionsCount',
        'slug',
        'topicId',
      ].sort(),
    );

    assert.equal(record.topicId, 45);
    assert.equal(record.nameEn, 'Integration by parts');
    assert.equal(record.nameHe, 'אינטגרציה בחלקים');
  });
});

describe('getMyTopicStats — the read behind the dashboard block', () => {
  it('reads the teacher off the token and returns one record per row', async () => {
    const { calls, loadStats } = deps();

    const response = await getMyTopicStats(TEACHER_ID, { loadStats });

    assert.deepEqual(calls, [TEACHER_ID]);
    assert.equal(response.topics.length, 2);
  });

  it('keeps the repository order and does not re-sort', async () => {
    // `sessionsCount` descending is the query's `ORDER BY`. A service that sorted again
    // would be a second ordering rule, free to disagree with the SQL the day one of
    // them changes — and the parent row here sorts below its leaf either way, which is
    // exactly why a re-sort would go unnoticed.
    const { loadStats } = deps([leafRow(), parentRow()]);

    const { topics } = await getMyTopicStats(TEACHER_ID, { loadStats });

    assert.deepEqual(
      topics.map((topic) => topic.topicId),
      [45, 41],
    );
    assert.ok(topics[0].sessionsCount > topics[1].sessionsCount);
  });

  it('answers an empty list for a teacher nobody has rated', async () => {
    const { loadStats } = deps([]);

    // Not a 404. Every teacher looks like this on the day they join, and an empty state
    // is a screen — an error is a bug report.
    assert.deepEqual(await getMyTopicStats(TEACHER_ID, { loadStats }), { topics: [] });
  });
});

describe('teacherStatsSchema — no input, and it says so', () => {
  const request = (over = {}) => ({ body: {}, params: {}, query: {}, ...over });

  it('accepts a request that carries nothing', () => {
    assert.equal(teacherStatsSchema.safeParse(request()).success, true);
  });

  it('rejects a query string, because the response is not paged', () => {
    // A client that thinks it is paging is a client reading a truncated breakdown
    // without knowing. `.strict()` is what says so out loud.
    assert.equal(teacherStatsSchema.safeParse(request({ query: { page: '2' } })).success, false);
  });

  it('rejects a body and a path parameter', () => {
    assert.equal(teacherStatsSchema.safeParse(request({ body: { id: 'x' } })).success, false);
    assert.equal(teacherStatsSchema.safeParse(request({ params: { id: 'x' } })).success, false);
  });
});
