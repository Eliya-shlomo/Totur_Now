import { createVideoAccessToken, createVideoRoom } from '#services/video.daily.service.js';
import { AppError } from '#utils/AppError.js';

/**
 * Creates the video resources for a TutorNow session.
 *
 * The session owner is responsible for storing the returned room data.
 * This service does not read or write the sessions table.
 */
export async function createSessionVideo(sessionId) {
  if (!sessionId) {
    throw AppError.validation('Session id is required.');
  }

  return createVideoRoom();
}

/**
 * Creates temporary access for one TutorNow user to an existing video room.
 */
export async function createSessionVideoAccess({ roomName, userId, userName }) {
  if (!roomName || !userId || !userName) {
    throw AppError.validation('Room name, user id and user name are required.');
  }

  return createVideoAccessToken(roomName, userId, userName);
}
