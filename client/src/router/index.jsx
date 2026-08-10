import { createBrowserRouter } from 'react-router-dom';

import { guestRoutes } from './routes.guest';
import { studentRoutes } from './routes.student';
import { teacherRoutes } from './routes.teacher';
import { adminRoutes } from './routes.admin';

/**
 * FROZEN after PR 0.5 — see docs/OWNERSHIP.md §2.
 *
 * This file only composes. Every route lives in one of the four area arrays, which
 * is what lets twenty later screen PRs land without ever touching a shared file.
 *
 * Order matters: the guest array ends in a `*` catch-all, so it must come last or it
 * would swallow /app, /teach and /admin.
 */
export const router = createBrowserRouter([
  ...studentRoutes,
  ...teacherRoutes,
  ...adminRoutes,
  ...guestRoutes,
]);
