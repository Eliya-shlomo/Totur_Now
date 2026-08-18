import { Anchor, Badge, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconCoin, IconStar, IconCircleCheck, IconMessages } from '@tabler/icons-react';
import { SOCKET_EVENTS } from '@tutor/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getTeacherMe } from '@/api/teacher.api';
import IncomingOfferModal from '@/components/offer/IncomingOfferModal';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';
import { useSocketEvent } from '@/hooks/useSocketEvent';

/**
 * `/teach` — the teacher's dashboard. MVP.md §14.1, PR 5.7.
 *
 * The teacher's half of the product: the screen that decides whether they are
 * reachable at all, and the one that raises an offer when they are. Three blocks —
 * availability, standing, and the modal that appears over both.
 *
 * **One offer at a time, and no queue.** 5.3's atomic lock guarantees a teacher holds
 * at most one `PENDING` offer; if a second `offer:new` arrives while a modal is open,
 * the lock did not hold and two students are waiting on one teacher. So the second one
 * is logged loudly and dropped rather than queued: a queue would render both offers in
 * turn, the teacher would answer one, and the defect — the thing this epic exists to
 * prevent — would be invisible until it reached production. The client's job here is
 * to be a witness.
 *
 * **No rehydrate on reload.** A teacher who refreshes mid-offer sees no modal, and
 * that is scoped out rather than forgotten: `GET /sessions/:id` answers the teacher's
 * side of a pending offer, and wiring it is a later PR's. The offer expires on its own
 * either way and the lock is released by 5.5.
 */
