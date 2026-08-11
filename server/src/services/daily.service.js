import { ERROR_CODES } from '#config/errors/codes.js';
import { AppError } from '#utils/AppError.js';
import { env } from '#config/env.js';

const DAILY_API_URL = 'https://api.daily.co/v1';

export async function createDailyRoom() {
  if (!env.DAILY_API_KEY) {
    throw new Error('DAILY_API_KEY is not configured');
  }
  const response = await fetch(`${DAILY_API_URL}/rooms`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DAILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      privacy: 'private',
    }),
  });

  if (!response.ok) {
    throw new AppError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Could not create video room.');
  }

  return response.json();
}

export async function createDailyMeetingToken(roomName, userName) {
  if (!env.DAILY_API_KEY) {
    throw new Error('DAILY_API_KEY is not configured');
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;

  const response = await fetch(`${DAILY_API_URL}/meeting-tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DAILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        exp: expiresAt,
      },
    }),
  });

  if (!response.ok) {
    throw new AppError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Could not create video access token.');
  }

  return response.json();
}
