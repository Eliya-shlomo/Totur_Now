import { Router } from 'express';

import { createRoom, createAccess } from '#controllers/video.controller.js';
import { asyncHandler } from '#utils/asyncHandler.js';

export const videoRoutes = Router();

videoRoutes.post('/rooms', asyncHandler(createRoom));
videoRoutes.post('/access', asyncHandler(createAccess));
