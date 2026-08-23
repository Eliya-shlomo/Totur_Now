import { Alert, Card, Divider, Group, Pagination, Stack, Text, Title } from '@mantine/core';
import { IconHistory, IconStarOff } from '@tabler/icons-react';
import { Fragment, useCallback, useEffect, useState } from 'react';

import { getMySessions } from '@/api/session.api';
import HistoryRow from '@/components/session/HistoryRow';
import EmptyState from '@/components/state/EmptyState';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';

/**
 * `/app/history` — MVP.md §14.1, PR 8.4. `GET /sessions/mine`.
 *
 * **The student has run sessions since E6 and has had no way to look at one afterwards.**
 * The sidebar has linked here since 1.5 and it has been a `<Placeholder>` since. This is
 * the screen.
 *
 * **It is a receipt and a rescue, in that order of size and the reverse order of
 * importance.** Most rows are a session that happened, with what it cost and how the
 * student rated it. The rows that matter are the `ENDED` ones with no review: §10 makes the
 * rating the only edge out of `ENDED` and 6.6's rating screen has no Skip, so a student who
 * closed the tab left a session that never reached a terminal state — `resolved_count`
 * never incremented, a teacher's reputation missing an entry it earned, and after 8.1 a
 * hole in `teacher_topic_stats` that nothing else will ever fill. Nothing in the product
 * could reach that session again. **This screen is the way back**, and the notice at the
 * top is what makes it findable without paging.
 *
 * **The notice is here rather than as a badge on the sidebar link.** `unratedCount` is on
 * the response precisely so a badge can be built from the whole set rather than from one
 * page — but `navItems.js` is a static list and the two components that render it,
 * `SidebarNav.jsx` and `BottomNav.jsx`, know nothing about badges and are not on this PR's
 * allowlist. Putting the count on the screen it is about is the honest half of the job;
 * the nav badge is filed rather than smuggled in.
 *
 * **Paged, not infinitely scrolled** — the wallet ledger's call and the teacher grid's,
 * for the same reason: `total` is on the response, so the end of the list is reachable on
 * a phone, and the student most likely to be here is looking for one specific evening.
 *
 * Nothing on this screen computes a number the server already computed. No minutes (that
 * is `lib/credits.js`, from `GET /public/pricing`), no cost from blocks × price, and no
 * unrated count from the rows on screen.
 */

/**
 * Rows per page. A layout number rather than a domain one — the same call `Wallet.jsx` and
 * `Teachers.jsx` both made: the server has its own default and its own ceiling in
 * `constants/pagination.js`, and neither of them is this. Ten fits a phone without the
 * pager falling below the fold.
 */
const PAGE_SIZE = 10;

/** The endpoint's own first page. `?page=0` is a `400`, not a silent page 1. */
const FIRST_PAGE = 1;

export default function History() {
  /** `SessionHistoryResponse`. Kept across a page change rather than cleared. */
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(FIRST_PAGE);

  /**
   * One page of the history.
   *
   * `cancelled` guards the unmount case, the pattern every async screen here uses since
   * `Pricing.jsx`: a student who navigates away mid-flight would otherwise land a
   * `setState` on a component that is gone.
   */
  const load = useCallback(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    getMySessions({ page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch((problem) => {
        // Everything from the api layer is an `ApiError`, so `.message` is already safe
        // to show — see client/src/api/ApiError.js.
        if (!cancelled) setError(problem);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page]);

  useEffect(load, [load]);

  if (loading && !history) return <LoadingState label="Loading your sessions…" minHeight={320} />;

  if (error) {
    return (
      <ErrorState
        error={error}
        title="Could not load your sessions"
        onRetry={load}
        minHeight={320}
      />
    );
  }

  if (!history) return null;

  const pageCount = Math.ceil(history.total / PAGE_SIZE);

  return (
    <Stack gap="lg">
      <Title order={2}>Session history</Title>

      {/*
        Only when there is something to finish. A standing notice that says "0 sessions
        need a rating" is a notice a student stops reading, and this one has to be read
        the one time it matters.
      */}
      {history.unratedCount > 0 && (
        <Alert
          icon={<IconStarOff size={16} />}
          color="yellow"
          variant="light"
          title={
            history.unratedCount === 1
              ? 'One session still needs your rating'
              : `${history.unratedCount} sessions still need your rating`
          }
        >
          <Text size="sm">
            {/*
              Said as what it costs the teacher rather than as a chore. The rating is what
              moves `resolved_count` and the teacher's per-topic reputation, and until it
              is given the session has not finished — which is a true sentence and the only
              honest reason to ask somebody to go back to a screen they closed.
            */}
            A session is only finished once you have rated it, and the rating is what your
            teacher&apos;s reputation is built from. Look for{' '}
            <Text span fw={600}>
              Rating unfinished
            </Text>{' '}
            below.
          </Text>
        </Alert>
      )}

      {history.sessions.length === 0 ? (
        <EmptyState
          icon={IconHistory}
          title="No sessions yet"
          message="Once you have worked through a question with a teacher, it appears here with what it cost and how you rated it."
          minHeight={320}
        />
      ) : (
        <Stack gap="sm">
          <Card withBorder padding={0} radius="md">
            {history.sessions.map((session, index) => (
              <Fragment key={session.sessionId}>
                {index > 0 && <Divider />}
                <HistoryRow session={session} />
              </Fragment>
            ))}
          </Card>

          {pageCount > 1 && (
            <Group justify="space-between" wrap="wrap" gap="sm">
              <Text size="sm" c="dimmed">
                {history.total} {history.total === 1 ? 'session' : 'sessions'}
              </Text>

              <Pagination value={page} total={pageCount} onChange={setPage} size="sm" />
            </Group>
          )}
        </Stack>
      )}
    </Stack>
  );
}
