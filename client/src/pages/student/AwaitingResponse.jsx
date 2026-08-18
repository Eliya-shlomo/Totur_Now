import { Card, Group, Stack, Text, Title } from '@mantine/core';

import OfferCountdown from '@/components/offer/OfferCountdown';
import TeacherCard from '@/components/teacher/TeacherCard';

/**
 * The `OFFER_SENT` state of `/app/session/:id` — PR 5.8, MVP.md §14.1.
 *
 * The sixty seconds between pressing **Send request** and hearing back. It renders
 * three things and no more: who was asked, what the opening block costs, and how long
 * is left.
 *
 * **No cancel button, and its absence is the design.** §10's diagram has no arrow out
 * of `OFFER_SENT` on the student's side. A cancel would need a server route, a lock
 * release and a rule for what happens when it races the teacher's accept — the atomic
 * lock problem a second time, for a button nobody asked for. Sixty seconds is short
 * enough that waiting is not a burden, and the countdown says exactly how short.
 *
 * **The countdown is `OfferCountdown`, 5.7's component, imported and not copied.** Both
 * screens count down to a server instant and the rule they obey is identical: recompute
 * from `expiresAt` every tick, never decrement a stored number. A second copy is a
 * second place for the background-tab bug to come back, and that bug is invisible —
 * the screen looks fine and the number is a minute stale.
 *
 * **This component owns no state and no timer.** The expiry decision is the route's:
 * `onExpire` goes up to `Session.jsx`, which resolves the screen whether or not a
 * socket frame ever arrives.
 *
 * **The teacher card does not link.** Everywhere else it is a link to the public
 * profile; here that is a way to navigate off a screen with sixty seconds on it, and
 * the student already read the profile — that is how they got here.
 */

/**
 * @param {object} props
 * @param {import('@tutor/shared').TeacherCard|null} props.teacher  null if the row is gone
 * @param {number|null} props.pricePerBlock  the price snapshotted onto the session
 * @param {object} props.block  `block` from `/public/pricing`
 * @param {string} props.expiresAt  ISO 8601, absolute, server-issued
 * @param {() => void} props.onExpire  the clock reached zero — the route decides what that means
 */
export default function AwaitingResponse({ teacher, pricePerBlock, block, expiresAt, onExpire }) {
  const openingCost = pricePerBlock === null ? null : pricePerBlock * block.openingBlocks;

  return (
    <Stack gap="lg" maw={640}>
      <Stack gap="xs">
        <Title order={2}>
          {teacher ? `Waiting for ${teacher.fullName}` : 'Waiting for an answer'}
        </Title>

        {/* No duration in the sentence. The countdown below is the precise answer and
            `OFFER_TTL_SECONDS` is the server's — a "60 seconds" typed here is a second
            copy of a constant no endpoint publishes, free to be wrong the day the
            appendix is tuned. */}
        <Text c="dimmed">
          We have sent them your question. This screen moves on by itself as soon as they answer,
          and when the clock runs out if they do not.
        </Text>
      </Stack>

      {/* The clock, and it is the largest thing on the screen. A student watching a
          countdown is deciding whether to keep waiting, and that decision is made on
          this number. */}
      <Card withBorder padding="lg">
        <Group justify="space-between" align="center" wrap="nowrap">
          <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
            Time left
          </Text>

          <OfferCountdown expiresAt={expiresAt} onExpire={onExpire} />
        </Group>
      </Card>

      {/* A teacher row that has since been deleted answers `null` rather than failing
          the read — the session and its countdown are still true, so the card is what
          drops out, not the screen. */}
      {teacher && <TeacherCard teacher={teacher} linkTo={false} />}

      {openingCost !== null && (
        <Text size="sm" c="dimmed">
          ₪{pricePerBlock} a block, so the first {block.openingMinutes} minutes are ₪{openingCost} —{' '}
          <Text span fw={600} c="var(--mantine-color-text)">
            charged only if they accept
          </Text>
          .
        </Text>
      )}
    </Stack>
  );
}
