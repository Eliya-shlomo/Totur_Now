import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SOCKET_EVENTS } from '@tutor/shared';

import { NEW_TEACHER_FEE_DAYS, OFFER_STATUS, PLATFORM_FEE_PCT } from '#config/constants/index.js';
import { userRoom } from '#sockets/rooms.js';
import { platformFeeRate } from '#utils/commission.js';
import { offerByIdSchema } from '#validators/offer.schema.js';
import { sendOfferSchema, sessionByIdSchema } from '#validators/session.schema.js';

/**
 * The E5 seam — MVP.md §5.3, §12, §13.
 *
 * Small on purpose. **This is the freeze, not the coverage.** What is pinned here is
 * the input surface, the one pure function that ships with a real body, and the
 * catalogue of event names — the three things later PRs consume without re-deciding.
 * 5.4 owns the tests for the respond transaction and 5.5 owns the sweep's.
 *
 * **Nothing here imports a repository, a router or the socket server**, and that is a
 * constraint rather than an oversight: `npm test` is bare `node --test` with no
 * database and no fixtures, and importing any of those pulls in `#config/db.js` and
 * `#config/env.js`, which `process.exit(1)`s on a missing `DATABASE_URL`. The routes
 * and the handshake are checked by the manual test in the PR brief, exactly as 4.1's
 * freeze test left its endpoint to one.
 *
 * Nothing below types a rate or a fee window. A test that wrote `0.15` would pass for
 * the wrong reason the day somebody tunes §5.3 — `pricing.test.js` has the full story
 * on why that matters, and it is the same mistake in a different file.
 */

/** A valid uuid, so that a rejection is about the field under test and not the shape. */
const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** The three parts `validate` hands a schema. */
const request = ({ body = {}, params = {}, query = {} } = {}) => ({ body, params, query });

/** Days before or after now, as an instant. */
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/**
 * A wall-clock hour in TIMEZONE, on a date old enough that the new-teacher window is
 * irrelevant. Built from an ISO string with an explicit offset rather than from local
 * time, because the test would otherwise assert whatever timezone it runs in — which
 * is the exact bug `#utils/time.js` exists to prevent.
 *
 * 17 August 2026 is inside Israel Daylight Time, so the offset is +03:00.
 */
const israelTime = (hhmm) => new Date(`2026-08-17T${hhmm}:00+03:00`);

describe('platformFeeRate — §5.3', () => {
  it('takes nothing from a teacher inside their first month, at any hour', () => {
    // The stronger of the two exemptions: a new teacher pays nothing even at the
    // busiest hour of the day. Asserted at an hour that is *not* low-demand, so a
    // function that only ever checked the clock would fail here.
    const rate = platformFeeRate({ teacherCreatedAt: daysAgo(1), at: israelTime('20:00') });

    assert.equal(rate, 0);
  });

  it('takes nothing in the low-demand window, however old the teacher is', () => {
    const rate = platformFeeRate({
      teacherCreatedAt: daysAgo(NEW_TEACHER_FEE_DAYS * 10),
      at: israelTime('09:00'),
    });

    assert.equal(rate, 0);
  });

  it('takes the platform fee from an established teacher at a busy hour', () => {
    const rate = platformFeeRate({
      teacherCreatedAt: daysAgo(NEW_TEACHER_FEE_DAYS * 10),
      at: israelTime('20:00'),
    });

    assert.equal(rate, PLATFORM_FEE_PCT);
  });

  it('resolves the hour in TIMEZONE and not in the host timezone', () => {
    // 03:00 UTC is 06:00 in Israel, which is the first low-demand hour. A function
    // written against `getHours()` answers 3 on Render and 6 on a laptop here, so
    // this is the assertion that catches the whole class of bug — and it is why the
    // instants above carry an explicit offset.
    const established = daysAgo(NEW_TEACHER_FEE_DAYS * 10);

    assert.equal(platformFeeRate({ teacherCreatedAt: established, at: israelTime('06:00') }), 0);
    assert.equal(
      platformFeeRate({ teacherCreatedAt: established, at: israelTime('05:00') }),
      PLATFORM_FEE_PCT,
    );
  });

  it('accepts the created-at as a string, the way a database row hands it over', () => {
    const rate = platformFeeRate({ teacherCreatedAt: daysAgo(1).toISOString() });

    assert.equal(rate, 0);
  });
});

