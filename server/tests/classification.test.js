import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import {
  DIFFICULTY_MAX,
  GEMINI_MIN_DEADLINE_MS,
  DIFFICULTY_MIN,
  LLM_MAX_OUTPUT_TOKENS,
  LLM_MODEL,
  LLM_THINKING_LEVEL,
  MATH_LEVELS,
  MAX_IMAGES,
  MIN_CONFIDENCE,
  TITLE_MAX_LENGTH,
  UNCLASSIFIED_TOPIC_ID,
} from '#config/constants/index.js';
import {
  CLASSIFICATION_OUTPUT_SCHEMA,
  classificationSchema,
} from '#validators/classification.schema.js';

/**
 * `classifyQuestion` and the shape it validates — PR 3.3, MVP.md §8.1.
 *
 * **Nothing here touches the network or a database**, and that is the point rather than
 * a convenience: this file's whole subject is what happens when the network *fails*, so
 * a suite that needed the network could not test it. Every collaborator arrives through
 * `classifyQuestion`'s second argument — the taxonomy, the SDK call, the timeout, and
 * the two configuration guards — so each of §8.1's failure modes is reachable on
 * demand, in milliseconds, with no key and no Postgres.
 *
 * Nothing is hardcoded either. The confidence floor, the level and difficulty bounds,
 * the sentinel topic id and the model name all come from `#config/constants/`, so a
 * test cannot pass by agreeing with a copy of a value somebody has since changed.
 *
 * What this file deliberately does **not** test is the prompt. §17.5 makes it
 * human-written, the epic's review checklist has a person read it out loud, and 3.8
 * exercises it against the real model. A test asserting that a paragraph contains
 * certain words would pretend to cover it while checking nothing that matters.
 */

// The service imports `config/env.js` transitively, which validates the environment at
// import time and calls `process.exit(1)` on a missing `DATABASE_URL`. Filling the
// required variables before the dynamic import below keeps `npm test` runnable on a
// machine with no `.env` — a checkout, CI, or a reviewer who has not set up Postgres.
// Nothing here is used: the database is never reached, and every test injects its deps.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { classifyQuestion } = await import('#services/classification.service.js');

/**
 * A two-level taxonomy in the shape `getTopicTree()` returns, sentinel included.
 *
 * The ids are arbitrary on purpose. They are not the seeded ones, and no assertion
 * below knows a real topic id — if this file agreed with `prisma/seed/topics.js` it
 * would be a fourth copy of that table, which is the thing 3.3 exists to avoid.
 */
const TAXONOMY = [
  {
    id: 7,
    slug: 'algebra',
    nameEn: 'Algebra',
    nameHe: 'אלגברה',
    children: [{ id: 71, slug: 'quadratic-equations', nameEn: 'Quadratic', nameHe: 'ריבועיות' }],
  },
  {
    id: 9,
    slug: 'calculus-integrals',
    nameEn: 'Calculus — Integrals',
    nameHe: 'חדו"א — אינטגרלים',
    children: [
      { id: 91, slug: 'definite-integrals', nameEn: 'Definite', nameHe: 'אינטגרל מסוים' },
      { id: 92, slug: 'areas-under-curves', nameEn: 'Areas', nameHe: 'חישוב שטחים' },
    ],
  },
  // The seeded "General / Unclassified" row: a root with no children (topic.service.js
  // returns it exactly like this). Its presence here is what proves the prompt drops it
  // and the id check refuses it.
  {
    id: UNCLASSIFIED_TOPIC_ID,
    slug: 'general-unclassified',
    nameEn: 'General / Unclassified',
    nameHe: 'כללי / לא מסווג',
    children: [],
  },
];

/** A well-formed answer from the model — the thing each test then breaks one field of. */
const ANSWER = {
  title: 'Definite integral bounds',
  topic_id: 9,
  subtopic_id: 91,
  difficulty: 3,
  estimated_level: 5,
  teacher_brief: 'Knows the antiderivative, stuck substituting the bounds.',
  student_confirmation: 'A question about definite integrals?',
  confidence: 0.9,
};

