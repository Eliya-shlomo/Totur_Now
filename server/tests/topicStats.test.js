import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * §7's propagation — PR 8.1, MVP.md §7 and §9.3.
 *
 * **The whole rule is four multiplications, and every way it goes wrong is silent.** A
 * parent row written at 1.0 instead of 0.3 makes a generalist outrank a specialist; a
 * `ratingCount` of 1 on an unrated review divides `topicFit` by a confidence nobody
 * gave; a row written for the sentinel topic gives a teacher history in a topic whose
 * meaning is "we do not know", and §9.1 lets that id past the topic filter, so it would
 * then score in every match that teacher is ever a candidate for. None of those turns a
 * suite red anywhere else — every one of them still ranks candidates in a plausible
 * order.
 *
 * So this file is where the rule is pinned, and it is a unit test rather than a
 * database one for the reason `commission.js` and `standing.js` have unit tests: this
 * is the arithmetic somebody will want to change, and a rule that needs Postgres to
 * exercise is a rule nobody re-tests.
 *
 * `PARENT_TOPIC_WEIGHT` is imported here too. A test that typed `0.3` would be the
 * third copy of the number, and E7's 7.9 — §5.3 read from three different dates at
 * three call sites — is what a third copy turns into.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { PARENT_TOPIC_WEIGHT, UNCLASSIFIED_TOPIC_ID } = await import('#config/constants/index.js');
const { topicStatDeltas } = await import('#utils/topicStats.js');

const TOPIC_ID = 9;
const SUBTOPIC_ID = 91;

/** One solved session, five stars — the shape `session.review.service.js` passes. */
const fiveStars = (overrides = {}) => ({
  topicId: TOPIC_ID,
  subtopicId: SUBTOPIC_ID,
  sessionsCount: 1,
  resolvedCount: 1,
  ratingSum: 5,
  ratingCount: 1,
  ...overrides,
});

const byTopic = (rows) => Object.fromEntries(rows.map((row) => [row.topicId, row]));

describe('the leaf and its parent', () => {
  it('writes two rows: the subtopic whole, the topic at PARENT_TOPIC_WEIGHT', () => {
    const rows = topicStatDeltas(fiveStars());

    assert.equal(rows.length, 2);

    const { [SUBTOPIC_ID]: leaf, [TOPIC_ID]: parent } = byTopic(rows);

    assert.deepEqual(leaf, {
      topicId: SUBTOPIC_ID,
      sessionsCount: 1,
      resolvedCount: 1,
      ratingSum: 5,
      ratingCount: 1,
    });

    // Every column discounted, not just the rating. The parent must carry a fraction of
    // the *count* as well as of the sum, or `matching.scoring.js` smooths it as a
    // full-confidence row and a teacher's one subtopic makes them look established
    // across the whole branch.
    assert.deepEqual(parent, {
      topicId: TOPIC_ID,
      sessionsCount: PARENT_TOPIC_WEIGHT,
      resolvedCount: PARENT_TOPIC_WEIGHT,
      ratingSum: 5 * PARENT_TOPIC_WEIGHT,
      ratingCount: PARENT_TOPIC_WEIGHT,
    });
  });

  it('puts the leaf first, so a reader of the array sees the row the teacher earned', () => {
    const [first] = topicStatDeltas(fiveStars());

    assert.equal(first.topicId, SUBTOPIC_ID);
  });

  it('discounts exactly once — the parent is 0.3 of the leaf, column by column', () => {
    const [leaf, parent] = topicStatDeltas(fiveStars({ ratingSum: 4 }));

    for (const column of ['sessionsCount', 'resolvedCount', 'ratingSum', 'ratingCount']) {
      assert.equal(
        parent[column],
        leaf[column] * PARENT_TOPIC_WEIGHT,
        `${column} must be the leaf's, weighted once`,
      );
    }
  });
});

