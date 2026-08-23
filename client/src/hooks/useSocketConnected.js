import { useEffect, useState } from 'react';

import { getSocket } from '@/lib/socket';

/**
 * Whether the app's one socket is currently connected — PR 10.4.
 *
 * A sibling of `useSocketEvent` and under the same rule: it adds listeners and removes
 * them, and it does nothing else. Connecting, reconnecting and the token refresh behind
 * a reconnect are all `lib/socket.js`'s, driven by the auth store, and a hook that
 * called `connect()` would be a second thing deciding when a session exists.
 *
 * **The two lifecycle events, not a read of `socket.connected` during render.** The
 * property is not reactive: read in a render body it is right exactly once, and then the
 * component sits there with a stale boolean until something unrelated re-renders it. It
 * is read here only to seed the state, which is the one moment it is current.
 *
 * **Optimistic on mount.** `useState(socket.connected)` rather than `false`, so a screen
 * mounting during the handshake does not announce a problem that has not happened.
 *
 * There is a second copy of this boolean in `hooks/useSessionState.js`, where 6.8 tracks
 * the same two events and also re-joins the room and re-reads the session on reconnect.
 * That one is doing more than reporting, so it is not this hook with extra steps —
 * unifying them is a change to how the session screen learns about its socket and it
 * needs its own PR. E10's retro carries it as an open item.
 *
 * @returns {boolean}
 */
export function useSocketConnected() {
  const [connected, setConnected] = useState(() => getSocket().connected);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    // Between the `useState` initialiser and this effect the socket may have settled
    // either way, and the events for that window are already gone.
    setConnected(socket.connected);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return connected;
}
