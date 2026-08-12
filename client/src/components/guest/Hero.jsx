import { Stack, Text, Title } from '@mantine/core';

import GuestCta from '@/components/guest/GuestCta';

/**
 * Above the fold. MVP.md §1 — the positioning, not a feature list.
 *
 * The headline names the moment rather than the product, because the visitor
 * arrives from that moment: it is late, they are stuck, and "per-question
 * real-time tutoring marketplace" is a description of us, not of them.
 *
 * No price appears here. Every number on the guest surface comes from
 * `/public/pricing`, and the honest short version of a teacher-set price is a
 * range — which belongs on the pricing page, where there is room to explain it.
 */
export default function Hero() {
  return (
    <Stack gap="lg" py={{ base: 'xl', sm: 48 }} maw={640}>
      <Stack gap="sm">
        <Title order={1} fz={{ base: 32, sm: 44 }} lh={1.15}>
          Stuck on a question right now? A tutor is on screen in 60 seconds.
        </Title>

        <Text size="lg" c="dimmed">
          Photograph the exercise, pick from teachers who are online this minute, and pay only for
          the minutes you actually need — not for a scheduled hour you did not ask for.
        </Text>
      </Stack>

      <GuestCta size="lg" />
    </Stack>
  );
}