export default function Dashboard() {
  /** `TeacherMeResponse`, for the standing block. Its own read — see `loadTeacher`. */
  const [teacher, setTeacher] = useState(null);
  const [teacherError, setTeacherError] = useState(null);

  /** The open offer, or `null`. At most one, by 5.3's lock. */
  const [offer, setOffer] = useState(null);

  /**
   * The standing figures, read here rather than shared with the header's toggle.
   *
   * Two reads of `GET /teachers/me` on this screen, and that is the cheaper mistake.
   * The alternative is a store both components write, which is a second source of
   * truth for a status that the *server* changes underneath them — and 5.3's lock
   * means the two would disagree at exactly the moment the disagreement matters. The
   * request is small, cached by nothing, and made once per mount.
   */
  const loadTeacher = useCallback(() => {
    let cancelled = false;

    setTeacherError(null);

    getTeacherMe()
      .then((record) => {
        if (!cancelled) setTeacher(record);
      })
      .catch((error) => {
        if (!cancelled) setTeacherError(error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(loadTeacher, [loadTeacher]);

  /**
   * A student picked this teacher. The payload is `IncomingOffer` in full, including
   * the absolute `expiresAt` the countdown recomputes from.
   */
  useSocketEvent(
    SOCKET_EVENTS.OFFER_NEW,
    useCallback((incoming) => {
      setOffer((current) => {
        if (current) {
          // Loud on purpose, and not a toast: this is not something the teacher can
          // act on, it is a server-side invariant that has just been violated. The
          // second offer is dropped, so the student who sent it gets the expiry they
          // would have got anyway rather than a teacher answering the wrong question.
          console.error(
            '[5.7] A second offer:new arrived while an offer was open. The atomic lock in 5.3 did not hold.',
            { open: current.offerId, dropped: incoming?.offerId },
          );

          return current;
        }

        return incoming;
      });
    }, []),
  );

  /**
   * The sweep reached it first, or the student gave up. Matched on `offerId` so a
   * late frame for an offer that has already been answered cannot close the modal
   * raised by the next one.
   */
  useSocketEvent(
    SOCKET_EVENTS.OFFER_EXPIRED,
    useCallback((payload) => {
      setOffer((current) => (current && current.offerId === payload?.offerId ? null : current));
    }, []),
  );

  const clearOffer = useCallback(() => setOffer(null), []);

  return (
    <Stack gap="lg">
      <Title order={2}>Dashboard</Title>

      {/*
        Explanation, and no second control.

        This card mounted `TeacherStatusToggle` a second time at first, on the argument
        that one component cannot disagree with itself. The argument was right and the
        result was still wrong: the menu is rendered inline (`withinPortal={false}`, so
        that it works from the header at every width) and a `Card` clips it, so the
        dropdown opened into nothing and the control here could not be used at all.

        A control that does not work beside one that does is worse than no control, and
        the header is where the toggle belongs anyway — §6.3's reason is that going
        offline has to be reachable from wherever the teacher happens to be, which a
        dashboard-only control is not. So the block explains what availability means and
        sends the teacher to the one place that changes it.
      */}
      <Card withBorder padding="lg">
        <Stack gap="xs">
          <Text fw={600}>Availability</Text>

          <Text size="sm" c="dimmed">
            While you are online, students can send you questions and you have 60 seconds to answer
            each one. Going offline stops new requests; it never interrupts a session you are
            already in.
          </Text>

          <Text size="sm" c="dimmed">
            Use the availability control in the top bar to go online or offline. It shows your
            current status, including when the system is holding you for an offer or a session.
          </Text>
        </Stack>
      </Card>

      <Stack gap="xs">
        <Text fw={600}>Your standing</Text>

        {teacherError && (
          <ErrorState
            error={teacherError}
            title="Could not load your standing"
            onRetry={loadTeacher}
          />
        )}

        {!teacherError && !teacher && <LoadingState label="Loading your standing…" />}

        {!teacherError && teacher && (
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
            <StandingTile
              icon={<IconMessages size={18} stroke={1.5} />}
              label="Sessions"
              value={teacher.sessionsCount}
            />

            <StandingTile
              icon={<IconCircleCheck size={18} stroke={1.5} />}
              label="Resolved"
              value={teacher.resolvedCount}
            />

            <StandingTile
              icon={<IconStar size={18} stroke={1.5} />}
              label="Rating"
              // `null` until somebody has rated them, and never `0` — a new teacher
              // has no rating, which is a different thing from a bad one.
              value={teacher.rating === null ? '—' : teacher.rating.toFixed(1)}
              caption={teacher.ratingCount > 0 ? `${teacher.ratingCount} ratings` : 'Not rated yet'}
            />

            {/*
              Earnings is a tile with no number, and that is the honest answer today.
              `GET /teachers/me` returns sessions, resolves and rating; it returns no
              money, and E7 owns the wallet that would. A figure derived here from
              sessions and price would be a payout estimate this screen cannot stand
              behind — so the tile says where earnings live and links there.
            */}
            <Card withBorder padding="md">
              <Stack gap={4}>
                <Group gap={6} c="dimmed">
                  <IconCoin size={18} stroke={1.5} />
                  <Text size="xs" tt="uppercase" fw={600}>
                    Earnings
                  </Text>
                </Group>

                <Badge variant="light" color="gray">
                  Coming in E7
                </Badge>

                <Anchor component={Link} to="/teach/earnings" size="xs">
                  Earnings breakdown
                </Anchor>
              </Stack>
            </Card>
          </SimpleGrid>
        )}
      </Stack>

      {offer && <IncomingOfferModal offer={offer} onClose={clearOffer} />}
    </Stack>
  );
}

/**
 * One figure from `GET /teachers/me`. A tile rather than a row because at 375px four
 * rows of label-and-number is most of the screen, and none of these is worth scrolling
 * past the availability control for.
 */
function StandingTile({ icon, label, value, caption = null }) {
  return (
    <Card withBorder padding="md">
      <Stack gap={4}>
        <Group gap={6} c="dimmed">
          {icon}
          <Text size="xs" tt="uppercase" fw={600}>
            {label}
          </Text>
        </Group>

        <Text fw={700} fz={24} lh={1.2}>
          {value}
        </Text>

        {caption && (
          <Text size="xs" c="dimmed">
            {caption}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
