import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it } from 'node:test';

/**
 * The Daily video layer — PR 6.1, `OWNERSHIP.md` §2.1.
 *
 * **What this file does not test, said first.** Nothing here reaches `api.daily.co`.
 * That a room really is created, that its URL opens, and that Daily refuses a caller
 * without a token are the brief's manual test, run once by hand with a real key;
 * `notification.test.js` draws the same line around Resend and for the same reason.
 * `globalThis.fetch` is replaced before every test and restored after, so a developer
 * with a key in their shell runs the same suite CI does.
 *
 * What is testable is everything this PR actually decided: the two guards, the
 * request bodies the provider is sent — `max_participants: 2` is the only thing
 * stopping a third person walking into a lesson — the failure mapping, and the two
 * TTLs now that they come from `env` rather than from literals.
 *
 * **The seam is what is being frozen here.** `createSessionVideo` and
 * `createSessionVideoAccess` are called by PRs 6.3 and 6.4, which are not written
 * yet, so the assertions on the returned shapes are the contract those PRs will be
 * built against rather than a restatement of the implementation.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

/**
 * A key, so the happy paths run — but a fake one, and `fetch` never survives long
 * enough to carry it anywhere. Set before the imports below, because `config/env.js`
 * parses the environment once, at import.
 */
process.env.DAILY_API_KEY = 'test-daily-key-never-sent';

/**
 * Both TTLs present and blank, which is exactly what a developer gets by copying
 * `.env.example`. dotenv reads that as `''`, and the defaults asserted further down
 * are what says `''` was understood as "not set" rather than coerced to `0`.
 */
process.env.VIDEO_ROOM_TTL_SECONDS = '';
process.env.VIDEO_TOKEN_TTL_SECONDS = '';

const { ERROR_CODES } = await import('#config/errors/codes.js');
const { VIDEO_ROOM_TTL_SECONDS, VIDEO_TOKEN_TTL_SECONDS } = await import('#config/video.js');
const { DAILY_API_URL } = await import('#services/video.daily.service.js');
const { env } = await import('#config/env.js');
const { createSessionVideo, createSessionVideoAccess } = await import('#services/video.service.js');

/** What Daily's `POST /rooms` returns, trimmed to the fields the service reads. */
const ROOM_RESPONSE = {
  name: 'abc123',
  url: 'https://tutornow.daily.co/abc123',
};

const TOKEN_RESPONSE = { token: 'eyJhbGciOi.test.token' };

const SESSION_ID = '33333333-3333-4333-8333-333333333333';

const realFetch = globalThis.fetch;

/** Every call the stub saw, in order — `{ url, method, headers, body }`. */
let calls = [];

/** Replaces `fetch` with one that answers `payload` and records what it was asked. */
function stubFetch({ ok = true, payload = {} } = {}) {
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url,
      method: options.method,
      headers: options.headers ?? {},
      body: options.body ? JSON.parse(options.body) : null,
    });

    return {
      ok,
      status: ok ? 200 : 502,
      json: async () => payload,
    };
  };
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('the two TTLs', () => {
  it('fall back to the branch defaults when the variables are present and blank', () => {
    assert.equal(VIDEO_ROOM_TTL_SECONDS, 86400);
    assert.equal(VIDEO_TOKEN_TTL_SECONDS, 3600);
  });

  it('are settable, which is the only thing PR 6.1 changed about them', () => {
    // A child process, because `config/env.js` parses once per process and this one
    // has already parsed with both blank. Nothing here touches the network: the
    // child imports the config module and prints two numbers.
    const script =
      "import('./server/src/config/video.js').then((m) => " +
      'console.log(m.VIDEO_ROOM_TTL_SECONDS, m.VIDEO_TOKEN_TTL_SECONDS));';

    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, VIDEO_ROOM_TTL_SECONDS: '1234', VIDEO_TOKEN_TTL_SECONDS: '56' },
      encoding: 'utf8',
    });

    assert.equal(output.trim(), '1234 56');
  });
});

