import { Badge, Card, Divider, Group, Stack, Text } from '@mantine/core';
import { IconChartBar, IconCircleCheck, IconMessages, IconStarFilled } from '@tabler/icons-react';
import { Fragment } from 'react';

import { topicName } from '@/components/teacher/TopicPicker';
import EmptyState from '@/components/state/EmptyState';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';

/**
 * The teacher's own reputation, topic by topic — `GET /teachers/me/stats` (PR 8.5).
 *
 * **The first screen in the product that shows `teacher_topic_stats` to a human.** Until
 * 8.1 the table had one writer and it was the seed, so this block would have rendered
 * fifteen fixtures and no evidence that anything worked. It now renders what the matching
 * engine actually ranks the teacher on, which is the whole point of showing it: §9.3's
 * `topic_fit` carries 0.35 of the match score and is computed from these exact numbers.
 *
 * **Subjects are separated from the topics under them, and this is the layout decision
 * the block exists for.** A subject row is not something the teacher taught — it is the
 * sum of the topics beneath it at 0.3 (§9.3), which is why its session count is a
 * fraction. Rendered flat, "Calculus — Integrals: 12.6" sits beside the "Integration by
 * parts: 42" it was derived from and the product looks like it cannot count. So the
 * topics are the list, the subjects are a muted section under it, and one sentence says
 * what the fraction means. The honest version is more useful than the tidy one — this is
 * a teacher reading their own numbers, not a stranger reading a card.
 *
 * **The rounding happens here and only here.** The server sends `12.6` because the value
 * it stores is `12.6` and its figures have to agree with the algorithm's; a display that
 * printed `13` would be a second rounding of a number the teacher can check against their
 * rank. `figure` below shows a whole number whole and a fraction to one place.
 *
 * **A topic with no ratings shows "not rated yet", never `0.0`** — `rating` is `null`
 * until somebody has rated the teacher in that topic and the two are different claims,
 * which is the same rule `TeacherCard` and `toTeacherCard` both state.
 *
 * The three async states are the review list's, in the same order: loading before error
 * before empty, with the result kept rather than cleared.
 *
 * @param {{topics: object[]}|null} stats
 * @param {boolean} loading
 * @param {Error|null} error
 * @param {() => void} onRetry
 */
export default function TopicStatsCard({ stats, loading, error, onRetry }) {
  if (loading && !stats) return <LoadingState label="Loading your topics…" minHeight={160} />;

  if (error) {
    return (
      <ErrorState
        error={error}
        title="Could not load your topics"
        onRetry={onRetry}
        minHeight={160}
      />
    );
  }

  if (!stats) return null;

  if (stats.topics.length === 0) {
    // A teacher who has taught nothing yet, or one whose sessions all ended without the
    // student rating them — §10 makes the rating the only edge out of `ENDED`, and the
    // student's history screen (8.4) is where those come back. Nothing here is broken and
    // the message says so rather than offering a button that would do nothing.
    return (
      <EmptyState
        icon={IconChartBar}
        title="No topic history yet"
        message="Once a student rates a session, the topic it was about appears here with your rating for it."
        minHeight={160}
      />
    );
  }

  const leaves = stats.topics.filter((topic) => topic.isLeaf);
  const subjects = stats.topics.filter((topic) => !topic.isLeaf);

  return (
    <Stack gap="sm">
      {leaves.length > 0 && (
        <Card withBorder padding={0} radius="md">
          {leaves.map((topic, index) => (
            <Fragment key={topic.topicId}>
              {index > 0 && <Divider />}
              <TopicRow topic={topic} />
            </Fragment>
          ))}
        </Card>
      )}

      {subjects.length > 0 && (
        <Stack gap={6}>
          <Text size="sm" fw={600}>
            Across whole subjects
          </Text>

          {/*
            Said out loud, because a teacher who reads "12.6 sessions" and is given no
            explanation concludes the number is broken. It is the propagation, and it is
            the reason a session on integrals also helps this teacher match a question
            about derivatives.
          */}
          <Text size="xs" c="dimmed">
            A session counts once for the topic it was about, and a fraction of it for the subject
            above — so these are smaller than the numbers on your topics, and they are what puts you
            forward for other questions in the same subject.
          </Text>

          <Card withBorder padding={0} radius="md">
            {subjects.map((topic, index) => (
              <Fragment key={topic.topicId}>
                {index > 0 && <Divider />}
                <TopicRow topic={topic} muted />
              </Fragment>
            ))}
          </Card>
        </Stack>
      )}

      {/*
        The two numbers on this screen move at different moments and a teacher will
        eventually notice. The tiles above come from `teacher_profiles`, whose counters
        move when a session *ends*; these rows move when a student *rates* it, and a
        student who closes the tab never does. Explained rather than hidden — hiding one
        of them would make the disagreement unfindable rather than untrue.
      */}
      <Text size="xs" c="dimmed">
        These counts include only sessions a student has rated, so they can be lower than the totals
        above.
      </Text>
    </Stack>
  );
}

/**
 * One topic: its name, then how much of it the teacher has done, then how it went.
 *
 * A stacked row rather than a table. At 375px a four-column table is either scrolled
 * sideways or unreadable, and CONVENTIONS.md asks for mobile-first — the figures wrap
 * onto their own line and nothing is cut off.
 *
 * `dir="auto"` on the name, like every other topic label in the client: the taxonomy is
 * bilingual and a Hebrew name in a left-to-right row renders with its punctuation in the
 * wrong place without it.
 */
function TopicRow({ topic, muted = false }) {
  return (
    <Stack gap={6} p="md">
      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
        <Text fw={muted ? 500 : 600} size="sm" dir="auto">
          {topicName(topic)}
        </Text>

        {topic.rating === null ? (
          <Badge variant="default" size="sm" radius="sm">
            Not rated yet
          </Badge>
        ) : (
          <Badge
            variant="light"
            color="yellow"
            size="sm"
            radius="sm"
            leftSection={<IconStarFilled size={11} />}
          >
            {topic.rating.toFixed(1)} · {figure(topic.ratingCount)}{' '}
            {topic.ratingCount === 1 ? 'rating' : 'ratings'}
          </Badge>
        )}
      </Group>

      <Group gap="md" c="dimmed" wrap="wrap">
        <Group gap={4}>
          <IconMessages size={14} stroke={1.5} />
          <Text size="xs">{figure(topic.sessionsCount)} sessions</Text>
        </Group>

        <Group gap={4}>
          <IconCircleCheck size={14} stroke={1.5} />
          <Text size="xs">{figure(topic.resolvedCount)} solved</Text>
        </Group>
      </Group>
    </Stack>
  );
}

/**
 * A stored counter, printed as what it is.
 *
 * Whole numbers print whole — a teacher's topics are whole sessions and "42.0" would be
 * noise. Fractions print to one place, which is every digit the 0.3 weight can produce
 * against a whole count and is what the `NUMERIC(8,2)` column actually holds for one.
 *
 * **Nothing here rounds to an integer.** The server refuses to, deliberately, so that
 * these figures agree with the ones the teacher is ranked on; a `Math.round` here would
 * throw that away one layer later.
 */
function figure(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
