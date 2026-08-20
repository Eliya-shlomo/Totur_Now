import { Badge, Card, Divider, Group, Pagination, Stack, Text } from '@mantine/core';
import { Fragment } from 'react';

import { formatTxDate } from '@/components/wallet/txLabel';

/**
 * One row per session taught — `GET /wallet/earnings`. PR 7.6, MVP.md §5.3.
 *
 * **Not a `<Table>`, and that is the responsive decision rather than a stylistic one.**
 * Five columns of money do not fit at 375px, and the two ways a table survives that width
 * are a horizontal scrollbar or a font nobody can read — §14.4 rules out the first and
 * common sense the second. So each session is a block: a heading line that says which
 * lesson it was, and three labelled figures that wrap onto as many lines as the width
 * allows. At 375px they stack; at desktop they sit in a row. No breakpoint is written
 * here, which means none can drift from `theme.js`.
 *
 * **The fee column is why this screen exists.** §5.3 waives the commission for a
 * teacher's first thirty days and inside the low-demand window, so `0` rows sit beside
 * 15% rows, and a teacher who cannot see why concludes the platform is inconsistent. A
 * waived fee renders as the number zero *and* a "no commission" badge — a blank or a dash
 * would read as missing data about money.
 *
 * **The screen does not say which waiver applied, and cannot.** That needs the teacher's
 * `created_at` and the session's hour in the platform's timezone, and
 * `utils/commission.js`'s own header says two implementations of §5.3 is two answers to
 * "what did I earn". It renders the number the server sent and labels the fact that it is
 * zero. Naming the reason is a server field somebody would have to add on purpose.
 *
 * `formatTxDate` is shared with the student's ledger — one date format across both money
 * screens, in the reader's own locale and zone.
 *
 * @param {object[]} earnings  `EarningRecord[]`, newest first
 * @param {number} total       every earning ever, not the page
 * @param {number} page        1-based
 * @param {number} pageSize
 * @param {(page: number) => void} onPageChange
 */
export default function EarningsTable({ earnings, total, page, pageSize, onPageChange }) {
  const pageCount = Math.ceil(total / pageSize);

  return (
    <Stack gap="sm">
      <Card withBorder padding={0}>
        {earnings.map((earning, index) => (
          <Fragment key={earning.sessionId}>
            {index > 0 && <Divider />}
            <EarningRow earning={earning} />
          </Fragment>
        ))}
      </Card>

      {pageCount > 1 && (
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Text size="sm" c="dimmed">
            {total} {total === 1 ? 'session' : 'sessions'}
          </Text>

          <Pagination value={page} total={pageCount} onChange={onPageChange} size="sm" />
        </Group>
      )}
    </Stack>
  );
}

function EarningRow({ earning }) {
  const waived = earning.platformFee === 0;

  return (
    <Stack gap="xs" p="md">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        {/*
          A question that was never classified has no topic, and the date is then the only
          thing identifying the row — so it moves up into the heading rather than leaving
          a blank where a title should be.
        */}
        <Text fw={600} truncate>
          {earning.topicName ?? 'Session'}
        </Text>

        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {formatTxDate(earning.endedAt)}
        </Text>
      </Group>

      <Group gap="lg" wrap="wrap">
        <Amount label="Student paid" value={earning.totalCharged} />

        <Amount
          label="Platform fee"
          value={earning.platformFee}
          c={waived ? undefined : 'dimmed'}
          badge={waived ? 'No commission' : null}
        />

        <Amount label="You earned" value={earning.teacherEarning} strong />
      </Group>
    </Stack>
  );
}

/** One labelled figure. Nothing here divides, subtracts or multiplies. */
function Amount({ label, value, strong = false, badge = null }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>

      <Group gap="xs" wrap="nowrap">
        <Text fw={strong ? 700 : 500} c={strong ? 'teal' : undefined}>
          ₪{value}
        </Text>

        {badge && (
          <Badge size="xs" variant="light" color="teal">
            {badge}
          </Badge>
        )}
      </Group>
    </Stack>
  );
}
