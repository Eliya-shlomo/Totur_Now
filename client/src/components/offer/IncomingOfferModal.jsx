import {
  Badge,
  Button,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  useMantineTheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { acceptOffer, rejectOffer } from '@/api/offer.api';
import OfferCountdown from '@/components/offer/OfferCountdown';
import { notify } from '@/lib/notify';

/**
 * The incoming offer — PR 5.7, MVP.md §14.1. Raised by the dashboard on `offer:new`.
 *
 * **It cannot be missed and it cannot be dismissed by accident.** No close button, no
 * escape key, no click-outside: a teacher has sixty seconds, and the three ordinary
 * ways of closing a dialog are three ways to lose a session by reflex. The only exits
 * are Accept, Decline, and the clock.
 *
 * **Nothing is sent when it expires.** The offer is gone whether or not 5.5's sweep
 * has reached the row — 5.4 re-checks `expires_at` under the row lock — so an Accept
 * fired at zero races the cron for no benefit and answers `409 OFFER_EXPIRED`. The
 * teacher would see an error for the product working exactly as designed. The modal
 * closes and says so.
 *
 * **Accept goes to `/teach/session/:id`, which is still E6's placeholder, and that is
 * correct.** The confirmation says the session is starting and the screen it lands on
 * says it is being built. A plausible session screen rendered here instead would be a
 * lie with better production values — the same ruling 4.7 made for **Send request**.
 *
 * **Decline asks nothing.** Sixty seconds is not enough time to ask twice, and a
 * confirmation dialog over a countdown is a way to run out the clock on a teacher who
 * has already decided.
 */

/**
 * @param {object} props
 * @param {import('@tutor/shared').IncomingOffer} props.offer
 * @param {() => void} props.onClose  clears the offer on the dashboard
 */
export default function IncomingOfferModal({ offer, onClose }) {
  const navigate = useNavigate();
  const theme = useMantineTheme();

  /**
   * §14.4 — a full-screen sheet below `sm` (768px). A centred dialog on a phone puts
   * the brief in a scroll box and the earning below the fold, and the earning is the
   * number the decision is actually made on.
   */
  const isPhone = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  /**
   * In flight, and the guard against a second request. Both buttons disable while
   * either call is open — a teacher who taps Accept twice on a phone must not send two
   * accepts, and one who taps Accept then Decline must not send both.
   */
  const [pending, setPending] = useState(null);

  const onAccept = useCallback(async () => {
    setPending('accept');

    try {
      const session = await acceptOffer(offer.offerId);

      // Said before the navigation, because the screen it lands on is E6's honest
      // placeholder and this is the only place that confirms what just happened.
      notify.success('Session starting — you have taken this question.');

      onClose();
      navigate(`/teach/session/${session.sessionId}`);
    } catch (error) {
      // Includes `409 OFFER_EXPIRED` in the race where the clock ran out between the
      // press and the server reading the row. The offer is gone either way, so the
      // modal closes rather than sitting there offering a button that cannot work.
      notify.apiError(error);
      onClose();
    } finally {
      setPending(null);
    }
  }, [navigate, offer.offerId, onClose]);

  const onDecline = useCallback(async () => {
    setPending('decline');

    try {
      await rejectOffer(offer.offerId);
    } catch (error) {
      // The server answers 200 even for an offer that already expired, so a failure
      // here is a network or auth problem rather than a state one. The modal still
      // closes: the teacher declined, and leaving it open would trap them behind a
      // dialog whose lock the cron will release anyway.
      notify.apiError(error);
    } finally {
      setPending(null);
      onClose();
    }
  }, [offer.offerId, onClose]);

  /**
   * The clock reached zero. No request — see the header — and a toast rather than a
   * silent disappearance, because a modal that vanishes on its own looks like a bug
   * to the person who was reading it.
   */
  const onExpire = useCallback(() => {
    notify.info('That question expired before you answered.');
    onClose();
  }, [onClose]);

  return (
    <Modal
      opened
      // Mantine requires the prop; every path that would call it is disabled below, so
      // it exists to satisfy the component rather than to close anything.
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      fullScreen={isPhone}
      centered
      size="lg"
      padding="lg"
      overlayProps={{ backgroundOpacity: 0.6, blur: 2 }}
      // A string, styled through `styles.title`, and not a `<Title>` element:
      // Mantine renders the modal's title inside an `h2`, so a heading component
      // passed here nests one heading inside another — invalid HTML, and React says
      // so in the console.
      title="New question for you"
      styles={{ title: { fontSize: 'var(--mantine-h3-font-size)', fontWeight: 700 } }}
    >
      <Stack gap="md">
        {/*
          The two numbers the decision is made on, side by side and first — above the
          fold at 375px, which is the whole reason the sheet is full-screen there.
        */}
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              You earn
            </Text>
            <Text fw={700} fz={{ base: 32, sm: 28 }} lh={1} c="teal.7">
              {formatCredits(offer.expectedEarning)} credits
            </Text>
          </Stack>

          <Stack gap={2} align="flex-end">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Time to answer
            </Text>
            <OfferCountdown expiresAt={offer.expiresAt} onExpire={onExpire} />
          </Stack>
        </Group>

        <Group gap="xs">
          {offer.topicLabel && (
            <Badge variant="light" size="lg">
              {offer.topicLabel}
            </Badge>
          )}

          {offer.level !== null && (
            <Badge variant="light" color="gray" size="lg">
              {offer.level} units
            </Badge>
          )}
        </Group>

        <Stack gap={4}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            What they are stuck on
          </Text>

          {/*
            The brief in full, scrolling inside its own box rather than pushing the
            buttons off a phone screen. It is E3's `teacher_brief` — shown as written,
            never re-summarised here, and on the classifier's fallback path it is the
            student's own words.
          */}
          <ScrollArea.Autosize mah={isPhone ? 220 : 260} type="auto">
            <Text style={{ whiteSpace: 'pre-wrap' }}>{offer.brief}</Text>
          </ScrollArea.Autosize>
        </Stack>

        <Group grow={isPhone} justify="flex-end" mt="xs">
          <Button
            variant="default"
            size={isPhone ? 'md' : 'sm'}
            onClick={onDecline}
            loading={pending === 'decline'}
            disabled={pending !== null}
          >
            Decline
          </Button>

          <Button
            color="teal"
            size={isPhone ? 'md' : 'sm'}
            onClick={onAccept}
            loading={pending === 'accept'}
            disabled={pending !== null}
          >
            Accept
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * `expectedEarning` for display, and **only** for display.
 *
 * The server sends the price times the opening blocks times one minus §5.3's
 * commission, unrounded on purpose: E7 does the rounding when it actually moves money,
 * and a second rounding here would be a second answer to "what did I earn". So this
 * shows one decimal when there is one and a whole number when there is not — never a
 * rounded integer standing in for a fractional payout.
 *
 * @param {number} credits
 * @returns {string}
 */
function formatCredits(credits) {
  if (!Number.isFinite(credits)) return '—';

  return Number.isInteger(credits) ? String(credits) : credits.toFixed(1);
}
