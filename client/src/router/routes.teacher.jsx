import TeacherLayout from '@/layouts/TeacherLayout';
import SessionRoom from '@/components/session/SessionRoom';
import Dashboard from '@/pages/teacher/Dashboard';
import Earnings from '@/pages/teacher/Earnings';
import NotFound from '@/pages/NotFound';
import Onboarding from '@/pages/teacher/Onboarding';
import Profile from '@/pages/teacher/Profile';
import ProtectedRoute from '@/router/ProtectedRoute';

/**
 * Teacher routes — MVP.md §14.1.
 *
 * PR 1.5 wrapped this subtree in <ProtectedRoute role="teacher">. A student who
 * reaches /teach is sent to /app — the epic's stated acceptance criterion.
 *
 * **No `Placeholder` import any more, and that is the milestone worth noticing**: 7.6
 * replaced the last stand-in on this side of the product, so every route below resolves
 * to a screen somebody built. The student's tree still has one, for E8's history.
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
      // The placeholder said `pr="7.8"` against §18's numbering, which E7's own brief
      // reordered: the earnings read and its screen are 7.6, and 7.8 is the epic's close.
      // The `pr=` is corrected by the PR that replaces the placeholder — E1's retro rule.
      { path: 'earnings', element: <Earnings /> },
      { path: 'profile', element: <Profile /> },

      // 10.3, and the same reason as the student array's: a teacher who mistypes a URL
      // keeps the shell with their availability toggle in it.
      { path: '*', element: <NotFound homeHref="/teach" homeLabel="Back to your dashboard" /> },
    ],
  },
];
