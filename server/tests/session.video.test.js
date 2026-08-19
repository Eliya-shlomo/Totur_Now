import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `GET /sessions/:id/video` — PR 6.4, and the epic's security boundary.
 *
 * **Read the failure paths first, because this file is mostly failure paths.** Four
 * different things go wrong here — no such session, not the caller's session, a session
 * that is not `ACTIVE`, and a provider that is down — and three of them must be
 * indistinguishable over the wire. The suite asserts that as *one* assertion on the four
 * thrown errors rather than four separate expectations, because four separate
 * expectations are four places a later PR can helpfully make one of them a `403`.
 *
 * **Nothing here mints a token and nothing here reaches Daily.** `getSessionVideoContext`
 * answers *may this person join, and which room* — the mint is `createSessionVideoAccess`,
 * frozen at 6.1 and asserted in `video.service.test.js` against a stubbed `fetch`. The
 * controller is the only place the two meet, and it is checked below by reading its text:
 * with no way to inject a service into a static import, the properties worth protecting
 * there — one call site, no display name off the wire, no cached token — are properties of
 * the source rather than of a return value.
 *
 * Every collaborator arrives through the third argument, 3.3's idiom, which is what lets
 * the stranger's request be asserted to read one row and create nothing at all.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5433/unused';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters';

const { ERROR_CODES } = await import('#config/errors/codes.js');
const { getSessionVideoContext } = await import('#services/session.video.service.js');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TEACHER_ID = '44444444-4444-4444-8444-444444444444';

const ROOM_NAME = 'abc123';
const ROOM_URL = 'https://tutornow.daily.co/abc123';

/** Records every call, and returns whatever the implementation says. */
function spy(implementation = () => undefined) {
  const fn = (...args) => {
    fn.calls.push(args);

    return implementation(...args);
  };

  fn.calls = [];

  return fn;
}

/** A `findSessionForVideo` row — both participants' names, both video columns. */
const sessionRow = (overrides = {}) => ({
  id: SESSION_ID,
  status: 'ACTIVE',
  studentId: STUDENT_ID,
  teacherId: TEACHER_ID,
  videoRoomName: ROOM_NAME,
  videoRoomUrl: ROOM_URL,
  student: { id: STUDENT_ID, fullName: 'Dana Student' },
  teacher: { id: TEACHER_ID, fullName: 'Rotem Teacher' },
  ...overrides,
});

/**
 * The service with a row in front of it and nothing behind it. `rows` is a list because
 * the repair path reads twice — the first read is the null-columned row and the second is
 * whatever the write left behind.
 */
function deps({ rows = [sessionRow()], repair = () => true } = {}) {
  const remaining = [...rows];

  return {
    loadSession: spy(() => (remaining.length > 1 ? remaining.shift() : remaining[0])),
    repairRoom: spy(repair),
  };
}

/** The error a call threw, or `null` if it did not throw. */
async function thrownBy(promise) {
  try {
    await promise;

    return null;
  } catch (error) {
    return error;
  }
}

describe('the participation check', () => {
  it('answers the student with the room and their own name', async () => {
    const context = await getSessionVideoContext(SESSION_ID, STUDENT_ID, deps());

    assert.deepEqual(context, {
      roomName: ROOM_NAME,
      roomUrl: ROOM_URL,
      userName: 'Dana Student',
    });
  });

  it('answers the teacher with the same room and *their* name', async () => {
    const context = await getSessionVideoContext(SESSION_ID, TEACHER_ID, deps());

    assert.equal(context.roomName, ROOM_NAME);
    assert.equal(context.userName, 'Rotem Teacher');
  });

  it('reads one row and creates nothing on the happy path', async () => {
    const collaborators = deps();

    await getSessionVideoContext(SESSION_ID, STUDENT_ID, collaborators);

    assert.equal(collaborators.loadSession.calls.length, 1);
    assert.deepEqual(collaborators.loadSession.calls[0], [SESSION_ID]);
    assert.equal(collaborators.repairRoom.calls.length, 0);
  });

  it('refuses a third user, and mints nothing on their behalf', async () => {
    const collaborators = deps();
    const error = await thrownBy(getSessionVideoContext(SESSION_ID, STRANGER_ID, collaborators));

    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
    assert.equal(collaborators.repairRoom.calls.length, 0);
  });

  it('refuses a session that does not exist', async () => {
    const error = await thrownBy(
      getSessionVideoContext(SESSION_ID, STUDENT_ID, deps({ rows: [null] })),
    );

    assert.equal(error.code, ERROR_CODES.NOT_FOUND);
  });

  /**
   * The allowlist, stated as a list. `!== 'ENDED'` passes a test written against `ENDED`
   * alone and hands a token to a `PENDING` session's student — so every value §10's
   * diagram has is named here, and the day a status is added this test is where it is
   * decided rather than a place it slipped through.
   */
  for (const status of ['PENDING', 'OFFER_SENT', 'ENDED', 'RATED', 'CANCELLED', 'NO_SHOW']) {
    it(`refuses a ${status} session — for a participant as much as a stranger`, async () => {
      const rows = [sessionRow({ status })];

      const asStudent = await thrownBy(
        getSessionVideoContext(SESSION_ID, STUDENT_ID, deps({ rows })),
      );
      const asTeacher = await thrownBy(
        getSessionVideoContext(SESSION_ID, TEACHER_ID, deps({ rows })),
      );
      const asStranger = await thrownBy(
        getSessionVideoContext(SESSION_ID, STRANGER_ID, deps({ rows })),
      );

      assert.equal(asStudent.code, ERROR_CODES.NOT_FOUND);
      assert.equal(asTeacher.code, ERROR_CODES.NOT_FOUND);
      assert.equal(asStranger.code, ERROR_CODES.NOT_FOUND);
    });
  }
});

