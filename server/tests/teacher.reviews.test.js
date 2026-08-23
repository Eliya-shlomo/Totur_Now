import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `GET /teachers/:id/reviews` — PR 8.3, MVP.md §12 "Public / Guest" and §6.3.
 *
 * **The property this file exists for is an absence, and absences do not fail loudly.**
 * The endpoint is unauthenticated and the `reviews` row carries `student_id`, so the one
 * defect that matters here is a serializer or a `select` that grows an author. Nothing
 * would break; a public URL would simply start mapping named people to the maths they
 * could not do, and two teachers' lists intersected would describe a student's term.
 *
 * So the student is checked three times over, in three different ways, because each
 * check can quietly stop mattering on its own:
 *
 *   1. on the payload, field by field, from a row that *has* a `studentId` on it — a
 *      fixture without one could not tell a working serializer from a lucky one;
 *   2. on the serializer's source text, because a field that is commented out or
 *      defaulted to `undefined` is one refactor from being emitted;
 *   3. on the repository's `select`, because the safest version of this is the one where
 *      the column is never read out of the database at all.
 *
 * The second property is `stars`. `isResolved` is the only required field on a review
 * (§6.2), so **a review with no stars is the common case rather than the edge**, and a
 * `?? 0` anywhere on this path is the public twin of the defect
 * `session.review.service.js` spends a paragraph on: it turns "no opinion" into the
 * harshest rating a student can give, on a page a stranger reads.
 *
 * The third is the paging offset, which is arithmetic and is invisible on a seeded
 * database where every review list fits on one page.
 *
 * Every collaborator arrives through the second argument, so the whole file runs with no
 * database.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = await import('#config/constants/index.js');
const { ERROR_CODES } = await import('#config/errors/codes.js');
const { listTeacherReviews } = await import('#services/teacher.public.service.js');
const { toTeacherReview } = await import('#utils/teacherView.js');
const { teacherReviewsSchema } = await import('#validators/teacher.public.schema.js');

const TEACHER_ID = '44444444-4444-4444-8444-444444444444';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = new Date('2026-08-21T18:30:00.000Z');

/**
 * A row as the repository hands it over — **with `studentId` on it**, deliberately and
 * against what the repository's own `select` would fetch. It is the only fixture shape
 * that can tell a serializer which drops the field from one which never received it.
 */
const reviewRow = (over = {}) => ({
  id: 'review-1',
  stars: 4,
  isResolved: true,
  comment: 'Explained the substitution step twice and it finally landed.',
  createdAt: CREATED_AT,
  studentId: STUDENT_ID,
  session: {
    question: {
      topic: { id: 41, nameEn: 'Calculus — Integrals', nameHe: 'חדו"א — אינטגרלים' },
      subtopic: { id: 45, nameEn: 'Integration by parts', nameHe: 'אינטגרציה בחלקים' },
    },
  },
  ...over,
});

/** The two reads, recording what they were asked for. */
function deps({ teacher = { userId: TEACHER_ID }, reviews, total } = {}) {
  const rows = reviews ?? [reviewRow()];
  const calls = [];

  return {
    calls,
    loadTeacher: async (id) => {
      calls.push(['loadTeacher', id]);

      return teacher;
    },
    loadReviews: async (args) => {
      calls.push(['loadReviews', args]);

      return { reviews: rows, total: total ?? rows.length };
    },
  };
}

const query = (over = {}) => ({
  id: TEACHER_ID,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  ...over,
});

async function thrownBy(promise) {
  try {
    await promise;

    return null;
  } catch (error) {
    return error;
  }
}

describe('the student is not on the wire', () => {
  it('emits no field derived from the author, from a row that carries one', () => {
    const view = toTeacherReview(reviewRow());

    assert.deepEqual(Object.keys(view).sort(), [
      'comment',
      'createdAt',
      'id',
      'isResolved',
      'stars',
      'topicName',
    ]);

    // The whole payload as text, because a nested object or a renamed key would pass a
    // field-by-field check. The id is a uuid a grep for "student" would not catch on its
    // own, so it is looked for by value as well.
    const serialized = JSON.stringify(view);

    assert.equal(/student/i.test(serialized), false);
    assert.equal(serialized.includes(STUDENT_ID), false);
  });

  it('survives the whole service path with the author still absent', async () => {
    const collaborators = deps();

    const result = await listTeacherReviews(query(), collaborators);

    assert.equal(/student/i.test(JSON.stringify(result)), false);
  });
});