const RAW_TEXT = 'לא מבין איך מציבים גבולות באינטגרל';

/**
 * The envelope `models.generateContent` resolves with, around the JSON under test.
 *
 * `text` is a getter on the real `GenerateContentResponse` and a plain property here,
 * which is the one difference this stub is allowed to have: `readJson` reads it, and a
 * getter and a property are indistinguishable to a read.
 */
const reply = (payload) => ({ text: JSON.stringify(payload) });

/**
 * Every dependency, always. Overriding one leaves the rest injected rather than real —
 * a test that forgot `loadTaxonomy` would reach the repository, fail on a missing
 * database, and still produce a fallback, so it would pass for the wrong reason.
 */
function deps(overrides = {}) {
  return {
    loadTaxonomy: async () => TAXONOMY,
    createMessage: async () => reply(ANSWER),
    timeoutMs: 50,
    promptReady: true,
    configured: true,
    ...overrides,
  };
}

/** Classify with a stubbed model answer, and hand back what the caller would get. */
function classify(overrides = {}, input = {}) {
  return classifyQuestion(
    { rawText: RAW_TEXT, imageUrls: [], declaredLevel: 5, ...input },
    deps(overrides),
  );
}

/** Classify with a model answer that differs from `ANSWER` in one field. */
function classifyAnswering(patch) {
  return classify({ createMessage: async () => reply({ ...ANSWER, ...patch }) });
}

/** The exact §8.1 fallback, built from constants rather than typed out. */
function expectedFallback(rawText = RAW_TEXT) {
  return {
    title: null,
    topicId: UNCLASSIFIED_TOPIC_ID,
    subtopicId: null,
    difficulty: null,
    estimatedLevel: null,
    teacherBrief: rawText,
    studentConfirmation: rawText,
    confidence: 0,
    classificationOk: false,
  };
}

/**
 * The logger writes through `console.warn`. Capturing it keeps the suite readable and,
 * more usefully, makes the log line itself testable — "no student text in the logs" is
 * a review item in this epic, and a review item nothing checks is a review item that
 * eventually stops being true.
 */
let warnings = [];

beforeEach(() => {
  warnings = [];
  mock.method(console, 'warn', (...args) => warnings.push(args));
});

afterEach(() => mock.restoreAll());

describe('classificationSchema', () => {
  it('accepts a well-formed answer', () => {
    assert.equal(classificationSchema.safeParse(ANSWER).success, true);
  });

  it('trims the strings it accepts', () => {
    const parsed = classificationSchema.parse({ ...ANSWER, title: '  Integrals  ' });

    assert.equal(parsed.title, 'Integrals');
  });

  it('rejects a confidence outside 0–1', () => {
    // The wire schema asks for this range too, but asking is not receiving: a stubbed
    // response, a future vendor whose subset drops ranges, or a model that ignores the
    // constraint all arrive here, and here is where the value is actually checked.
    assert.equal(classificationSchema.safeParse({ ...ANSWER, confidence: 1.4 }).success, false);
    assert.equal(classificationSchema.safeParse({ ...ANSWER, confidence: -0.1 }).success, false);
  });

  it('rejects a difficulty outside the declared bounds', () => {
    for (const difficulty of [DIFFICULTY_MIN - 1, DIFFICULTY_MAX + 1]) {
      assert.equal(classificationSchema.safeParse({ ...ANSWER, difficulty }).success, false);
    }
  });

  it('accepts every declared difficulty and level', () => {
    for (let difficulty = DIFFICULTY_MIN; difficulty <= DIFFICULTY_MAX; difficulty += 1) {
      assert.equal(classificationSchema.safeParse({ ...ANSWER, difficulty }).success, true);
    }

    for (const estimated_level of MATH_LEVELS) {
      assert.equal(classificationSchema.safeParse({ ...ANSWER, estimated_level }).success, true);
    }
  });

  it('rejects a level the platform does not teach', () => {
    const outside = Math.max(...MATH_LEVELS) + 1;

    assert.equal(
      classificationSchema.safeParse({ ...ANSWER, estimated_level: outside }).success,
      false,
    );
  });

  it('rejects a title wider than the column', () => {
    const tooLong = 'x'.repeat(TITLE_MAX_LENGTH + 1);

    assert.equal(classificationSchema.safeParse({ ...ANSWER, title: tooLong }).success, false);
  });

  it('rejects strings that are only whitespace', () => {
    // Valid JSON, valid `type: string`, and a blank brief in front of a teacher.
    assert.equal(classificationSchema.safeParse({ ...ANSWER, teacher_brief: '  ' }).success, false);
  });

  it('rejects a key it did not ask for', () => {
    assert.equal(classificationSchema.safeParse({ ...ANSWER, extra: 1 }).success, false);
  });

  it('rejects a missing field', () => {
    const { confidence, ...missing } = ANSWER;

    assert.equal(typeof confidence, 'number');
    assert.equal(classificationSchema.safeParse(missing).success, false);
  });
});

