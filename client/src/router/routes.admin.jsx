import AdminLayout from '@/layouts/AdminLayout';
import Placeholder from '@/components/Placeholder';

/**
 * Admin routes — MVP.md §14.1.
 *
 * PR 1.5 wraps this subtree in <ProtectedRoute role="admin">.
 */
export const adminRoutes = [
  {
    path: 'admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <Placeholder title="Document queue" pr="9.2" /> },
      { path: 'documents', element: <Placeholder title="Document queue" pr="9.2" /> },
      { path: 'sessions', element: <Placeholder title="All sessions" pr="9.3" /> },
    ],
  },
];
