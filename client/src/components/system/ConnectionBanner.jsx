import { Alert } from '@mantine/core';
import { IconPlugConnectedX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { useSocketConnected } from '@/hooks/useSocketConnected';

/**
 * "The socket is down and you are not hearing anything" — MVP.md §18's row 10.6, PR 10.4.
 *
 * Until this existed the socket was visible on exactly one screen. `useSessionState`
 * tracks it and `SessionRoom` renders a marker beside the timer; everywhere else a dead
 * connection was silent. The case the row was written for is not that screen: it is a
 * teacher on `/teach`, `status: 'ONLINE'`, availability toggle green, socket gone. They
 * receive no `offer:new` and are told nothing, while the server's atomic lock hands an
 * offer to them and it expires unanswered against `OFFER_TTL_SECONDS`.
 *
 * ## What it is allowed to be — E10's contract freeze §2
 *
 * **Authenticated shells only.** Mounted by `AppLayout` and by nothing else.
 * `lib/socket.js` connects on `status === 'authenticated'`, so a banner on the guest
 * surface would warn a visitor about a connection they never had.
 *
 * **No retry button.** Socket.IO's backoff is already retrying and 5.7's `TOKEN_EXPIRED`
 * path already refreshes; a button racing them can only make the reconnect slower or the
 * user's belief about it wrong.
 *
 * **In the flow, never fixed or sticky.** A fixed overlay at 375px eats a quarter of the
 * viewport on the one device this epic is about. The cost is that a user scrolled to the
 * bottom of a long screen cannot see it, and that is recorded rather than solved.
 *
 * **Not a toast.** `lib/notify.js` is for the outcome of an action; this is a condition,
 * conditions persist, and an unclosable toast is a banner that covers the screen.
 *
 * **It names the consequence, not the cause.** "WebSocket disconnected" is not something
 * a person can act on.
 */

/**
 * How long the socket has to stay down before anybody is told.
 *
 * A reconnect that resolves in 300ms must not flash a warning: a banner that appears and
 * vanishes teaches the user to ignore banners, and Socket.IO's first retry is well inside
 * this window. Coming back clears it immediately — the delay is on appearing only.
 *
 * A render timing rather than a business rule, so it lives here the way `HEARTBEAT_MS`
 * lives in `lib/socket.js`. `MVP.md`'s no-magic-numbers rule points at
 * `server/src/config/constants/`.
 */
const DISCONNECT_GRACE_MS = 2500;

export default function ConnectionBanner() {
  const connected = useSocketConnected();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (connected) {
      setVisible(false);

      return undefined;
    }

    const timer = window.setTimeout(() => setVisible(true), DISCONNECT_GRACE_MS);

    return () => window.clearTimeout(timer);
  }, [connected]);

  if (!visible) return null;

  return (
    <Alert
      color="orange"
      icon={<IconPlugConnectedX size={18} />}
      title="Reconnecting"
      mb="md"
      role="status"
    >
      You are not receiving live updates right now. New requests, offers and session changes will
      not reach this page until the connection is back — it is retrying on its own.
    </Alert>
  );
}