describe('CLASSIFICATION_OUTPUT_SCHEMA', () => {
  it('describes the same fields as the Zod schema', () => {
    // The drift guard. The two schemas are written by hand — the SDK's `zodOutputFormat`
    // helper needs Zod v4 and every validator in this repo is v3 — so the one failure
    // they can have is disagreeing about which fields exist.
    assert.deepEqual(
      Object.keys(CLASSIFICATION_OUTPUT_SCHEMA.properties),
      Object.keys(classificationSchema.shape),
    );
  });

  it('requires every field and forbids the rest', () => {
    // Both are conditions of the structured-outputs feature, not preferences.
    assert.deepEqual(
      CLASSIFICATION_OUTPUT_SCHEMA.required,
      Object.keys(CLASSIFICATION_OUTPUT_SCHEMA.properties),
    );
    assert.equal(CLASSIFICATION_OUTPUT_SCHEMA.additionalProperties, false);
  });

  it('spells the closed sets as enums drawn from the constants', () => {
    const difficulties = Array.from(
      { length: DIFFICULTY_MAX - DIFFICULTY_MIN + 1 },
      (_, offset) => DIFFICULTY_MIN + offset,
    );

    assert.deepEqual(CLASSIFICATION_OUTPUT_SCHEMA.properties.difficulty.enum, difficulties);
    assert.deepEqual(CLASSIFICATION_OUTPUT_SCHEMA.properties.estimated_level.enum, [
      ...MATH_LEVELS,
    ]);
  });

  it('bounds the confidence on the wire as well as in Zod', () => {
    // Gemini's schema subset supports numeric ranges, so the model is told the bound
    // rather than only being corrected after the fact. Zod keeps checking it anyway:
    // this layer constrains what the model emits, that one verifies what arrived.
    const confidence = CLASSIFICATION_OUTPUT_SCHEMA.properties.confidence;

    assert.equal(confidence.minimum, 0);
    assert.equal(confidence.maximum, 1);
  });
});

describe('classifyQuestion — the happy path', () => {
  it('maps the model’s answer onto the Classification contract', async () => {
    assert.deepEqual(await classify(), {
      title: ANSWER.title,
      topicId: ANSWER.topic_id,
      subtopicId: ANSWER.subtopic_id,
      difficulty: ANSWER.difficulty,
      estimatedLevel: ANSWER.estimated_level,
      teacherBrief: ANSWER.teacher_brief,
      studentConfirmation: ANSWER.student_confirmation,
      confidence: ANSWER.confidence,
      classificationOk: true,
    });
  });

  it('logs nothing when it succeeds', async () => {
    await classify();

    assert.deepEqual(warnings, []);
  });

  it('accepts an answer sitting exactly on the confidence floor', async () => {
    // §8.1 says *below* the floor is a failure. The boundary is the one value where a
    // `<` and a `<=` disagree, and one of them silently discards good classifications.
    const onTheFloor = await classifyAnswering({ confidence: MIN_CONFIDENCE });

    assert.equal(onTheFloor.classificationOk, true);
  });
});

