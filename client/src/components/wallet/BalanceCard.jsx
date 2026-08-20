import { Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconWallet } from '@tabler/icons-react';

import { minutesFor } from '@/lib/credits';

/**
 * The balance, and what it buys — MVP.md §5.4, §14.1.
 *
 * Rendered on `/app/wallet` and on `/app`, which is why it is a component and not a
 * block inside either screen.
 *
 * **Credits are the primary number and minutes are the sentence under it.** §5.4 says
 * the student thinks in help remaining rather than in money, and the minutes line is
 * there because of it — but the ledger below is denominated in credits, the packages are
 * priced in credits, and a screen whose headline figure cannot be found in its own list
 * of movements is a screen that cannot be reconciled by the person reading it.
 *
 * **The minutes line names the price it assumed, and this is the whole point of it.**
 * Minutes are a function of a teacher's price — §5.4's own example is "₪96 ≈ 40 minutes
 * *with Dana*" — so a bare "≈ 40 minutes" here is a promise the wallet cannot keep, for
 * a teacher the student has not chosen yet. Saying "at the typical price, ₪12 a block"
 * makes it an illustration, which is the only true thing this screen can say about time.
 *
 * **Not one number in this file is written down.** The price, the block length and the
 * opening threshold all come from `GET /public/pricing`, which derives them from the same
 * `constants/` the wallet charges from, and the division is `lib/credits.js`'s. A `5` or a
 * `12` here would be the exact drift that endpoint exists to prevent, in the one place
 * where being wrong costs the student money.
 *
 * **`updatedAt` is deliberately not rendered.** It is on `WalletResponse` and this card
 * has no honest way to keep it true: `wallet:updated` carries a balance and no timestamp,
 * so after a top-up in another tab the figure would be current and the "as of" line
 * beside it would be stale. The ledger below dates every movement, which is the question
 * an "as of" was standing in for anyway.
 *
 * @param {number} balance    credits, from `GET /wallet`
 * @param {object|null} pricing  `PublicPricingResponse`, or null if that read failed
 */
export default function BalanceCard({ balance, pricing }) {
  return (
    <Card withBorder padding="lg">
      <Stack gap={4}>
        <Group gap={6} c="dimmed">
          <IconWallet size={18} stroke={1.5} />
          <Text size="xs" tt="uppercase" fw={600}>
            Balance
          </Text>
        </Group>

        <Title order={1}>{balance} credits</Title>

        <MinutesLine balance={balance} pricing={pricing} />
      </Stack>
    </Card>
  );
}

/**
 * The four things this line can honestly say, and the order they are checked in.
 *
 * **Pricing missing is first, and it is not a spinner.** If `/public/pricing` failed there
 * is no price to divide by, so the credits stand alone and the line says why the minutes
 * are absent. A card that waited for pricing forever would hide a balance the student
 * came here to read, over a number that is decoration next to it.
 *
 * The three credit states are `CreditMinutes`'s, at the default price instead of a
 * teacher's, and the middle one is the one that gets skipped: a student with some credit
 * but less than an opening block can see teachers and cannot start with any of them,
 * because §5.1 charges the opening block in full at the start. Rendering "5 minutes"
 * above a top-up button they do not know they need is the failure this state prevents.
 */
function MinutesLine({ balance, pricing }) {
  if (!pricing) {
    return (
      <Text size="sm" c="dimmed">
        Minutes need the current prices, which could not be loaded. Your credit is unaffected.
      </Text>
    );
  }

  const { block, price } = pricing;

  if (balance <= 0) {
    return (
      <Text size="sm" c="dimmed">
        No credit yet. Add credit to start a session.
      </Text>
    );
  }

  const minutes = minutesFor(balance, price.default, block.minutes);

  if (minutes < block.openingMinutes) {
    return (
      <Text size="sm" c="dimmed">
        Not enough for the {block.openingMinutes}-minute opening block at the typical price of ₪
        {price.default} a block.
      </Text>
    );
  }

  return (
    <Text size="sm" c="dimmed">
      ≈{' '}
      <Text span fw={600} c="var(--mantine-color-text)">
        {minutes} minutes
      </Text>{' '}
      at the typical price of ₪{price.default} per {block.minutes}-minute block. Your teacher sets
      theirs, so the real figure is on their card.
    </Text>
  );
}
