import { Text } from '@mantine/core';

import { minutesFor } from '@/lib/credits';

/**
 * What a balance buys with one teacher, in minutes — MVP.md §5.4.
 *
 * One line of text and no box of its own, because it is rendered inside somebody
 * else's layout: the price row of `TeacherCard` in the browse list, and 4.7's
 * `MatchCard` on the selection screen. A component that carried a `Card` here
 * would be a component that can only be used where it was first written.
 *
 * Not one number is written in this file. `blockMinutes` and `openingMinutes` both
 * come from `GET /public/pricing`, which derives them from
 * `server/src/config/constants/session.js` — the same module the wallet charges
 * from. "10 minutes" in particular is `openingMinutes`, never a literal: it is
 * `BLOCK_MINUTES × OPENING_BLOCKS` on the server, and a client that hardcodes the
 * product goes stale the day either factor moves. `BlocksExplainer.jsx` makes the
 * same argument on the pricing page.
 *
 * Three states, and the middle one is the one that gets skipped:
 *
 * - **No credit at all.** "No credit", not "0 minutes". Zero minutes reads like an
 *   arithmetic result the student could fix by finding a cheaper teacher; no
 *   credit reads like what it is. Reachable on the seed today (`ido.student`).
 * - **Some credit, but less than an opening block.** The student can see this
 *   teacher and cannot start with them, because the opening block is charged in
 *   full at the start and is non-cancellable (§5.1). Rendering "5 minutes" beside
 *   a button that will fail is the failure mode this state exists to prevent, so
 *   the line names the threshold instead. Reachable the moment a student spends
 *   down.
 * - **Enough.** The minutes.
 *
 * @param {number} balance        the student's credit balance
 * @param {number} pricePerBlock  this teacher's price, credits per block
 * @param {number} blockMinutes   `block.minutes` from `/public/pricing`
 * @param {number} openingMinutes `block.openingMinutes` — the start threshold
 */
export default function CreditMinutes({ balance, pricePerBlock, blockMinutes, openingMinutes }) {
  if (balance <= 0) {
    return (
      <Text size="xs" c="dimmed">
        No credit
      </Text>
    );
  }

  const minutes = minutesFor(balance, pricePerBlock, blockMinutes);

  if (minutes < openingMinutes) {
    return (
      <Text size="xs" c="dimmed">
        Not enough for the {openingMinutes}-minute opening block
      </Text>
    );
  }

  return (
    <Text size="xs" c="dimmed">
      Your credit ={' '}
      <Text span fw={600} c="var(--mantine-color-text)">
        {minutes} minutes
      </Text>
    </Text>
  );
}
