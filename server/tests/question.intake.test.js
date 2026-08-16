import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MATH_LEVELS,
  MAX_ATTACHMENTS,
  RAW_TEXT_MAX_LENGTH,
  RAW_TEXT_MIN_LENGTH,
  UNCLASSIFIED_TOPIC_ID,
} from '#config/constants/index.js';

/**
 * `POST /questions` — the create flow and the ownership rule. PR 3.4, MVP.md §12.
 *
 * **Nothing here touches a database.** The four collaborators — the bindable-ids
 * lookup, the transaction, DEV-B's classifier and the classification update — arrive
 * through `createAndClassifyQuestion`'s second argument, the same idiom
 * `classification.service.js` established in 3.3. That is what makes this file able to
 * assert the thing the epic actually cares about: that the transaction has *closed*
 * before the classifier is awaited. A suite running against real Postgres could
 * observe the result of that ordering but never the ordering itself.
 *
 * The DB-level criteria in the PR brief — the `PENDING` row's columns, `question_id`
 * landing on the attachment rows, `raw_text` surviving a crash between steps 2 and 3 —
 * are the manual test's, against `psql`. They are properties of the frozen repository
 * and of Postgres, and a mock asserting them would only be asserting itself.
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

const { createAndClassifyQuestion } = await import('#services/question.intake.service.js');
const { createQuestionSchema } = await import('#validators/question.intake.schema.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const QUESTION_ID = '22222222-2222-4222-8222-222222222222';
const ATTACHMENT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ATTACHMENT_ID = '44444444-4444-4444-8444-444444444444';

const RAW_TEXT = 'נתקעתי באינטגרל של x·ln(x)';

/** What 3.3 returns when the model answered. Field names are the contract's, not the columns'. */
const CLASSIFIED = {
  title: 'אינטגרציה בחלקים',
  topicId: 9,
  subtopicId: 91,
  difficulty: 3,
  estimatedLevel: 5,
  teacherBrief: 'התלמיד צריך אינטגרציה בחלקים.',
  studentConfirmation: 'נפתור יחד באינטגרציה בחלקים?',
  confidence: 0.91,
  classificationOk: true,
};

/** What 3.3 returns when it fell back. §8.1: `topic_id = 0`, and the student's own text. */
const FELL_BACK = {
  title: null,
  topicId: UNCLASSIFIED_TOPIC_ID,
  subtopicId: null,
  difficulty: null,
  estimatedLevel: null,
  teacherBrief: RAW_TEXT,
  studentConfirmation: RAW_TEXT,
  confidence: 0,
  classificationOk: false,
};

/** A row as `QUESTION_VIEW` shapes it — what both repository writes resolve with. */
function row(overrides = {}) {
  return {
    id: QUESTION_ID,
    rawText: RAW_TEXT,
    declaredLevel: null,
    title: null,
    topicId: null,
    subtopicId: null,
    difficulty: null,
    estimatedLevel: null,
    teacherBrief: null,
    studentConfirmation: null,
    llmConfidence: null,
    classificationOk: false,
    createdAt: new Date('2026-08-16T09:00:00Z'),
    attachments: [],
    session: { id: 'session-1', status: 'PENDING' },
    ...overrides,
  };
}

/**
 * Every dependency, always, plus a shared log of what happened in which order.
 *
 * Overriding one leaves the rest injected rather than real — a test that forgot
 * `createWithSession` would reach the repository and fail on a missing database.
 */
function harness(overrides = {}) {
  const calls = [];

  const deps = {
    findBindable: async (ids) => {
      calls.push('findBindable');
      return ids;
    },
    createWithSession: async (input) => {
      calls.push('createWithSession');
      return row({ declaredLevel: input.declaredLevel ?? null });
    },
    classify: async () => {
      calls.push('classify');
      return CLASSIFIED;
    },
    updateClassification: async (id, columns) => {
      calls.push('updateClassification');
      return row({ ...columns, id });
    },
    ...overrides,
  };

  return { calls, deps };
}

/** Create with the harness's stubs, and hand back both the response and the call log. */
async function create(overrides = {}, input = {}) {
  const { calls, deps } = harness(overrides);
  const response = await createAndClassifyQuestion(
    { studentId: STUDENT_ID, rawText: RAW_TEXT, ...input },
    deps,
  );

  return { response, calls };
}

describe('createQuestionSchema', () => {
  const parse = (body) => createQuestionSchema.safeParse({ body, params: {}, query: {} });

  it('accepts the minimum a student can send', () => {
    assert.equal(parse({ rawText: RAW_TEXT }).success, true);
  });

  it('trims the text before measuring it, so whitespace is not a question', () => {
    const spaces = ' '.repeat(RAW_TEXT_MIN_LENGTH + 5);

    assert.equal(parse({ rawText: spaces }).success, false);
  });

  it('hands the trimmed text on rather than the padded one', () => {
    const parsed = parse({ rawText: `  ${RAW_TEXT}  ` });

    assert.equal(parsed.data.body.rawText, RAW_TEXT);
  });

  it('rejects an empty rawText and one past the ceiling', () => {
    assert.equal(parse({ rawText: '' }).success, false);
    assert.equal(parse({ rawText: 'x'.repeat(RAW_TEXT_MAX_LENGTH + 1) }).success, false);
  });

  it('accepts a rawText exactly on each bound', () => {
    assert.equal(parse({ rawText: 'x'.repeat(RAW_TEXT_MIN_LENGTH) }).success, true);
    assert.equal(parse({ rawText: 'x'.repeat(RAW_TEXT_MAX_LENGTH) }).success, true);
  });

  it('accepts every declared level and rejects one outside the set', () => {
    for (const level of MATH_LEVELS) {
      assert.equal(parse({ rawText: RAW_TEXT, declaredLevel: level }).success, true);
    }

    assert.equal(parse({ rawText: RAW_TEXT, declaredLevel: 2 }).success, false);
  });

  it('treats declaredLevel as optional', () => {
    assert.equal(parse({ rawText: RAW_TEXT }).data.body.declaredLevel, undefined);
  });

  it('rejects an unknown key rather than ignoring it', () => {
    assert.equal(parse({ rawText: RAW_TEXT, nonsense: 1 }).success, false);
  });

  it('caps attachmentIds at MAX_ATTACHMENTS and requires uuids', () => {
    const ids = Array.from({ length: MAX_ATTACHMENTS }, () => ATTACHMENT_ID);

    assert.equal(parse({ rawText: RAW_TEXT, attachmentIds: ids }).success, true);
    assert.equal(
      parse({ rawText: RAW_TEXT, attachmentIds: [...ids, ATTACHMENT_ID] }).success,
      false,
    );
    assert.equal(parse({ rawText: RAW_TEXT, attachmentIds: ['not-a-uuid'] }).success, false);
  });
});

