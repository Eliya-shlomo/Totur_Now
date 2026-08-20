import { SOCKET_EVENTS } from '@tutor/shared';
import { useCallback, useState } from 'react';

import IncomingOfferModal from '@/components/offer/IncomingOfferModal';
import { useSocketEvent } from '@/hooks/useSocketEvent';

/**
 * The teacher's open offer, and the modal that shows it — PR 6b.3, MVP.md §14.1.
 *
 * **Mounted by `TeacherLayout`, so it is alive on every `/teach/*` route.** This lived
 * in `pages/teacher/Dashboard.jsx` from 5.7 until 6b.3, and that is the whole of the
 * defect it was moved to fix: `lib/socket.js` keeps one connection per tab for exactly
 * the reason its own comment gives — "a teacher who navigates away from that screen
 * would stop hearing offers" — but `useSocketEvent` detaches on unmount, correctly, and
 * the dashboard is one route out of four. A teacher reading their profile had a live
 * socket taking `offer:new` frames that nothing was listening for: the header said
 * **Offer pending** because 5.3's lock was held, the student's countdown ran to zero,
 * and there was nothing on screen to accept.
 *
 * The listeners, the payload, the countdown and the accept and reject calls are all
 * unchanged. Only where they are mounted moved.
 *
 * **Not a route and not a provider.** Nothing reads the offer except the modal, so
 * putting it in context would publish a value with one consumer; and a component that
 * renders `null` until a frame arrives is the smallest thing that can own a listener
 * for the length of a session.
 */
export default function OfferHost() {
  /** The open offer, or `null`. At most one, by 5.3's lock. */
  const [offer, setOffer] = useState(null);

  /**
   * A student picked this teacher. The payload is `IncomingOffer` in full, including
   * the absolute `expiresAt` the countdown recomputes from.
   *
   * **The same `offerId` twice is a replay, not a second offer.** The server re-emits
   * `offer:new` on every teacher handshake, so that logging in after the student
   * pressed **Send request** — or reloading, or a socket that dropped and came back —
   * still raises the modal. A second tab connecting therefore delivers a frame for the
   * offer this tab is already showing, and the modal must not be rebuilt underneath a
   * teacher who is reading it.
   */
  useSocketEvent(
    SOCKET_EVENTS.OFFER_NEW,
    useCallback((incoming) => {
      setOffer((current) => {
        if (current && current.offerId === incoming?.offerId) return current;

        if (current) {
          // Loud on purpose, and not a toast: this is not something the teacher can
          // act on, it is a server-side invariant that has just been violated. The
          // second offer is dropped, so the student who sent it gets the expiry they
          // would have got anyway rather than a teacher answering the wrong question.
          console.error(
            '[5.7] A second offer:new arrived while an offer was open. The atomic lock in 5.3 did not hold.',
            { open: current.offerId, dropped: incoming?.offerId },
          );

          return current;
        }

        return incoming;
      });
    }, []),
  );

  /**
   * The sweep reached it first, or the student gave up. Matched on `offerId` so a
   * late frame for an offer that has already been answered cannot close the modal
   * raised by the next one.
   */
  useSocketEvent(
    SOCKET_EVENTS.OFFER_EXPIRED,
    useCallback((payload) => {
      setOffer((current) => (current && current.offerId === payload?.offerId ? null : current));
    }, []),
  );

  const clearOffer = useCallback(() => setOffer(null), []);

  // Nothing at all until there is an offer. A layout-level component that renders an
  // empty node on every teacher route is chrome nobody asked for.
  if (!offer) return null;

  return <IncomingOfferModal offer={offer} onClose={clearOffer} />;
}