/**
 * What `models.generateContent` is handed. PR 6a.1.
 *
 * **Every assertion below is by the field name the SDK reads**, which is the whole
 * point of the block rather than a detail of it. Until 6a.1 this suite asserted a
 * request shape belonging to no SDK at all — `interactions.create`, `system_instruction`,
 * `response_format` — and passed, for three epics, on a call that threw a `TypeError`
 * before a socket opened. It could: it injects `createMessage`, so what it proved was
 * that the code built the object the code meant to build. Names taken from the wrong
 * API are exactly what that proof cannot see, and the tests here would now fail against
 * the old service, which is the property that makes them worth having.
 *
 * They still do not prove the vendor accepts it. Only the bench (6a.3) does that.
 */
describe('classifyQuestion — the request it builds', () => {
  /** Run once and hand back the exact argument the SDK would have received. */
  async function capture(input = {}) {
    let params;

    await classify(
      {
        createMessage: async (sent) => {
          params = sent;
          return reply(ANSWER);
        },
      },
      input,
    );

    return params;
  }

  it('sends the model, ceiling and thinking level from constants', async () => {
    const params = await capture();

    assert.equal(params.model, LLM_MODEL);
    assert.equal(params.config.maxOutputTokens, LLM_MAX_OUTPUT_TOKENS);
    // §4.1 promised 2–4 seconds and this model thinks by default — the level is a
    // latency decision, so it is asserted rather than left to the vendor's default.
    assert.equal(params.config.thinkingConfig.thinkingLevel, LLM_THINKING_LEVEL);
  });

  it('asks for the schema rather than for prose', async () => {
    const params = await capture();

    assert.equal(params.config.responseMimeType, 'application/json');
    // `responseJsonSchema`, not `responseSchema`. The schema is JSON Schema and the
    // other field takes Gemini's own `Schema` type; asserting the name is asserting
    // that the two were not confused again.
    assert.equal(params.config.responseJsonSchema, CLASSIFICATION_OUTPUT_SCHEMA);
    assert.equal(params.config.responseSchema, undefined);
  });

  it('bounds the request itself, in milliseconds, without retries', async () => {
    const params = await capture();

    // The vendor floor, not the injected 50ms: Gemini rejects any deadline under ten
    // seconds outright, so a request carrying §8.1's eight would fail before it ran.
    // The race is what enforces the budget the student waits; this is the backstop.
    assert.equal(params.config.httpOptions.timeout, GEMINI_MIN_DEADLINE_MS);
    // One 8-second budget must not become five: this SDK retries by default, and a
    // per-request deadline bounds one attempt rather than the wait the student sees.
    assert.equal(params.config.httpOptions.retryOptions.attempts, 1);
    // Losing the race has to cancel the request, or the timeout protects the student's
    // latency and nothing else — the abandoned call still runs, and is still billed.
    assert.ok(params.config.abortSignal);
  });

  it('bounds it at the callers timeout when that is above the vendor floor', async () => {
    // The clamp is a floor and not a constant. A 20-second budget must reach the
    // vendor as twenty, or the backstop would quietly become the tighter bound.
    let params;

    await classifyQuestion(
      { rawText: RAW_TEXT },
      deps({
        timeoutMs: GEMINI_MIN_DEADLINE_MS * 2,
        createMessage: async (sent) => {
          params = sent;
          return reply(ANSWER);
        },
      }),
    );

    assert.equal(params.config.httpOptions.timeout, GEMINI_MIN_DEADLINE_MS * 2);
  });

  it('adds the bounds without dropping the prompt or the schema', async () => {
    // `callWithTimeout` merges into `config`, which the caller already filled. A
    // spread in the wrong direction would take the schema and the instructions with it
    // and still leave a request that looks well-formed.
    const params = await capture();

    assert.ok(params.config.systemInstruction);
    assert.ok(params.config.responseJsonSchema);
    assert.equal(params.config.maxOutputTokens, LLM_MAX_OUTPUT_TOKENS);
  });

  it('renders the taxonomy from the tree it was handed', async () => {
    const params = await capture();

    // Every parent and leaf the tree carried, by id and by both names — proof the list
    // is read from the database rather than pasted into the prompt.
    assert.match(params.config.systemInstruction, /9: Calculus — Integrals/);
    assert.match(params.config.systemInstruction, /91: Definite \/ אינטגרל מסוים/);
    assert.match(params.config.systemInstruction, /71: Quadratic/);
  });

  it('never offers the sentinel as something to choose', async () => {
    const params = await capture();

    // It is a childless root, so no valid answer can name it — printing it would only
    // invite one. Asserted by name because the prompt is where it would appear.
    assert.doesNotMatch(params.config.systemInstruction, /Unclassified/);
  });

  it('sends one user turn, with every part inside it', async () => {
    // `contents` is a conversation, not a list of blocks. The parts belong to a turn,
    // and a flat array is the previous API's shape rather than this one's.
    const params = await capture();

    assert.equal(params.contents.length, 1);
    assert.equal(params.contents[0].role, 'user');
    assert.ok(Array.isArray(params.contents[0].parts));
  });

  it('sends the images before the text, capped and https-only', async () => {
    const params = await capture({
      imageUrls: [
        'https://res.cloudinary.com/one.jpg',
        'http://insecure.example.com/two.jpg',
        'https://res.cloudinary.com/three.jpg',
        'https://res.cloudinary.com/four.jpg',
        'https://res.cloudinary.com/five.jpg',
        null,
      ],
    });

    // The image parts are still the ones 3.3 wrote, and Gemini reaches nothing with
    // them — 6a.2 replaces them with `inlineData`. Asserted here as they are so that
    // the cap, the https filter and the ordering stay covered while they change, and
    // so 6a.2's diff is the parts and not the rules around them.
    const parts = params.contents[0].parts;
    const images = parts.filter((part) => part.type === 'image');

    assert.equal(images.length, MAX_IMAGES);
    assert.ok(images.every((part) => part.uri.startsWith('https://')));
    // The exercise is usually the photograph (§4.1); the text is what it cannot show.
    assert.equal(typeof parts.at(-1).text, 'string');
  });

  it('passes the declared level through, and omits it when there is none', async () => {
    const withLevel = await capture({ declaredLevel: 4 });
    const without = await capture({ declaredLevel: null });

    assert.match(withLevel.contents[0].parts.at(-1).text, /<declared_level>4</);
    assert.doesNotMatch(without.contents[0].parts.at(-1).text, /declared_level/);
  });
});

