import { Anchor, Button, Group, Stack } from '@mantine/core';
import { Link } from 'react-router-dom';

/**
 * The two calls to action, in one place because the landing page shows them
 * twice — above the fold and after the explanation — and two copies drift.
 *
 * Both carry `?role=` so the register screen (PR 1.3) opens with the role already
 * chosen. Role is immutable after registration (E1 contract freeze), which makes
 * choosing it a real decision; a visitor who clicked "Teach with us" has made it
 * already and should not be asked again on the next screen.
 *
 * **The third line is not a button, and it is what MVP.md §18's row 10.2 actually
 * wanted.** That row says "public online-teachers list"; the list is not online-only
 * and E10.1 ruled that it stays that way — a visitor arriving at 23:40 to an empty
 * page learns nothing, and every seeded teacher is `OFFLINE`. What was missing is
 * that the online view was reachable only by finding a switch inside the filter bar.
 * `?onlineOnly=true` is that view, and 2.5 put the filters in the URL precisely so a
 * filtered list could be a link. It is a link rather than a third button because two
 * calls to action are a decision and three are a menu.
 *
 * @param {'sm'|'md'|'lg'} [size]
 * @param {boolean} [fullWidthOnMobile]  stack and stretch below 576px
 */
export default function GuestCta({ size = 'md', fullWidthOnMobile = true }) {
  return (
    <Stack gap="sm" align="flex-start" style={fullWidthOnMobile ? { width: '100%' } : undefined}>
      <Group
        gap="sm"
        wrap="wrap"
        // Full-width stacked buttons at 375px, side by side from xs up. Two
        // half-width buttons on a narrow phone are the classic way a CTA becomes
        // untappable.
        style={fullWidthOnMobile ? { width: '100%' } : undefined}
      >
        <Button
          component={Link}
          to="/register?role=student"
          size={size}
          flex={fullWidthOnMobile ? { base: '1 1 100%', xs: '0 0 auto' } : undefined}
        >
          Get help now
        </Button>

        <Button
          component={Link}
          to="/register?role=teacher"
          size={size}
          variant="default"
          flex={fullWidthOnMobile ? { base: '1 1 100%', xs: '0 0 auto' } : undefined}
        >
          Teach with us
        </Button>
      </Group>

      <Anchor component={Link} to="/teachers?onlineOnly=true" size="sm" c="dimmed">
        See who is online right now
      </Anchor>
    </Stack>
  );
}
