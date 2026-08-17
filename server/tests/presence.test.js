import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { AUTO_AWAY_MINUTES } from '#config/constants/index.js';
import {
  claimLastSeenWrite,
  PRESENCE_WRITE_INTERVAL_MS,
  resetPresenceDebounce,
} from '#services/presence.debounce.js';

/**
 * The `last_seen_at` write debounce — PR 5.2, MVP.md §10.
 *
 * **This file imports the debounce and nothing else, on purpose.** `npm test` is bare
 * `node --test` with no database and no fixtures, so a test that reached
 * `presence.service.js` would pull in the repository and therefore `PrismaClient` —
 * the constraint `offer.core.test.js` documents and works around the same way. What
 * is left over there — the write itself, the socket handler, the broadcast — is the
 * PR brief's manual test, because all three are facts about a connection rather than
 * about a function.
 *
 * The clock is injected rather than waited on. The interval is thirty minutes; a suite
 * that proved the debounce by sleeping through one would be a suite nobody runs.
 */

/** Any teacher id. The map is keyed by string and never parses it. */
const DANA = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const GIL = '9c858901-8a57-4791-81fe-4c455b099bc8';

/** A fixed origin, so every instant below is readable as an offset from it. */
const T0 = Date.UTC(2026, 7, 17, 9, 0, 0);

/** Minutes after `T0`, as epoch milliseconds. */
const at = (minutes) => T0 + minutes * 60 * 1000;

beforeEach(() => {
  // Module-level state, so without this the first test decides the second's answer.
  resetPresenceDebounce();
});

describe('PRESENCE_WRITE_INTERVAL_MS', () => {
  it('is half the auto-away window, derived rather than typed', () => {
    // The relationship is the whole argument for the debounce being safe: the column
    // is never more than this far behind reality, and the sweep asks whether it is a
    // full window old. A literal here would go on saying 30 the day somebody tunes
    // AUTO_AWAY_MINUTES down, and a teacher sitting at their desk would be swept.
    assert.equal(PRESENCE_WRITE_INTERVAL_MS, (AUTO_AWAY_MINUTES / 2) * 60 * 1000);
    assert.ok(PRESENCE_WRITE_INTERVAL_MS < AUTO_AWAY_MINUTES * 60 * 1000);
  });
});

describe('claimLastSeenWrite — the debounce', () => {
  it('writes on a teacher it has never seen', () => {
    // The first beat after a connect or a process restart always lands, so a teacher
    // is never invisible for an interval because the map was empty.
    assert.equal(claimLastSeenWrite(DANA, { now: at(0) }), true);
  });

  it('turns ten beats in a row into exactly one write', () => {
    // The acceptance criterion, and the reason the debounce exists: one UPDATE per
    // teacher per beat is write amplification the free-tier database does not need.
    const claims = Array.from({ length: 10 }, (_, beat) =>
      claimLastSeenWrite(DANA, { now: at(beat) }),
    );

    assert.deepEqual(claims.filter(Boolean).length, 1);
    assert.equal(claims[0], true);
  });

  it('writes again once the interval has passed', () => {
    assert.equal(claimLastSeenWrite(DANA, { now: at(0) }), true);
    assert.equal(claimLastSeenWrite(DANA, { now: at(0) + PRESENCE_WRITE_INTERVAL_MS - 1 }), false);
    assert.equal(claimLastSeenWrite(DANA, { now: at(0) + PRESENCE_WRITE_INTERVAL_MS }), true);
  });

  it('measures the interval from the last write and not from the last beat', () => {
    // A suppressed beat must not restart the clock. If it did, a teacher beating
    // every minute would never write again after the first one, and would be swept
    // offline while sitting there — the failure the whole feature exists to prevent.
    claimLastSeenWrite(DANA, { now: at(0) });

    for (let minute = 1; minute < AUTO_AWAY_MINUTES / 2; minute += 1) {
      assert.equal(claimLastSeenWrite(DANA, { now: at(minute) }), false);
    }

    assert.equal(claimLastSeenWrite(DANA, { now: at(AUTO_AWAY_MINUTES / 2) }), true);
  });

  it('is keyed per teacher, so one busy teacher cannot suppress another', () => {
    // A single module-level timestamp would pass every test above and fail this one,
    // and in production it would move exactly one arbitrary teacher's last_seen_at
    // while every heartbeat still arrived and every handler still ran.
    assert.equal(claimLastSeenWrite(DANA, { now: at(0) }), true);
    assert.equal(claimLastSeenWrite(GIL, { now: at(0) }), true);

    assert.equal(claimLastSeenWrite(DANA, { now: at(1) }), false);
    assert.equal(claimLastSeenWrite(GIL, { now: at(1) }), false);
  });

  it('lets `force` through the interval, for activity that is not a beat', () => {
    // Connecting the socket and setting status through PATCH /teachers/me. Both are
    // unambiguously a teacher being present, and both are rare enough to write on.
    assert.equal(claimLastSeenWrite(DANA, { now: at(0) }), true);
    assert.equal(claimLastSeenWrite(DANA, { now: at(1) }), false);
    assert.equal(claimLastSeenWrite(DANA, { now: at(1), force: true }), true);
  });

  it('restarts the interval from a forced write', () => {
    // A forced write is still a write: the beat after it is redundant and must be
    // suppressed, or a teacher toggling their pill would write twice in a second.
    claimLastSeenWrite(DANA, { now: at(0), force: true });

    assert.equal(claimLastSeenWrite(DANA, { now: at(1) }), false);
  });

  it('claims and records in one call, so a caller cannot ask twice', () => {
    // Two functions — a shouldWrite and a markWritten — would let a caller check and
    // then forget to answer, which is a row written on every beat with nothing
    // anywhere saying so. Asking twice at the same instant answers `false` the second
    // time, which is what proves the claim was taken by the first.
    assert.equal(claimLastSeenWrite(DANA, { now: at(0) }), true);
    assert.equal(claimLastSeenWrite(DANA, { now: at(0) }), false);
  });

  it('defaults `now` to the real clock', () => {
    // The production call site passes an instant, but the parameter is an injection
    // point rather than a requirement, and a default that was wrong would only ever
    // fail in production.
    assert.equal(claimLastSeenWrite(DANA), true);
    assert.equal(claimLastSeenWrite(DANA), false);
  });
});