describe('classifyQuestion — every way it falls back', () => {
  /** Each case is one of §8.1's failure modes, and each must produce the same answer. */
  const cases = [
    {
      name: 'a subtopic id the taxonomy does not have',
      overrides: { createMessage: async () => reply({ ...ANSWER, subtopic_id: 9999 }) },
    },
    {
      name: 'a real subtopic filed under the wrong parent',
      overrides: { createMessage: async () => reply({ ...ANSWER, topic_id: 7 }) },
    },
    {
      name: 'the sentinel topic offered as an answer',
      overrides: {
        createMessage: async () =>
          reply({ ...ANSWER, topic_id: UNCLASSIFIED_TOPIC_ID, subtopic_id: UNCLASSIFIED_TOPIC_ID }),
      },
    },
    {
      name: 'a confidence below the floor',
      overrides: {
        createMessage: async () => reply({ ...ANSWER, confidence: MIN_CONFIDENCE - 0.1 }),
      },
    },
    {
      name: 'an answer that fails the schema',
      overrides: { createMessage: async () => reply({ ...ANSWER, difficulty: 42 }) },
    },
    {
      name: 'a response that is not JSON at all',
      overrides: { createMessage: async () => ({ output_text: 'sorry!' }) },
    },
    {
      name: 'a response carrying no output text',
      overrides: { createMessage: async () => ({}) },
    },
    {
      name: 'a thrown error',
      overrides: {
        createMessage: async () => {
          throw new Error('502 from upstream');
        },
      },
    },
    {
      name: 'a call that never settles',
      overrides: { createMessage: () => new Promise(() => {}) },
    },
    {
      name: 'a taxonomy read that fails',
      overrides: {
        loadTaxonomy: async () => {
          throw new Error('database is unreachable');
        },
      },
    },
    {
      name: 'an unset GEMINI_API_KEY',
      overrides: { configured: false },
    },
    {
      name: 'a prompt still holding its placeholder',
      overrides: { promptReady: false },
    },
  ];

  for (const { name, overrides } of cases) {
    it(`returns the fallback on ${name}`, async () => {
      assert.deepEqual(await classify(overrides), expectedFallback());
    });

    it(`resolves rather than rejecting on ${name}`, async () => {
      // The caller commits the student's question *before* calling here, so a rejection
      // would strand a row. This is an acceptance criterion, not a style preference.
      await assert.doesNotReject(() => classify(overrides));
    });
  }

  it('gives up because the timeout fired, not because the call answered', async () => {
    await classify({ timeoutMs: 30, createMessage: () => new Promise(() => {}) });

    // Deliberately not a stopwatch. An earlier version asserted the elapsed time was
    // under a second, which flaked under the full suite: six test files run in parallel
    // and a 30ms timer is not owed the event loop on a loaded machine. The wall clock
    // was never the claim anyway — a timeout that failed to fire would hang this test
    // until the runner killed it, so "it finished" already proves it stopped waiting.
    // What is worth asserting is *which* path finished it, and that is deterministic.
    assert.match(warnings[0][1].reason, /timed out after 30ms/);
  });
});

