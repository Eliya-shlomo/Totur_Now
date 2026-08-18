import TeacherLayout from '@/layouts/TeacherLayout';
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
      { path: 'session/:id', element: <Placeholder title="Active session" pr="6.8" /> },
      { path: 'earnings', element: <Placeholder title="Earnings" pr="7.8" /> },
      { path: 'profile', element: <Profile /> },
    ],
  },
];
