import { Button, Card, Stack, Text, Title } from '@mantine/core';
import { IconUsersGroup } from '@tabler/icons-react';
import { ERROR_CODES, SOCKET_EVENTS } from '@tutor/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { getPricing } from '@/api/public.api';
import { getSession } from '@/api/session.api';
import SessionRoom from '@/components/session/SessionRoom';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import AwaitingResponse from '@/pages/student/AwaitingResponse';

/**
 * `/app/session/:id` — the student's session screen. PR 5.8, MVP.md §14.1.
 *
 * **One route, several states, and no `/awaiting` route beside it.** §14.1 has no
 * awaiting screen, and E4's ruling applies: a route invented in one epic is a route the
 * next has to honour or rename. "Waiting for an answer" is a *state of* this session,
 * the same way `ACTIVE` is, and E6 adds its state to this same file.
 *
 * **This PR builds one state and delegates the rest**, which is the whole reason the
 * switch below is a switch and not four screens:
 *
 * | offer status        | what renders                                            |
 * | `PENDING`           | `AwaitingResponse` — the whole of this PR                |
 * | `ACCEPTED`          | E6's placeholder, named honestly. Not a fake session     |
 * | `REJECTED`/`EXPIRED`| the recovery — one line and a way back to the list       |
 * | `null` (no offer)   | the same recovery. A session nobody has been asked about |
 *
 * **The server is the source of truth and the socket is an accelerator.** The screen
 * reads `GET /sessions/:id` on mount and renders from the answer, so a reload at second
 * thirty shows thirty seconds and a reload after the offer resolved shows the
 * resolution. Built the other way round — state assembled from whatever frames happen
 * to arrive — it works on a desk and is blank on a train.
 *
 * **The status is the *offer's*, not the session's.** 5.4 answers the student with the
 * `OfferResponse` shape, and it evaluates `expires_at` on every read, so a `PENDING`
 * offer past its instant arrives here as `EXPIRED` even when the sweeper has been
 * asleep for forty minutes. Nothing on this screen re-derives that.
 *
 * **Three ways it ends and all three are events, never a poll**: `offer:accepted`,
 * `offer:rejected`, and the countdown reaching zero — the last of which is what makes
 * the screen resolve with the socket disconnected.
 */

/**
 * The four values `offers.status` takes, and why they are written here.
 *
 * The server keeps them in `config/constants/session.js` and `shared/` is frozen at
 * 5.1, so there is no shared export to import — the same position `TeacherStatusToggle`
 * is in for `TeacherStatus`. One object at the top of the one file that switches on
 * them, rather than string literals scattered through the render.
 */
const OFFER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
});

/**
 * What a socket frame or a finished countdown resolves the screen to.
 *
 * Deliberately not the four statuses above: from the student's side a decline and an
 * expiry are one outcome with one next action, so the screen has one resolved state for
 * both. Two would be two strings to keep in step for a distinction nobody can act on.
 */
const RESOLUTION = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  OVER: 'OVER',
});

