import { Alert, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconVideoOff } from '@tabler/icons-react';
import { ERROR_CODES } from '@tutor/shared';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { getPricing } from '@/api/public.api';
import { endSession, extendSession, getSessionVideo, reportNoShow } from '@/api/session.api';
import ExtendModal from '@/components/session/ExtendModal';
import MoneyLine from '@/components/session/MoneyLine';
import SessionTimer from '@/components/session/SessionTimer';
import VideoRoom from '@/components/session/VideoRoom';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';
import { useSessionState } from '@/hooks/useSessionState';
import { notify } from '@/lib/notify';

/**
 * The session room — **one screen, both roles, the call inside the page.** PR 6.7,
 * MVP.md §14.3.
 *
 * §18 asked for two PRs and two screens. The two roles differ by three things — the money
 * line, the no-show button, and who gets asked to extend — and the contract answers both
 * from one endpoint with a `role` discriminator precisely so this could be one file. Two
 * files would be two timers, and a timer written twice is a timer that disagrees with
 * itself on one of the two screens. §20 lists "timer desync" as a risk for a reason.
 *
 * ## What is server truth here, which is nearly everything
 *
 * The clock is `endsAt`. The money is four columns. The extend modal's four numbers are
 * the server's. This component owns exactly two decisions of its own: whether the call is
 * showing, and which of the three video failure states to render. Everything else it
 * displays it was told.
 *
 * ## Leaving the call is not ending the session
 *
 * Daily's prebuilt UI has its own leave button and nothing can remove it. A person who
 * presses it has left the *call*, not the *session*: the meter is running, the block is
 * charging and `ends_at` has not moved. So `onLeft` stops nothing, navigates nowhere and
 * says so in a sentence, with a way back in. **A screen that looked finished while credit
 * was leaving the wallet is the worst thing this epic could ship.**
 *
 * ## The three video states the frame renders, because the component renders none
 *
 * - `hasVideo === false` — 6.3's designed degradation. A Daily outage at accept time
 *   leaves an `ACTIVE` session with no room; 6.4 repairs it on the first join, and if the
 *   provider is still down the session runs without a camera. It must not look like a
 *   crash, because everything else on this screen works.
 * - the join failed — most often `max_participants: 2`, which a real person trips by
 *   opening the lesson on a phone *as well as* a laptop and locking their own teacher out.
 *   The message says that, because "call error" sends nobody anywhere useful.
 * - somebody left — above.
 *
 * **`VideoRoom.jsx` is DEV-C's and is mounted, not opened.** Its props were frozen at
 * import in 6.1 and this screen goes around it.
 *
 * @param {object} props
 * @param {import('@tutor/shared').SessionState} [props.initial] the payload the student's
 *   route already read one branch up; the teacher's route mounts this cold
 */
