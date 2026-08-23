import AdminLayout from '@/layouts/AdminLayout';
import NotFound from '@/pages/NotFound';
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

      // 10.3. Every route in this array is a placeholder until E9, which makes a
      // mistyped one indistinguishable from a real one — all the more reason for the
      // 404 to arrive inside the admin shell rather than on the public site.
      { path: '*', element: <NotFound homeHref="/admin" homeLabel="Back to the admin home" /> },
    ],
  },
];
