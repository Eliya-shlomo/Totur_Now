import { Anchor, Box, Burger, Container, Divider, Drawer, Group, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link, Outlet } from 'react-router-dom';

const links = [
  { to: '/teachers', label: 'Teachers' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/login', label: 'Log in' },
  { to: '/register', label: 'Sign up' },
];

/**
 * Public shell — header, content, footer. No AppShell: the guest surface has no
 * sidebar and no bottom nav, so the extra machinery would only get in the way.
 *
 * Below 768px the links collapse into a drawer.
 */
export default function GuestLayout() {
  const [opened, { toggle, close }] = useDisclosure(false);

  return (
    <Box mih="100dvh" display="flex" style={{ flexDirection: 'column' }}>
      <Box
        component="header"
        py="sm"
        style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
      >
        <Container size="lg">
          <Group justify="space-between">
            <Text component={Link} to="/" fw={700} size="lg" td="none" c="inherit">
              TutorNow
            </Text>

            <Group gap="lg" visibleFrom="sm">
              {links.map(({ to, label }) => (
                <Anchor key={to} component={Link} to={to} c="inherit" underline="hover" size="sm">
                  {label}
                </Anchor>
              ))}
            </Group>

            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label={opened ? 'Close menu' : 'Open menu'}
            />
          </Group>
        </Container>
      </Box>

      <Drawer opened={opened} onClose={close} position="right" size="70%" title="TutorNow">
        <Stack gap="md">
          {links.map(({ to, label }) => (
            <Anchor key={to} component={Link} to={to} onClick={close} c="inherit" size="lg">
              {label}
            </Anchor>
          ))}
        </Stack>
      </Drawer>

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
