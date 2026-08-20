import { Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCash, IconCoin, IconReceipt2, IconWallet } from '@tabler/icons-react';

/**
 * The four figures at the top of `/teach/earnings` — MVP.md §5.3, §14.1. PR 7.6.
 *
 * **Three of them are all-time and the fourth is right now, and the labels say which.**
 * `totals` is every finished session ever, not the page below it; `balance` is what is in
 * the wallet at this moment, after any spending. A teacher who reads "earned 3,400" and
 * "wallet 512" without being told the difference concludes that money has gone missing,
 * so the captions are load-bearing rather than decoration.
 *
 * **Gross, fee and net, in that order, because that is the sentence.** What students
 * paid, minus what the platform took, is what the teacher earned. Putting the fee beside
 * the two figures it sits between is what makes 15% legible without arithmetic.
 *
 * Not one number here is computed. `totals` arrives aggregated by the database over the
 * whole set and `balance` is the same number `GET /wallet` answers — this component adds
 * nothing up, and a `gross - fee` here would be a third opinion about the net.
 *
 * @param {{gross: number, fee: number, net: number}} totals  all-time
 * @param {number} balance  the wallet, now
 */
export default function EarningsSummary({ totals, balance }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
      <Figure
        icon={<IconCoin size={18} stroke={1.5} />}
        label="Students paid"
        value={totals.gross}
        caption="All time"
      />

      <Figure
        icon={<IconReceipt2 size={18} stroke={1.5} />}
        label="Platform fee"
        value={totals.fee}
        caption="All time"
      />

      <Figure
        icon={<IconCash size={18} stroke={1.5} />}
        label="You earned"
        value={totals.net}
        caption="All time"
      />

      {/*
        The one figure on this screen that is not history. It is also the only place a
        teacher can see their balance at all — the teacher navigation has no wallet
        entry, because `/app/wallet` is the student's screen.
      */}
      <Figure
        icon={<IconWallet size={18} stroke={1.5} />}
        label="In your wallet"
        value={balance}
        caption="Right now"
      />
    </SimpleGrid>
  );
}

/**
 * One tile. `StandingTile`'s shape on the teacher dashboard, which is the screen beside
 * this one in the navigation — two money screens that look like two different products
 * is a worse outcome than one shared visual idea.
 */
function Figure({ icon, label, value, caption }) {
  return (
    <Card withBorder padding="md">
      <Stack gap={4}>
        <Group gap={6} c="dimmed" wrap="nowrap">
          {icon}
          <Text size="xs" tt="uppercase" fw={600} truncate>
            {label}
          </Text>
        </Group>

        <Text fw={700} size="xl">
          ₪{value}
        </Text>

        <Text size="xs" c="dimmed">
          {caption}
        </Text>
      </Stack>
    </Card>
  );
}
