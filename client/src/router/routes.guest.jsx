import AuthLayout from '@/layouts/AuthLayout';
import GuestLayout from '@/layouts/GuestLayout';
import Login from '@/pages/auth/Login';
import Placeholder from '@/components/Placeholder';
import Landing from '@/pages/guest/Landing';
import NotFound from '@/pages/NotFound';
import Pricing from '@/pages/guest/Pricing';
import Register from '@/pages/auth/Register';

/**
 * Public routes — MVP.md §14.1. No authentication.
 *
 * Owned by whoever builds the guest surface (PR 1.6, then E10.1–10.2).
 * To add a screen: add one entry here and one page file. Never touch router/index.jsx.
 */
export const guestRoutes = [
  {
    // PR 1.3. Its own shell, not the guest one: a form does not want a nav bar
    // around it. First in the array so the pair reads ahead of the `*` below it,
    // though the router's specificity ranking would pick them either way.
    element: <AuthLayout />,
    children: [
      { path: 'login', element: <Login /> },
      { path: 'register', element: <Register /> },
    ],
  },
  {
    element: <GuestLayout />,
    children: [
      { index: true, element: <Landing /> },
      { path: 'teachers', element: <Placeholder title="Available teachers" pr="1.6" /> },
      { path: 'teachers/:id', element: <Placeholder title="Teacher profile + reviews" pr="8.5" /> },
      { path: 'pricing', element: <Pricing /> },

      // Catch-all. Renders inside the guest layout so the user keeps a way out.
      { path: '*', element: <NotFound /> },
    ],
  },
];
