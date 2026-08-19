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
 * Four ways the state is refreshed, and every one exists for a different failure:
 *
 * | when | why |
 * |---|---|
 * | on mount | the reload case, and the only path that works with the socket down |
 * | `visibilitychange` back to visible | a backgrounded tab misses frames; phones suspend sockets |
 * | after a mutation | the response is authoritative and the emit may race it |
 * | on socket reconnect — 6.8 | the room was rejoined, but nothing that happened while it was gone is replayed |
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
 *   departed: object|null, connected: boolean, reload: () => Promise<object|null>,
 *   applyExtend: (extended: object) => void, dismissWarning: () => void}}
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

  /**
   * Whether the socket is up — 6.8, and it is rendered rather than acted on.
   *
   * The screen carries a small marker when this is `false` and changes nothing else: the
   * countdown is computed from `endsAt` and stays right, the buttons still work because
   * they are HTTP, and the reconnect above repairs the state. **A screen that froze or
   * hid its numbers on a dropped socket would be lying about a session that is still
   * running and still charging.**
   */
  const [connected, setConnected] = useState(true);

  /**
   * The other person's last socket went away — `session:participant_left`, 6.8, E5's
   * gap 11.
   *
   * **It is not the end of the session and the screen must not treat it as one.** A
   * dropped tunnel and a closed laptop are indistinguishable from the server, the meter
   * is still running and the money has already moved. The value is the payload, kept so
   * the line can name a role, and cleared when the session ends because by then there is
   * a better sentence on screen.
   */
  const [departed, setDeparted] = useState(null);

  /** Guards a refetch that resolves after the screen has gone. */
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    // **The promise is returned, and 6.8 is why.** A mutation that is refused for the
    // session's state has to re-read that state before it can say anything useful about
    // it — `sessionErrors.js` maps the code *and the fresh row* to a sentence — so the
    // caller needs to know when the read landed and what it said. Nothing is forced to
    // await it: the socket handlers below still call it and walk away.
    return getSession(sessionId)
      .then((next) => {
        if (!alive.current) return null;

        setSession(next);
        setError(null);

        return next;
      })
      .catch((failure) => {
        if (!alive.current) return null;

        // **The last good state is kept.** A dropped request during a live session must
        // not blank a screen that is charging by the minute; the error is reported and
        // the numbers on screen stay the ones the server last confirmed.
        if (!session) setError(failure);

        // `null` rather than a rejection: every caller of this is a screen recovering
        // from something, and a rejected refetch inside a `catch` block is a second
        // failure to handle in the place least able to do anything about it.
        return null;
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
  //
  // **6.8 adds the two things a reconnect needs beyond the room.** The socket being down
  // is reported, because a screen that goes quiet and says nothing is indistinguishable
  // from a frozen one — and this is the screen with a meter on it. And coming back is a
  // refetch, because everything that happened while the tunnel was gone happened: a
  // block was bought, or the session was ended, and the room the socket just rejoined
  // will not replay any of it.
  //
  // **The clock is not on this path and never was.** `SessionTimer` counts from `endsAt`,
  // which is absolute and server-issued, so a disconnected screen keeps telling the
  // truth about a session it cannot hear. That is the property the marker exists to
  // explain rather than to replace.
  useEffect(() => {
    const socket = getSocket();

    const join = () => socket.emit(SOCKET_EVENTS.SESSION_JOIN, { sessionId });

    const onConnect = () => {
      setConnected(true);
      join();
      reload();
    };

    const onDisconnect = () => setConnected(false);

    setConnected(socket.connected);
    join();

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [sessionId, reload]);

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
        setDeparted(null);
        setEnded(payload);
        reload();
      },
      [reload],
    ),
  );

  /**
   * `session:participant_left` — **6.7 subscribed to it empty and 6.8 fills the body.**
   *
   * The name was appended in 6.2 and the emitter is 6.8's: the server waits
   * `PRESENCE_DISCONNECT_GRACE_SECONDS` and sends this only when no other socket of that
   * person is left in the room, so a reload — which is also a disconnect — is not
   * reported as somebody walking out.
   *
   * **Nothing is refetched and nothing is stopped.** There is no state change on the
   * server to go and read; the session is exactly as it was one frame ago, which is the
   * whole point. The screen says the connection dropped and the meter keeps running,
   * because who pays for a broken connection is a product decision nobody has made.
   */
  useSocketEvent(
    SOCKET_EVENTS.SESSION_PARTICIPANT_LEFT,
    useCallback((payload) => {
      if (payload) setDeparted(payload);
    }, []),
  );

  /** The extend response, which is the same four numbers the emit carries. */
  const applyExtend = useCallback((extended) => {
    setWarning(null);
    setSession((current) =>
      current ? { ...current, ...extendPatch(current, extended) } : current,
    );
  }, []);

  const dismissWarning = useCallback(() => setWarning(null), []);

  return {
    session,
    error,
    warning,
    ended,
    departed,
    connected,
    reload,
    applyExtend,
    dismissWarning,
  };
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
