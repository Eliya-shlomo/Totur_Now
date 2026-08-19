import { SOCKET_EVENTS } from '@tutor/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getSession } from '@/api/session.api';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import { getSocket } from '@/lib/socket';

/**
 * The live session, for both roles — PR 6.7, MVP.md §14.3.
 *
 * **The server is the source of truth and the socket is an accelerator.** 5.8's sentence,
 * and this screen is where it earns its place: a session has money moving through it, so
 * a screen assembled out of whatever frames happened to arrive is a screen that shows a
 * stale balance on a train and a running clock on a session that has been billed and
 * closed. Every event below either patches a value the server just told us it wrote, or
 * triggers a refetch.
 *
 * Three ways the state is refreshed, and all three exist for a different failure:
 *
 * | when | why |
 * |---|---|
 * | on mount | the reload case, and the only path that works with the socket down |
 * | `visibilitychange` back to visible | a backgrounded tab misses frames; phones suspend sockets |
 * | after a mutation | the response is authoritative and the emit may race it |
 *
 * **The room is joined before anything can be missed, and rejoined on reconnect.**
 * `session:join` is the epic's one client → server event; the server checks membership
 * against the database before putting the socket in the room, because a room name is not
 * a capability. A socket that reconnects is a *new* socket in no rooms at all, so the
 * emit is repeated on `connect` — without that, a laptop that slept through a token
 * refresh sits in a live session hearing nothing, which looks exactly like a frozen page.
 *
 * **Nothing here decides money.** `session:extended` carries the server's four numbers and
 * they are written down as they arrive; `session:block_warning` carries `canAfford` and
 * `withinCap` already decided. A hook that recomputed either would compute it differently
 * from the endpoint that enforces it, and the modal would offer a button that 402s.
 *
 * @param {string} sessionId
 * @param {object} [options]
 * @param {import('@tutor/shared').SessionState} [options.initial] the student's screen has
 *   already read this endpoint for its offer branch — seeding avoids a second identical
 *   fetch on mount without giving the screen a second source of truth
 * @returns {{session: object|null, error: unknown, warning: object|null, ended: object|null,
 *   reload: () => void, applyExtend: (extended: object) => void, dismissWarning: () => void}}
 */
export function useSessionState(sessionId, { initial = null } = {}) {
  const [session, setSession] = useState(initial);
  const [error, setError] = useState(null);

  /** The last `session:block_warning` payload, or `null` once it has been dealt with. */
  const [warning, setWarning] = useState(null);

  /**
   * The `session:ended` payload, kept beside the session rather than folded into it.
   *
   * A frame can arrive before the refetch it triggers comes back, and the screen has to
   * move *now* — the alternative is a countdown ticking on a session the server has
   * already billed and closed. The row catches up a moment later and agrees.
   */
  const [ended, setEnded] = useState(null);

  /** Guards a refetch that resolves after the screen has gone. */
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    getSession(sessionId)
      .then((next) => {
        if (!alive.current) return;

        setSession(next);
        setError(null);
      })
      .catch((failure) => {
        if (!alive.current) return;

        // **The last good state is kept.** A dropped request during a live session must
        // not blank a screen that is charging by the minute; the error is reported and
        // the numbers on screen stay the ones the server last confirmed.
        if (!session) setError(failure);
      });
    // `session` is deliberately absent: including it would rebuild `reload` on every
    // patch, and every effect below that depends on it would re-run mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Mount. Skipped when the caller already holds this exact payload — the student's
  // screen read it one branch up.
  useEffect(() => {
    if (!initial) reload();
    // Once per session id. `initial` is a snapshot, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // The room, and again on every reconnect. A reconnected socket is a new socket in no
  // rooms; `session:join` is idempotent on the server and re-emitting costs one frame.
  useEffect(() => {
    const socket = getSocket();
    const join = () => socket.emit(SOCKET_EVENTS.SESSION_JOIN, { sessionId });

    join();
    socket.on('connect', join);

    return () => {
      socket.off('connect', join);
    };
  }, [sessionId]);

  // A tab that was in the background missed frames, and on a phone it may have been
  // suspended entirely. Coming back is the cheapest moment to be sure.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };

    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  /**
   * `session:block_warning` — the current block ends in `WARNING_SECONDS`.
   *
   * Stored whole and rendered whole. Every number on it was decided by the server
   * against the same rules `POST /sessions/:id/extend` enforces.
   */
  useSocketEvent(
    SOCKET_EVENTS.SESSION_BLOCK_WARNING,
    useCallback((payload) => {
      if (payload) setWarning(payload);
    }, []),
  );

  /**
   * `session:extended` — a block was bought, by this tab or by nothing at all.
   *
   * Patched rather than refetched: the payload is the four values that changed and it
   * was emitted after the charge committed. The warning is cleared here rather than in
   * the modal, so a student whose *other* tab pressed **Extend** stops being asked.
   */
  useSocketEvent(
    SOCKET_EVENTS.SESSION_EXTENDED,
    useCallback((payload) => {
      if (!payload) return;

      setWarning(null);
      setSession((current) =>
        current ? { ...current, ...extendPatch(current, payload) } : current,
      );
    }, []),
  );

  /**
   * `session:ended` — it is over, and why.
   *
   * Both sides get it, and for whichever of the two did not press anything this frame is
   * the only notice they will ever get: there is no HTTP response coming to them.
   */
  useSocketEvent(
    SOCKET_EVENTS.SESSION_ENDED,
    useCallback(
      (payload) => {
        if (!payload) return;

        setWarning(null);
        setEnded(payload);
        reload();
      },
      [reload],
    ),
  );

  /**
   * `session:participant_left` — **6.8's, and a no-op here on purpose.**
   *
   * The name was appended in 6.2 and the detection is 6.8's. It is subscribed to now so
   * that the frame is consumed rather than landing on a screen with no listener, and so
   * that 6.8 is one function body rather than a new subscription plus a new state field.
   * **It is not the end of the session**: a dropped tunnel and a closed laptop are
   * indistinguishable from here, the meter is still running, and the money has moved.
   */
  useSocketEvent(
    SOCKET_EVENTS.SESSION_PARTICIPANT_LEFT,
    useCallback(() => {}, []),
  );

  /** The extend response, which is the same four numbers the emit carries. */
  const applyExtend = useCallback((extended) => {
    setWarning(null);
    setSession((current) =>
      current ? { ...current, ...extendPatch(current, extended) } : current,
    );
  }, []);

  const dismissWarning = useCallback(() => setWarning(null), []);

  return { session, error, warning, ended, reload, applyExtend, dismissWarning };
}

/**
 * The fields an extension moves, and **only for the role entitled to each.**
 *
 * `balance` is the student's and is `null` on the teacher's payload by contract; writing
 * the number in would put a balance on a screen that must never show one. The teacher's
 * `teacherEarning` is not on this event at all — it is settled at termination — so it is
 * left exactly as the last read had it.
 */
function extendPatch(current, payload) {
  const patch = {
    blocksUsed: payload.blocksUsed,
    endsAt: payload.endsAt,
    totalCharged: payload.totalCharged,
  };

  if (current.role === 'student') patch.balance = payload.balance;

  return patch;
}
