import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SOCKET_EVENTS } from '@tutor/shared';

import { ERROR_CODES } from '#config/errors/codes.js';
import { assertTransition, TRANSITIONS } from '#services/session.state.js';
import { sessionRoom, userRoom } from '#sockets/rooms.js';

/**
 * The session state machine, exhaustively — PR 6.2.
 *
 * **This file imports the rule and nothing else**, the arrangement `presence.test.js`
 * documents and `teacher.status.rules.test.js` follows: `npm test` runs bare
 * `node --test` with no database, and reaching a service that touches the repository
 * would pull in `PrismaClient`. `session.state.js` was written pure precisely so this
 * test could exist.
 *
 * **All 49 pairs, not the six that pass.** A transition table is not wrong in the edges
 * it contains; it is wrong in the ones it forgot to forbid. `ENDED → ACTIVE` resurrects
 * a session whose teacher has already been credited, `ACTIVE → ACTIVE` is a second
 * opening charge, and neither is reachable by any test that walks a legal path. The
 * pairs are generated from `TRANSITIONS`' own keys rather than from a list kept here —
 * a second list is a second table, and the day the enum grows an eighth value this test
 * grows fifteen cases without being edited.
 */

/**
 * The seven `SessionStatus` values, read off the table itself.
 *
 * Asserted against the Prisma enum by hand below rather than imported, because
 * importing `@prisma/client` for a string list would put a database driver in a suite
 * that deliberately has none.
 */
const STATUSES = Object.keys(TRANSITIONS);

/** The six edges §10's diagram draws, written out longhand as the independent copy. */
const LEGAL = [
  ['PENDING', 'OFFER_SENT'],
  ['OFFER_SENT', 'ACTIVE'],
  ['OFFER_SENT', 'PENDING'],
  ['ACTIVE', 'ENDED'],
  ['ACTIVE', 'NO_SHOW'],
  ['ENDED', 'RATED'],
];

const isLegal = (from, to) => LEGAL.some(([f, t]) => f === from && t === to);

describe('TRANSITIONS', () => {
  it('has exactly the seven statuses of the Prisma enum', () => {
    assert.deepEqual([...STATUSES].sort(), [
      'ACTIVE',
      'CANCELLED',
      'ENDED',
      'NO_SHOW',
      'OFFER_SENT',
      'PENDING',
      'RATED',
    ]);
  });

  it('is frozen, and so is every row', () => {
    assert.ok(Object.isFrozen(TRANSITIONS));

    for (const status of STATUSES) {
      assert.ok(Object.isFrozen(TRANSITIONS[status]), `${status}'s row is not frozen`);
    }
  });

  it('draws six edges and no seventh', () => {
    const edges = STATUSES.flatMap((from) => TRANSITIONS[from].map((to) => [from, to]));

    assert.equal(edges.length, 6);
    assert.deepEqual(new Set(edges.map(String)), new Set(LEGAL.map(String)));
  });

  it('leaves CANCELLED unreachable — §12 has no cancel endpoint', () => {
    const inbound = STATUSES.filter((from) => TRANSITIONS[from].includes('CANCELLED'));

    assert.deepEqual(inbound, []);
  });

  it('makes RATED, NO_SHOW and CANCELLED terminal', () => {
    for (const status of ['RATED', 'NO_SHOW', 'CANCELLED']) {
      assert.deepEqual(TRANSITIONS[status], [], `${status} has an outbound edge`);
    }
  });
});

describe('assertTransition — all 49 pairs', () => {
  /**
   * Seven times seven. The count is asserted at the end so that a table which somehow
   * shrinks does not quietly turn this into a smaller suite that still passes.
   */
  let checked = 0;

  for (const from of STATUSES) {
    for (const to of STATUSES) {
      checked += 1;

      if (isLegal(from, to)) {
        it(`allows ${from} → ${to}`, () => {
          assert.doesNotThrow(() => assertTransition(from, to));
        });
      } else {
        it(`refuses ${from} → ${to}`, () => {
          assert.throws(() => assertTransition(from, to), {
            name: 'AppError',
            code: ERROR_CODES.SESSION_NOT_ACTIVE,
            statusCode: 409,
          });
        });
      }
    }
  }

  it('covered every pair — 7 × 7', () => {
    assert.equal(checked, 49);
    assert.equal(LEGAL.length, 6);
  });
});

