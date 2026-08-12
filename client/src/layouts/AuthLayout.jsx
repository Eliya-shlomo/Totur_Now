import { Box, Center, Paper, Text } from '@mantine/core';
import { Outlet } from 'react-router-dom';

import GuestHeader from '@/components/guest/GuestHeader';

/**
 * The shell both auth screens sit in — PR 1.3.
 *
 * A sibling of `GuestLayout` in `routes.guest.jsx` rather than a child of it: the
 * form is centred in the viewport instead of sitting at the top of a content
 * container, and the footer is one line rather than the full public one.
 *
 * It carries the same header as the rest of the public surface. An earlier version
 * of this file dropped the nav on the theory that every link in it leads away from
 * the form — but a bar that vanishes on two routes makes the login page feel like a
 * different site, and a visitor who lands here from a bookmark needs a way to
 * Pricing that is not the back button.
 *
 * `maw` with `w="100%"` rather than a fixed width, and horizontal padding on the
 * inner box, so the card breathes on a phone and never forces a sideways scroll.
 */
export default function AuthLayout() {
  return (
    <Box mih="100dvh" display="flex" style={{ flexDirection: 'column' }}>
      <GuestHeader />

      <Center style={{ flex: 1 }} px="md" py="xl">
        <Box w="100%" maw={420}>
          <Paper withBorder p="lg" radius="md">
            <Outlet />
          </Paper>
        </Box>
      </Center>

      <Text size="xs" c="dimmed" ta="center" px="md" pb="xl">
        A tutor on screen in 60 seconds. Pay only for the minutes you need.
      </Text>
    </Box>
  );
}
