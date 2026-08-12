import AdminLayout from '@/layouts/AdminLayout';
import Placeholder from '@/components/Placeholder';
import ProtectedRoute from '@/router/ProtectedRoute';

/**
 * Admin routes — MVP.md §14.1.
 *
 * PR 1.5 wrapped this subtree in <ProtectedRoute role="admin">. There is no route
 * that mints an admin — the role is set in the database — so this gate is the only
 * thing standing in front of the review queues.
 */
export const adminRoutes = [
  {
    path: 'admin',
    element: (
      <ProtectedRoute role="admin">
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Placeholder title="Document queue" pr="9.2" /> },
      { path: 'documents', element: <Placeholder title="Document queue" pr="9.2" /> },
      { path: 'sessions', element: <Placeholder title="All sessions" pr="9.3" /> },
    ],
  },
];