export default function SessionRoom({ initial = null }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const { session, error, warning, ended, reload, applyExtend, dismissWarning } = useSessionState(
    id,
    { initial },
  );

  const [pricing, setPricing] = useState(null);
  const [video, setVideo] = useState(null);

  /** `null` while the call is fine; one of the three states above once it is not. */
  const [videoIssue, setVideoIssue] = useState(null);

  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let cancelled = false;

    getPricing()
      .then((model) => {
        if (!cancelled) setPricing(model);
      })
      .catch(() => {
        // The pricing model is block lengths and a warning window, not money owed. A
        // failure here costs the progress bar its denominator and nothing else, so the
        // screen renders and the session runs.
        if (!cancelled) setPricing(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The room and a token — `GET /sessions/:id/video`, 6.4.
   *
   * **Per mount, and the token is put nowhere else.** Not in a store, not in the URL, not
   * in `localStorage`: it names one person and one room and expires in an hour, and
   * anything that kept it would be the `POST /video/access` endpoint 6.1 deleted wearing
   * a different name. A retry re-fetches rather than reusing.
   */
  const loadVideo = useCallback(() => {
    setVideoIssue(null);

    getSessionVideo(id)
      .then((access) => setVideo(access))
      .catch((failure) => {
        setVideo(null);
        setVideoIssue(
          failure?.is?.(ERROR_CODES.EXTERNAL_SERVICE_ERROR)
            ? { kind: 'unavailable' }
            : { kind: 'failed' },
        );
      });
  }, [id]);

  useEffect(() => {
    // `hasVideo` false is 6.3's degradation and there is nothing to fetch — asking anyway
    // would make the repair path run on every mount of a session Daily could not serve.
    if (session?.hasVideo && session?.status === 'ACTIVE') loadVideo();
  }, [session?.hasVideo, session?.status, loadVideo]);

  /**
   * Where a finished session sends each role.
   *
   * **The student cannot leave without rating.** §10 makes it mandatory and 6.6 built the
   * screen; `replace` is what refuses back-navigation into a session that is over. A
   * `NO_SHOW` skips it entirely — nobody rates a person who never arrived — and lands on
   * the question list with the refund already made.
   */
  useEffect(() => {
    if (!session) return;

    if (session.status === 'NO_SHOW') {
      navigate('/app', { replace: true });

      return;
    }

    if (session.status === 'ENDED' && session.role === 'student' && !session.isRated) {
      navigate(`/app/session/${id}/review`, { replace: true });

      return;
    }

    if (session.status !== 'ACTIVE' && session.role === 'teacher') {
      navigate('/teach', { replace: true });
    }
  }, [session, id, navigate]);

  const onExtend = useCallback(async () => {
    setBusy('extend');

    try {
      applyExtend(await extendSession(id));
      notify.success('Another block added.');
    } catch (failure) {
      // Both 402s are real answers rather than bugs: the balance moved since the warning
      // was computed, or the cap refused it. The modal stays open and says why.
      notify.apiError(failure, 'Could not add a block');
      reload();
    } finally {
      setBusy(null);
    }
  }, [id, applyExtend, reload]);

  const onEnd = useCallback(async () => {
    setBusy('end');

    try {
      await endSession(id);
      // No navigation here. `session:ended` reaches both sides and the effect above is
      // what moves each of them, so the person who pressed the button and the person who
      // did not take the same path out.
      reload();
    } catch (failure) {
      if (failure?.is?.(ERROR_CODES.SESSION_NOT_ACTIVE)) {
        // Somebody got there first — the other participant, or the auto-end sweep. The
        // session is over either way.
        reload();
      } else {
        notify.apiError(failure, 'Could not end the session');
      }
    } finally {
      setBusy(null);
    }
  }, [id, reload]);

  const onNoShow = useCallback(async () => {
    setBusy('no-show');

    try {
      await reportNoShow(id);
      notify.success('Your credits have been returned.');
      reload();
    } catch (failure) {
      notify.apiError(failure, 'Could not report that');
      reload();
    } finally {
      setBusy(null);
    }
  }, [id, reload]);

  if (error) {
    return (
      <ErrorState
        error={error}
        title="Could not load this session"
        onRetry={reload}
        minHeight={320}
      />
    );
  }

  if (!session) return <LoadingState label="Opening the room…" minHeight={320} />;

  const isStudent = session.role === 'student';
  const blockMinutes = currentBlockMinutes(session, pricing);

  return (
    <Stack gap="lg" maw={900}>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <Stack gap={4}>
          <Title order={3}>In session with {session.counterpart?.fullName ?? 'your partner'}</Title>

          <Group gap="xs">
            {session.topicLabel ? <Badge variant="light">{session.topicLabel}</Badge> : null}
            {session.level ? <Badge variant="light">Level {session.level}</Badge> : null}
          </Group>
        </Stack>

        <SessionTimer
          endsAt={session.endsAt}
          blocksUsed={session.blocksUsed}
          blockMinutes={blockMinutes}
        />
      </Group>

      <CallFrame
        hasVideo={session.hasVideo}
        video={video}
        issue={videoIssue}
        onRetry={loadVideo}
        onLeft={() => setVideoIssue({ kind: 'left' })}
        onError={() => setVideoIssue({ kind: 'failed' })}
        onJoined={() => setVideoIssue(null)}
      />

      <Card withBorder padding="md" radius="md">
        <Stack gap="xs">
          <Text fw={600} size="sm">
            What they asked
          </Text>
          <Text size="sm">{session.brief}</Text>
        </Stack>
      </Card>

      <MoneyLine
        role={session.role}
        totalCharged={session.totalCharged}
        budgetCap={session.budgetCap}
        balance={session.balance}
        teacherEarning={session.teacherEarning}
      />

      {/* The teacher's half of the warning: they cannot spend, so they are told rather
          than asked. A teacher who does not know the clock is nearly up is a teacher who
          starts explaining something. */}
      {!isStudent && warning ? (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
          The block is nearly over — your student is deciding whether to add another.
        </Alert>
      ) : null}

      <Group gap="sm" wrap="wrap">
        <Button color="red" variant="light" onClick={onEnd} loading={busy === 'end'}>
          We&apos;re done — end session
        </Button>

        {/* Student only, and only while the window is open. After that the remedy is the
            end button, which charges — that is the product's answer and the server
            enforces the same minute. */}
        {isStudent && withinNoShowWindow(session) ? (
          <Button variant="subtle" color="red" onClick={onNoShow} loading={busy === 'no-show'}>
            They never showed up
          </Button>
        ) : null}
      </Group>

      {isStudent ? (
        <ExtendModal
          warning={warning}
          busy={busy === 'extend'}
          onExtend={onExtend}
          onDismiss={dismissWarning}
        />
      ) : null}

      {ended ? (
        <Alert color="blue">This session has ended. Taking you to the last step…</Alert>
      ) : null}
    </Stack>
  );
}

/**
 * The server's `NO_SHOW_WINDOW_SEC`, and **the one number on this screen that is typed
 * rather than fetched.**
 *
 * `/public/pricing` publishes block lengths and the warning window; it does not publish
 * this one, and `server/**` is closed to 6.7. So the value is written here with the reason
 * beside it: it hides a button at roughly the right moment and decides nothing. The
 * endpoint enforces the real minute against `started_at` under a lock, and a press that
 * arrives late is answered `409` — which is the outcome whether or not this constant has
 * drifted. **If §5.1's window is ever tuned, publishing it through `/public/pricing` is
 * the fix, not editing this line.**
 */
const NO_SHOW_WINDOW_MS = 60 * 1000;

/**
 * The call, or an honest sentence about why there isn't one.
 *
 * Four states and each one is a different failure with a different next action. The
 * component itself renders none of them — it is an iframe and three callbacks — so the
 * frame around it is where they live.
 */
function CallFrame({ hasVideo, video, issue, onRetry, onJoined, onLeft, onError }) {
  if (!hasVideo) {
    return (
      <Alert color="gray" icon={<IconVideoOff size={18} />} title="No video on this session">
        We could not set up a call for this session. Everything else still works — the clock is
        running and the session is live.
      </Alert>
    );
  }

  if (issue?.kind === 'left') {
    return (
      <Alert color="orange" title="You left the call">
        <Stack gap="sm" align="flex-start">
          <Text size="sm">
            The session is still running and still being charged — leaving the call does not end it.
            Rejoin, or end the session with the button below.
          </Text>
          <Button size="xs" onClick={onRetry}>
            Rejoin the call
          </Button>
        </Stack>
      </Alert>
    );
  }

  if (issue?.kind === 'failed') {
    return (
      <Alert color="red" title="Could not join the call">
        <Stack gap="sm" align="flex-start">
          <Text size="sm">
            {/* `max_participants: 2` is 6.1's and deliberate. The realistic way a person
                trips it is opening the lesson on a phone as well as a laptop — a
                reasonable thing to do with a completely opaque failure if nobody says so. */}
            A room holds two people. If you have this session open on another device or in another
            tab, close it — it is taking the second seat.
          </Text>
          <Button size="xs" onClick={onRetry}>
            Try again
          </Button>
        </Stack>
      </Alert>
    );
  }

  if (issue?.kind === 'unavailable') {
    return (
      <Alert color="gray" icon={<IconVideoOff size={18} />} title="Video is not available">
        <Stack gap="sm" align="flex-start">
          <Text size="sm">
            The video service could not be reached. The session is live and the clock is running.
          </Text>
          <Button size="xs" onClick={onRetry}>
            Try again
          </Button>
        </Stack>
      </Alert>
    );
  }

  if (!video) return <LoadingState label="Connecting the call…" minHeight={200} />;

  return (
    <VideoRoom
      roomUrl={video.roomUrl}
      token={video.token}
      onJoined={onJoined}
      onLeft={onLeft}
      onError={onError}
    />
  );
}

/**
 * How long the block now running is, so the progress bar has a denominator.
 *
 * The opening block is `OPENING_BLOCKS × BLOCK_MINUTES` and every extension is
 * `EXTENSION_BLOCKS × BLOCK_MINUTES`; both numbers come from `/public/pricing` rather than
 * being typed here, so the day §5.1's appendix is tuned this moves with it. Falls back to
 * the opening length when the pricing model did not load — a slightly wrong bar on a
 * screen whose clock is still exactly right.
 */
function currentBlockMinutes(session, pricing) {
  const block = pricing?.block;

  if (!block) return 10;

  return session.blocksUsed > block.openingBlocks ? block.extensionMinutes : block.openingMinutes;
}

/**
 * Whether the no-show button still has a window to be pressed in.
 *
 * `warningSeconds` is not this number and the server's `NO_SHOW_WINDOW_SEC` is not
 * published by `/public/pricing`, so the client cannot know it exactly — **and the button
 * is a convenience, not the guard.** `POST /sessions/:id/report-no-show` enforces the real
 * minute against `started_at` as read under a lock, and a late press answers `409`. This
 * hides the button at roughly the right moment; it does not decide anything.
 */
function withinNoShowWindow(session) {
  if (!session.startedAt) return false;

  const elapsed = Date.now() - new Date(session.startedAt).getTime();

  return elapsed >= 0 && elapsed <= NO_SHOW_WINDOW_MS;
}