describe('the three refusals are one refusal over the wire', () => {
  it('answers a stranger, a missing session and an ended session identically', async () => {
    const refusals = await Promise.all([
      thrownBy(getSessionVideoContext(SESSION_ID, STRANGER_ID, deps())),
      thrownBy(getSessionVideoContext(SESSION_ID, STUDENT_ID, deps({ rows: [null] }))),
      thrownBy(
        getSessionVideoContext(
          SESSION_ID,
          STUDENT_ID,
          deps({ rows: [sessionRow({ status: 'ENDED' })] }),
        ),
      ),
    ]);

    // Status, code and message. A `403` on any one of them confirms the id is real, and
    // a message that says "not active" beside one that says "not found" is the same leak
    // spelled out in English — which is what the brief means by an oracle built out of
    // two individually correct decisions.
    const [first] = refusals;

    for (const refusal of refusals) {
      assert.equal(refusal.statusCode, 404);
      assert.equal(refusal.code, first.code);
      assert.equal(refusal.message, first.message);
    }
  });

  it('agrees with `GET /sessions/:id`, which answers a stranger the same way', async () => {
    const { getSessionView } = await import('#services/session.view.service.js');

    const fromVideo = await thrownBy(getSessionVideoContext(SESSION_ID, STRANGER_ID, deps()));
    const fromView = await thrownBy(
      getSessionView(
        { sessionId: SESSION_ID, userId: STRANGER_ID },
        { loadSession: () => sessionRow() },
      ),
    );

    assert.equal(fromVideo.statusCode, fromView.statusCode);
    assert.equal(fromVideo.code, fromView.code);
    assert.equal(fromVideo.message, fromView.message);
  });
});

describe('the repair path — 6.3 activated without a room', () => {
  const withoutRoom = sessionRow({ videoRoomName: null, videoRoomUrl: null });

  it('creates the room on the first join and answers with it', async () => {
    const collaborators = deps({ rows: [withoutRoom, sessionRow()] });

    const context = await getSessionVideoContext(SESSION_ID, STUDENT_ID, collaborators);

    assert.deepEqual(collaborators.repairRoom.calls, [[SESSION_ID]]);
    assert.equal(context.roomName, ROOM_NAME);
    assert.equal(context.roomUrl, ROOM_URL);
  });

  /**
   * Both participants pressing join in the same second. `setSessionVideoRoom` matches on
   * `video_room_name IS NULL`, so the loser persists nothing and `attachSessionVideo`
   * resolves `false` — and the loser must answer with the **winner's** room rather than
   * with the one it just created and threw away. Two rooms here is one person alone in a
   * lesson the other cannot see.
   */
  it('answers with the winner’s room when it lost the race', async () => {
    const winner = sessionRow({ videoRoomName: 'winner-room', videoRoomUrl: 'https://d/winner' });
    const collaborators = deps({ rows: [withoutRoom, winner], repair: () => false });

    const context = await getSessionVideoContext(SESSION_ID, TEACHER_ID, collaborators);

    assert.equal(context.roomName, 'winner-room');
    assert.equal(context.roomUrl, 'https://d/winner');
    assert.equal(collaborators.repairRoom.calls.length, 1);
  });

  it('repairs once per call, and only while both columns are null', async () => {
    const halfWritten = sessionRow({ videoRoomUrl: null });
    const collaborators = deps({ rows: [halfWritten, sessionRow()] });

    await getSessionVideoContext(SESSION_ID, STUDENT_ID, collaborators);

    assert.equal(collaborators.repairRoom.calls.length, 1);
  });

  /**
   * 6.3 could swallow this — nothing was waiting on a camera and the accept still had a
   * session to answer with. Here the caller asked for a call and cannot have one, so it
   * is the one genuine 502 on this endpoint, and it is *not* the `404` above: a
   * participant of a live session has already been told their session is real.
   */
  it('answers EXTERNAL_SERVICE_ERROR when the room still could not be created', async () => {
    const collaborators = deps({ rows: [withoutRoom, withoutRoom], repair: () => false });

    const error = await thrownBy(getSessionVideoContext(SESSION_ID, STUDENT_ID, collaborators));

    assert.equal(error.code, ERROR_CODES.EXTERNAL_SERVICE_ERROR);
    assert.equal(error.statusCode, 502);
  });

  it('never repairs a session it just refused', async () => {
    const collaborators = deps({ rows: [withoutRoom] });

    await thrownBy(getSessionVideoContext(SESSION_ID, STRANGER_ID, collaborators));

    assert.equal(collaborators.repairRoom.calls.length, 0);
  });
});

