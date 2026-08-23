import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconPlus } from '@tabler/icons-react';
import { ERROR_CODES } from '@tutor/shared';
import { useCallback, useRef, useState } from 'react';

import { topUp } from '@/api/wallet.api';

/**
 * Add credit without leaving the page — PR 7.7, MVP.md §5.4's last line.
 *
 * Rendered inside `ExtendModal` when the student cannot afford another block, sixty
 * seconds before a paid session closes itself.
 *
 * **There is no link and no navigation in this file, and that is the whole design.** A
 * link to `/app/wallet` from a running session is a student leaving a timed call to go and
 * buy time for it, and coming back — if the router even lets them — to a session the
 * auto-end sweep closed while they were shopping. The cheapest way to guarantee it cannot
 * happen is that there is nothing here to leave with: no `Link`, no `useNavigate`, no
 * `href`. The review checklist for 7.7 greps for exactly that.
 *
 * **Sixty seconds is the entire budget.** Three buttons, one press, no confirmation step
 * and no second modal. The student is mid-lesson and the clock behind this is real.
 *
 * **The failure is shown here rather than raised as a toast**, which departs from
 * `notify.apiError` and the rule in `ErrorState`'s header. That rule is about a *screen*
 * that still has content; this is a confined decision surface with a countdown on it, and
 * below `sm` the modal is a full-screen sheet — a toast in a corner of it is a message a
 * hurrying student does not see. The sentence belongs next to the button that produced it.
 *
 * @param {number[]|undefined} packages  `pricing.topupPackages`, from the parent
 * @param {number} shortfall             credits still needed, for the hint
 * @param {(result: import('@tutor/shared').TopUpResponse) => void} onCredited
 */
export default function InlineTopUp({ packages, shortfall, onCredited }) {
  const [pending, setPending] = useState(null);
  const [failure, setFailure] = useState(null);

  /**
   * A ref rather than `pending`, and the difference is the guard. `pending` is what the
   * buttons render from and it is only true after React re-renders; two clicks in one tick
   * both read the old value and both fire, which on this endpoint is two ledger rows and
   * twice the credit for one decision. A hurried double-tap is the expected input here.
   */
  const inFlight = useRef(false);

  const buy = useCallback(
    (amount) => {
      if (inFlight.current) return;

      inFlight.current = true;
      setPending(amount);
      setFailure(null);

      topUp(amount)
        .then(onCredited)
        .catch(setFailure)
        .finally(() => {
          inFlight.current = false;
          setPending(null);
        });
    },
    [onCredited],
  );

  // The parent's pricing read failed, so there is no allowlist to offer from. No guessed
  // amounts: the server accepts membership of `TOPUP_PACKAGES` and nothing else, and a
  // button that 400s here costs the student the only sixty seconds they had.
  if (!packages?.length) {
    return (
      <Text size="sm" c="dimmed">
        Top-up amounts could not be loaded, so credit cannot be added from here.
      </Text>
    );
  }

  const busy = pending !== null;

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Add credit and keep going — you need ₪{shortfall} more.
      </Text>

      {/* Wrapping, so the three buttons stack at 375px inside a full-screen sheet
          without a horizontal scrollbar and without a breakpoint of their own. */}
      <Group gap="xs">
        {packages.map((amount) => (
          <Button
            key={amount}
            size="sm"
            variant="light"
            leftSection={<IconPlus size={16} />}
            loading={pending === amount}
            disabled={busy && pending !== amount}
            onClick={() => buy(amount)}
          >
            ₪{amount}
          </Button>
        ))}
      </Group>

      {failure ? (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} p="xs">
          <Text size="sm">
            {/* A 429 here is a real person pressing twice under time pressure, not an
                attack — the top-up route carries its own limiter because a mock top-up
                credits immediately. The server's sentence already says so; the point of
                naming the code is that this is the one failure a retry cannot fix. */}
            {failure.is?.(ERROR_CODES.RATE_LIMITED)
              ? failure.message
              : (failure.message ?? 'Could not add credit. Please try again.')}
          </Text>
        </Alert>
      ) : null}
    </Stack>
  );
}
