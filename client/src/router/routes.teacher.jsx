import TeacherLayout from '@/layouts/TeacherLayout';
import Onboarding from '@/pages/teacher/Onboarding';
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
      { index: true, element: <Placeholder title="Teacher dashboard" pr="5.7" /> },
      { path: 'onboarding', element: <Onboarding /> },
      { path: 'session/:id', element: <Placeholder title="Active session" pr="6.8" /> },
      { path: 'earnings', element: <Placeholder title="Earnings" pr="7.8" /> },
      { path: 'profile', element: <Placeholder title="Profile + documents" pr="2.7" /> },
    ],
  },
];
