import { Alert, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconPlugConnectedX, IconVideoOff } from '@tabler/icons-react';
import { ERROR_CODES } from '@tutor/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { destinationFor, resolveSessionError, SESSION_ACTIONS } from '@/utils/sessionErrors';

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
 * ## What 6.8 added, and none of it is a new decision
 *
 * - **One error boundary for the three mutations**, mapping the code plus the *freshly
 *   re-read* state to a sentence and a destination through `utils/sessionErrors.js`.
 *   Six independent handlers is six places for the recovery to drift.
 * - **One token refresh, ever.** A session extended past `VIDEO_TOKEN_TTL_SECONDS`
 *   outlives its token; the first `onError` re-fetches and rejoins, the second shows the
 *   failure. Unbounded, it is a request every few seconds for as long as the tab is open.
 * - **A "reconnecting" marker** while the socket is down, beside a clock that is still
 *   right because it is computed from `endsAt`.
 * - **`session:participant_left` rendered as a line**, and nothing else: the meter keeps
 *   running, because a dropped tunnel and a closed laptop are the same thing from here.
 *
 * @param {object} props
 * @param {import('@tutor/shared').SessionState} [props.initial] the payload the student's
 *   route already read one branch up; the teacher's route mounts this cold
 */
export default function SessionRoom({ initial = null }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const {
    session,
    error,
    warning,
    ended,
    departed,
    connected,
    reload,
    applyExtend,
    dismissWarning,
  } = useSessionState(id, { initial });

  const [pricing, setPricing] = useState(null);
  const [video, setVideo] = useState(null);

  /** `null` while the call is fine; one of the four states below once it is not. */
  const [videoIssue, setVideoIssue] = useState(null);

  const [busy, setBusy] = useState(null);

  /**
   * Bumped on every successful `GET /sessions/:id/video`, and used as the call's `key`.
   *
   * `VideoRoom` joins on mount and is DEV-C's — its props are frozen and it has no
   * "rejoin with this token" input. Changing the key is how a *new* token becomes a new
   * join: React unmounts the old frame and mounts a fresh one. Without it a re-fetched
   * token would sit in state beside a call frame that never looked at it again.
   */
  const [joinAttempt, setJoinAttempt] = useState(0);

  /**
   * Whether the one token refresh has been spent — 6.8, and **the whole of the loop
   * guard.**
   *
   * `VIDEO_TOKEN_TTL_SECONDS` is an hour and a session extended past it outlives its
   * token: Daily ejects, `onError` fires, and the honest repair is to fetch a new token
   * and rejoin. **Once.** An `onError` that always re-fetches turns a genuinely broken
   * room into a request every few seconds for as long as the tab is open, and the second
   * failure is the one that tells you it was never the token. A ref rather than state
   * because nothing renders from it and a re-render must not reset it.
   */
  const tokenRefreshed = useRef(false);

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
      .then((access) => {
        setVideo(access);
        // A fresh token is only a fresh *join* if the frame is remounted around it.
        setJoinAttempt((attempt) => attempt + 1);
      })
      .catch((failure) => {
        setVideo(null);
        setVideoIssue(
          failure?.is?.(ERROR_CODES.EXTERNAL_SERVICE_ERROR)
            ? { kind: 'unavailable' }
            : { kind: 'failed' },
        );
      });
  }, [id]);

  /**
   * The call broke — **and the first time, that is assumed to be the token.** 6.8.
   *
   * A session extended past `VIDEO_TOKEN_TTL_SECONDS` outlives the token it was joined
   * with, Daily ejects both people, and `onError` is the only notice the screen gets. It
   * is a real case at an hour of extensions and **it is the one failure on this screen
   * nobody would ever find by hand**: no manual test runs for sixty minutes and no demo
   * would survive one.
   *
   * So the first `onError` re-fetches and rejoins, silently, and the second renders the
   * failure. `max_participants: 2` — the common cause — costs one wasted request and
   * then reads exactly as it did before this PR. **The guard is not reset by a
   * successful rejoin**, deliberately: a room that ejects twice in one session is not a
   * token problem, and one retry per mount is a bound that cannot become a storm.
   */
  const onVideoError = useCallback(() => {
    if (tokenRefreshed.current) {
      setVideoIssue({ kind: 'failed' });

      return;
    }

    tokenRefreshed.current = true;
    setVideo(null);
    setVideoIssue({ kind: 'rejoining' });
    loadVideo();
  }, [loadVideo]);

  useEffect(() => {
    // `hasVideo` false is 6.3's degradation and there is nothing to fetch — asking anyway
    // would make the repair path run on every mount of a session Daily could not serve.
    if (session?.hasVideo && session?.status === 'ACTIVE') loadVideo();
  }, [session?.hasVideo, session?.status, loadVideo]);

  /**
   * Where a finished session sends each role — **and `sessionErrors.js` is what decides.**
   *
   * **The student cannot leave without rating.** §10 makes it mandatory and 6.6 built the
   * screen; `replace` is what refuses back-navigation into a session that is over. A
   * `NO_SHOW` skips it entirely — nobody rates a person who never arrived — and lands on
   * the question list with the refund already made.
   *
   * 6.8 moved the rules themselves into `destinationFor`, unchanged, so that this effect
   * and the three refused mutations below cannot answer the same question differently. A
   * student whose **End** press lost the race to the auto-end sweep and a student whose
   * socket heard `session:ended` are in the same state and belong on the same screen.
   */
  useEffect(() => {
    const destination = destinationFor(session, id);

    if (destination) navigate(destination, { replace: true });
  }, [session, id, navigate]);

  /**
   * **The one error boundary for the three mutations on this screen** — 6.8, and the
   * reason none of them has a `catch` block of its own worth reading.
   *
   * Every refusal is the same two steps: re-read the session, then ask the table what
   * that pair means. The re-read is what makes it possible at all — `SESSION_NOT_ACTIVE`
   * is thrown by six situations and the code cannot tell them apart, but the code beside
   * the *fresh* status can. It is also the repair: a double-tapped **Extend** re-reads a
   * row that already carries the block the first tap bought, so the screen agrees with
   * the database before anything is said, and nothing is said at all.
   *
   * **The destination is not navigated to here.** `destinationFor` decided it, and the
   * effect above is watching the same session this call just refreshed — so the move
   * happens through one code path whether the person pressed a button or heard an event.
   * What is left is the sentence.
   */
  const onMutationRefused = useCallback(
    async (action, failure, title) => {
      const { message } = resolveSessionError({
        action,
        failure,
        session: await reload(),
        sessionId: id,
      });

      // `null` is the double tap, reconciled by the re-read above. The student pressed
      // once as far as they know, and a toast would be the screen apologising for having
      // worked.
      if (message) notify.error(message, title);
    },
    [id, reload],
  );

  const onExtend = useCallback(async () => {
    setBusy('extend');

    try {
      applyExtend(await extendSession(id));
      notify.success('Another block added.');
    } catch (failure) {
      // Both 402s are real answers rather than bugs: the balance moved since the warning
      // was computed, or the cap refused it, and the table passes the server's own
      // sentence through. The 409s are the session having moved on.
      await onMutationRefused(SESSION_ACTIONS.EXTEND, failure, 'Could not add a block');
    } finally {
      setBusy(null);
    }
  }, [id, applyExtend, onMutationRefused]);

  const onEnd = useCallback(async () => {
    setBusy('end');

    try {
      await endSession(id);
      // No navigation here. `session:ended` reaches both sides and the effect above is
      // what moves each of them, so the person who pressed the button and the person who
      // did not take the same path out.
      reload();
    } catch (failure) {
      // Somebody got there first — the other participant, or the auto-end sweep — and
      // the session is over either way. Before 6.8 that was silent; now it says which
      // ending it was, because "finished" and "refunded" are two different next steps.
      await onMutationRefused(SESSION_ACTIONS.END, failure, 'Could not end the session');
    } finally {
      setBusy(null);
    }
  }, [id, reload, onMutationRefused]);

  const onNoShow = useCallback(async () => {
    setBusy('no-show');

    try {
      await reportNoShow(id);
      notify.success('Your credits have been returned.');
      reload();
    } catch (failure) {
      // The late report is the interesting one: the session is still `ACTIVE`, so the
      // table passes the server's sentence through — and that sentence names the end
      // button as the remedy rather than leaving a dead end.
      await onMutationRefused(SESSION_ACTIONS.NO_SHOW, failure, 'Could not report that');
    } finally {
      setBusy(null);
    }
  }, [id, reload, onMutationRefused]);

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

        <Stack gap={4} align="flex-end">
          <SessionTimer
            endsAt={session.endsAt}
            blocksUsed={session.blocksUsed}
            blockMinutes={blockMinutes}
          />

          {/* **A marker, not a blocker** — 6.8. The countdown beside it is computed from
              `endsAt`, which is absolute and server-issued, so it keeps telling the truth
              with the socket down; what stops arriving is the warning, the extension and
              the ending. The reconnect re-joins the room and re-reads the session, so
              this says "you may be a moment behind" rather than "this is broken". */}
          {!connected ? (
            <Group gap={4} c="dimmed">
              <IconPlugConnectedX size={14} />
              <Text size="xs">Reconnecting…</Text>
            </Group>
          ) : null}
        </Stack>
      </Group>

      <CallFrame
        hasVideo={session.hasVideo}
        video={video}
        issue={videoIssue}
        joinAttempt={joinAttempt}
        onRetry={loadVideo}
        onLeft={() => setVideoIssue({ kind: 'left' })}
        onError={onVideoError}
        onJoined={() => setVideoIssue(null)}
      />

      {/* **The other side went quiet — E5's gap 11, and it is not an ending.** The server
          waited out `PRESENCE_DISCONNECT_GRACE_SECONDS` and checked that no other socket
          of theirs was left in the room, so this is not a reload. The meter is still
          running and `ends_at` has not moved, because who pays for a broken connection is
          a product decision nobody has made — the remedies are the buttons below. */}
      {departed && session.status === 'ACTIVE' ? (
        <Alert color="orange" icon={<IconPlugConnectedX size={18} />}>
          {session.counterpart?.fullName ?? 'The other person'} lost their connection. The session
          is still running and still being charged — give them a moment to come back, or end it
          below.
        </Alert>
      ) : null}

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
          /*
            7.7's out-of-credit branch, from the pricing this screen already holds.

            The brief had `InlineTopUp` fetch `/public/pricing` itself, on the argument
            that a session screen should not pay for a state most sessions never reach.
            That argument was written without checking: 6.7 already fetches it on mount,
            for the progress bar's denominator, on every session either way. Fetching it
            again inside the modal would be a second request for a model already in state
            — and it would be made at the worst possible moment, sixty seconds before the
            session closes. So it is passed down.
          */
          topupPackages={pricing?.topupPackages}
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
 * Five states and each one is a different failure with a different next action. The
 * component itself renders none of them — it is an iframe and three callbacks — so the
 * frame around it is where they live. 6.8 adds the fifth, `rejoining`, which is the one
 * that is not a failure at all: the token expired under a long session and a fresh one is
 * being fetched.
 */
function CallFrame({ hasVideo, video, issue, joinAttempt, onRetry, onJoined, onLeft, onError }) {
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

  // The token was assumed to have expired and a fresh one is on its way — 6.8. Worded as
  // a reconnection rather than as a failure because on the case it exists for that is
  // exactly what it is, and the failure state is one `onError` away if it was not.
  if (issue?.kind === 'rejoining') {
    return <LoadingState label="Reconnecting the call…" minHeight={200} />;
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
      // **A new token is a new mount.** `VideoRoom` joins on mount and its props are
      // DEV-C's, frozen at import in 6.1 — there is no "rejoin with this" input, so the
      // key is how the refreshed token from 6.8's `onError` path actually gets used.
      key={joinAttempt}
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