const controllerSource = await readFile(
  fileURLToPath(new URL('../src/controllers/session.controller.js', import.meta.url)),
  'utf8',
);

const serviceSource = await readFile(
  fileURLToPath(new URL('../src/services/session.video.service.js', import.meta.url)),
  'utf8',
);

const handlerSource = controllerSource.slice(
  controllerSource.indexOf('export async function getSessionVideo('),
  controllerSource.indexOf('export async function extendSession('),
);

describe('the handler, read rather than called', () => {
  /**
   * The endpoint 6.1 deleted took the display name from the request body, so a stranger
   * could walk in *and* choose the name on their tile. There is no return value that
   * proves the replacement does not — the proof is that neither the handler nor the
   * service ever names `req.body` or `req.query`.
   */
  it('takes nothing off the wire but the path id and the token’s user', () => {
    assert.equal(/req\.(body|query)/.test(handlerSource), false);
    assert.equal(/req\.(body|query)/.test(serviceSource), false);
    assert.match(handlerSource, /req\.params\.id/);
    assert.match(handlerSource, /req\.user\.id/);
  });

  it('mints through the one seam, and hands it the room name it just read', () => {
    assert.match(handlerSource, /createSessionVideoAccess\(\{[\s\S]*roomName: context\.roomName/);
    assert.match(handlerSource, /userName: context\.userName/);
  });

  /**
   * `SessionVideoResponse.expiresAt` is ISO 8601 and Daily's `exp` is epoch seconds.
   * Spreading the mint's result — which is what the brief's sketch does — puts a number
   * on a field 6.7 will call `new Date()` on.
   */
  it('answers the token’s expiry as ISO 8601, not as epoch seconds', () => {
    assert.match(handlerSource, /new Date\(access\.expiresAt \* 1000\)\.toISOString\(\)/);
  });

  it('takes the room URL from the session and never from the mint', () => {
    assert.match(handlerSource, /roomUrl: context\.roomUrl/);
    assert.equal(/roomUrl: access/.test(handlerSource), false);
  });

  /**
   * The acceptance criterion, run as a test: one call site in the whole server. A second
   * one is a second answer to "who may have a token", and the first thing it will not
   * have is the participation check.
   */
  it('is the only place in the server that mints a token', async () => {
    const { execFileSync } = await import('node:child_process');

    const src = fileURLToPath(new URL('../src', import.meta.url));

    // Call sites, not mentions. Both this seam's own file and the service beside it
    // describe it in prose, and a grep that counted those would be a grep nobody could
    // keep green — so the comment lines are dropped and what is left is code that calls.
    const callSites = execFileSync('grep', ['-rn', 'createSessionVideoAccess(', src], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter((line) => {
        const code = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1).trim();

        return !code.startsWith('*') && !code.startsWith('//');
      })
      .map((line) => line.split(':')[0].split('/').slice(-2).join('/'));

    // The seam's own definition, and the one handler that calls it.
    assert.deepEqual(callSites.sort(), [
      'controllers/session.controller.js',
      'services/video.service.js',
    ]);
  });

  it('caches nothing — the token is minted inside the handler, per call', () => {
    assert.equal(/let |Map\(|cache/i.test(handlerSource), false);
    assert.match(handlerSource, /const access = await createSessionVideoAccess/);
  });
});
