import { Badge, Card, Divider, Group, Pagination, Stack, Text } from '@mantine/core';
import { IconReceipt } from '@tabler/icons-react';
import { Fragment } from 'react';

import { formatTxDate, signedCredits, txLabel } from '@/components/wallet/txLabel';
import EmptyState from '@/components/state/EmptyState';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';

/**
 * The ledger — `GET /wallet/transactions`, newest first (PR 7.2).
 *
 * Every movement of this student's money, which makes it the screen a support
 * conversation is held over. Four things per row: what it was, when, how much, and what
 * the balance became. `balanceAfter` is the column that turns a list into something a
 * person can reconcile against their own memory — without it, a student who disputes one
 * charge has to add the whole list up to check the total.
 *
 * **Paged, not infinitely scrolled.** `total` is on the response and the endpoint takes
 * `page`, so pagination is a control the student can see and reach the end of. The
 * student most likely to be here is looking for one charge they did not expect, and an
 * infinite scroll is the single interaction that makes "the end of the list" unreachable
 * on a phone.
 *
 * **The sentence is the client's**, from `type` alone — `note` is operator-facing and is
 * not on the wire (7.2). An unrecognised type renders as itself; see `txLabel`.
 *
 * The three async states are checked loading-before-error-before-empty, which is the
 * order they occur in, and `result` is kept across a page change rather than cleared, so
 * paging does not blank the list before the next page lands (`Teachers.jsx`'s rule).
 *
 * @param {{transactions: object[], total: number}|null} result
 * @param {boolean} loading
 * @param {Error|null} error
 * @param {number} page       1-based, matching the endpoint
 * @param {number} pageSize
 * @param {string|null} highlightId  a row just written by this tab's own top-up
 * @param {() => void} onRetry
 * @param {(page: number) => void} onPageChange
 */
export default function LedgerList({
  result,
  loading,
  error,
  page,
  pageSize,
  highlightId,
  onRetry,
  onPageChange,
}) {
  if (loading && !result) return <LoadingState label="Loading your transactions…" />;

  if (error) {
    return <ErrorState error={error} title="Could not load your transactions" onRetry={onRetry} />;
  }

  if (!result) return null;

  if (result.transactions.length === 0) {
    // No action on this empty state, and that is not an oversight: the action a
    // student needs here is the top-up block, which stays on screen above it. An
    // "Add credit" button that scrolled to buttons already visible would be a
    // second control for one decision.
    return (
      <EmptyState
        icon={IconReceipt}
        title="Nothing here yet"
        message="Top-ups, session charges and refunds all appear here, newest first."
      />
    );
  }

  const pageCount = Math.ceil(result.total / pageSize);

  return (
    <Stack gap="sm">
      <Card withBorder padding={0}>
        {result.transactions.map((tx, index) => (
          <Fragment key={tx.id}>
            {index > 0 && <Divider />}
            <LedgerRow tx={tx} isNew={tx.id === highlightId} />
          </Fragment>
        ))}
      </Card>

      {pageCount > 1 && (
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Text size="sm" c="dimmed">
            {result.total} {result.total === 1 ? 'movement' : 'movements'}
          </Text>

          <Pagination value={page} total={pageCount} onChange={onPageChange} size="sm" />
        </Group>
      )}
    </Stack>
  );
}

/**
 * One row.
 *
 * `wrap="nowrap"` with the two halves free to shrink is what keeps 375px from scrolling
 * sideways: the label truncates and the money never does, which is the right way round —
 * an amount clipped to "+10" on a phone is worse than a topic clipped to "Session".
 *
 * **Colour is not the only carrier of the sign.** The `+` and the `−` are in the text
 * (`signedCredits`), and the green and red are on top of them, per §14.4.
 */
function LedgerRow({ tx, isNew }) {
  const incoming = tx.amount >= 0;

  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      gap="md"
      p="md"
      bg={isNew ? 'var(--mantine-color-teal-light)' : undefined}
    >
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Text fw={600} truncate>
            {txLabel(tx.type)}
          </Text>

          {/*
            Said out loud only on the row this tab just created. A student who presses
            ₪100 and looks down at a list of numbers should not have to work out which
            line is the one they just caused.
          */}
          {isNew && (
            <Badge size="xs" variant="filled" color="teal">
              New
            </Badge>
          )}
        </Group>

        <Text size="xs" c="dimmed">
          {formatTxDate(tx.createdAt)}
        </Text>
      </Stack>

      <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
        <Text fw={700} c={incoming ? 'teal' : 'red'}>
          {signedCredits(tx.amount)}
        </Text>

        <Text size="xs" c="dimmed">
          Balance {tx.balanceAfter}
        </Text>
      </Stack>
    </Group>
  );
}
