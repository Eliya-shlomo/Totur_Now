import TeacherLayout from '@/layouts/TeacherLayout';
import Placeholder from '@/components/Placeholder';

/**
 * Teacher routes — MVP.md §14.1.
 *
 * PR 1.5 wraps this subtree in <ProtectedRoute role="teacher">.
 */
export const teacherRoutes = [
  {
    path: 'teach',
    element: <TeacherLayout />,
    children: [
      { index: true, element: <Placeholder title="Teacher dashboard" pr="5.7" /> },
      { path: 'onboarding', element: <Placeholder title="Onboarding" pr="2.6" /> },
      { path: 'session/:id', element: <Placeholder title="Active session" pr="6.8" /> },
      { path: 'earnings', element: <Placeholder title="Earnings" pr="7.8" /> },
      { path: 'profile', element: <Placeholder title="Profile + documents" pr="2.7" /> },
    ],
  },
];