describe('the review a student wrote without stars', () => {
  it('keeps stars null rather than answering zero', () => {
    const view = toTeacherReview(reviewRow({ stars: null }));

    // §6.2 makes `isResolved` the only required field, so this is the common case. A
    // `?? 0` here would publish the harshest rating a student can give on behalf of a
    // student who declined to give one.
    assert.equal(view.stars, null);
    assert.equal(view.isResolved, true);
    assert.equal(typeof view.comment, 'string');
  });

  it('keeps a one-star review, which a truthiness check would drop', () => {
    assert.equal(toTeacherReview(reviewRow({ stars: 1 })).stars, 1);
  });

  it('keeps an absent comment null — a review can be stars alone', () => {
    assert.equal(toTeacherReview(reviewRow({ comment: null })).comment, null);
  });
});

describe('the topic label', () => {
  it('prefers the subtopic — the more specific true thing', () => {
    assert.equal(toTeacherReview(reviewRow()).topicName, 'Integration by parts');
  });

  it('falls back to the parent topic when the question has no subtopic', () => {
    const row = reviewRow({
      session: {
        question: {
          topic: { id: 41, nameEn: 'Calculus — Integrals', nameHe: 'חדו"א — אינטגרלים' },
          subtopic: null,
        },
      },
    });

    assert.equal(toTeacherReview(row).topicName, 'Calculus — Integrals');
  });

  it('answers null for the sentinel topic, which is a real row with a real name', async () => {
    // **Found by calling the endpoint, not by a test.** `topics` id 0 is seeded as
    // "כללי / לא מסווג" (§8.1's fallback), so the first version of this serializer put
    // that on a chip for every question the classifier could not place. The guard is on
    // the id because the id is `0` and falsy, and `if (topic.id)` reads as correct.
    const { UNCLASSIFIED_TOPIC_ID } = await import('#config/constants/index.js');
    const row = reviewRow({
      session: {
        question: {
          topic: {
            id: UNCLASSIFIED_TOPIC_ID,
            nameEn: 'General / Unclassified',
            nameHe: 'כללי / לא מסווג',
          },
          subtopic: null,
        },
      },
    });

    assert.equal(toTeacherReview(row).topicName, null);
  });

  it('answers null on the sentinel path rather than a label meaning “we do not know”', () => {
    // §8.1's fallback classification. "General / Unclassified" as a chip on a review says
    // less than no chip at all, and the client renders the row without one.
    const row = reviewRow({ session: { question: { topic: null, subtopic: null } } });

    assert.equal(toTeacherReview(row).topicName, null);
  });

  it('answers null for a review whose session or question has gone', () => {
    assert.equal(toTeacherReview(reviewRow({ session: null })).topicName, null);
    assert.equal(toTeacherReview(reviewRow({ session: {} })).topicName, null);
  });
});

describe('the date', () => {
  it('leaves as an ISO 8601 string in UTC, never a Date', () => {
    const { createdAt } = toTeacherReview(reviewRow());

    assert.equal(typeof createdAt, 'string');
    assert.equal(createdAt, '2026-08-21T18:30:00.000Z');
  });
});

describe('paging', () => {
  it('asks for the first page at offset zero', async () => {
    const collaborators = deps();

    await listTeacherReviews(query(), collaborators);

    const [, args] = collaborators.calls.find(([name]) => name === 'loadReviews');

    assert.deepEqual(args, { teacherId: TEACHER_ID, skip: 0, take: DEFAULT_PAGE_SIZE });
  });

  it('computes the offset as (page - 1) × pageSize', async () => {
    const collaborators = deps();

    await listTeacherReviews(query({ page: 3, pageSize: 5 }), collaborators);

    const [, args] = collaborators.calls.find(([name]) => name === 'loadReviews');

    // `page × pageSize` returns page 4 to somebody who asked for page 3, and every
    // seeded teacher's whole list fits on page 1, so nothing else would notice.
    assert.equal(args.skip, 10);
    assert.equal(args.take, 5);
  });

  it('reports the unpaged total rather than the length of the page', async () => {
    const collaborators = deps({ reviews: [reviewRow()], total: 47 });

    const result = await listTeacherReviews(query({ pageSize: 1 }), collaborators);

    // It is the number beside the stars in the heading, and a heading that changes as
    // you page is a heading nobody trusts. 2.3 and 7.2 made the same call.
    assert.equal(result.reviews.length, 1);
    assert.equal(result.total, 47);
  });

  it('answers an empty page as an empty list, not as a 404', async () => {
    const collaborators = deps({ reviews: [], total: 0 });

    const result = await listTeacherReviews(query(), collaborators);

    // A teacher with no reviews is a teacher, and the screen renders an empty state.
    // Every seeded teacher is in exactly this position: the seed writes aggregates and
    // no `reviews` rows.
    assert.deepEqual(result, { reviews: [], total: 0 });
  });
});