describe('createAndClassifyQuestion', () => {
  it('commits the question before the classifier is awaited', async () => {
    const { calls } = await create();

    assert.ok(
      calls.indexOf('createWithSession') < calls.indexOf('classify'),
      'the transaction must close before the LLM call starts',
    );
  });

  it('runs the four steps in the contract order', async () => {
    const { calls } = await create({}, { attachmentIds: [ATTACHMENT_ID] });

    assert.deepEqual(calls, [
      'findBindable',
      'createWithSession',
      'classify',
      'updateClassification',
    ]);
  });

  it('does not look up attachments when none were claimed', async () => {
    const { calls } = await create();

    assert.equal(calls.includes('findBindable'), false);
  });

  it('classifies the images the transaction actually bound, not the ids sent', async () => {
    let seen = null;

    await create(
      {
        createWithSession: async () =>
          row({
            attachments: [
              { id: ATTACHMENT_ID, fileUrl: 'https://cdn/a.jpg', mimeType: 'image/jpeg' },
            ],
          }),
        classify: async (input) => {
          seen = input;
          return CLASSIFIED;
        },
      },
      { attachmentIds: [ATTACHMENT_ID], declaredLevel: 5 },
    );

    assert.deepEqual(seen.imageUrls, ['https://cdn/a.jpg']);
    assert.equal(seen.rawText, RAW_TEXT);
    assert.equal(seen.declaredLevel, 5);
  });

  it('writes confidence to the llmConfidence column and the rest by name', async () => {
    let written = null;

    await create({
      updateClassification: async (id, columns) => {
        written = columns;
        return row({ ...columns, id });
      },
    });

    assert.equal(written.llmConfidence, CLASSIFIED.confidence);
    assert.equal('confidence' in written, false);
    assert.equal(written.topicId, CLASSIFIED.topicId);
    assert.equal(written.classificationOk, true);
  });

  it('answers with the full QuestionResponse, classification included', async () => {
    const { response } = await create();

    assert.equal(response.id, QUESTION_ID);
    assert.equal(response.rawText, RAW_TEXT);
    assert.equal(response.sessionId, 'session-1');
    assert.equal(response.classification.topicId, CLASSIFIED.topicId);
    assert.equal(response.classification.confidence, CLASSIFIED.confidence);
    assert.equal(response.classification.classificationOk, true);
  });

  it('answers normally when the classifier fell back — §8.1 never blocks the flow', async () => {
    const { response } = await create({ classify: async () => FELL_BACK });

    assert.equal(response.classification.topicId, UNCLASSIFIED_TOPIC_ID);
    assert.equal(response.classification.classificationOk, false);
    assert.equal(response.classification.teacherBrief, RAW_TEXT);
    assert.equal(response.rawText, RAW_TEXT);
  });
});

describe('the ownership rule on attachmentIds', () => {
  /** The repository answers with the bindable subset; anything absent is not the caller's to use. */
  const withheld = (ids) => ({ findBindable: async () => ids });

  it('rejects an id the repository will not hand back', async () => {
    await assert.rejects(create(withheld([]), { attachmentIds: [ATTACHMENT_ID] }), {
      code: 'VALIDATION_ERROR',
    });
  });

  it('creates no question row when an attachment is refused', async () => {
    const { calls, deps } = harness(withheld([]));

    await assert.rejects(
      createAndClassifyQuestion(
        { studentId: STUDENT_ID, rawText: RAW_TEXT, attachmentIds: [ATTACHMENT_ID] },
        deps,
      ),
    );

    assert.equal(calls.includes('createWithSession'), false);
    assert.equal(calls.includes('classify'), false);
  });

  it('rejects when only some of the claimed ids come back', async () => {
    await assert.rejects(
      create(withheld([ATTACHMENT_ID]), {
        attachmentIds: [ATTACHMENT_ID, OTHER_ATTACHMENT_ID],
      }),
      { code: 'VALIDATION_ERROR' },
    );
  });

  it('rejects the same id sent twice rather than binding it once', async () => {
    // The repository answers per row, so a duplicate comes back once and the counts
    // disagree. A client that uploaded one image and claimed it twice has a bug.
    await assert.rejects(
      create(withheld([ATTACHMENT_ID]), { attachmentIds: [ATTACHMENT_ID, ATTACHMENT_ID] }),
      { code: 'VALIDATION_ERROR' },
    );
  });

  it('scopes the lookup to the caller', async () => {
    let seenOwner = null;

    await create(
      {
        findBindable: async (ids, uploadedBy) => {
          seenOwner = uploadedBy;
          return ids;
        },
      },
      { attachmentIds: [ATTACHMENT_ID] },
    );

    assert.equal(seenOwner, STUDENT_ID);
  });
});
