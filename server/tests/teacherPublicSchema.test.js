import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
  PRICE_BAND_KEYS,
  TEACHING_LEVELS,
} from '#config/constants/index.js';
import { teacherByIdSchema, teacherListSchema } from '#validators/teacher.public.schema.js';

/**
 * `GET /teachers` and `GET /teachers/:id` query validation — PR 2.3.
 *
 * These two schemas are the only thing standing between an anonymous query string
 * and the repository, and every value they receive is a string because a query
 * string has no other type. The coercion is therefore not a detail: a `level` that
 * arrives as `'5'` and reaches Prisma unconverted matches nothing and looks exactly
 * like "no teachers teach at that level".
 *
 * Pure — no server, no database. Nothing is hardcoded either: the page sizes, band
 * keys and levels all come from `#config/constants/`, so a test cannot pass by
 * agreeing with a copy of a table somebody has since edited.
 */

/** Parse a query string the way `validate()` does, and return the parsed query. */
function parseQuery(query) {
  return teacherListSchema.parse({ body: {}, params: {}, query }).query;
}

/** The `VALIDATION_ERROR` path: which field Zod objected to. */
function rejectedKeys(query) {
  const result = teacherListSchema.safeParse({ body: {}, params: {}, query });

  assert.equal(result.success, false, 'expected this query to be rejected');

  return result.error.issues.map((issue) => issue.path.join('.'));
}

describe('teacherListSchema', () => {
  describe('defaults', () => {
    it('fills page, pageSize and onlineOnly when the caller says nothing', () => {
      assert.deepEqual(parseQuery({}), {
        page: FIRST_PAGE,
        pageSize: DEFAULT_PAGE_SIZE,
        onlineOnly: false,
      });
    });

    it('defaults onlineOnly to a boolean, not the string it parses from', () => {
      // `.default()` feeds its value back through the schema it wraps, so the
      // default has to be `'false'` rather than `false` or a request that never
      // sent the parameter fails the enum. Regression: it did, once.
      assert.equal(parseQuery({}).onlineOnly, false);
      assert.equal(typeof parseQuery({}).onlineOnly, 'boolean');
    });
  });

  describe('coercion', () => {
    it('turns numeric strings into numbers', () => {
      const query = parseQuery({ topicId: '2', level: '5', page: '3', pageSize: '10' });

      assert.deepEqual(query, {
        topicId: 2,
        level: 5,
        page: 3,
        pageSize: 10,
        onlineOnly: false,
      });
    });

    it('turns onlineOnly into a real boolean', () => {
      assert.equal(parseQuery({ onlineOnly: 'true' }).onlineOnly, true);
      assert.equal(parseQuery({ onlineOnly: 'false' }).onlineOnly, false);
    });

    it('leaves the band key a string', () => {
      for (const key of PRICE_BAND_KEYS) {
        assert.equal(parseQuery({ band: key }).band, key);
      }
    });
  });

  describe('the page size cap', () => {
    it('caps rather than rejects', () => {
      // A client cannot know our ceiling before it asks, so asking for more returns
      // the cap. A 400 would turn one over-eager parameter into a blank screen.
      assert.equal(parseQuery({ pageSize: String(MAX_PAGE_SIZE * 20) }).pageSize, MAX_PAGE_SIZE);
    });

    it('leaves a request under the cap alone', () => {
      assert.equal(parseQuery({ pageSize: '7' }).pageSize, 7);
    });

    it('still rejects a page size of zero', () => {
      assert.deepEqual(rejectedKeys({ pageSize: '0' }), ['query.pageSize']);
    });
  });

  describe('rejections', () => {
    it('rejects a parameter it does not know', () => {
      // A silently ignored typo in a filter is a bug that looks like an empty
      // result. `.strict()` is what turns it into a message naming the parameter.
      assert.deepEqual(rejectedKeys({ sortBy: 'price' }), ['query']);
    });

    it('rejects a level outside the declared set', () => {
      const outside = Math.max(...TEACHING_LEVELS) + 1;

      assert.deepEqual(rejectedKeys({ level: String(outside) }), ['query.level']);
    });

    it('rejects an unknown band', () => {
      assert.deepEqual(rejectedKeys({ band: 'Z' }), ['query.band']);
    });

    it('rejects onlineOnly values that are not the two literals', () => {
      assert.deepEqual(rejectedKeys({ onlineOnly: '1' }), ['query.onlineOnly']);
    });

    it('rejects a page below the first', () => {
      assert.deepEqual(rejectedKeys({ page: '0' }), ['query.page']);
    });

    it('accepts every declared level and band', () => {
      for (const level of TEACHING_LEVELS) {
        assert.equal(parseQuery({ level: String(level) }).level, level);
      }
    });
  });

  describe('topicId', () => {
    it('accepts the seeded sentinel rather than calling a real id invalid', () => {
      // `General / Unclassified` is id 0 (§8.1). It is a root, so nothing teaches it
      // and the filter comes back empty — an honest empty result, not a 400 about an
      // id that exists.
      assert.equal(parseQuery({ topicId: '0' }).topicId, 0);
    });

    it('rejects a negative id', () => {
      assert.deepEqual(rejectedKeys({ topicId: '-1' }), ['query.topicId']);
    });
  });
});

describe('teacherByIdSchema', () => {
  const uuid = '6fb7c0e6-f234-48b2-a2e7-233b56cb5c85';

  it('accepts a uuid', () => {
    const parsed = teacherByIdSchema.parse({ body: {}, params: { id: uuid }, query: {} });

    assert.equal(parsed.params.id, uuid);
  });

  it('rejects anything that is not one', () => {
    // Postgres raises 22P02 on a malformed uuid rather than returning no rows, so
    // uncaught this is a 500 for what is plainly a bad request.
    const result = teacherByIdSchema.safeParse({ body: {}, params: { id: 'me' }, query: {} });

    assert.equal(result.success, false);
    assert.deepEqual(
      result.error.issues.map((issue) => issue.path.join('.')),
      ['params.id'],
    );
  });
});