describe('whose id it is', () => {
  it('answers NOT_FOUND for a user who is not a teacher', async () => {
    const collaborators = deps({ teacher: null });

    const error = await thrownBy(listTeacherReviews(query({ id: STUDENT_ID }), collaborators));

    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
    assert.equal(error.statusCode, 404);
  });

  it('does not read a single review for an id that is not a teacher’s', async () => {
    const collaborators = deps({ teacher: null });

    await thrownBy(listTeacherReviews(query({ id: STUDENT_ID }), collaborators));

    // The assertion with no return value: an empty list for a student's id would tell a
    // caller that this person is a teacher nobody has written about. They are not a
    // teacher, and this endpoint is unauthenticated.
    assert.equal(
      collaborators.calls.some(([name]) => name === 'loadReviews'),
      false,
    );
  });
});

describe('teacherReviewsSchema', () => {
  const parse = (params, query = {}) =>
    teacherReviewsSchema.parse({ body: {}, params, query }).query;

  const rejects = (params, query = {}) =>
    teacherReviewsSchema.safeParse({ body: {}, params, query }).success === false;

  it('defaults the paging so the service never branches on “did they say”', () => {
    assert.deepEqual(parse({ id: TEACHER_ID }), { page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('coerces the query string, which has no types of its own', () => {
    assert.deepEqual(parse({ id: TEACHER_ID }, { page: '2', pageSize: '5' }), {
      page: 2,
      pageSize: 5,
    });
  });

  it('caps an over-eager pageSize rather than rejecting it', () => {
    // A client cannot know our ceiling before it asks, and a 400 would turn one
    // parameter into a blank profile. `total` still reports the true count.
    assert.equal(parse({ id: TEACHER_ID }, { pageSize: '1000' }).pageSize, MAX_PAGE_SIZE);
  });

  it('refuses a page below one and a pageSize below one', () => {
    assert.ok(rejects({ id: TEACHER_ID }, { page: '0' }));
    assert.ok(rejects({ id: TEACHER_ID }, { pageSize: '0' }));
  });

  it('refuses a malformed uuid, which Postgres would raise 22P02 for', () => {
    // Uncaught that is a 500 for what is plainly a bad request, and the client renders
    // the 404 page for a `VALIDATION_ERROR` on this route for exactly that reason.
    assert.ok(rejects({ id: 'not-a-uuid' }));
  });

  it('refuses an invented filter rather than ignoring it', () => {
    // A filter quietly dropped looks like the data is wrong. `.strict()`, the posture
    // every schema on this surface takes.
    assert.ok(rejects({ id: TEACHER_ID }, { sort: 'oldest' }));
  });
});

const source = (path) =>
  readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8').then((text) =>
    text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''),
  );

const serializerSource = await source('../src/utils/teacherView.js');
const repositorySource = await source('../src/repositories/review.repository.js');
const controllerSource = await source('../src/controllers/teacher.public.controller.js');
const serviceSource = await source('../src/services/teacher.public.service.js');

describe('the properties a call cannot demonstrate', () => {
  it('never mentions the author in the serializer, not even to drop it', () => {
    const [, body] = serializerSource.split('export function toTeacherReview');

    // Commented out or set to `undefined`, it is one refactor from being emitted — and
    // this URL is public. The comments are stripped above, so the check is about code.
    assert.equal(/student/i.test(body), false);
  });

  it('never selects the column in the repository', () => {
    const [, body] = repositorySource.split('export async function findTeacherReviewPage');

    // The safest version of this is the one where the column never leaves the database.
    assert.equal(/studentId/.test(body), false);
  });

  it('keeps prisma out of the controller and the service', () => {
    // CONVENTIONS.md layering: the repository owns the client.
    assert.equal(/prisma/.test(controllerSource), false);
    assert.equal(/prisma/.test(serviceSource), false);
  });

  it('pages in the repository rather than slicing in the service', () => {
    const [, body] = repositorySource.split('export async function findTeacherReviewPage');

    // An unbounded read of every review a popular teacher ever received is a slow screen
    // and a denial-of-service shape on an unauthenticated endpoint.
    assert.match(body, /skip/);
    assert.match(body, /take/);
    assert.equal(/\.slice\(/.test(serviceSource), false);
  });

  it('orders newest first on a total key', () => {
    const [, body] = repositorySource.split('export async function findTeacherReviewPage');

    // Two reviews written in one transaction share `created_at` to the microsecond, and
    // a non-total order lets page 2 repeat a row from page 1.
    assert.match(body, /orderBy:\s*\[\{\s*createdAt:\s*'desc'\s*\}/);
    assert.match(body, /\{\s*id:\s*'desc'\s*\}\]/);
  });
});
