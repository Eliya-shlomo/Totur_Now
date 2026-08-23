import { Alert, Button, Group, Modal, Stack, Text, useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useState } from 'react';

import InlineTopUp from '@/components/wallet/InlineTopUp';

/**
 * "Your time is nearly up — keep going?" — PR 6.7, MVP.md §5.1 and §14.3.
 *
 * **Every number on this modal comes off the `session:block_warning` payload and not one
 * of them is computed here.** `extensionPrice`, `balanceAfter`, `canAfford` and
 * `withinCap` are decided by the server, against the same two rules
 * `POST /sessions/:id/extend` enforces — balance covers the price, and
 * `total_charged + price` stays inside the cap. A modal that worked out affordability
 * itself would work it out differently from the endpoint, and the difference shows up as
 * an enabled button that answers 402: the worst possible moment to be wrong, because the
 * student has already decided to spend.
 *
 * **So the button is disabled with a reason rather than hidden.** A missing button is a
 * dead end nobody can act on; "you need ₪12 more" is a sentence with a next step in it.
 *
 * **The student side only.** The teacher gets a passive note on the screen behind this —
 * they cannot spend, and a modal they must dismiss is a modal in front of somebody who is
 * mid-sentence explaining something.
 *
 * Dismissible, and dismissing is a real answer: §5.1 lets the block run out and the
 * auto-end sweep closes the session `GRACE_SECONDS` later. The modal does not have to be
 * answered because silence already means something. **7.7 adds no obligation to answer**:
 * the top-up below is an option inside the same modal, not a step it now requires.
 *
 * ## PR 7.7 — the sentence becomes a button
 *
 * The header above says a disabled button beats a hidden one because "you need ₪12 more"
 * is a sentence with a next step in it. Until E7 there was no step to take: nothing in the
 * product could add credit. `POST /wallet/topup` exists now, so the out-of-credit branch
 * offers the packages in place — §5.4's "a top-up banner appears at the 60-second
 * warning", which E6 could not build.
 *
 * **`canAfford: true` is untouched.** No extra element, no extra request, no changed
 * layout. This is the most expensive screen in the product sixty seconds before a session
 * closes, and the branch most sessions take must be the one 6.7 shipped.
 *
 * @param {object} props
 * @param {object|null} props.warning the `session:block_warning` payload, or null
 * @param {boolean} props.busy the extend request is in flight
 * @param {number[]} [props.topupPackages] `pricing.topupPackages`, for the branch below
 * @param {() => void} props.onExtend
 * @param {() => void} props.onDismiss
 */
export default function ExtendModal({ warning, busy, topupPackages, onExtend, onDismiss }) {
  const theme = useMantineTheme();

  /**
   * §14.4 — a full-screen sheet below `sm` (768px), the same call 5.7's offer modal
   * made. A centred dialog on a phone puts the price above the fold and the two buttons
   * below it, and this modal has sixty seconds to be answered in.
   */
  const isPhone = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const open = Boolean(warning);

  /**
   * The warning this tab has already topped up against — **the payload object itself, not
   * a boolean.**
   *
   * Every `session:block_warning` is a new object, so `credited.warning === warning` is
   * false the instant a fresh warning arrives and the modal goes back to trusting the
   * server without an effect, a reset, or a render in between where a stale `true` still
   * applied. A boolean would need clearing, and the render it was cleared one tick late on
   * is the render where an unaffordable block looks affordable.
   *
   * `balance` rides along because the top-up response carries the server's new figure, and
   * the line above the button would otherwise still be quoting the projection from before
   * the money arrived.
   */
  const [credited, setCredited] = useState(null);
  const toppedUp = warning !== null && credited?.warning === warning;

  /**
   * **The modal does not recompute `canAfford`, and this is not that.** 6.7's rule is that
   * a screen working out affordability works it out differently from the endpoint that
   * enforces it. What happens here is narrower: the balance demonstrably moved, so the
   * server's `canAfford: false` is stale, and the modal stops asserting a fact it knows is
   * out of date. It does not claim the opposite. `POST /sessions/:id/extend` is still the
   * authority, and if the top-up was not enough it answers `402 INSUFFICIENT_CREDIT`,
   * which `sessionErrors.js` already turns into the server's own sentence.
   *
   * **`withinCap` is deliberately not part of this.** The budget cap is the student's own
   * ceiling for this question and buying credit is not a way through it, so it keeps
   * disabling the button on its own terms.
   */
  const affordable = warning?.canAfford || toppedUp;

  // Negative `balanceAfter` is the server's own figure, unclamped on purpose. The
  // shortfall is that number with its sign flipped — the price minus what they hold — not
  // a second opinion about anything.
  const shortfall = warning ? Math.max(0, -warning.balanceAfter) : 0;

  return (
    <Modal
      opened={open}
      onClose={onDismiss}
      title="Keep this session going?"
      centered={!isPhone}
      fullScreen={isPhone}
      size="md"
    >
      {warning ? (
        <Stack gap="md">
          <Text>
            About {Math.max(0, Math.round(warning.secondsLeft))} seconds left. Another block is{' '}
            <strong>₪{warning.extensionPrice}</strong>.
          </Text>

          {toppedUp ? (
            /*
              The line below is the server's projection from *before* the top-up, so once
              credit has been added it is stale — and an enabled button sitting under "your
              balance after this would be ₪-7" is a screen arguing with itself.

              What replaces it is the balance `POST /wallet/topup` answered with: the
              server's own number, echoed. Deliberately **not** the new projection —
              `balance - extensionPrice` here would be this modal computing the very figure
              its header says it must never compute. The projection comes back on the next
              `session:block_warning`, or the extend response settles it for real.
            */
            <Text size="sm" c="dimmed">
              Credit added — your balance is now ₪{credited.balance}.
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              {/* The server sends what the balance *would* be, and a negative number is not
                  clamped: `canAfford` is the decision, and a figure that hid how short they
                  are would be worse than a minus sign. */}
              Your balance after this would be ₪{warning.balanceAfter}.
            </Text>
          )}

          {!affordable ? (
            <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
              <Stack gap="sm">
                <Text size="sm">
                  You do not have enough credits for another block. The session will end when the
                  clock runs out.
                </Text>

                <InlineTopUp
                  packages={topupPackages}
                  shortfall={shortfall}
                  onCredited={(result) => setCredited({ warning, balance: result.balance })}
                />
              </Stack>
            </Alert>
          ) : null}

          {affordable && !warning.withinCap ? (
            <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
              This would go past the spending limit set for this session, so it cannot be extended.
            </Alert>
          ) : null}

          <Group justify="flex-end">
            <Button variant="subtle" onClick={onDismiss} disabled={busy}>
              Let it end
            </Button>

            <Button
              onClick={onExtend}
              loading={busy}
              // Both flags, and the modal never decides either. Disabled with the reason
              // above it beats a button that 402s.
              disabled={busy || !affordable || !warning.withinCap}
            >
              Add another block
            </Button>
          </Group>
        </Stack>
      ) : null}
    </Modal>
  );
}