describe('sendOfferSchema — POST /sessions/:id/offer', () => {
  it('accepts a session id and a teacher id, and nothing else', () => {
    const parsed = sendOfferSchema.parse(
      request({ body: { teacherId: UUID }, params: { id: UUID } }),
    );

    assert.equal(parsed.body.teacherId, UUID);
    assert.equal(parsed.params.id, UUID);
  });

  it('refuses an empty body', () => {
    // `{}` must be a VALIDATION_ERROR rather than an offer sent to nobody.
    assert.throws(() => sendOfferSchema.parse(request({ params: { id: UUID } })));
  });

  it('refuses a teacher id that is not a uuid', () => {
    // `users.id` is @db.Uuid and Postgres raises 22P02 on a malformed one, so an
    // uncaught typo here is a 500 for what is plainly a bad request.
    assert.throws(() =>
      sendOfferSchema.parse(request({ body: { teacherId: 'x' }, params: { id: UUID } })),
    );
  });

  it('refuses an unknown key in the body', () => {
    // Notably a price. 5.3 reads `price_per_block` from the teacher's row, and a
    // price that arrives from the client is a price the client can choose.
    assert.throws(() =>
      sendOfferSchema.parse(
        request({ body: { teacherId: UUID, pricePerBlock: 1 }, params: { id: UUID } }),
      ),
    );
  });

  it('names the parameter when the session id is malformed', () => {
    // The message reaches the student through `fieldErrors`, so it is asserted as
    // being about `id` rather than merely being a rejection.
    const result = sendOfferSchema.safeParse(
      request({ body: { teacherId: UUID }, params: { id: 'not-a-uuid' } }),
    );

    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues[0].path, ['params', 'id']);
  });
});

describe('sessionByIdSchema and offerByIdSchema — the params-only routes', () => {
  for (const [name, schema] of [
    ['sessionByIdSchema', sessionByIdSchema],
    ['offerByIdSchema', offerByIdSchema],
  ]) {
    it(`${name} accepts a uuid and refuses anything in the body`, () => {
      assert.equal(schema.parse(request({ params: { id: UUID } })).params.id, UUID);
      assert.throws(() =>
        schema.parse(request({ body: { sessionId: UUID }, params: { id: UUID } })),
      );
    });

    it(`${name} refuses a malformed id and refuses a query string`, () => {
      assert.throws(() => schema.parse(request({ params: { id: 'nope' } })));
      assert.throws(() => schema.parse(request({ params: { id: UUID }, query: { force: '1' } })));
    });
  }
});

describe('the socket contract', () => {
  it('catalogues six events and not eleven', () => {
    // §13 lists eleven. The other five belong to E6's meter and E7's wallet, and a
    // catalogue of names nothing emits stops being trustworthy. This is the
    // assertion that makes appending one a deliberate act.
    assert.equal(Object.keys(SOCKET_EVENTS).length, 6);
  });

  it('names every event exactly as the contract freeze does', () => {
    // The strings, not the keys: the client switches on these values, and a rename
    // that only one side learns about is a screen that never updates and no error
    // anywhere. Written out rather than derived, so a typo cannot agree with itself.
    assert.deepEqual(SOCKET_EVENTS, {
      OFFER_NEW: 'offer:new',
      OFFER_EXPIRED: 'offer:expired',
      OFFER_ACCEPTED: 'offer:accepted',
      OFFER_REJECTED: 'offer:rejected',
      TEACHER_STATUS: 'teacher:status',
      TEACHER_HEARTBEAT: 'teacher:heartbeat',
    });
  });

  it('addresses a user room by id, with a prefix', () => {
    // Unprefixed, a room name could collide with a socket's own id — Socket.IO puts
    // every socket in a room named after it.
    assert.equal(userRoom(UUID), `user:${UUID}`);
  });
});

describe('OFFER_STATUS', () => {
  it('carries the four values `offers.status` takes', () => {
    // The column is a VarChar(20), not a Postgres enum, so Prisma's generated types
    // will not catch a typo the way they catch a bad SessionStatus. This object is
    // the only thing that will.
    assert.deepEqual(Object.keys(OFFER_STATUS).sort(), [
      'ACCEPTED',
      'EXPIRED',
      'PENDING',
      'REJECTED',
    ]);
  });

  it('is frozen, so a caller cannot invent a fifth', () => {
    assert.ok(Object.isFrozen(OFFER_STATUS));
  });
});
