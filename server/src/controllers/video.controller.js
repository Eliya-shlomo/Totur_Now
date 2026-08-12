import { createSessionVideo, createSessionVideoAccess } from '#services/video.service.js';

export async function createRoom(req, res) {
  const { sessionId } = req.body;

  const room = await createSessionVideo(sessionId);

  res.status(201).json({
    success: true,
    data: room,
  });
}

export async function createAccess(req, res) {
  const { roomName, userName } = req.body;

  const access = await createSessionVideoAccess({
    roomName,
    userId: req.user.id,
    userName,
  });

  res.json({
    success: true,
    data: access,
  });
}
