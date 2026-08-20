import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconHelpCircle, IconWallet } from '@tabler/icons-react';
import { SOCKET_EVENTS } from '@tutor/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getPricing } from '@/api/public.api';
import { getWallet } from '@/api/wallet.api';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';
import BalanceCard from '@/components/wallet/BalanceCard';
import { useSocketEvent } from '@/hooks/useSocketEvent';

/**
 * `/app` — the student's home. MVP.md §14.1, PR 7.5.
 *
 * §14.1 gives this screen three things: the balance, the "I'm stuck" call to action, and
 * recent sessions. **Two of them are here and the third is E8's.** 8.6 owns the history
 * screen and the reads behind it, and a session list assembled here would be a second one
 * — written against no endpoint, since nothing serves a student's session history today.
 * The sidebar already links to `/app/history`, which is where that list belongs.
 *
 * The placeholder this replaces said `pr="E1/E7"`, which was true when 1.5 wrote it and
 * names no PR. E1's retro rule is that the `pr=` is corrected by whoever replaces the
 * placeholder, and replacing it is the correction.
 *
 * **The two reads are duplicated from `Wallet.jsx` rather than shared, and that is a
 * decision.** They are the `Promise.allSettled` + `cancelled` pattern that `Pricing.jsx`,
 * `Teachers.jsx` and the teacher's `Dashboard.jsx` each write out for themselves; a hook
 * to spare two call sites twenty lines would be a fifth shape for something the repo
 * already reads the same way in four places. If a third screen wants the balance, that is
 * the moment to extract one.
 */
export default function Dashboard() {
  const [wallet, setWallet] = useState(null);
  const [walletError, setWalletError] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [loading, setLoading] = useState(true);

  /**
   * Balance and pricing together, and only the balance is fatal — `Wallet.jsx`'s split,
   * for the same reason: minutes are a nicety and the credit figure is the point.
   */
  const load = useCallback(() => {
    let cancelled = false;

    setLoading(true);
    setWalletError(null);

    Promise.allSettled([getWallet(), getPricing()]).then(([walletResult, pricingResult]) => {
      if (cancelled) return;

      if (walletResult.status === 'fulfilled') setWallet(walletResult.value);
      else setWalletError(walletResult.reason);

      setPricing(pricingResult.status === 'fulfilled' ? pricingResult.value : null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(load, [load]);

  /**
   * `wallet:updated`, so a top-up made on `/app/wallet` in another tab is reflected here
   * without a reload. The same guard as the wallet screen: a frame with no number is
   * dropped rather than rendered as "undefined credits".
   */
  useSocketEvent(
    SOCKET_EVENTS.WALLET_UPDATED,
    useCallback((payload) => {
      if (!Number.isFinite(payload?.balance)) return;

      setWallet((current) => (current ? { ...current, balance: payload.balance } : current));
    }, []),
  );

  return (
    <Stack gap="lg">
      <Title order={2}>Home</Title>

      {/*
        The call to action is above the balance and does not wait for it.

        §4.1's student is standing over an exercise with a phone, and the one thing this
        screen exists to do is get them to `/app/ask`. Putting that behind a wallet read —
        or worse, behind a wallet read that failed — would make a network problem look
        like a product that has nothing for them. The ask screen and the offer both check
        credit properly; this button does not need to.
      */}
      <Card withBorder padding="lg">
        <Stack gap="sm">
          <Stack gap={2}>
            <Text fw={600}>Stuck on something?</Text>
            <Text size="sm" c="dimmed">
              Describe it or photograph it, and we will find a teacher who is online now.
            </Text>
          </Stack>

          <Group>
            <Button
              component={Link}
              to="/app/ask"
              size="md"
              leftSection={<IconHelpCircle size={18} />}
            >
              I&apos;m stuck
            </Button>
          </Group>
        </Stack>
      </Card>

      {loading && <LoadingState label="Loading your balance…" />}

      {!loading && walletError && (
        <ErrorState error={walletError} title="Could not load your balance" onRetry={load} />
      )}

      {!loading && !walletError && wallet && (
        <Stack gap="xs">
          <BalanceCard balance={wallet.balance} pricing={pricing} />

          <Group justify="flex-end">
            <Button
              component={Link}
              to="/app/wallet"
              variant="subtle"
              size="compact-sm"
              leftSection={<IconWallet size={16} />}
            >
              Add credit and see your transactions
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
