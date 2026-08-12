import { Anchor, Box, Burger, Container, Drawer, Group, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link } from 'react-router-dom';

/**
 * The public header — wordmark, links, and the burger drawer below 768px.
 *
 * Extracted from `GuestLayout` so the auth screens can show the same bar. The nav
 * is present on every page of the public surface, landing and forms alike: a user
 * who opens `/login` from a bookmark and decides they want the pricing page first
 * otherwise has no way there except the browser's back button, and a bar that
 * appears and disappears between routes reads as two different websites.
 *
 * One component rather than two copies, because a link added to one and not the
 * other is the classic way a nav starts disagreeing with itself.
 */

const links = [
  { to: '/teachers', label: 'Teachers' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/login', label: 'Log in' },
  { to: '/register', label: 'Sign up' },
];

export default function GuestHeader() {
  const [opened, { toggle, close }] = useDisclosure(false);

  return (
    <>
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
    </>
  );
}
