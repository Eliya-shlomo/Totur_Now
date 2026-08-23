import { Button, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';

/**
 * The route that resolved to nothing.
 *
 * **It is rendered by four arrays, not one — PR 10.3.** `routes.guest.jsx` had the only
 * catch-all in the router and `router/index.jsx` puts the guest array last, so
 * `/app/nonsense` resolved to this page *inside `GuestLayout`*: a logged-in student was
 * shown the public header, a **Log in** link, no sidebar, no bottom nav, and a button back
 * to `/`. It read fine and it was the wrong product.
 *
 * Each area array now carries its own `{ path: '*' }`, which keeps the shell the user was
 * already in. The two props are what make one page serve all four; both default to the
 * guest answer, so `routes.guest.jsx` is unchanged.
 *
 * @param {string} [homeHref]   where "back" goes. Defaults to the public home
 * @param {string} [homeLabel]  what that button says
 */
export default function NotFound({ homeHref = '/', homeLabel = 'Back to the home page' }) {
  return (
    <Stack align="center" gap="md" py="xl">
      <Title order={1}>404</Title>
      <Text c="dimmed" ta="center">
        That page does not exist.
      </Text>
      <Button component={Link} to={homeHref}>
        {homeLabel}
      </Button>
    </Stack>
  );
}
