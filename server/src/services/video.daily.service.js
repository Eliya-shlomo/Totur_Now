import { env } from '#config/env.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { VIDEO_ROOM_TTL_SECONDS, VIDEO_TOKEN_TTL_SECONDS } from '#config/video.js';
import { AppError } from '#utils/AppError.js';

/**
 * The provider's REST base, and the only place in `server/` that names it.
 *
 * `OWNERSHIP.md` §2.1 rule 2 is written as a grep rather than as a principle: one
 * search for `api.daily.co` returns one file, and that fact is what makes "swap the
 * provider by rewriting one file" a true statement instead of an intention. It is
 * exported so that PR 6.3's and 6.8's failure drills can point it at a dead host.
 */
export const DAILY_API_URL = 'https://api.daily.co/v1';

/**
 * The unset-key path, and the one thing PR 6.1 changed about this file.
 *
 * It used to be a bare `Error`, which reaches `errorHandler` as a 500 with no code
 * — so a missing key would fail the *accept* and turn an optional integration into
 * a required one. As an `AppError` it carries the same `EXTERNAL_SERVICE_ERROR` as
 * every other failure here, which is what lets PR 6.3 catch it by code and start
 * the session anyway with `video_room_*` left null. The degradation itself is 6.3's
 * and 6.4's; this only makes it catchable.
 */
function videoNotConfigured() {
  return new AppError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Video is not available right now.');
}

export async function createVideoRoom() {
  if (!env.DAILY_API_KEY) {
    throw videoNotConfigured();
  }

  const expiresAt = Math.floor(Date.now() / 1000) + VIDEO_ROOM_TTL_SECONDS;

  const response = await fetch(`${DAILY_API_URL}/rooms`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DAILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      privacy: 'private',
      properties: {
        exp: expiresAt,
        eject_at_room_exp: true,
        max_participants: 2,
      },
    }),
  });

  if (!response.ok) {
    throw new AppError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Could not create video room.');
  }

  const room = await response.json();

  return {
    provider: 'daily',
    roomName: room.name,
    roomUrl: room.url,
    expiresAt,
  };
}

export async function createVideoAccessToken(roomName, userId, userName) {
  if (!env.DAILY_API_KEY) {
    throw videoNotConfigured();
  }

  const expiresAt = Math.floor(Date.now() / 1000) + VIDEO_TOKEN_TTL_SECONDS;

  const response = await fetch(`${DAILY_API_URL}/meeting-tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DAILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_id: userId,
        user_name: userName,
        exp: expiresAt,
      },
    }),
  });

  if (!response.ok) {
    throw new AppError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Could not create video access token.');
  }

  const result = await response.json();

  return {
    token: result.token,
    expiresAt,
  };
}
