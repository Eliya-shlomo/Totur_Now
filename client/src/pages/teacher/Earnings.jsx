import { Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconCash, IconWallet } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';

import { getEarnings } from '@/api/wallet.api';
import EarningsSummary from '@/components/wallet/EarningsSummary';
import EarningsTable from '@/components/wallet/EarningsTable';
import EmptyState from '@/components/state/EmptyState';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';

/**
 * `/teach/earnings` — MVP.md §14.1's "Earnings breakdown", §5.3. PR 7.6.
 *
 * The teacher's side of the money, and the first time any of it has been visible: §5.3
 * has taken 15% since E5, 6.6 has written the split onto every finished session since E6,
 * and no teacher has been able to see a single figure of it.
 *
 * **One endpoint, and everything on the screen comes from it.** `GET /wallet/earnings`
 * answers the balance, the page, the count and the all-time totals in one response,
 * because they are four facts about the same set and a screen that assembled them from
 * two endpoints would render a moment where they disagreed.
 *
 * **Nothing here is arithmetic.** No fee is derived, no net is computed, no total is
 * folded from the rows on screen. §5.3's rate, its thirty-day waiver and its low-demand
 * window are resolved server-side at `started_at`, and a second implementation in the
 * client would be a second answer to "what did I earn" — shown to the person it is about.
 * `PLATFORM_FEE_PCT` is not in this bundle and must not arrive in it.
 *
 * **No socket listener, deliberately.** A teacher's earnings change when a session ends,
 * and at that moment they are in the session room rather than on this screen — the tab
 * that would receive the event is not mounted. `session:ended` already tells the room
 * what happened, and this page is read fresh when it is opened. A `wallet:updated`
 * listener here would fire only for a top-up, which is not an earning.
 */

/**
 * Rows per page. A layout number rather than a domain one — the server has its own
 * default and its own ceiling in `constants/pagination.js` and neither is this. Ten,
 * matching the student's ledger, because these two screens are read the same way.
 */
const PAGE_SIZE = 10;

/** The endpoint's own first page. `?page=0` is a `400`, not a silent page 1. */
const FIRST_PAGE = 1;

export default function Earnings() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(FIRST_PAGE);

  const load = useCallback(() => {
    // `cancelled` guards the unmount case, the pattern every async screen here uses:
    // a teacher who navigates away mid-flight would otherwise land a setState on a
    // component that is gone.
    let cancelled = false;

    setLoading(true);
    setError(null);

    getEarnings({ page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((err) => {
        // Everything from the api layer is an ApiError, so `err.message` is already safe
        // to show — see client/src/api/ApiError.js.
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page]);

  useEffect(load, [load]);

  // `result` is kept across a page change rather than cleared, so paging does not blank
  // the screen before the next page lands — `Teachers.jsx`'s rule.
  if (loading && !result) return <LoadingState label="Loading your earnings…" minHeight={320} />;

  if (error) {
    return (
      <ErrorState
        error={error}
        title="Could not load your earnings"
        onRetry={load}
        minHeight={320}
      />
    );
  }

  if (!result) return null;

  return (
    <Stack gap="lg">
      <Title order={2}>Earnings</Title>

      {result.total === 0 ? (
        <NothingYet balance={result.balance} />
      ) : (
        <Earned result={result} page={page} onPageChange={setPage} />
      )}
    </Stack>
  );
}

/**
 * The screen once there is something on it.
 *
 * The caption under the table says out loud that the fee has two waivers, because the
 * alternative is a teacher comparing two rows and inventing a reason for the difference.
 * It does not say which one applied to which row — that is a fact the server would have
 * to send, and it does not.
 */
function Earned({ result, page, onPageChange }) {
  return (
    <>
      <EarningsSummary totals={result.totals} balance={result.balance} />

      <Stack gap="xs">
        <Title order={3}>Sessions</Title>

        <Text size="sm" c="dimmed">
          The platform takes a commission on each session, waived during your first thirty days and
          inside the quiet hours. Rows showing no commission are one of those two.
        </Text>

        <EarningsTable
          earnings={result.earnings}
          total={result.total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={onPageChange}
        />
      </Stack>
    </>
  );
}

/**
 * A teacher who has taught nothing — which is every teacher on the day they onboard.
 *
 * **An empty state rather than four zeros and a blank table**, because "₪0 · ₪0 · ₪0"
 * reads like a system that has lost something rather than one that has nothing to show
 * yet.
 *
 * The balance survives on its own, and that is not an inconsistency: this screen is the
 * only place in the teacher's navigation where a balance appears at all — `/app/wallet`
 * belongs to the student — so hiding it would leave a teacher holding credit with no
 * screen that says so. One true number is not the four zeros the rule is about.
 */
function NothingYet({ balance }) {
  return (
    <Stack gap="md">
      <Card withBorder padding="md" maw={260}>
        <Stack gap={4}>
          <Group gap={6} c="dimmed">
            <IconWallet size={18} stroke={1.5} />
            <Text size="xs" tt="uppercase" fw={600}>
              In your wallet
            </Text>
          </Group>

          <Text fw={700} size="xl">
            ₪{balance}
          </Text>
        </Stack>
      </Card>

      <EmptyState
        icon={IconCash}
        title="No earnings yet"
        message="When you finish your first session, what the student paid, the platform's commission and your share all appear here."
        minHeight={260}
      />
    </Stack>
  );
}
