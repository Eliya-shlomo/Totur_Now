import { Badge, Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconStar } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

import CreditMinutes from '@/components/match/CreditMinutes';
import TeacherBadge from '@/components/teacher/TeacherBadge';

/**
 * One teacher, as a card. `TeacherCard` in `shared/api.d.ts`.
 *
 * Built once and read three times: the public list and the public profile here in
 * 2.5, and the live preview on the teacher's own edit screen in 2.6. That reuse is
 * the reason the epic gives both screens to the same developer — a card built twice
 * is a card that disagrees with itself about what a teacher looks like.
 *
 * The payload has no `email` and no `status`; the server omits them by construction
 * (`utils/teacherView.js`) rather than by a filter here. This component could not
 * leak them if it tried.
 *
 * §5.4 says a balance is always displayed in minutes, and §18 says that happens
 * "across all teacher cards" — the browse list included, because that is where a
 * student first sees a price. So the card can show it, and shows nothing when it
 * cannot: `walletBalance` and `block` both default to `null`, and a guest, a
 * logged-out profile and 2.6's preview all render the tree this file rendered
 * before E4 existed. The pair is deliberate — `walletBalance` alone cannot be
 * turned into minutes without the block length, and a card that fetched
 * `/public/pricing` for itself would fetch it once per card in a grid.
 *
 * @param {import('@tutor/shared').TeacherCard} teacher
 * @param {boolean} [linkTo]  render as a link to the profile — off for 2.6's preview
 * @param {number|null} [walletBalance]  the signed-in student's credits, if any
 * @param {object|null} [block]  `block` from `/public/pricing`, needed with the above
 */
export default function TeacherCard({
  teacher,
  linkTo = true,
  walletBalance = null,
  block = null,
}) {
  const cardProps = linkTo
    ? { component: Link, to: `/teachers/${teacher.id}`, style: { textDecoration: 'none' } }
    : {};

  const showsMinutes = walletBalance !== null && block !== null;

  return (
    <Card withBorder radius="md" padding="lg" h="100%" {...cardProps}>
      <Stack gap="sm" h="100%">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Title order={4} lineClamp={1}>
              {teacher.fullName}
            </Title>
            <TeacherRating rating={teacher.rating} ratingCount={teacher.ratingCount} />
          </Stack>

          <TeacherBadge badge={teacher.badge} />
        </Group>

        {teacher.bio && (
          <Text size="sm" c="dimmed" lineClamp={3}>
            {teacher.bio}
          </Text>
        )}

        <TopicChips topics={teacher.topics} />

        {/* `mt="auto"` pins the price row to the bottom, so a grid of cards with
            bios of different lengths still lines its prices up. */}
        <Group justify="space-between" align="center" mt="auto" pt="xs">
          <Text fw={700}>₪{teacher.pricePerBlock} / block</Text>

          <Group gap="xs">
            <Text size="xs" c="dimmed">
              up to level {teacher.levelMax}
            </Text>
            <OnlineDot isOnline={teacher.isOnline} />
          </Group>
        </Group>

        {showsMinutes && (
          <CreditMinutes
            balance={walletBalance}
            pricePerBlock={teacher.pricePerBlock}
            blockMinutes={block.minutes}
            openingMinutes={block.openingMinutes}
          />
        )}
      </Stack>
    </Card>
  );
}

/**
 * The rating, or the absence of one.
 *
 * `null` and `0` are different claims and the server is careful to keep them apart
 * (`ratingOf` in `utils/teacherView.js`), so throwing that away here by rendering
 * "0.0 ★" for an unrated teacher would undo the work. A new teacher has not scored
 * badly; nobody has scored them.
 */
function TeacherRating({ rating, ratingCount }) {
  if (rating === null) {
    return (
      <Text size="xs" c="dimmed">
        No ratings yet
      </Text>
    );
  }

  return (
    <Group gap={4} align="center">
      <IconStar size={14} fill="currentColor" style={{ color: 'var(--mantine-color-yellow-6)' }} />
      <Text size="xs" c="dimmed">
        {rating.toFixed(1)} ({ratingCount})
      </Text>
    </Group>
  );
}

/**
 * What the teacher teaches, capped.
 *
 * `nameEn` is the label: the UI is English and LTR, fixed in `client/index.html` at
 * PR 0.5. `nameHe` rides along in the payload for the day that changes and for the
 * LLM classifier in E3.
 *
 * Four chips, then a count. A teacher carrying twelve topics would otherwise make
 * their card three times the height of their neighbour's and break the grid.
 */
function TopicChips({ topics, max = 4 }) {
  if (topics.length === 0) return null;

  const shown = topics.slice(0, max);
  const hidden = topics.length - shown.length;

  return (
    <Group gap={6}>
      {shown.map((topic) => (
        <Badge key={topic.id} variant="default" size="sm" radius="sm">
          {topic.nameEn}
        </Badge>
      ))}

      {hidden > 0 && (
        <Text size="xs" c="dimmed">
          +{hidden} more
        </Text>
      )}
    </Group>
  );
}

/**
 * Online or not.
 *
 * A dot and a word, not a dot alone: colour is the only signal for a dot, and
 * red/green is the pair a colour-blind reader is least likely to separate.
 */
function OnlineDot({ isOnline }) {
  return (
    <Group gap={4} align="center" wrap="nowrap">
      <StatusDot isOnline={isOnline} />
      <Text size="xs" c={isOnline ? 'teal' : 'dimmed'}>
        {isOnline ? 'Online' : 'Offline'}
      </Text>
    </Group>
  );
}

/** `aria-hidden` because the word beside it already says the same thing. */
function StatusDot({ isOnline }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: isOnline ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-gray-4)',
      }}
    />
  );
}
