import { api } from '@/api/client';

export function createVideoRoom(sessionId) {
  return api.post('/video/rooms', {
    sessionId,
  });
}

export function createVideoAccess(roomName, userName) {
  return api.post('/video/access', {
    roomName,
    userName,
  });
}
