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
    throw new Error(`Daily room creation failed: ${response.status}`);
  }

  return response.json();
}
