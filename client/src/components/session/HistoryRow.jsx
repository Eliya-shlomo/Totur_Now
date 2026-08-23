import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { IconStar, IconStarFilled } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

/**
 * One finished session, on the student's own history — `SessionHistoryRecord`, PR 8.4.
 *
 * **The row's job is to be recognisable and then, sometimes, to be actionable.** A student
 * opens this screen for one of two reasons: to find a session they remember, or because
 * something is unfinished. So the question's own title leads, the teacher and the topic
 * identify it, and the right-hand side is either what they paid or what they still owe the
 * teacher — a rating.
 *
 * **An `ENDED` row with no review is the whole point of the screen.** §10 makes the rating
 * the only edge out of `ENDED` and 6.6 shipped a rating screen with no Skip, so a student
 * who closed the tab left a session that never reached a terminal state, with
 * `resolved_count` never incremented and a teacher's reputation missing an entry it earned.
 * Nothing else in the product can reach that session again. **This link is the way back**,
 * and it goes to `/app/session/:id/review` — 6.6's own screen, with its comment box, its
 * resolve switch and its stars control. Nothing here reimplements any part of it: a second,
 * smaller rating form would be a second client of `POST /sessions/:id/review` with its own
 * idea of what "no stars" means, and "no stars" is the one value in this product that two
 * implementations have already been warned about getting wrong.
 *
 * **A rating with no stars is not an unfinished one.** `review: null` means unrated;
 * `review: {stars: null}` means rated by a student who declined to give stars, which §6.2
 * makes the common case rather than the edge. The first gets the button, the second gets
 * "no rating given", and conflating them either nags a student who is done or hides work
 * that is owed.
 *
 * **No minutes anywhere in this file.** Minutes are `blocksUsed × block.minutes` and
 * `lib/credits.js` owns that translation, from the `block.minutes` on
 * `GET /public/pricing`. The row says blocks and credits, which are the two numbers the
 * server actually stored.
 *
 * @param {import('@tutor/shared').SessionHistoryRecord} session
 */
export default function HistoryRow({ session }) {
  const needsRating = session.status === 'ENDED' && session.review === null;

  return (
    <Stack gap={8} p="md">
      <Group justify="space-between" wrap="nowrap" gap="md" align="flex-start">
        <Stack gap={4} style={{ minWidth: 0 }}>
          {/*
            `wrap="nowrap"` with the left half free to shrink is what keeps 375px from
            scrolling sideways: the title truncates and the money never does, which is the
            right way round — a cost clipped to "3" is worse than a title clipped.
          */}
          <Text fw={600} truncate>
            {/* A question that never got a title — the classifier writes one and the
                fallback path may not have — still names the session by its teacher rather
                than rendering a blank line. */}
            {session.questionTitle || `Session with ${session.teacher.fullName}`}
          </Text>

          <Text size="sm" c="dimmed" truncate>
            {session.teacher.fullName}
          </Text>
        </Stack>

        <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
          <Text fw={700}>{session.totalCharged} credits</Text>

          <Text size="xs" c="dimmed">
            {session.blocksUsed} {session.blocksUsed === 1 ? 'block' : 'blocks'}
          </Text>
        </Stack>
      </Group>

      <Group justify="space-between" wrap="wrap" gap="xs">
        <Group gap="xs" wrap="wrap">
          <StatusBadge status={session.status} />

          {/* Null on the sentinel path (`topic_id = 0`) — the row renders without a chip
              rather than with one reading "we do not know". */}
          {session.topicLabel && (
            <Badge variant="default" size="sm" radius="sm">
              {session.topicLabel}
            </Badge>
          )}

          <Text size="xs" c="dimmed">
            {formatSessionDate(session.endedAt)}
          </Text>
        </Group>

        {needsRating ? (
          <Button
            component={Link}
            to={`/app/session/${session.sessionId}/review`}
            size="xs"
            variant="light"
          >
            Rate this session
          </Button>
        ) : (
          <Review review={session.review} />
        )}
      </Group>
    </Stack>
  );
}

/**
 * What happened, as a word a person understands.
 *
 * **Every status says what it means for the student, not what the enum is called.** A
 * `NO_SHOW` row is the one worth getting right: the teacher never arrived, the student was
 * refunded in full with no fee taken, and `totalCharged` beside it is `0` — a row reading
 * "NO_SHOW · 0 credits" without the sentence looks like a session that was free.
 *
 * `ENDED` deliberately reads as unfinished rather than as over. It is over as far as the
 * teaching goes, and §10 says it has not reached a terminal state — the rating is what
 * ends it, and the button beside this badge is how.
 *
 * An unknown status renders as itself, never as nothing: `SessionStatus` is a server-side
 * enum and a client is always one deploy behind it.
 */
function StatusBadge({ status }) {
  const badges = {
    RATED: { label: 'Completed', color: 'teal' },
    ENDED: { label: 'Rating unfinished', color: 'yellow' },
    NO_SHOW: { label: 'Teacher never arrived — refunded', color: 'orange' },
    CANCELLED: { label: 'Never started', color: 'gray' },
  };

  const badge = badges[status] ?? { label: status, color: 'gray' };

  return (
    <Badge variant="light" color={badge.color} size="sm" radius="sm">
      {badge.label}
    </Badge>
  );
}

/**
 * The rating the student gave, or the honest absence of one.
 *
 * **`stars: null` renders as words rather than as five hollow stars.** `isResolved` is the
 * only required field on a review (§6.2), so a review without stars is the ordinary one; a
 * component that filled `stars ?? 0` of five positions would show ☆☆☆☆☆ for the most
 * common rating in the product. `ReviewList.jsx` makes the same call on the public
 * profile.
 *
 * A `NO_SHOW` or `CANCELLED` row shows nothing at all — neither is rated, deliberately (6.7
 * sends a no-show back to the match list rather than to the rating screen), so "no rating
 * given" there would describe an absence nobody was ever asked to fill.
 */
function Review({ review }) {
  if (!review) return null;

  if (review.stars === null || review.stars === undefined) {
    return (
      <Text size="xs" c="dimmed">
        You rated this {review.isResolved ? 'solved' : 'unsolved'}, without stars
      </Text>
    );
  }

  return (
    <Group gap={2} align="center" aria-label={`You gave ${review.stars} out of 5`}>
      {Array.from({ length: 5 }, (_, index) =>
        index < review.stars ? (
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
 * When the session ended, in the reader's own locale and zone.
 *
 * `endedAt` is ISO 8601 in UTC, and `undefined` as the locale means the browser's
 * preference rather than one this app picked — a student matching a row against their own
 * memory of the evening is using their clock. Minutes are included and seconds are not:
 * two sessions in one evening need the time to be told apart, and nothing here is decided
 * at second resolution.
 *
 * **`null` is a real value here**, not a failure: a `CANCELLED` session never ran and has
 * no `ended_at`, and the row says so rather than rendering "Invalid Date".
 *
 * `formatTxDate` in `components/wallet/txLabel.js` is the same five lines. It is not
 * imported because that module is the wallet's, named for a ledger row, and reaching
 * across for it would make a session component depend on the money screen's vocabulary.
 * Both are small enough to read; if a third appears it earns a `lib/` module of its own.
 */
function formatSessionDate(isoDate) {
  if (!isoDate) return 'Never started';

  const date = new Date(isoDate);

  // A row is useless without a date but not worth blanking the list over, so an
  // unparseable one degrades to what the server sent rather than to "Invalid Date".
  if (Number.isNaN(date.getTime())) return isoDate;

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}
