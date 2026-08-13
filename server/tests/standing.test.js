import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STANDING_BANDS } from '#config/constants/index.js';
import { standingOf } from '#utils/standing.js';

/**
 * `standingOf` — MVP.md §6.2. The first tests in the project.
 *
 * The badge is the platform making a public claim about a person, on a screen a
 * stranger reads before deciding whether to trust them. `standingOf` is pure and has
 * no dependencies, which makes it the cheapest thing in the codebase to prove right
 * — and the fact that it is *computed* rather than stored is what makes proving it
 * worth doing: there is no row to inspect when a badge looks wrong, only this
 * function.
 *
 * `node:test` and `node:assert`, both built into Node 24. No test framework is
 * installed and none is needed for a pure function; the day an endpoint needs a
 * request runner is the day to have that argument, with evidence.
 *
 * Every threshold below is read from `STANDING_BANDS` rather than typed. A test that
 * hardcodes 100 and 4.5 passes for the wrong reason after somebody edits the table —
 * it stops testing the code and starts testing a copy of the old table.
 */

/** The bands by name, so a test can say `TOP.minSessions` instead of an index. */
const byBadge = Object.fromEntries(STANDING_BANDS.map((band) => [band.badge, band]));
const { TOP, EXPERIENCED, ACTIVE } = byBadge;

/** A rated teacher: `count` ratings that average exactly `average`. */
function rated(sessionsCount, average, count = 10) {
  return { sessionsCount, ratingSum: average * count, ratingCount: count };
}

describe('standingOf', () => {
  describe('the four bands', () => {
    it('a teacher with no history is NEW', () => {
      assert.equal(standingOf({ sessionsCount: 0, ratingSum: 0, ratingCount: 0 }), 'NEW');
    });

    it('is ACTIVE at the ACTIVE threshold', () => {
      assert.equal(standingOf(rated(ACTIVE.minSessions, 5)), 'ACTIVE');
    });

    it('is EXPERIENCED at the EXPERIENCED threshold', () => {
      assert.equal(standingOf(rated(EXPERIENCED.minSessions, 5)), 'EXPERIENCED');
    });

    it('is TOP at both TOP thresholds together', () => {
      assert.equal(standingOf(rated(TOP.minSessions, TOP.minRating)), 'TOP');
    });
  });

  describe('band boundaries', () => {
    it('one session below a threshold stays in the band below', () => {
      assert.equal(standingOf(rated(ACTIVE.minSessions - 1, 5)), 'NEW');
      assert.equal(standingOf(rated(EXPERIENCED.minSessions - 1, 5)), 'ACTIVE');
      assert.equal(standingOf(rated(TOP.minSessions - 1, 5)), 'EXPERIENCED');
    });
  });

  describe('TOP needs volume and satisfaction, not either', () => {
    it('holds a teacher just below the rating threshold at EXPERIENCED', () => {
      const justUnder = TOP.minRating - 0.01;

      assert.equal(standingOf(rated(TOP.minSessions, justUnder, 100)), 'EXPERIENCED');
    });

    it('does not promote on volume alone', () => {
      // The example `constants/teacher.js` gives in its own comment: a badge that
      // rewarded volume would point students at the busiest teacher, not the best.
      assert.equal(standingOf(rated(TOP.minSessions * 3, 4.1)), 'EXPERIENCED');
    });

    it('does not promote on rating alone', () => {
      assert.equal(standingOf(rated(ACTIVE.minSessions, 5)), 'ACTIVE');
    });
  });

  describe('an unrated teacher', () => {
    it('is not held below a threshold they never had a chance to meet', () => {
      // No ratings is not a rating of zero. Only TOP carries a rating floor, so
      // volume alone still earns every band under it.
      assert.equal(
        standingOf({ sessionsCount: EXPERIENCED.minSessions, ratingSum: 0, ratingCount: 0 }),
        'EXPERIENCED',
      );
    });

    it('cannot reach TOP on volume alone', () => {
      assert.equal(
        standingOf({ sessionsCount: TOP.minSessions, ratingSum: 0, ratingCount: 0 }),
        'EXPERIENCED',
      );
    });
  });

  describe('missing fields', () => {
    it('treats an absent counter as zero rather than throwing', () => {
      // A brand-new profile row reaches the serializer before anything writes a
      // counter. `NEW` is the answer; a crash on the public list is not.
      assert.equal(standingOf({}), 'NEW');
    });
  });
});
