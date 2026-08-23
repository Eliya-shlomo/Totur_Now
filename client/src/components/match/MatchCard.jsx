import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { IconCircleCheck, IconHeart, IconSend } from '@tabler/icons-react';

import TeacherCard from '@/components/teacher/TeacherCard';

/**
 * One ranked teacher on the selection screen — §14.2's mock, and PR 4.7.
 *
 * **E2's card, composed and never forked.** `TeacherCard` is DEV-A's file from 2.5
 * and this is the fourth screen to read it; E2's retro names "TeacherCard written
 * once and read by three screens" as that epic's best outcome. A copy here would be
 * a second definition of what a teacher looks like, free to disagree with the browse
 * list about a name, a badge or a price.
 *
 * The minutes line comes from the same composition: `walletBalance` and `block` go
 * straight through to `TeacherCard`, which renders 4.4's `CreditMinutes` inside its
 * own price row. This file renders no second `CreditMinutes` — the card already
 * knows how, and two of them would be two roundings of one number.
 *
 * **The card links, so the button lives outside it.** `TeacherCard` wraps itself in a
 * `Link` to the public profile when `linkTo` is on, and a submit button inside an
 * anchor is a nested interactive control. So the three match-specific lines and the
 * action sit in a `Stack` directly beneath the card rather than inside it: clicking
 * the card reads the teacher, clicking the button picks them.
 *
 * **Nothing here is a score, a rank or an ordinal.** §14.2 — the student sees an
 * order, not grades. `MatchesResponse` carries no score (4.5 destructures it away at
 * the join), so the only way to break that promise is to invent one: a position
 * number, a "best match" ribbon, a percentage. None of them belong on this card, and
 * a reviewer should be able to grep this file for them and find nothing.
 *
 * @param {import('@tutor/shared').TeacherMatch} match
 * @param {string|null} subtopicName   the leaf's name, for the specialty line
 * @param {number} walletBalance       the student's credits, from `MatchesResponse`
 * @param {object} block               `block` from `/public/pricing`
 * @param {(choice: {teacherId: string, pricePerBlock: number}) => void} onChoose
 * @param {boolean} [disabled]         a choice is already in flight
 */
export default function MatchCard({
  match,
  subtopicName,
  walletBalance,
  block,
  onChoose,
  disabled = false,
}) {
  const { teacher, subtopicSessions, subtopicResolveRate, studiedWith } = match;

  return (
    <Stack gap="xs" h="100%">
      <TeacherCard teacher={teacher} walletBalance={walletBalance} block={block} />

      <Stack gap={6}>
        <SpecialtyLine sessions={subtopicSessions} subtopicName={subtopicName} />
        <ResolveRate rate={subtopicResolveRate} />
        {studiedWith && (
          <Badge
            variant="light"
            color="blue"
            radius="sm"
            leftSection={<IconHeart size={12} />}
            w="fit-content"
          >
            Studied with them
          </Badge>
        )}
      </Stack>

      <Button
        fullWidth
        mt="auto"
        /* The card is a grid item stretched to the row's height, and every child of
           this `Stack` is a flex item free to shrink into it. The button is the one
           that loses: at 375px it came out 26px tall against `Look again`'s 36 —
           §14.2's decisive screen, with its primary action the smallest control on
           it. Nothing else in the stack shrinks visibly, so the button opts out
           rather than the layout changing (PR 10.5). */
        style={{ flexShrink: 0 }}
        leftSection={<IconSend size={16} />}
        onClick={() => onChoose({ teacherId: teacher.id, pricePerBlock: teacher.pricePerBlock })}
        /* Disabled for the whole screen while any choice is in flight, not just this
           card's. E5 replaces the callback's body with something that takes an atomic
           lock on the teacher, and a second request fired from a neighbouring card
           while the first is open is the same double-book that guard exists to stop. */
        disabled={disabled}
      >
        Send request
      </Button>
    </Stack>
  );
}

/**
 * §14.2's "solved 12 questions in Integrals" — what this teacher has *done here*.
 *
 * Rendered only when there is a number and a name to put it against. Zero is
 * omitted rather than printed: "solved 0 questions in Integrals" reads as a mark
 * against a teacher who has simply not taught that leaf, and the card already says
 * everything true about them. On a sentinel question there is no subtopic at all,
 * `subtopicName` is null, and the line is absent for every teacher — which is
 * honest, because the pool was not narrowed by topic either.
 *
 * `subtopicSessions` arrives already rounded (`matchView.js`): the column is
 * NUMERIC(8,2) because a rating propagates to the parent topic at
 * `PARENT_TOPIC_WEIGHT`, and "solved 12.6 questions" is not a card.
 */
function SpecialtyLine({ sessions, subtopicName }) {
  if (!subtopicName || sessions <= 0) return null;

  return (
    <Text size="sm">
      Solved{' '}
      <Text span fw={600}>
        {sessions} {sessions === 1 ? 'question' : 'questions'}
      </Text>{' '}
      in {subtopicName}
    </Text>
  );
}

/**
 * §14.2's "✅ 91% resolved", **omitted entirely when the rate is null**.
 *
 * `null` and `0` are different claims and the server keeps them apart on purpose
 * (`resolveRateOf` in `matchView.js`, making the same argument `teacherView.js`
 * makes for `rating`): a teacher with no history in this subtopic has not failed to
 * resolve anything, nobody has asked them. Rendering "0% resolved" for that teacher
 * would put a lie on the card and undo the work the server did to avoid it.
 *
 * A real `0` — asked and resolved nothing — does render, because that one is true.
 */
function ResolveRate({ rate }) {
  if (rate === null || rate === undefined) return null;

  return (
    <Group gap={6} align="center" wrap="nowrap">
      <IconCircleCheck size={16} color="var(--mantine-color-teal-6)" />
      <Text size="sm" c="dimmed">
        {Math.round(rate * 100)}% resolved
      </Text>
    </Group>
  );
}
