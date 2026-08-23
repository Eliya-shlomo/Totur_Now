import StudentLayout from '@/layouts/StudentLayout';
import Ask from '@/pages/student/Ask';
import ChooseTeacher from '@/pages/student/ChooseTeacher';
import Classifying from '@/pages/student/Classifying';
import Dashboard from '@/pages/student/Dashboard';
import History from '@/pages/student/History';
import NotFound from '@/pages/NotFound';
import RateSession from '@/pages/student/RateSession';
import Session from '@/pages/student/Session';
import Wallet from '@/pages/student/Wallet';
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
      // The placeholder said `pr="E1/E7"` because in 1.5 the balance had no epic that
      // owned it yet. E7 does, and §14.1's third element — recent sessions — is E8's:
      // 8.4 owns the history screen and the read behind it.
      { index: true, element: <Dashboard /> },
      { path: 'ask', element: <Ask /> },
      { path: 'ask/:id/matching', element: <Classifying /> },
      { path: 'ask/:id/teachers', element: <ChooseTeacher /> },
      { path: 'session/:id', element: <Session /> },
      // The placeholder said `pr="8.4"` and the screen arrived in 6.6 — §10 makes the
      // rating the only way out of an `ENDED` session, so E6 could not leave it to E8.
      // The `pr=` is corrected by the PR that replaces it, which is E1's retro rule.
      { path: 'session/:id/review', element: <RateSession /> },
      // Said `pr="7.7"` against §18's numbering, which E7's own brief reordered: the
      // wallet screen is 7.5 and 7.7 is the out-of-credit path that builds on it. The
      // `pr=` is corrected by the PR that replaces the placeholder — E1's retro rule,
      // and the second time this file has applied it.
      { path: 'wallet', element: <Wallet /> },
      // The placeholder said `pr="8.6"` against §18's numbering, which E8's README
      // reordered: the history screen is 8.4 and 8.6 is the epic's close. The `pr=` is
      // corrected by the PR that replaces the placeholder — E1's retro rule, and the
      // third time this file has applied it.
      { path: 'history', element: <History /> },

      // 10.3. Without this, `/app/nonsense` fell through to the guest array's catch-all
      // and rendered 404 inside `GuestLayout` — a logged-in student shown the public
      // header and an invitation to log in. One entry per area file; `router/index.jsx`
      // is frozen and stays that way.
      { path: '*', element: <NotFound homeHref="/app" homeLabel="Back to your dashboard" /> },
    ],
  },
];