export default function Session() {
  const { id } = useParams();

  /** The `GET /sessions/:id` payload, plus `block` from the pricing model. */
  const [view, setView] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [loadError, setLoadError] = useState(null);

  /**
   * What has happened *since* the read, from a socket frame or from the clock.
   *
   * A local override rather than a refetch, because both of the events that set it are
   * terminal: nothing after `offer:accepted` makes the offer un-accepted, and the
   * countdown hitting zero is the one path that has to work with no server at all. A
   * refetch here would put a network round trip between the student and the answer,
   * on the exact code path that exists for a network that is not there.
   */
  const [resolution, setResolution] = useState(null);

  /**
   * Both payloads together, once, on mount. The session is the screen and the pricing
   * model is what turns a price into "the first ten minutes" — neither renders without
   * the other, so two flags would be two ways to describe one wait.
   *
   * Not primed from the `POST /sessions/:id/offer` body the previous screen already
   * holds. Passing it through router state would save a spinner and cost the property
   * this screen is built on: a reload has no router state, so the primed path and the
   * reloaded path would be two different screens, and only one of them would be tested.
   */
  const loadSession = useCallback(() => {
    let cancelled = false;

    setLoadError(null);

    Promise.all([getSession(id), getPricing()])
      .then(([session, pricingModel]) => {
        if (cancelled) return;

        setView(session);
        setPricing(pricingModel);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(loadSession, [loadSession]);

  /**
   * The teacher took it. `offer:accepted` carries `{ offerId, sessionId }`.
   *
   * **Matched on `sessionId`.** Events are addressed to the *user*'s room and delivered
   * to every tab they have open, so a student with two questions in the air receives
   * both offers' frames on this screen. Without the check, one question resolving would
   * resolve the other's screen too.
   *
   * Accept wins over a local expiry, and that ordering is deliberate: if our clock ran
   * a second fast we may already be showing the recovery when the frame lands, and the
   * server's answer is the true one. `OVER` never overwrites it — see below.
   */
  useSocketEvent(
    SOCKET_EVENTS.OFFER_ACCEPTED,
    useCallback(
      (payload) => {
        if (payload?.sessionId === id) setResolution(RESOLUTION.ACCEPTED);
      },
      [id],
    ),
  );

  /**
   * The teacher declined — **and the cron sends this on expiry too**, deliberately
   * (`jobs/offer.expiry.job.js`). From the student's side "declined" and "ran out of
   * time" are the same outcome and the same next action, so there is one handler for
   * both rather than two that must not drift. `offer:expired` goes to the teacher,
   * whose modal has to close, and this screen does not listen for it.
   */
  useSocketEvent(
    SOCKET_EVENTS.OFFER_REJECTED,
    useCallback(
      (payload) => {
        if (payload?.sessionId === id) setResolution(resolveOver);
      },
      [id],
    ),
  );

  /**
   * The clock reached zero, from `OfferCountdown`'s own recomputation.
   *
   * **This is the path that has to work with the socket down**, which is why it resolves
   * locally instead of refetching: an expiry the student can see on the countdown must
   * not depend on a frame arriving or a request completing.
   */
  const onExpire = useCallback(() => setResolution(resolveOver), []);

  if (loadError) {
    const isMissing = loadError?.is?.(ERROR_CODES.NOT_FOUND);

    return (
      <ErrorState
        // A stranger's session and a session that never existed are the same answer —
        // the server does not confirm which ids are real, and a screen that said "that
        // is not yours" would confirm it for them. 3.7 and 4.7 word it the same way.
        error={isMissing ? 'We could not find that session. It may not be yours.' : loadError}
        title={isMissing ? 'Session not found' : 'Could not load this session'}
        onRetry={isMissing ? undefined : loadSession}
        minHeight={320}
      />
    );
  }

  if (!view || !pricing) return <LoadingState label="Loading your session…" minHeight={320} />;

  // **A `SessionState` payload is the room, whatever its status.** Above `ACTIVE` this
  // endpoint stops answering an offer and answers a session (6.3), and a student who
  // reloads an `ENDED` session lands here needing the rating screen — not the offer
  // recovery below, which would read a `questionId` this shape does not carry. The `role`
  // field is the discriminator: only the session shape has one.
  if (view.role) return <SessionRoom initial={view} />;

  const status = statusFor(view, resolution);

  if (status === OFFER_STATUS.ACCEPTED) {
    // **6.7 fills the branch 5.8 left as a placeholder**, and this is the socket's path
    // into it: `offer:accepted` resolved the screen while the payload in hand is still
    // the `OfferResponse` read when the offer was `PENDING`. That shape has no `role`,
    // no clock and no counterpart, so the room is mounted cold and fetches the session
    // for itself. The seeded path is the branch above, for a screen that read the row
    // after it went `ACTIVE`.
    return <SessionRoom />;
  }

  if (status === OFFER_STATUS.PENDING) {
    return (
      <AwaitingResponse
        teacher={view.teacher}
        pricePerBlock={view.pricePerBlock}
        block={pricing.block}
        expiresAt={view.expiresAt}
        onExpire={onExpire}
      />
    );
  }

  return <OfferOver questionId={view.questionId} />;
}

/**
 * What the screen is showing: what has happened since the read, or what the read said.
 *
 * **`ACCEPTED` is sticky.** A late `offer:rejected` — the cron settling a row whose
 * accept beat it — must not take an accepted session back to the recovery, and the
 * ordering is expressed here rather than in three handlers that each have to remember
 * it.
 *
 * @param {{status: string|null}} view  the server's answer
 * @param {string|null} resolution  a socket frame or the countdown, since the read
 * @returns {string|null}
 */
function statusFor(view, resolution) {
  if (resolution === RESOLUTION.ACCEPTED) return OFFER_STATUS.ACCEPTED;
  if (view.status === OFFER_STATUS.ACCEPTED) return OFFER_STATUS.ACCEPTED;
  if (resolution === RESOLUTION.OVER) return OFFER_STATUS.EXPIRED;

  return view.status;
}

/** `setResolution`'s updater for the two paths that end the offer. See `statusFor`. */
function resolveOver(current) {
  return current === RESOLUTION.ACCEPTED ? current : RESOLUTION.OVER;
}

/**
 * The recovery, **and it is the point of this screen.**
 *
 * Not an error and not a dead end: the teacher did not take it, and the next action is
 * one press away. The list re-runs with `rejected_by` now excluding whoever declined —
 * 4.2's filter doing something real for the first time — and the student picks again.
 * That loop is what makes a sixty-second TTL tolerable, and it is why this is a button
 * rather than a sentence.
 *
 * **One wording for a decline and for an expiry**, because the student cannot act on
 * the difference. The teacher's side does distinguish them: there it is "you declined"
 * versus "you missed it".
 *
 * `questionId` comes off the session payload — 5.8's addition to 5.4's shape, for
 * exactly this link. Router state would have died on the reload this screen is built to
 * survive.
 */
function OfferOver({ questionId }) {
  return (
    <Card withBorder padding="lg" maw={640}>
      <Stack gap="md" align="flex-start">
        <IconUsersGroup size={32} stroke={1.5} color="var(--mantine-color-blue-6)" />

        <Stack gap={4}>
          <Title order={3}>That teacher did not take it</Title>

          <Text c="dimmed" size="sm">
            Pick somebody else — it takes a moment, and they are waiting.
          </Text>
        </Stack>

        <Button component={Link} to={`/app/ask/${questionId}/teachers`}>
          Choose another teacher
        </Button>
      </Stack>
    </Card>
  );
}