describe('assertTransition — the pairs that would cost money', () => {
  /**
   * Named on their own, above the generated forty-three, because these are the ones a
   * table with a missing guard actually gets wrong. Each is already covered by the loop;
   * the duplication is deliberate and it is documentation — a failure here says what
   * broke in the language of the product rather than as one of forty-three refusals.
   */
  it('refuses ACTIVE → ACTIVE — a second opening charge', () => {
    assert.throws(() => assertTransition('ACTIVE', 'ACTIVE'), {
      code: ERROR_CODES.SESSION_NOT_ACTIVE,
    });
  });

  it('refuses ENDED → ACTIVE — the teacher has already been credited', () => {
    assert.throws(() => assertTransition('ENDED', 'ACTIVE'), {
      code: ERROR_CODES.SESSION_NOT_ACTIVE,
    });
  });

  it('refuses RATED → RATED — one review per session', () => {
    assert.throws(() => assertTransition('RATED', 'RATED'), {
      code: ERROR_CODES.SESSION_NOT_ACTIVE,
    });
  });

  it('refuses NO_SHOW → RATED — a no-show is not rated, it is refunded', () => {
    assert.throws(() => assertTransition('NO_SHOW', 'RATED'), {
      code: ERROR_CODES.SESSION_NOT_ACTIVE,
    });
  });

  it('refuses PENDING → ACTIVE — a session with no accepted offer', () => {
    assert.throws(() => assertTransition('PENDING', 'ACTIVE'), {
      code: ERROR_CODES.SESSION_NOT_ACTIVE,
    });
  });
});

describe('assertTransition — inputs that are not statuses', () => {
  /**
   * `from` arrives from a database column and cannot be junk, but `null` is what a
   * missing row reads as, and a lookup that threw `TypeError` on it would surface as a
   * 500 for something the machine already has an answer to.
   */
  for (const from of [null, undefined, '', 'active', 'ended']) {
    it(`refuses ${JSON.stringify(from)} → ACTIVE without a TypeError`, () => {
      assert.throws(() => assertTransition(from, 'ACTIVE'), {
        name: 'AppError',
        code: ERROR_CODES.SESSION_NOT_ACTIVE,
      });
    });
  }

  it('refuses a lowercase target', () => {
    assert.throws(() => assertTransition('ACTIVE', 'ended'), {
      code: ERROR_CODES.SESSION_NOT_ACTIVE,
    });
  });

  it('does not treat an inherited property as an edge', () => {
    assert.throws(() => assertTransition('constructor', 'ACTIVE'), {
      code: ERROR_CODES.SESSION_NOT_ACTIVE,
    });
    assert.throws(() => assertTransition('ACTIVE', 'toString'), {
      code: ERROR_CODES.SESSION_NOT_ACTIVE,
    });
  });

  it('never leaks the statuses into the response body', () => {
    assert.throws(
      () => assertTransition('ENDED', 'ACTIVE'),
      (error) => {
        assert.equal(error.details, null);
        assert.ok(!/ENDED|ACTIVE/.test(error.message));
        return true;
      },
    );
  });
});

describe("E6's socket contract", () => {
  /**
   * The other half of what 6.2 freezes. `offer.core.test.js` pins E5's six the same
   * way and each epic asserts its own block, so a broken name says which contract
   * broke rather than which file noticed.
   *
   * Importing `#sockets/rooms.js` is safe here for the reason `offer.core.test.js`
   * already relies on: that file is two template literals and imports nothing. The
   * emitters are not imported and cannot be — `events.js` pulls in the socket server,
   * which pulls in `#config/env.js`, which exits on a missing `DATABASE_URL`.
   */
  const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  it("names E6's six events exactly as the contract freeze does", () => {
    for (const [key, value] of Object.entries({
      SESSION_BLOCK_WARNING: 'session:block_warning',
      SESSION_EXTENDED: 'session:extended',
      SESSION_ENDED: 'session:ended',
      SESSION_PARTICIPANT_LEFT: 'session:participant_left',
      TEACHER_AWAY_WARNING: 'teacher:away_warning',
      SESSION_JOIN: 'session:join',
    })) {
      assert.equal(SOCKET_EVENTS[key], value, `${key} moved`);
    }
  });

  it('left wallet:updated to E7, and E7 took it', () => {
    // §13 lists it and E6 did not append it: there was no wallet screen to update, and
    // the session screen learns its balance from `session:extended`, which it is already
    // listening to. **PR 7.3 appended it** — the rule both epics wrote down is "added by
    // the epic that emits them", and E7 is that epic.
    //
    // The half of this test that is still E6's, and the reason it stayed here rather
    // than moving: **E6's six are untouched by that append.** A later epic may add a
    // name; it may not rename one of these.
    assert.equal(SOCKET_EVENTS.WALLET_UPDATED, 'wallet:updated');
    assert.equal(SOCKET_EVENTS.SESSION_EXTENDED, 'session:extended');
    assert.equal(SOCKET_EVENTS.SESSION_BLOCK_WARNING, 'session:block_warning');
  });

  it('addresses a session room by id, with a prefix, and not the user room', () => {
    // Unprefixed, a room name could collide with a socket's own id — Socket.IO puts
    // every socket in a room named after it. The two prefixes must also differ, or a
    // session room and a user room with the same uuid would be one room.
    assert.equal(sessionRoom(UUID), `session:${UUID}`);
    assert.notEqual(sessionRoom(UUID), userRoom(UUID));
  });
});
