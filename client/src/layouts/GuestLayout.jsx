import { Box, Container, Divider, Text } from '@mantine/core';
import { Outlet, useLocation } from 'react-router-dom';

import ErrorBoundary from '@/components/ErrorBoundary';
import GuestHeader from '@/components/guest/GuestHeader';

/**
 * Public shell — header, content, footer. No AppShell: the guest surface has no
 * sidebar and no bottom nav, so the extra machinery would only get in the way.
 *
 * The header itself lives in `components/guest/GuestHeader.jsx`, because
 * `AuthLayout` shows the same one.
 *
 * The inner `ErrorBoundary` is 10.3's, and the reason is the same one `AppLayout` gives:
 * a throw on `/teachers` should not take the nav that leads away from it. `AuthLayout` is
 * deliberately without one — both its routes are forms that fetch nothing, and the outer
 * boundary in `App.jsx` is the right altitude for a form that cannot render.
 */
export default function GuestLayout() {
  const { pathname } = useLocation();

  return (
    <Box mih="100dvh" display="flex" style={{ flexDirection: 'column' }}>
      <GuestHeader />

      <Box component="main" style={{ flex: 1 }} py="xl">
        <Container size="lg">
          <ErrorBoundary variant="inline" resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </Container>
      </Box>

      <Box component="footer" py="lg">
        <Divider mb="lg" />
        <Container size="lg">
          <Text size="sm" c="dimmed">
            TutorNow — a tutor on screen in 60 seconds. Pay only for the minutes you need.
          </Text>
        </Container>
      </Box>
    </Box>
  );
}
