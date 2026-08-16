import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MATH_LEVELS, UNCLASSIFIED_TOPIC_ID } from '#config/constants/index.js';

/**
 * `GET /questions/:id` and `PATCH /questions/:id/classification` — the read, the
 * override and the three refusals in front of it. PR 3.5, MVP.md §12 and §8.1.
 *
 * **Nothing here touches a database or a model.** The three collaborators — the
 * find-by-id, the classification update and the taxonomy read — arrive through each
 * service function's second argument, the idiom `classification.service.js`
 * established in 3.3. That is what lets this file assert the properties the brief
 * actually names: that `classification_ok` is not among the written columns, that a
 * stranger's question is refused before any write is attempted, and that an id the
 * taxonomy does not have never reaches Postgres to become a foreign-key 500.
 *
 * The row-level criteria — the columns actually moving, the query count under
 * `DEBUG=prisma:query` — are the manual test's, against the local database. They are
 * properties of the frozen repository, and a stub asserting them would be asserting
 * itself.
 *
 * Every bound comes from `#config/constants/`, so no test can pass by agreeing with a
 * copy of a number somebody has since changed.
 */

// The service imports `config/env.js` transitively, which validates the environment at
// import time and calls `process.exit(1)` on a missing `DATABASE_URL`. Filling the
// required variables before the dynamic imports keeps `npm test` runnable on a machine
// with no `.env`. Nothing here is used: every collaborator is injected.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { getStudentQuestion, overrideQuestionClassification } =
  await import('#services/question.classify.service.js');
