import { Alert, Anchor, Badge, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import {
  IconCoin,
  IconStar,
  IconCircleCheck,
  IconMessages,
  IconPlugOff,
} from '@tabler/icons-react';
import { SOCKET_EVENTS } from '@tutor/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getTeacherMe } from '@/api/teacher.api';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';
import { useSocketEvent } from '@/hooks/useSocketEvent';

/**
 * `/teach` — the teacher's dashboard. MVP.md §14.1, PR 5.7.
 *
 * The teacher's half of the product: the screen that decides whether they are
 * reachable at all. Two blocks — availability, and standing.
 *
 * **The incoming offer is no longer raised here.** It was, from 5.7 until 6b.3, and
 * that is why a teacher on `/teach/profile` never saw one: the listener unmounted with
 * this screen while the socket stayed up, so the lock was held, the header read "Offer
 * pending", and there was nothing anywhere to accept. It now lives in
 * `components/offer/OfferHost.jsx`, mounted by `TeacherLayout` for every `/teach/*`
 * route. The rules it carries — the handshake replay, the dropped second offer, the
 * expiry matched on `offerId` — moved with it unchanged.
 */
export default function Dashboard() {
  /** `TeacherMeResponse`, for the standing block. Its own read — see `loadTeacher`. */
  const [teacher, setTeacher] = useState(null);
  const [teacherError, setTeacherError] = useState(null);

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
   * `teacher:status` — this teacher's own availability, from wherever it moved.
   *
   * The notice below is a claim about the present, so it cannot be rendered from a value
   * read once on mount: the toggle in the header changes it, and so do the offer lock,
   * a session starting and both sweeps. The payload is filtered to this teacher because
   * `emitTeacherStatus` broadcasts to everybody — the same filter, for the same reason,
   * as `TeacherStatusToggle`.
   */
  useSocketEvent(
    SOCKET_EVENTS.TEACHER_STATUS,
    useCallback((payload) => {
      setTeacher((current) => {
        if (!current || payload?.teacherId !== current.id) return current;

        return { ...current, status: payload.status };
      });
    }, []),
  );

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

          {/*
            Said out loud, because a teacher now starts every session offline and nothing
            else on the screen would explain the silence.

            `status` used to survive the browser that set it: a teacher went online, closed
            the laptop, and students were offered them for the next hour with nobody there
            to answer. Availability is a statement about right now, so it is made once per
            session — and the cost of that is a teacher who does not know they are invisible.
            This is that cost, paid in one sentence.
          */}
          {teacher?.status === 'OFFLINE' && (
            <Alert
              icon={<IconPlugOff size={16} />}
              color="yellow"
              variant="light"
              title="You are offline, so no questions will reach you"
            >
              You start each sign-in offline. Go online in the top bar when you are ready to answer,
              and a question will reach you on any of your pages.
            </Alert>
          )}
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
