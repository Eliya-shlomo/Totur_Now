import TeacherLayout from '@/layouts/TeacherLayout';
import SessionRoom from '@/components/session/SessionRoom';
import Dashboard from '@/pages/teacher/Dashboard';
import Onboarding from '@/pages/teacher/Onboarding';
import Profile from '@/pages/teacher/Profile';
import Placeholder from '@/components/Placeholder';
import ProtectedRoute from '@/router/ProtectedRoute';

/**
 * Teacher routes — MVP.md §14.1.
 *
 * PR 1.5 wrapped this subtree in <ProtectedRoute role="teacher">. A student who
 * reaches /teach is sent to /app — the epic's stated acceptance criterion.
 */
export const teacherRoutes = [
  {
    path: 'teach',
    element: (
      <ProtectedRoute role="teacher">
        <TeacherLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'onboarding', element: <Onboarding /> },
      // **The same component the student's route renders**, and that is the whole of
      // 6.7's teacher side. The two roles differ by three fields and one button, and
      // `SessionState` carries a `role` that says which — two files would be two timers.
      { path: 'session/:id', element: <SessionRoom /> },
      { path: 'earnings', element: <Placeholder title="Earnings" pr="7.8" /> },
      { path: 'profile', element: <Profile /> },
    ],
  },
];
