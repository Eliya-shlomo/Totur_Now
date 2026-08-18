import { useEffect, useRef } from 'react';

import { getSocket } from '@/lib/socket';

/**
 * Subscribe a screen to one server event for as long as it is mounted — PR 5.7.
 *
 * The only way a component touches the socket. It adds a listener and removes it, and
 * that is deliberately all it does: connecting is `lib/socket.js`'s job, driven by the
 * auth store, so a screen that mounts twice cannot open a second connection.
 *
 * **The handler lives in a ref.** Every render produces a new function identity, so a
 * handler in the dependency array would detach and reattach the listener on each
 * render — usually harmless, and then not: an event that arrives between the removal
 * and the addition is an offer nobody heard. Keeping the latest handler in a ref means
 * the listener is attached once per event name, and it still calls today's closure
 * with today's state.
 *
 * **Event names come from `@tutor/shared`.** No screen types `'offer:new'` — two
 * drifting lists of names is a screen that never updates and no error anywhere.
 *
 * @param {string} event  a value from `SOCKET_EVENTS`, never a literal
 * @param {(payload: unknown) => void} handler
 */
export function useSocketEvent(event, handler) {
  const savedHandler = useRef(handler);

  // No dependency array: this runs after every render, so the ref always holds the
  // most recent closure by the time an event can be delivered to it.
  useEffect(() => {
    savedHandler.current = handler;
  });

  useEffect(() => {
    const socket = getSocket();
    const listener = (payload) => savedHandler.current?.(payload);

    socket.on(event, listener);

    return () => {
      socket.off(event, listener);
    };
  }, [event]);
}
