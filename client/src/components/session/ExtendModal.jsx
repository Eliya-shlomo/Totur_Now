import { Alert, Button, Group, Modal, Stack, Text, useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle } from '@tabler/icons-react';

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
 * answered because silence already means something.
 *
 * @param {object} props
 * @param {object|null} props.warning the `session:block_warning` payload, or null
 * @param {boolean} props.busy the extend request is in flight
 * @param {() => void} props.onExtend
 * @param {() => void} props.onDismiss
 */
export default function ExtendModal({ warning, busy, onExtend, onDismiss }) {
  const theme = useMantineTheme();

  /**
   * §14.4 — a full-screen sheet below `sm` (768px), the same call 5.7's offer modal
   * made. A centred dialog on a phone puts the price above the fold and the two buttons
   * below it, and this modal has sixty seconds to be answered in.
   */
  const isPhone = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const open = Boolean(warning);

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

          <Text size="sm" c="dimmed">
            {/* The server sends what the balance *would* be, and a negative number is not
                clamped: `canAfford` is the decision, and a figure that hid how short they
                are would be worse than a minus sign. */}
            Your balance after this would be ₪{warning.balanceAfter}.
          </Text>

          {!warning.canAfford ? (
            <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
              You do not have enough credits for another block. The session will end when the clock
              runs out.
            </Alert>
          ) : null}

          {warning.canAfford && !warning.withinCap ? (
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
              disabled={busy || !warning.canAfford || !warning.withinCap}
            >
              Add another block
            </Button>
          </Group>
        </Stack>
      ) : null}
    </Modal>
  );
}
