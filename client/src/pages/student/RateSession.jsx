import { Button, Card, Group, Rating, Stack, Switch, Text, Textarea, Title } from '@mantine/core';
import { ERROR_CODES } from '@tutor/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { submitReview } from '@/api/session.api';
import { notify } from '@/lib/notify';

/**
 * `/app/session/:id/review` — the rating, and **the only way out of an `ENDED` session.**
 * PR 6.6, MVP.md §6.2, §10 and §14.1.
 *
 * §10 makes the rating mandatory: until this succeeds the session has not reached a
 * terminal state and `isRated` is `false`. That is why the screen has no **Skip** and no
 * back link — 6.7 owns how the blocking feels, this PR owns the fact that it blocks.
 *
 * ## One required field, and it is not the stars
 *
 * `isResolved` is §6.2's core KPI and the only thing this form insists on. **Stars are
 * optional and a review without them moves no average at all** — not a zero, not a
 * neutral three. A student who does not want to rate a person should not have to, and the
 * server writes `rating_count` only when a number arrived.
 *
 * The switch defaults to *solved*, which is the common case and the reason the student is
 * on this screen rather than in a support thread. It is a two-state control rather than a
 * pair of radio buttons because the KPI is a boolean and a tri-state would invent an
 * answer §6.2 has no column for.
 *
 * ## Failures
 *
 * `SESSION_NOT_ACTIVE` (409) means the review already exists — the double-tapped submit
 * the unique constraint on `reviews.session_id` catches — or the session is not `ENDED`.
 * Both are answered by leaving: the rating is done, and keeping the student on a form
 * that cannot succeed is the one thing worse than a toast. Everything else is a toast and
 * the form stays, because a comment somebody typed must not be thrown away by a network
 * blip.
 *
 * **Nothing here reads a review back.** The badge, the history screen and the public
 * profile all render these numbers and every one of them is E8's.
 */
export default function RateSession() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [isResolved, setIsResolved] = useState(true);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  /**
   * Submits once.
   *
   * `saving` guards the second press as well as disabling the button: the button's
   * `disabled` is a render away from being true and the click that lands in between is
   * the `409` this screen would rather never see.
   */
  async function onSubmit() {
    if (saving) return;

    setSaving(true);

    try {
      await submitReview(id, {
        isResolved,
        // Mantine's `Rating` uses 0 for "nothing chosen" and the contract's field is
        // absent-or-1-to-5. Sending 0 would be a star rating nobody gave, and the
        // server would count it.
        ...(stars > 0 ? { stars } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });

      notify.success('Thanks — that helps the next student too.');
      navigate('/app', { replace: true });
    } catch (error) {
      if (error?.is?.(ERROR_CODES.SESSION_NOT_ACTIVE)) {
        // Already rated, or no longer `ENDED`. Nothing this form can do differently.
        navigate('/app', { replace: true });

        return;
      }

      notify.apiError(error, 'Could not save your rating');
      setSaving(false);
    }
  }

  return (
    <Stack gap="lg" maw={560}>
      <Stack gap="xs">
        <Title order={2}>How did that go?</Title>
        <Text c="dimmed">
          One question is required and the rest is up to you. This is the last step of the session.
        </Text>
      </Stack>

      <Card withBorder padding="lg" radius="md">
        <Stack gap="lg">
          <Switch
            checked={isResolved}
            onChange={(event) => setIsResolved(event.currentTarget.checked)}
            label="My question was answered"
            description="The one thing we ask for. It is how we tell which teachers actually help."
          />

          <Stack gap={4}>
            <Text fw={500}>Rate the teacher</Text>
            <Text size="sm" c="dimmed">
              Optional. Leaving it blank changes nothing about their rating.
            </Text>
            <Group>
              <Rating value={stars} onChange={setStars} size="lg" />
            </Group>
          </Stack>

          <Textarea
            label="Anything to add?"
            description="Optional, and only we read it."
            value={comment}
            onChange={(event) => setComment(event.currentTarget.value)}
            autosize
            minRows={3}
            maxLength={1000}
          />

          <Group justify="flex-end">
            <Button onClick={onSubmit} loading={saving} disabled={saving}>
              Finish
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