const { classificationOverrideSchema, questionByIdSchema } =
  await import('#validators/question.classify.schema.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_STUDENT_ID = '99999999-9999-4999-8999-999999999999';
const QUESTION_ID = '22222222-2222-4222-8222-222222222222';

const RAW_TEXT = 'נתקעתי באינטגרל של x·ln(x)';

/** A parent with two leaves, plus the seeded sentinel — the shape `getTopicTree` returns. */
const TOPIC_TREE = [
  { id: UNCLASSIFIED_TOPIC_ID, slug: 'general-unclassified', children: [] },
  {
    id: 9,
    slug: 'calculus',
    children: [
      { id: 91, slug: 'integrals' },
      { id: 92, slug: 'derivatives' },
    ],
  },
  { id: 4, slug: 'algebra', children: [{ id: 41, slug: 'inequalities' }] },
];

/** A row as `QUESTION_VIEW` shapes it — what both repository reads resolve with. */
function row(overrides = {}) {
  return {
    id: QUESTION_ID,
    studentId: STUDENT_ID,
    rawText: RAW_TEXT,
    declaredLevel: 5,
    title: 'אינטגרציה בחלקים',
    topicId: 9,
    subtopicId: 91,
    difficulty: 3,
    estimatedLevel: 5,
    teacherBrief: 'התלמיד צריך אינטגרציה בחלקים.',
    studentConfirmation: 'נפתור יחד באינטגרציה בחלקים?',
    llmConfidence: 0.91,
    classificationOk: true,
    createdAt: new Date('2026-08-16T09:00:00Z'),
    attachments: [{ id: 'a-1', fileUrl: 'https://cdn/a.jpg', mimeType: 'image/jpeg' }],
    session: { id: 'session-1', status: 'PENDING' },
    ...overrides,
  };
}

/**
 * Every dependency, always, plus what the update was asked to write.
 *
 * Overriding one leaves the rest injected rather than real — a test that forgot
 * `loadTaxonomy` would reach the real repository and fail on a missing database.
 */
function harness(overrides = {}) {
  const calls = [];
  let written = null;

  const deps = {
    findById: async (id) => {
      calls.push('findById');
      return row({ id });
    },
    updateClassification: async (id, columns) => {
      calls.push('updateClassification');
      written = columns;
      return row({ ...columns, id });
    },
    loadTaxonomy: async () => {
      calls.push('loadTaxonomy');
      return TOPIC_TREE;
    },
    ...overrides,
  };

  return { calls, deps, written: () => written };
}

/** Override with the harness's stubs, and hand back the response, the log and the write. */
async function override(overrides = {}, body = {}) {
  const harnessed = harness(overrides);
  const response = await overrideQuestionClassification(
    {
      questionId: QUESTION_ID,
      studentId: STUDENT_ID,
      topicId: 9,
      subtopicId: 91,
      ...body,
    },
    harnessed.deps,
  );

  return { response, calls: harnessed.calls, written: harnessed.written() };
}

describe('questionByIdSchema', () => {
  const parse = (params) => questionByIdSchema.safeParse({ body: {}, params, query: {} });

  it('accepts a uuid', () => {
    assert.equal(parse({ id: QUESTION_ID }).success, true);
  });

  it('rejects a malformed id here rather than letting Postgres raise 22P02', () => {
    assert.equal(parse({ id: 'not-a-uuid' }).success, false);
  });
});

describe('classificationOverrideSchema', () => {
  const parse = (body) =>
    classificationOverrideSchema.safeParse({ body, params: { id: QUESTION_ID }, query: {} });

  it('accepts a leaf with its parent', () => {
    assert.equal(parse({ topicId: 9, subtopicId: 91 }).success, true);
  });

  it('accepts the sentinel with a null subtopic — "none of these" is an answer', () => {
    assert.equal(parse({ topicId: UNCLASSIFIED_TOPIC_ID, subtopicId: null }).success, true);
  });

  it('normalises subtopicId 0 to null, the second spelling api.d.ts documents', () => {
    const parsed = parse({ topicId: UNCLASSIFIED_TOPIC_ID, subtopicId: UNCLASSIFIED_TOPIC_ID });

    assert.equal(parsed.success, true);
    assert.equal(parsed.data.body.subtopicId, null);
  });

  it('requires both ids — an empty body is not an update that writes nothing', () => {
    assert.equal(parse({}).success, false);
    assert.equal(parse({ topicId: 9 }).success, false);
    assert.equal(parse({ subtopicId: 91 }).success, false);
  });

  it('accepts every level in the set and rejects one outside it', () => {
    for (const level of MATH_LEVELS) {
      assert.equal(parse({ topicId: 9, subtopicId: 91, estimatedLevel: level }).success, true);
    }

    assert.equal(parse({ topicId: 9, subtopicId: 91, estimatedLevel: 6 }).success, false);
  });

  it('rejects a non-integer id and a negative one', () => {
    assert.equal(parse({ topicId: 9.5, subtopicId: 91 }).success, false);
    assert.equal(parse({ topicId: -1, subtopicId: 91 }).success, false);
  });

  it('rejects an unknown key rather than ignoring it', () => {
    assert.equal(parse({ topicId: 9, subtopicId: 91, classificationOk: false }).success, false);
  });
});

describe('getStudentQuestion', () => {
  it('answers the full QuestionResponse for its owner', async () => {
    const { deps } = harness();
    const response = await getStudentQuestion(
      { questionId: QUESTION_ID, studentId: STUDENT_ID },
      deps,
    );

    assert.equal(response.id, QUESTION_ID);
    assert.equal(response.rawText, RAW_TEXT);
    assert.equal(response.sessionId, 'session-1');
    assert.equal(response.classification.subtopicId, 91);
    assert.equal(response.classification.classificationOk, true);
    assert.equal(response.attachments.length, 1);
  });

  it('never serializes studentId — the ownership column stays behind the check', async () => {
    const { deps } = harness();
    const response = await getStudentQuestion(
      { questionId: QUESTION_ID, studentId: STUDENT_ID },
      deps,
    );

    assert.equal('studentId' in response, false);
  });

  it('answers NOT_FOUND for another student rather than FORBIDDEN', async () => {
    const { deps } = harness();

    await assert.rejects(
      getStudentQuestion({ questionId: QUESTION_ID, studentId: OTHER_STUDENT_ID }, deps),
      { code: 'NOT_FOUND' },
    );
  });

  it('answers NOT_FOUND for a question that does not exist', async () => {
    const { deps } = harness({ findById: async () => null });

    await assert.rejects(
      getStudentQuestion({ questionId: QUESTION_ID, studentId: STUDENT_ID }, deps),
      {
        code: 'NOT_FOUND',
      },
    );
  });

  it('reads a question whose session has moved on — only PATCH is refused', async () => {
    const { deps } = harness({
      findById: async () => row({ session: { id: 's', status: 'ACTIVE' } }),
    });
    const response = await getStudentQuestion(
      { questionId: QUESTION_ID, studentId: STUDENT_ID },
      deps,
    );

    assert.equal(response.id, QUESTION_ID);
  });
});

describe('overrideQuestionClassification', () => {
  it('writes both ids together, never the leaf alone', async () => {
    const { written } = await override({}, { topicId: 4, subtopicId: 41 });

    assert.equal(written.topicId, 4);
    assert.equal(written.subtopicId, 41);
  });

  it('leaves classificationOk out of the written columns', async () => {
    const { written, response } = await override();

    assert.equal('classificationOk' in written, false);
    // The column the row already carried, unchanged — the machine still got it wrong.
    assert.equal(response.classification.classificationOk, true);
  });

  it('writes estimatedLevel only when the student sent one', async () => {
    const untouched = await override();
    const changed = await override({}, { estimatedLevel: 4 });

    assert.equal('estimatedLevel' in untouched.written, false);
    assert.equal(changed.written.estimatedLevel, 4);
  });

  it('accepts the sentinel with a null subtopic without reading the taxonomy', async () => {
    const { calls, written } = await override(
      {},
      { topicId: UNCLASSIFIED_TOPIC_ID, subtopicId: null },
    );

    assert.equal(written.topicId, UNCLASSIFIED_TOPIC_ID);
    assert.equal(written.subtopicId, null);
    assert.equal(calls.includes('loadTaxonomy'), false);
  });

  it('accepts a parent with a null subtopic — §9.2 scores that at 0.3, not at nothing', async () => {
    const { written } = await override({}, { topicId: 9, subtopicId: null });

    assert.equal(written.topicId, 9);
    assert.equal(written.subtopicId, null);
  });

  it('answers with the updated QuestionResponse', async () => {
    const { response } = await override({}, { topicId: 4, subtopicId: 41 });

    assert.equal(response.classification.topicId, 4);
    assert.equal(response.classification.subtopicId, 41);
    assert.equal(response.id, QUESTION_ID);
  });
});

describe('the refusals in front of the write', () => {
  /** Nothing may reach the update once a refusal fires. */
  const assertNoWrite = (calls) => assert.equal(calls.includes('updateClassification'), false);

  it('refuses another student with NOT_FOUND and writes nothing', async () => {
    const harnessed = harness();

    await assert.rejects(
      overrideQuestionClassification(
        { questionId: QUESTION_ID, studentId: OTHER_STUDENT_ID, topicId: 9, subtopicId: 91 },
        harnessed.deps,
      ),
      { code: 'NOT_FOUND' },
    );

    assertNoWrite(harnessed.calls);
  });

  it('refuses a question whose session is no longer PENDING with SESSION_NOT_ACTIVE', async () => {
    const harnessed = harness({
      findById: async () => row({ session: { id: 's', status: 'OFFER_SENT' } }),
    });

    await assert.rejects(
      overrideQuestionClassification(
        { questionId: QUESTION_ID, studentId: STUDENT_ID, topicId: 9, subtopicId: 91 },
        harnessed.deps,
      ),
      { code: 'SESSION_NOT_ACTIVE' },
    );

    assertNoWrite(harnessed.calls);
  });

  it('checks ownership before state — a stranger learns nothing about the session', async () => {
    const harnessed = harness({
      findById: async () => row({ session: { id: 's', status: 'ACTIVE' } }),
    });

    await assert.rejects(
      overrideQuestionClassification(
        { questionId: QUESTION_ID, studentId: OTHER_STUDENT_ID, topicId: 9, subtopicId: 91 },
        harnessed.deps,
      ),
      { code: 'NOT_FOUND' },
    );
  });

  it('refuses a subtopic id no row has, rather than letting it become a foreign-key 500', async () => {
    const harnessed = harness();

    await assert.rejects(
      overrideQuestionClassification(
        { questionId: QUESTION_ID, studentId: STUDENT_ID, topicId: 9, subtopicId: 9999 },
        harnessed.deps,
      ),
      { code: 'VALIDATION_ERROR' },
    );

    assertNoWrite(harnessed.calls);
  });

  it('refuses a topic id no row has', async () => {
    const harnessed = harness();

    await assert.rejects(
      overrideQuestionClassification(
        { questionId: QUESTION_ID, studentId: STUDENT_ID, topicId: 8888, subtopicId: null },
        harnessed.deps,
      ),
      { code: 'VALIDATION_ERROR' },
    );

    assertNoWrite(harnessed.calls);
  });

  it('refuses a parent id sent as the subtopic — a parent is not a leaf', async () => {
    const harnessed = harness();

    await assert.rejects(
      overrideQuestionClassification(
        { questionId: QUESTION_ID, studentId: STUDENT_ID, topicId: 9, subtopicId: 4 },
        harnessed.deps,
      ),
      { code: 'VALIDATION_ERROR' },
    );

    assertNoWrite(harnessed.calls);
  });

  it('refuses a real leaf under the wrong parent', async () => {
    const harnessed = harness();

    await assert.rejects(
      overrideQuestionClassification(
        // 41 is algebra's, not calculus's.
        { questionId: QUESTION_ID, studentId: STUDENT_ID, topicId: 9, subtopicId: 41 },
        harnessed.deps,
      ),
      { code: 'VALIDATION_ERROR' },
    );

    assertNoWrite(harnessed.calls);
  });

  it('refuses the sentinel carrying a leaf — it has no children to carry', async () => {
    const harnessed = harness();

    await assert.rejects(
      overrideQuestionClassification(
        {
          questionId: QUESTION_ID,
          studentId: STUDENT_ID,
          topicId: UNCLASSIFIED_TOPIC_ID,
          subtopicId: 91,
        },
        harnessed.deps,
      ),
      { code: 'VALIDATION_ERROR' },
    );

    assertNoWrite(harnessed.calls);
  });
});