describe('the cases that must not write two rows', () => {
  it('writes nothing for a question on the sentinel topic', () => {
    // §8.1's fallback: `topic_id = 0`, `subtopic_id` null. There is no topical evidence
    // in a question the classifier could not place, and a row here would be history in
    // a topic that means "we do not know" — on a teacher who would then carry it into
    // every match, because §9.1 lets id 0 past the topic filter.
    assert.deepEqual(
      topicStatDeltas(fiveStars({ topicId: UNCLASSIFIED_TOPIC_ID, subtopicId: null })),
      [],
    );
  });

  it('writes nothing when both ids are null — a question whose row has gone', () => {
    assert.deepEqual(topicStatDeltas(fiveStars({ topicId: null, subtopicId: null })), []);
  });

  it('writes one row when the classifier answered the same id twice', () => {
    const rows = topicStatDeltas(fiveStars({ topicId: TOPIC_ID, subtopicId: TOPIC_ID }));

    // 1.3 of a session, on one row, is what the naive version writes.
    assert.equal(rows.length, 1);
    assert.equal(rows[0].topicId, TOPIC_ID);
    assert.equal(rows[0].sessionsCount, 1);
  });

  it('writes one whole row when the leaf arrived without a parent', () => {
    const rows = topicStatDeltas(fiveStars({ topicId: null }));

    // `topics.parent_id` is nullable. The subtopic is still the row the teacher earned
    // and it is not discounted for the absence of somebody to propagate to.
    assert.deepEqual(rows, [
      {
        topicId: SUBTOPIC_ID,
        sessionsCount: 1,
        resolvedCount: 1,
        ratingSum: 5,
        ratingCount: 1,
      },
    ]);
  });

  it('writes one whole row for a question classified only to its parent', () => {
    const rows = topicStatDeltas(fiveStars({ subtopicId: null }));

    assert.equal(rows.length, 1);
    assert.equal(rows[0].topicId, TOPIC_ID);
    assert.equal(rows[0].sessionsCount, 1);
  });

  it('treats the sentinel as a parent that is not there, not as one to propagate to', () => {
    const rows = topicStatDeltas(
      fiveStars({ topicId: UNCLASSIFIED_TOPIC_ID, subtopicId: SUBTOPIC_ID }),
    );

    // A shape the classifier does not produce, asserted because `0` is falsy and the
    // guard that lets it through is the same one that would let `null` through.
    assert.equal(rows.length, 1);
    assert.equal(rows[0].topicId, SUBTOPIC_ID);
  });
});

describe('the review with no stars', () => {
  const unrated = fiveStars({ ratingSum: 0, ratingCount: 0 });

  it('moves the session counts and neither rating column, on both rows', () => {
    const [leaf, parent] = topicStatDeltas(unrated);

    // The defect this rule is one character from: `rating_sum += stars ?? 0` beside an
    // unconditional `rating_count += 1` turns every unrated review into a zero-star one.
    // At profile level that drags an average down; here it also divides `topicFit`,
    // which carries 0.35 of the score.
    assert.equal(leaf.ratingSum, 0);
    assert.equal(leaf.ratingCount, 0);
    assert.equal(parent.ratingSum, 0);
    assert.equal(parent.ratingCount, 0);

    assert.equal(leaf.sessionsCount, 1);
    assert.equal(parent.sessionsCount, PARENT_TOPIC_WEIGHT);
  });

  it('moves resolved_count on neither row when the student said it was not solved', () => {
    const [leaf, parent] = topicStatDeltas(fiveStars({ resolvedCount: 0 }));

    assert.equal(leaf.resolvedCount, 0);
    assert.equal(parent.resolvedCount, 0);

    // §6.2's KPI is "did this get answered" and a rating is a different question. The
    // session still happened.
    assert.equal(leaf.sessionsCount, 1);
    assert.equal(leaf.ratingCount, 1);
  });
});

const source = await readFile(
  fileURLToPath(new URL('../src/utils/topicStats.js', import.meta.url)),
  'utf8',
);

describe('purity — the property that makes this rule cheap to re-test', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('imports the weight rather than writing it', () => {
    // The brief's own grep. The seed has the second copy and cannot import this one;
    // a third is what §5.3 turned into before 7.9.
    assert.equal(/0\.3/.test(code), false);
    assert.match(code, /PARENT_TOPIC_WEIGHT/);
  });

  it('names the sentinel rather than testing for a falsy id', () => {
    assert.match(code, /UNCLASSIFIED_TOPIC_ID/);
  });

  it('reaches no database, no clock and no request', () => {
    assert.equal(/prisma|tx\.|Date|req\b/.test(code), false);
  });

  it('does not round — the NUMERIC(8,2) column is what rounds', () => {
    // `0.3 × 3` is `0.8999999999999999` in IEEE 754 and Postgres stores `0.90`.
    // Rounding here would be a second rounding of a number the column already rounds.
    assert.equal(/toFixed|Math\.round/.test(code), false);
  });
});
