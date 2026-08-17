import { Anchor, Badge, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconStar } from '@tabler/icons-react';
import { ERROR_CODES } from '@tutor/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { getTeacher } from '@/api/teacher.public.api';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';
import TeacherBadge from '@/components/teacher/TeacherBadge';
import NotFound from '@/pages/NotFound';

/**
 * `/teachers/:id` — one teacher, read by a stranger. MVP.md §14.1.
 *
 * The payload is the same `TeacherCard` the list renders; this screen shows all of
 * it rather than the summary a grid cell has room for. There is deliberately **no
 * "book this teacher" button**: booking is E3 and E4 and does not exist. A dead
 * primary button on the most important screen in the funnel is worse than none.
 */
export default function TeacherProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * Whether this screen was reached from somewhere inside the app.
   *
   * React Router stamps `key: 'default'` on the first entry of a browsing session
   * and a real key on every entry pushed after it, so this is "there is a page
   * behind me" without keeping a trail of our own. A shared link, a new tab and a
   * bookmark all answer false and get the list; everything else goes back where it
   * came from.
   */
  const cameFromInsideTheApp = location.key !== 'default';

  const [teacher, setTeacher] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    getTeacher(id)
      .then((data) => {
        if (!cancelled) setTeacher(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(load, [load]);

  if (loading) return <LoadingState label="Loading profile…" minHeight={320} />;

  // A `NOT_FOUND` is not a failure to retry — the id is a student's, or nobody's,
  // and it will be just as absent next time. The 404 page is the honest answer, and
  // it is the same one a bad URL gets, so the two cases read identically to a
  // visitor who mistyped something. `VALIDATION_ERROR` lands here too: a malformed
  // uuid is a bad address, not a broken server.
  if (error?.is?.(ERROR_CODES.NOT_FOUND) || error?.is?.(ERROR_CODES.VALIDATION_ERROR)) {
    return <NotFound />;
  }

  if (error) {
    return (
      <ErrorState
        error={error}
        title="Could not load this teacher"
        onRetry={load}
        minHeight={320}
      />
    );
  }

  return (
    <Stack gap="xl">
      {/*
        Back to wherever the visitor was, not always to the public list.

        A student who opened this profile from their match list (`/app/ask/:id/teachers`,
        PR 4.7) was reading five teachers chosen for their question; sending them to
        `/teachers` drops them into all fifteen, most of whom are offline or cannot
        teach that topic, with no way back to the shortlist but the browser's own back
        button. The list is only the right destination when it is where they actually
        came from.
      */}
      {cameFromInsideTheApp ? (
        <Anchor component="button" type="button" size="sm" onClick={() => navigate(-1)}>
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            Back
          </Group>
        </Anchor>
      ) : (
        <Anchor component={Link} to="/teachers" size="sm">
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            All teachers
          </Group>
        </Anchor>
      )}

      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <Stack gap={4}>
            <Title order={1}>{teacher.fullName}</Title>
            <Rating rating={teacher.rating} ratingCount={teacher.ratingCount} />
          </Stack>

          <Group gap="xs">
            <TeacherBadge badge={teacher.badge} size="lg" />
            <Badge
              variant="light"
              color={teacher.isOnline ? 'teal' : 'gray'}
              size="lg"
              // No `OFFER_LOCKED` or `IN_SESSION` here, and not because they are
              // filtered: the public payload has no `status` at all. Those are
              // matching-engine internals (E4) and a stranger has no business
              // reading the platform's state.
            >
              {teacher.isOnline ? 'Online now' : 'Offline'}
            </Badge>
          </Group>
        </Group>

        {teacher.bio && <Text maw={640}>{teacher.bio}</Text>}
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        <Fact label="Price">₪{teacher.pricePerBlock} / block</Fact>
        <Fact label="Teaches up to">Level {teacher.levelMax}</Fact>
        <Fact label="Ratings">
          {teacher.ratingCount === 0 ? 'None yet' : `${teacher.ratingCount} received`}
        </Fact>
      </SimpleGrid>

      <Stack gap="sm">
        <Title order={3}>Topics</Title>

        {teacher.topics.length === 0 ? (
          <Text size="sm" c="dimmed">
            This teacher has not chosen their topics yet.
          </Text>
        ) : (
          <Group gap="xs">
            {teacher.topics.map((topic) => (
              <Badge key={topic.id} variant="default" size="md" radius="sm">
                {topic.nameEn}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>

      {/* Reviews are PR 8.5. Saying so is better than an empty section that reads
          as a teacher nobody has anything to say about. */}
    </Stack>
  );
}

/** One labelled number. Three of them, so the layout is a grid rather than prose. */
function Fact({ label, children }) {
  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap={2}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
        <Text fw={700}>{children}</Text>
      </Stack>
    </Card>
  );
}

/**
 * The rating, or its absence — the same distinction the card makes, at heading size.
 *
 * `null` is "not rated yet" and `0` would be "rated badly". The server keeps them
 * apart (`ratingOf` in `utils/teacherView.js`) and so does every screen that reads
 * it.
 */
function Rating({ rating, ratingCount }) {
  if (rating === null) {
    return (
      <Text size="sm" c="dimmed">
        No ratings yet — this teacher is new here
      </Text>
    );
  }

  return (
    <Group gap={6} align="center">
      <IconStar size={18} fill="currentColor" style={{ color: 'var(--mantine-color-yellow-6)' }} />
      <Text fw={600}>{rating.toFixed(1)}</Text>
      <Text size="sm" c="dimmed">
        from {ratingCount} {ratingCount === 1 ? 'rating' : 'ratings'}
      </Text>
    </Group>
  );
}