describe('createSessionVideo', () => {
  it('refuses without a session id, and does not call the provider', async () => {
    stubFetch();

    await assert.rejects(() => createSessionVideo(), {
      code: ERROR_CODES.VALIDATION_ERROR,
    });
    assert.equal(calls.length, 0);
  });

  it('returns what the caller must persist', async () => {
    stubFetch({ payload: ROOM_RESPONSE });

    const before = Math.floor(Date.now() / 1000);
    const room = await createSessionVideo(SESSION_ID);

    assert.equal(room.provider, 'daily');
    // PR 6.0's `sessions.video_room_name` and `video_room_url` are written from
    // exactly these two fields, by PR 6.3.
    assert.equal(room.roomName, ROOM_RESPONSE.name);
    assert.equal(room.roomUrl, ROOM_RESPONSE.url);
    assert.ok(room.expiresAt >= before + VIDEO_ROOM_TTL_SECONDS);
  });

  it('creates a private two-seat room that Daily evicts at expiry', async () => {
    stubFetch({ payload: ROOM_RESPONSE });

    await createSessionVideo(SESSION_ID);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${DAILY_API_URL}/rooms`);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].body.privacy, 'private');
    // The only thing stopping a third person walking into a lesson.
    assert.equal(calls[0].body.properties.max_participants, 2);
    assert.equal(calls[0].body.properties.eject_at_room_exp, true);
  });

  it('sends the key as a bearer token and tells the provider nothing about the session', async () => {
    stubFetch({ payload: ROOM_RESPONSE });

    await createSessionVideo(SESSION_ID);

    assert.equal(calls[0].headers.Authorization, `Bearer ${env.DAILY_API_KEY}`);
    // The id is validated and then deliberately unused — the room is not named after
    // the session and Daily is never told the id exists. It stays in the signature so
    // that naming rooms per session later moves no caller.
    assert.ok(!JSON.stringify(calls[0].body).includes(SESSION_ID));
  });

  it('maps a provider failure to EXTERNAL_SERVICE_ERROR, never a bare Error', async () => {
    stubFetch({ ok: false });

    await assert.rejects(() => createSessionVideo(SESSION_ID), {
      code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
    });
  });
});

describe('createSessionVideoAccess', () => {
  const access = {
    roomName: 'abc123',
    userId: '11111111-1111-4111-8111-111111111111',
    userName: 'Yael Cohen',
  };

  it('refuses a partial argument, and does not call the provider', async () => {
    stubFetch();

    for (const missing of ['roomName', 'userId', 'userName']) {
      await assert.rejects(() => createSessionVideoAccess({ ...access, [missing]: undefined }), {
        code: ERROR_CODES.VALIDATION_ERROR,
      });
    }

    assert.equal(calls.length, 0);
  });

  it('mints a token scoped to one room and one caller', async () => {
    stubFetch({ payload: TOKEN_RESPONSE });

    const before = Math.floor(Date.now() / 1000);
    const result = await createSessionVideoAccess(access);

    assert.equal(result.token, TOKEN_RESPONSE.token);
    assert.ok(result.expiresAt >= before + VIDEO_TOKEN_TTL_SECONDS);

    assert.equal(calls[0].url, `${DAILY_API_URL}/meeting-tokens`);
    assert.equal(calls[0].body.properties.room_name, access.roomName);
    assert.equal(calls[0].body.properties.user_id, access.userId);
    // The display name comes from the caller, and from PR 6.4 that caller is the
    // database rather than a request body — which is the whole reason the two
    // endpoints on `dev-c/daily-video` were deleted rather than moved.
    assert.equal(calls[0].body.properties.user_name, access.userName);
    assert.equal(calls[0].body.properties.exp, result.expiresAt);
  });

  it('maps a provider failure to EXTERNAL_SERVICE_ERROR', async () => {
    stubFetch({ ok: false });

    await assert.rejects(() => createSessionVideoAccess(access), {
      code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
    });
  });
});

describe('with no DAILY_API_KEY', () => {
  /**
   * `config/env.js` parses once at import, so the only way to see both branches in
   * one process is to take the key off the parsed object and put it back. The
   * assertion is about the error's *code*: PR 6.3 catches it to start a session with
   * `video_room_*` left null, and a bare `Error` — which is what this was before PR
   * 6.1 — reaches `errorHandler` as a codeless 500 and fails the accept instead.
   */
  const configuredKey = env.DAILY_API_KEY;

  beforeEach(() => {
    env.DAILY_API_KEY = undefined;
    stubFetch();
  });

  afterEach(() => {
    env.DAILY_API_KEY = configuredKey;
  });

  it('rejects room creation with EXTERNAL_SERVICE_ERROR and calls nothing', async () => {
    await assert.rejects(() => createSessionVideo(SESSION_ID), {
      code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
    });
    assert.equal(calls.length, 0);
  });

  it('rejects token minting the same way', async () => {
    await assert.rejects(
      () =>
        createSessionVideoAccess({
          roomName: 'abc123',
          userId: '11111111-1111-4111-8111-111111111111',
          userName: 'Yael Cohen',
        }),
      { code: ERROR_CODES.EXTERNAL_SERVICE_ERROR },
    );
    assert.equal(calls.length, 0);
  });
});
