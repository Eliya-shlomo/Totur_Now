import { createDailyRoom, createDailyMeetingToken } from '#services/daily.service.js';

export async function createRoom(req, res) {
  const room = await createDailyRoom();

  res.status(201).json({
    success: true,
    data: {
      name: room.name,
      url: room.url,
      privacy: room.privacy,
    },
  });
}

export async function createAccess(req, res) {
  const { roomName, userName } = req.body;

  const result = await createDailyMeetingToken(roomName, userName);

  res.json({
    success: true,
    data: {
      token: result.token,
    },
  });
}
