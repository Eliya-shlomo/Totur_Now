import { Card, List, Stack, Text, Title } from '@mantine/core';

/**
 * The teacher-facing half of the pricing page — MVP.md §5.3.
 *
 * Stated plainly and early, because a marketplace that is coy about its cut is
 * telling a teacher something about itself. Ours is deliberately below market: we
 * need supply before profit, and that is the actual reason, so it is the one
 * printed here.
 *
 * @param {object} commission `{ platformFeePct, newTeacherFeeDays, lowDemandHours, timezone }`
 */
export default function CommissionPanel({ commission }) {
  const { platformFeePct, newTeacherFeeDays, lowDemandHours } = commission;

  return (
    <Card withBorder radius="md" padding="lg">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={3}>What we take: {formatPercent(platformFeePct)}</Title>
          <Text size="sm" c="dimmed">
            Of what a student pays. The rest is yours, and you set the price it comes from.
          </Text>
        </Stack>

        <List spacing="sm" size="sm">
          <List.Item>
            <Text span fw={600}>
              Your first {newTeacherFeeDays} days are commission-free.
            </Text>{' '}
            You keep everything while you are building a rating.
          </List.Item>

          <List.Item>
            <Text span fw={600}>
              Teaching between {formatHour(lowDemandHours.startHour)} and{' '}
              {formatHour(lowDemandHours.endHour)} is commission-free too.
            </Text>{' '}
            Those are the hours students struggle to find anyone, so we pay for cover with our own
            cut rather than with a retainer.
          </List.Item>

          <List.Item>
            When a student gets their first opening block free, you are still paid in full. The
            platform absorbs it, not you.
          </List.Item>
        </List>
      </Stack>
    </Card>
  );
}

/** `0.15 → "15%"`. Via Intl rather than `pct * 100`, which yields 15.000000000000002. */
function formatPercent(fraction) {
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(fraction);
}

/**
 * `6 → "6 AM"`, `14 → "2 PM"`.
 *
 * Formatted from an hour number rather than a `Date`, because the server sends
 * these as wall-clock hours in the platform's timezone (Asia/Jerusalem). Building
 * a `Date` from them would re-interpret those hours in the *visitor's* timezone
 * and quietly print the wrong window to anyone travelling.
 */
function formatHour(hour) {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;

  return `${twelve} ${suffix}`;
}
