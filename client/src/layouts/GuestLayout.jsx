import { Box, Container, Divider, Text } from '@mantine/core';
import { Outlet } from 'react-router-dom';

import GuestHeader from '@/components/guest/GuestHeader';

/**
 * Public shell — header, content, footer. No AppShell: the guest surface has no
 * sidebar and no bottom nav, so the extra machinery would only get in the way.
 *
 * The header itself lives in `components/guest/GuestHeader.jsx`, because
 * `AuthLayout` shows the same one.
 */
export default function GuestLayout() {
  return (
    <Box mih="100dvh" display="flex" style={{ flexDirection: 'column' }}>
      <GuestHeader />

      <Box component="main" style={{ flex: 1 }} py="xl">
        <Container size="lg">
          <Outlet />
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
