import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';

import ErrorBoundary from '@/components/ErrorBoundary';
import { router } from '@/router';
import { useAuthStore } from '@/stores/authStore';
import { theme } from '@/theme';

/**
 * The provider tree. `main.jsx` only mounts this.
 *
 * Order matters:
 *   MantineProvider   outermost, so the boundary's own fallback is themed
 *   Notifications     outside the boundary, so a toast raised on the way down
 *                     still renders if the tree below crashes
 *   ErrorBoundary     wraps the router, so a throw in any screen is caught here
 *                     instead of blanking the page
 */
export default function App() {
  // PR 1.5. Restores the session from the refresh cookie before anything
  // auth-dependent renders — `status` is 'loading' until this resolves, and
  // `ProtectedRoute` shows a spinner rather than deciding on unknown state.
  //
  // Read off `getState()` rather than subscribed, so this effect never re-runs.
  // StrictMode still mounts twice in development; `bootstrap` is idempotent.
  useEffect(() => {
    useAuthStore.getState().bootstrap();
  }, []);

  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" />
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </MantineProvider>
  );
}
