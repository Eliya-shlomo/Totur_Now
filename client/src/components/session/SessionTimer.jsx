import { Group, Progress, Stack, Text } from '@mantine/core';
import { IconClock } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

/**
 * How long is left in the current block — PR 6.7, MVP.md §5.1 and §14.3.
 *
 * **`endsAt` is the only source and the value is recomputed on every tick.** Not a number
 * seeded once and decremented: `setInterval` does not fire in a backgrounded tab, phones
 * throttle it, and a decremented counter comes back a minute slow with no way to know it.
 * The interval here only decides *when to re-render*; what it renders is always
 * `endsAt - now`, so a tab that missed sixty ticks is correct on the sixty-first.
 *
 * E5's `OfferCountdown` established the pattern and this is the same one with money behind
 * it — a clock that disagrees with `ends_at` is a session that looks over while it is
 * still charging, or still running after it has been billed.
 *
 * **It reports nothing and ends nothing.** Reaching zero is not the end of a session:
 * §5.1 gives a `GRACE_SECONDS` window after `ends_at` and the auto-end sweep is what
 * closes it, announced over `session:ended`. A timer that navigated at zero would race the
 * server and win about half the time.
 *
 * @param {object} props
 * @param {string|null} props.endsAt ISO 8601, absolute, server-issued
 * @param {number} props.blocksUsed how many blocks have been bought so far
 * @param {number} props.blockMinutes the length of the block now running
 */
export default function SessionTimer({ endsAt, blocksUsed, blockMinutes }) {
  const remaining = useRemainingSeconds(endsAt);

  if (remaining === null) {
    return (
      <Group gap="xs" c="dimmed">
        <IconClock size={18} stroke={1.5} />
        <Text size="sm">No deadline on this session</Text>
      </Group>
    );
  }

  const blockSeconds = Math.max(1, blockMinutes * 60);
  // Clamped both ways: past `ends_at` the bar is empty rather than negative, and a block
  // longer than expected does not overflow the track.
  const elapsed = Math.min(100, Math.max(0, ((blockSeconds - remaining) / blockSeconds) * 100));

  return (
    <Stack gap={6} miw={180}>
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Group gap={6} wrap="nowrap">
          <IconClock size={18} stroke={1.5} />
          <Text fw={600} fz="lg" ff="monospace">
            {formatClock(remaining)}
          </Text>
        </Group>

        <Text size="xs" c="dimmed">
          block {blocksUsed}
        </Text>
      </Group>

      <Progress
        value={elapsed}
        // The last minute is when the extend modal fires; the colour change is the same
        // information one glance earlier, for whoever is talking and not reading.
        color={remaining <= 60 ? 'orange' : 'blue'}
        size="sm"
        radius="xl"
      />
    </Stack>
  );
}

/**
 * Seconds left, recomputed every second from the absolute instant.
 *
 * The state is the *number*, not a countdown: every tick throws away the previous value
 * and asks the clock again. Exported implicitly through the component only — nothing else
 * in the app needs a second timer, and a second timer is how two parts of one screen come
 * to disagree.
 */
function useRemainingSeconds(endsAt) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(tick);
  }, []);

  if (!endsAt) return null;

  const target = new Date(endsAt).getTime();

  if (Number.isNaN(target)) return null;

  return Math.max(0, Math.round((target - now) / 1000));
}

/** `mm:ss`, and it never shows a negative — past the deadline it reads `00:00`. */
function formatClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
