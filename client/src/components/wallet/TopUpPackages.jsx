import { Button, Card, Group, Stack, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

/**
 * The top-up buttons — MVP.md §5.4, on `POST /wallet/topup` (PR 7.3).
 *
 * **The amounts are `pricing.topupPackages` and nothing else.** The server validates
 * membership of `TOPUP_PACKAGES` rather than a range, so a hardcoded `[50, 100, 200]`
 * here would be a second copy of a list that can only ever disagree with the first — and
 * it would disagree by offering the student a button the endpoint answers `400` to. The
 * list arrives on `GET /public/pricing` precisely so this screen cannot invent one, and
 * it is rendered in the order the server sent it.
 *
 * **A package is pressed, an amount is never typed.** There is no free-entry field here
 * and there is no room for one: the mock top-up credits immediately, so the allowlist is
 * one of the two things standing between this screen and an infinite-money URL. The
 * other is the rate limiter, which is why a `429` on this control is a real state a real
 * person reaches rather than an abuse signal — see the screen's `handleTopUp`.
 *
 * **Nothing is disabled while another package is in flight except by `loading`.** Mantine
 * disables a loading button on its own; the *other* two are disabled explicitly, because
 * two top-ups fired a moment apart would both succeed, and a student who meant to press
 * ₪50 once should not be able to buy ₪250 by being unsure. The screen holds a ref guard
 * as well — this is the visible half of a rule that has to hold before React re-renders.
 *
 * @param {number[]} packages   `pricing.topupPackages`, server order
 * @param {number|null} pending the package currently in flight, or null
 * @param {(amount: number) => void} onTopUp
 */
export default function TopUpPackages({ packages, pending, onTopUp }) {
  const busy = pending !== null;

  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        <Stack gap={2}>
          <Text fw={600}>Add credit</Text>
          <Text size="sm" c="dimmed">
            One credit is one shekel. Credit is added straight away and never expires.
          </Text>
        </Stack>

        {/*
          `wrap` rather than a grid: the three buttons have to stack at 375px without
          a horizontal scrollbar (§14.4), and a wrapping group does that with no
          breakpoint of its own to keep in sync with the theme.
        */}
        <Group gap="sm">
          {packages.map((amount) => (
            <Button
              key={amount}
              variant="light"
              leftSection={<IconPlus size={16} />}
              loading={pending === amount}
              disabled={busy && pending !== amount}
              onClick={() => onTopUp(amount)}
            >
              ₪{amount}
            </Button>
          ))}
        </Group>
      </Stack>
    </Card>
  );
}
