import { Alert, Button, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { ERROR_CODES, SOCKET_EVENTS } from '@tutor/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getPricing } from '@/api/public.api';
import { getWallet, getWalletTransactions, topUp } from '@/api/wallet.api';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';
import BalanceCard from '@/components/wallet/BalanceCard';
import LedgerList from '@/components/wallet/LedgerList';
import TopUpPackages from '@/components/wallet/TopUpPackages';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import { notify } from '@/lib/notify';

/**
 * `/app/wallet` — MVP.md §14.1 "Balance · top-up · transactions", §5.4. PR 7.5.
 *
 * The first screen in the product that shows a student their own money, and the first
 * that renders `wallet_transactions` to a human at all — the rows were written for a log
 * reader by E6 and are read here by the person they are about.
 *
 * **Two endpoints on mount, and only one of them is fatal.** `GET /wallet` is the screen;
 * `GET /public/pricing` is the block economics that turn credits into minutes and supply
 * the top-up amounts. They are fetched with `Promise.allSettled` rather than `Promise.all`
 * on purpose: a pricing outage must not blank a balance the student came here to read.
 * Credits are then shown alone, the minutes line says why it is absent, and the top-up
 * block is replaced by a notice — because the packages *are* pricing data and inventing
 * three buttons here would be offering amounts the server may refuse.
 *
 * **Two writers of the balance, deliberately.** The `POST /wallet/topup` response and
 * `wallet:updated`. The response is the one the screen trusts: the socket may be down,
 * and a screen that only learns from an event shows a stale balance for as long as the
 * connection was gone. Both carry a server-computed number, so whichever lands last is
 * still right, and neither is derived from the other.
 *
 * **Nothing on this screen adds up a number the server already added up.** The balance is
 * the server's, the minutes are `lib/credits.js`'s, the packages are `/public/pricing`'s,
 * and `balanceAfter` on each row is the running total as the ledger recorded it. There is
 * no `5`, no `12` and no `[50, 100, 200]` in this file, and that is the review line.
 */

/**
 * Rows per page. A layout number rather than a domain one — the same call
 * `Teachers.jsx` made and for the same reason: the server has its own default and its own
 * ceiling in `constants/pagination.js`, and neither is this. Ten fits a phone screen
 * without the pager falling below the fold.
 */
const PAGE_SIZE = 10;

/** The endpoint's own first page. `?page=0` is a `400`, not a silent page 1. */
const FIRST_PAGE = 1;

export default function Wallet() {
  /** `WalletResponse`. Written by the initial read, by the top-up, and by the socket. */
  const [wallet, setWallet] = useState(null);
  const [walletError, setWalletError] = useState(null);

  /** `PublicPricingResponse`, or `null` when that read failed. Never fatal. */
  const [pricing, setPricing] = useState(null);
  const [loading, setLoading] = useState(true);

  const [ledger, setLedger] = useState(null);
  const [ledgerError, setLedgerError] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(true);

  /**
   * Which page of the ledger to read, in component state rather than in the URL.
   *
   * `Teachers.jsx` puts its paging in the query string because a filtered list of
   * teachers is a link somebody sends. A ledger is nobody's link — it is one person's
   * private history behind a `ProtectedRoute` — and a top-up jumps this list back to page
   * one, which would mean writing to the URL as a side effect of pressing a button.
   *
   * **`reload` is why this is an object and not a number.** A top-up made from page one
   * has to fetch page one again, and `setPage(1)` while already on page 1 is not a state
   * change and starts nothing. Bumping a counter beside the page makes "the same page,
   * freshly" a distinct value, so one effect covers both reasons to read.
   */
  const [ledgerQuery, setLedgerQuery] = useState({ page: FIRST_PAGE, reload: 0 });

  /** The package currently in flight, for the button's busy state. */
  const [pending, setPending] = useState(null);

  /** The row this tab's own top-up just created, so the student can find it. */
  const [highlightId, setHighlightId] = useState(null);

  /**
   * The balance and the pricing, together.
   *
   * `cancelled` guards the unmount case, the pattern every async screen here uses since
   * `Pricing.jsx`: a student who navigates away mid-flight would otherwise land a
   * `setState` on a component that is gone.
   */
  const load = useCallback(() => {
    let cancelled = false;

    setLoading(true);
    setWalletError(null);

    Promise.allSettled([getWallet(), getPricing()]).then(([walletResult, pricingResult]) => {
      if (cancelled) return;

      if (walletResult.status === 'fulfilled') setWallet(walletResult.value);
      // Everything from the api layer is an `ApiError`, so `.reason.message` is
      // already safe to show — see client/src/api/ApiError.js.
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
   * One page of the ledger. Its own read, its own error, its own retry — a ledger that
   * failed to load is not a reason to hide a balance that did.
   */
  const loadLedger = useCallback(() => {
    let cancelled = false;

    setLedgerLoading(true);
    setLedgerError(null);

    getWalletTransactions({ page: ledgerQuery.page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (!cancelled) setLedger(data);
      })
      .catch((error) => {
        if (!cancelled) setLedgerError(error);
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ledgerQuery]);

  useEffect(loadLedger, [loadLedger]);

  /**
   * `wallet:updated` — the same balance, arriving in every tab this user has open.
   *
   * **It writes the balance and nothing else.** The payload is `{ balance }`, so there is
   * no new ledger row in it to render, and refetching the list on every event would yank
   * a student who is reading page four back to page one because another tab spent money.
   * The tab that pressed the button refetches from its own response; a second tab shows
   * the new figure now and the row on its next page change. Both are honest, and only one
   * of them moves the list under somebody's finger.
   *
   * The payload is checked rather than trusted: a frame that arrived without a number
   * would otherwise replace a real balance with `undefined` and render "undefined credits".
   */
  useSocketEvent(
    SOCKET_EVENTS.WALLET_UPDATED,
    useCallback((payload) => {
      if (!Number.isFinite(payload?.balance)) return;

      setWallet((current) => (current ? { ...current, balance: payload.balance } : current));
    }, []),
  );

  /**
   * A ref, not the `pending` state, and the difference is the whole guard.
   *
   * `pending` is what the buttons render from, and it is only true *after* React
   * re-renders. Two clicks dispatched in the same tick both read the old value and both
   * fire — which on this endpoint means two ledger rows and twice the credit for one
   * decision. The ref changes synchronously inside the handler, so the second click
   * returns before it reaches the network.
   */
  const inFlight = useRef(false);

  const handleTopUp = useCallback((amount) => {
    if (inFlight.current) return;

    inFlight.current = true;
    setPending(amount);

    topUp(amount)
      .then((result) => {
        setWallet((current) => (current ? { ...current, balance: result.balance } : current));

        // `transactionId` identifies the row the server just wrote, so it can be marked
        // once it arrives. The row is fetched rather than prepended optimistically: the
        // ledger's `balanceAfter` is a running total, and a row this screen composed
        // itself would be the one line in the list that nothing on the server agrees with.
        setHighlightId(result.transactionId);
        setLedgerQuery((current) => ({ page: FIRST_PAGE, reload: current.reload + 1 }));

        // `credited` is echoed by the endpoint rather than taken from `amount`, so the
        // confirmation cannot disagree with what was actually added.
        notify.success(
          `₪${result.credited} added. Your balance is ${result.balance} credits.`,
          'Credit added',
        );
      })
      .catch((error) => {
        // A `429` here is a real person pressing twice, not an attack: the top-up route
        // carries its own limiter because a mock top-up credits immediately. The server's
        // sentence already says "Too many requests", and it gets a title of its own so
        // that the one failure a retry cannot fix does not read as "something went wrong".
        notify.apiError(
          error,
          error?.is?.(ERROR_CODES.RATE_LIMITED) ? 'Too many top-ups' : 'Could not add credit',
        );
      })
      .finally(() => {
        inFlight.current = false;
        setPending(null);
      });
  }, []);

  if (loading) return <LoadingState label="Loading your wallet…" minHeight={320} />;

  // The balance is the screen. Without it there is nothing to top up and no total for
  // the ledger's rows to reconcile against, so this is the one fatal state here.
  if (walletError) {
    return (
      <ErrorState
        error={walletError}
        title="Could not load your wallet"
        onRetry={load}
        minHeight={320}
      />
    );
  }

  return (
    <Stack gap="lg">
      <Title order={2}>Wallet</Title>

      <BalanceCard balance={wallet.balance} pricing={pricing} />

      {pricing ? (
        <TopUpPackages packages={pricing.topupPackages} pending={pending} onTopUp={handleTopUp} />
      ) : (
        /*
          No fallback amounts, for the same reason `Pricing.jsx` renders no fallback
          prices: the server accepts membership of `TOPUP_PACKAGES` and nothing else, so a
          guessed button is a button that answers `400`. Better to say the amounts are
          missing than to offer one that cannot be bought.
        */
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="yellow"
          variant="light"
          title="Top-up amounts are unavailable"
        >
          <Stack gap="xs" align="flex-start">
            <Text size="sm">
              The current top-up packages could not be loaded, so there is nothing safe to offer
              here. Your balance and your history below are unaffected.
            </Text>

            <Button size="xs" variant="light" color="yellow" onClick={load}>
              Try again
            </Button>
          </Stack>
        </Alert>
      )}

      <Stack gap="xs">
        <Title order={3}>Transactions</Title>

        <LedgerList
          result={ledger}
          loading={ledgerLoading}
          error={ledgerError}
          page={ledgerQuery.page}
          pageSize={PAGE_SIZE}
          highlightId={highlightId}
          onRetry={loadLedger}
          onPageChange={(page) => setLedgerQuery({ page, reload: 0 })}
        />
      </Stack>
    </Stack>
  );
}
