import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ERROR_CODES } from '#config/errors/codes.js';
import {
  assertStatusChangeAllowed,
  SYSTEM_OWNED_STATUSES,
} from '#services/teacher.status.rules.js';

/**
 * The manual availability guard — PR 5.10, closing the defect PR 5.9's pass found.
 *
 * **This file imports the rule and nothing else**, the arrangement `presence.test.js`
 * documents: `npm test` runs bare `node --test` with no database, and reaching
 * `teacher.me.service.js` would pull in the repository and therefore `PrismaClient`.
 *
 * The defect these tests pin: `PATCH /teachers/me {"status":"ONLINE"}` moved a teacher
 * out of `OFFER_LOCKED` without resolving their offer, so a second student could be
 * locked onto the same teacher and `MVP.md` §11.3-A's "exactly one wins" became two
 * `PENDING` offers on one teacher. It was reachable through the availability pill on the
 * teacher's own dashboard, it needed no race, and **every test in E5 passed with it
 * present** — because none of them toggled availability while an offer was open.
 */

/** The statuses a teacher may legitimately be in when they press their own pill. */
const SELF_OWNED = ['ONLINE', 'OFFLINE'];

describe('assertStatusChangeAllowed', () => {
  describe('the defect: going ONLINE out of a status the system owns', () => {
    for (const current of SYSTEM_OWNED_STATUSES) {
      it(`refuses ONLINE from ${current}`, () => {
        assert.throws(() => assertStatusChangeAllowed(current, 'ONLINE'), {
          code: ERROR_CODES.TEACHER_UNAVAILABLE,
        });
      });
    }

    it('says something a teacher can act on when an offer is waiting', () => {
      assert.throws(
        () => assertStatusChangeAllowed('OFFER_LOCKED', 'ONLINE'),
        (error) => {
          assert.match(error.message, /Accept or decline it/);
          return true;
        },
      );
    });

    it('says something different, and true, when the teacher is in a session', () => {
      assert.throws(
        () => assertStatusChangeAllowed('IN_SESSION', 'ONLINE'),
        (error) => {
          assert.match(error.message, /in a session/i);
          return true;
        },
      );
    });
  });

  describe('OFFLINE stays allowed, which is the half that must not regress', () => {
    // A teacher closing a laptop mid-offer is supported: it cannot manufacture a second
    // offer, because `lockTeacherForOffer` matches on ONLINE, and the conditional
    // release then leaves them OFFLINE rather than dragging them back online. PR 5.9
    // verified that end to end; this keeps the guard from quietly breaking it.
    for (const current of SYSTEM_OWNED_STATUSES) {
      it(`allows OFFLINE from ${current}`, () => {
        assert.doesNotThrow(() => assertStatusChangeAllowed(current, 'OFFLINE'));
      });
    }
  });

  describe('the ordinary paths are untouched', () => {
    for (const current of SELF_OWNED) {
      for (const next of SELF_OWNED) {
        it(`allows ${current} → ${next}`, () => {
          assert.doesNotThrow(() => assertStatusChangeAllowed(current, next));
        });
      }
    }

    it('is a no-op when the PATCH carried no status at all', () => {
      // A teacher editing their bio while an offer is open must still be able to save.
      assert.doesNotThrow(() => assertStatusChangeAllowed('OFFER_LOCKED', undefined));
    });
  });
});
