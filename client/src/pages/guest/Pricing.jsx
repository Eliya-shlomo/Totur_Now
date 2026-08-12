import { SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';

import { getPricing } from '@/api/public.api';
import BlocksExplainer from '@/components/guest/BlocksExplainer';
import CommissionPanel from '@/components/guest/CommissionPanel';
import CreditsPanel from '@/components/guest/CreditsPanel';
import GuestCta from '@/components/guest/GuestCta';
import PriceBandTable from '@/components/guest/PriceBandTable';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';

/**
 * `/pricing` — MVP.md §14.1, the model from §5.
 *
 * **Not one number on this page is written in this file.** Everything comes from
 * `/public/pricing`, which derives it from `server/src/config/constants/`, which
 * is the same module the wallet charges from. That is the whole point of the
 * endpoint: a pricing page that can disagree with the billing code is worse than
 * no pricing page, and the only way to guarantee it cannot is to give it no
 * numbers of its own.
 *
 * The cost is that a marketing page depends on the API being up, which is what
 * the error state is for — and why `/` deliberately does not fetch.
 */
export default function Pricing() {
  const [pricing, setPricing] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    // `cancelled` guards the unmount case: a visitor who navigates away mid-flight
    // would otherwise land a setState on a gone component.
    let cancelled = false;

    setLoading(true);
    setError(null);

    getPricing()
      .then((data) => {
        if (!cancelled) setPricing(data);
      })
      .catch((err) => {
        // Everything from the api layer is an ApiError, so `err.message` is
        // already safe to show — see client/src/api/ApiError.js.
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(load, [load]);

  if (loading) return <LoadingState label="Loading pricing…" minHeight={320} />;

  if (error) {
    return (
      <ErrorState
        error={error}
        title="Could not load pricing"
        onRetry={load}
        minHeight={320}
        // No fallback numbers on purpose. A cached guess at a price is exactly
        // the drift this page exists to prevent.
      />
    );
  }

  return (
    <Stack gap={48}>
      <Stack gap="xs" maw={640}>
        <Title order={1}>Pricing</Title>
        <Text c="dimmed" size="lg">
          You pay for the minutes you use, at a price the teacher set and you saw before you
          started. Nothing recurring, nothing to cancel.
        </Text>
      </Stack>

      <Stack gap="md">
        <PriceBandTable
          price={pricing.price}
          bands={pricing.bands}
          openingMinutes={pricing.block.openingMinutes}
          openingBlocks={pricing.block.openingBlocks}
        />

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <BlocksExplainer block={pricing.block} />
          <CreditsPanel topupPackages={pricing.topupPackages} budget={pricing.budget} />
        </SimpleGrid>
      </Stack>

      <Stack gap="md">
        <Stack gap="xs" maw={640}>
          <Title order={2}>Teaching here</Title>
          <Text c="dimmed">
            You set your price, you choose when you are online, and you are paid per block you
            actually taught.
          </Text>
        </Stack>

        <CommissionPanel commission={pricing.commission} />
      </Stack>

      <GuestCta />
    </Stack>
  );
}
