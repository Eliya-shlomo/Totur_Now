import { env } from '#config/env.js';
import { ERROR_CODES } from '#config/errors/codes.js';
import { DAILY_API_URL, VIDEO_ROOM_TTL_SECONDS, VIDEO_TOKEN_TTL_SECONDS } from '#config/video.js';
import { AppError } from '#utils/AppError.js';

export async function createVideoRoom() {
  if (!env.DAILY_API_KEY) {
    throw new Error('DAILY_API_KEY is not configured');
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
    throw new Error('DAILY_API_KEY is not configured');
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