describe('classifyQuestion — what it writes to the log', () => {
  it('names the reason and the elapsed time on a fallback', async () => {
    await classify({ timeoutMs: 30, createMessage: () => new Promise(() => {}) });

    assert.equal(warnings.length, 1);

    const [, meta] = warnings[0];

    // 3.8 wants to know how often this fires, and on what shape of question.
    assert.match(meta.reason, /timed out/);
    assert.equal(typeof meta.elapsedMs, 'number');
    assert.equal(typeof meta.wordCount, 'number');
  });

  it('never writes the student’s words, at any level', async () => {
    await classify({ createMessage: async () => reply({ ...ANSWER, subtopic_id: 9999 }) });

    // The raw text is a person's homework, and it reaches the log the first time
    // somebody debugs a fallback carelessly. Whole line, not just the meta object.
    const logged = JSON.stringify(warnings);

    assert.doesNotMatch(logged, new RegExp(RAW_TEXT));
    assert.equal(warnings.length, 1);
  });
});

describe('classifyQuestion — inputs that should not be survivable', () => {
  it('answers for an input with no text at all', async () => {
    const classification = await classifyQuestion(undefined, deps({ configured: false }));

    assert.deepEqual(classification, expectedFallback(''));
  });

  it('answers for a 10k-character question', async () => {
    const long = 'x'.repeat(10_000);
    const classification = await classify({ configured: false }, { rawText: long });

    assert.deepEqual(classification, expectedFallback(long));
  });

  it('answers for twenty images', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://res.cloudinary.com/${i}.jpg`);
    const classification = await classify({}, { imageUrls: many });

    assert.equal(classification.classificationOk, true);
  });

  it('returns a string brief even when rawText is not one', async () => {
    // `String(...)` in the fallback exists for this: an undefined rawText must produce
    // a string, not a crash two layers up in DEV-A's transaction.
    const classification = await classify({ configured: false }, { rawText: undefined });

    assert.equal(typeof classification.teacherBrief, 'string');
  });
});
