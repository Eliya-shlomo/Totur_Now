import { Divider, Stack, Text, Title } from '@mantine/core';

import GuestCta from '@/components/guest/GuestCta';
import Hero from '@/components/guest/Hero';
import HowItWorks from '@/components/guest/HowItWorks';
import ProblemSection from '@/components/guest/ProblemSection';

/**
 * `/` — MVP.md §14.1, positioning from §1.
 *
 * Static by design: this page makes no network call, so it renders instantly and
 * keeps rendering when the API is down. Everything numeric lives one click away
 * on `/pricing`, which is the page that fetches — a landing page that shows a
 * spinner before it shows its pitch has already lost the visitor it was written
 * for.
 *
 * The section order is the argument: the moment, why the alternatives fail, what
 * we do instead, and only then the ask. The CTA repeats at the bottom because a
 * visitor who read the whole page should not have to scroll back up.
 */
export default function Landing() {
  return (
    <Stack gap={64}>
      <Hero />

      <ProblemSection />

      <HowItWorks />

      <Stack gap="md">
        <Divider />

        <Stack gap="xs" maw={640}>
          <Title order={2}>Pay for minutes, not for hours</Title>
          <Text c="dimmed">
            Sessions are billed in short blocks, and every extension is yours to approve. Teachers
            set their own price, so what you see on the selection screen is what you are charged.
          </Text>
        </Stack>

        <GuestCta />
      </Stack>
    </Stack>
  );
}
