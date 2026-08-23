import { Badge, Card, Divider, Group, Pagination, Stack, Text } from '@mantine/core';
import { IconCheck, IconMessage2, IconStar, IconStarFilled } from '@tabler/icons-react';
import { Fragment } from 'react';

import EmptyState from '@/components/state/EmptyState';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';

/**
 * What students wrote about one teacher — `GET /teachers/:id/reviews` (PR 8.3).
 *
 * **Nobody's name is on this list and that is the design, not a gap.** The payload
 * carries no student in any form, so there is nothing here to hide and nothing to
 * decide: a row is a rating, a sentence, a topic and a date. §6.3 — the platform states
 * only what it can stand behind — and the page is about the teacher.
 *
 * **A review with no stars renders with no star row, never with five empty ones.**
 * `isResolved` is the only required field on a review (§6.2) and the rating screen sends
 * stars only when the student picked some, so this is the common case rather than the
 * edge. Five hollow stars beside a warm comment is the client-side version of the defect
 * `session.review.service.js` is careful about: it publishes the harshest rating a
 * student can give on behalf of one who declined to give any.
 *
 * **`comment` is unmoderated student text on a public page and is rendered as text.**
 * React escapes by default and nothing here reaches for `dangerouslySetInnerHTML`.
 * Moderation is E9's admin surface; a half-built filter here would be worse than none,
 * because the next person would believe the problem was handled.
 *
 * **Paged, not infinitely scrolled**, the same call the wallet ledger and the teacher
 * grid make: `total` is on the response, so the end of the list is reachable on a phone.
 * The three async states are checked loading-before-error-before-empty, and `result` is
 * kept across a page change rather than cleared, so paging does not blank the section.
 *
 * @param {{reviews: object[], total: number}|null} result
 * @param {boolean} loading
 * @param {Error|null} error
 * @param {number} page      1-based, matching the endpoint
 * @param {number} pageSize
 * @param {() => void} onRetry
 * @param {(page: number) => void} onPageChange
 */
export default function ReviewList({
  result,
  loading,
  error,
  page,
  pageSize,
  onRetry,
  onPageChange,
}) {
  if (loading && !result) return <LoadingState label="Loading reviews…" minHeight={160} />;

  if (error) {
    return (
      <ErrorState error={error} title="Could not load reviews" onRetry={onRetry} minHeight={160} />
    );
  }

  if (!result) return null;

  if (result.reviews.length === 0) {
    // No action, and none is possible: a stranger reading a profile cannot write a
    // review, and a student can only write one for a session they actually had. The
    // honest empty state says what the list is rather than offering a dead button.
    //
    // Every seeded teacher lands here, because the seed writes rating aggregates and no
    // `reviews` rows — so the ⭐ average above this section is real and this list is
    // empty at the same time. That is true rather than broken, and the heading above
    // does not claim the two agree.
    return (
      <EmptyState
        icon={IconMessage2}
        title="No written reviews yet"
        message="Students leave a note after a session. This teacher has ratings but nothing written."
        minHeight={160}
      />
    );
  }

  const pageCount = Math.ceil(result.total / pageSize);

  return (
    <Stack gap="sm">
      <Card withBorder padding={0} radius="md">
        {result.reviews.map((review, index) => (
          <Fragment key={review.id}>
            {index > 0 && <Divider />}
            <ReviewRow review={review} />
          </Fragment>
        ))}
      </Card>

      {pageCount > 1 && (
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Text size="sm" c="dimmed">
            {result.total} {result.total === 1 ? 'review' : 'reviews'}
          </Text>
          <Pagination value={page} total={pageCount} onChange={onPageChange} size="sm" />
        </Group>
      )}
    </Stack>
  );
}

/**
 * One review.
 *
 * The order is stars, then what the session achieved, then the words, then the date —
 * strongest signal first for somebody skimming a stranger's profile on a phone.
 *
 * A row with neither stars nor a comment still renders: `isResolved` alone is a real
 * review and it is what §6.2 actually measures.
 */
function ReviewRow({ review }) {
  return (
    <Stack gap={8} p="md">
      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
        <Group gap="xs" align="center" wrap="wrap">
          <Stars stars={review.stars} />

          {/*
            Only when it was solved. "Not solved" as a badge on a public profile is a
            verdict on a teacher drawn from one question, and §6.2's KPI is about the
            platform rather than about a person — a student may rate a teacher warmly for
            a question that stayed open, which is why `isResolved` and `stars` are
            separate fields in the first place.
          */}
          {review.isResolved && (
            <Badge
              variant="light"
              color="teal"
              size="sm"
              radius="sm"
              leftSection={<IconCheck size={12} />}
            >
              Solved
            </Badge>
          )}

          {/* Null on the sentinel path (`topic_id = 0`) — the row renders without a chip
              rather than with one reading "we do not know". */}
          {review.topicName && (
            <Badge variant="default" size="sm" radius="sm">
              {review.topicName}
            </Badge>
          )}
        </Group>

        <Text size="xs" c="dimmed">
          {formatReviewDate(review.createdAt)}
        </Text>
      </Group>

      {review.comment && (
        // Text, never HTML or markdown. React escapes this by default and that is the
        // whole defence — the string is a stranger's, on a public URL.
        <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
          {review.comment}
        </Text>
      )}
    </Stack>
  );
}

/**
 * The stars, or nothing at all.
 *
 * **`null` renders no row, and this is the one thing in this file worth a test.** A
 * component that mapped over five positions and filled `stars ?? 0` of them would show
 * ☆☆☆☆☆ for the most common review in the product.
 */
function Stars({ stars }) {
  if (stars === null || stars === undefined) {
    return (
      <Text size="xs" c="dimmed">
        No rating given
      </Text>
    );
  }

  return (
    <Group gap={2} align="center" aria-label={`${stars} out of 5`}>
      {Array.from({ length: 5 }, (_, index) =>
        index < stars ? (
          <IconStarFilled
            key={index}
            size={14}
            style={{ color: 'var(--mantine-color-yellow-6)' }}
          />
        ) : (
          <IconStar key={index} size={14} style={{ color: 'var(--mantine-color-gray-5)' }} />
        ),
      )}
    </Group>
  );
}

/**
 * The date alone, without a time.
 *
 * A review is not a receipt: the hour it was written at tells a reader nothing, and on a
 * 375px row it is what pushes the topic chip onto a second line. The wallet ledger keeps
 * its time for the opposite reason — a student reconciling a charge needs it.
 */
function formatReviewDate(isoDate) {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) return isoDate;

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}
