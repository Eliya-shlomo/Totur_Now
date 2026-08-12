import { Router } from 'express';

import { createAccess, createRoom } from '#controllers/video.controller.js';
import { authenticate } from '#middlewares/authenticate.js';
import { authorize } from '#middlewares/authorize.js';
import { asyncHandler } from '#utils/asyncHandler.js';

export const videoRoutes = Router();

videoRoutes.use(authenticate, authorize('student', 'teacher'));

videoRoutes.post('/rooms', asyncHandler(createRoom));
videoRoutes.post('/access', asyncHandler(createAccess));
