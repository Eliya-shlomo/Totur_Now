import { Navigate, useLocation } from 'react-router-dom';

import LoadingState from '@/components/state/LoadingState';
import { HOME_BY_ROLE, loginPathFor, useAuthStore } from '@/stores/authStore';

/**
 * The gate on every authenticated area — MVP.md §14.1.
 *
 * Wraps an area's layout in `routes.student.jsx`, `routes.teacher.jsx` and
 * `routes.admin.jsx`, so one entry protects a whole subtree and a screen PR that
 * adds a route inherits the protection without knowing this file exists.
 *
 * The three states, in order, because the order is the behaviour:
 *
 *   'loading'      a spinner. Not a redirect — bootstrap has not answered yet, and
 *                  treating "we don't know" as "logged out" bounces a logged-in
 *                  user to /login on every page refresh.
 *   'anonymous'    /login, carrying the attempted path so 1.3 can return here.
 *   wrong role     that user's own home. Not /login: they are logged in, they are
 *                  just not who this area is for.
 *
 * @param {'student'|'teacher'|'admin'} [role]  omit to require only a session
 * @param {React.ReactNode} children            the area layout
 */
export default function ProtectedRoute({ role, children }) {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  if (status === 'loading') return <LoadingState label="Checking your session…" minHeight="60vh" />;

  if (status === 'anonymous') return <Navigate to={loginPathFor(location)} replace />;

  // `replace`, so the back button does not land on the page we just bounced them
  // off and start the redirect over.
  if (role && user?.role !== role) {
    return <Navigate to={HOME_BY_ROLE[user?.role] ?? '/'} replace />;
  }

  return children;
}
