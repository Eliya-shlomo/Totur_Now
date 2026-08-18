import StudentLayout from '@/layouts/StudentLayout';
import Placeholder from '@/components/Placeholder';
import Ask from '@/pages/student/Ask';
import ChooseTeacher from '@/pages/student/ChooseTeacher';
import Classifying from '@/pages/student/Classifying';
import Session from '@/pages/student/Session';
import ProtectedRoute from '@/router/ProtectedRoute';

/**
 * Student routes — MVP.md §14.1.
 *
 * PR 1.5 wrapped this whole subtree in <ProtectedRoute role="student"> — that was
 * the one edit this file expects from outside its owner. Everything else here is
 * added one entry at a time by the PR that builds the screen, and every such entry
 * is protected by that wrapper without doing anything.
 */
export const studentRoutes = [
  {
    path: 'app',
    element: (
      <ProtectedRoute role="student">
        <StudentLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Placeholder title="Student dashboard" pr="E1/E7" /> },
      { path: 'ask', element: <Ask /> },
      { path: 'ask/:id/matching', element: <Classifying /> },
      { path: 'ask/:id/teachers', element: <ChooseTeacher /> },
      { path: 'session/:id', element: <Session /> },
      { path: 'session/:id/review', element: <Placeholder title="Rate this session" pr="8.4" /> },
      { path: 'wallet', element: <Placeholder title="Wallet" pr="7.7" /> },
      { path: 'history', element: <Placeholder title="Session history" pr="8.6" /> },
    ],
  },
];
