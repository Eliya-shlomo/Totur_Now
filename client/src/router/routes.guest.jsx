import GuestLayout from '@/layouts/GuestLayout';
import Placeholder from '@/components/Placeholder';
import Landing from '@/pages/guest/Landing';
import NotFound from '@/pages/NotFound';
import Pricing from '@/pages/guest/Pricing';

/**
 * Public routes — MVP.md §14.1. No authentication.
 *
 * Owned by whoever builds the guest surface (PR 1.6, then E10.1–10.2).
 * To add a screen: add one entry here and one page file. Never touch router/index.jsx.
 */
export const guestRoutes = [
  {
    element: <GuestLayout />,
    children: [
      { index: true, element: <Landing /> },
      { path: 'teachers', element: <Placeholder title="Available teachers" pr="1.6" /> },
      { path: 'teachers/:id', element: <Placeholder title="Teacher profile + reviews" pr="8.5" /> },
      { path: 'pricing', element: <Pricing /> },
      { path: 'login', element: <Placeholder title="Log in" pr="1.3" /> },
      { path: 'register', element: <Placeholder title="Register" pr="1.3" /> },

      // Catch-all. Renders inside the guest layout so the user keeps a way out.
      { path: '*', element: <NotFound /> },
    ],
  },
];
