import { Button, Group } from '@mantine/core';
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
 * @param {'sm'|'md'|'lg'} [size]
 * @param {boolean} [fullWidthOnMobile]  stack and stretch below 576px
 */
export default function GuestCta({ size = 'md', fullWidthOnMobile = true }) {
  return (
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
  );
}
