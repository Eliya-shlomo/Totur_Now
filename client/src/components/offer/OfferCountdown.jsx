import { Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';

/**
 * How long is left on an offer — PR 5.7, from `IncomingOffer.expiresAt`.
 *
 * **The number is recomputed from `expiresAt` on every tick, never decremented.**
 * This is the single most likely defect in this PR and it is worth being explicit
 * about why. A `setInterval` that subtracts one each second is wrong in three
 * ordinary situations: a background tab is throttled to roughly one callback per
 * minute, so thirty seconds of backgrounding costs one tick and the display is
 * thirty seconds late; a phone that sleeps stops the timer entirely; and a machine
 * that wakes fires nothing to catch up. All three show a teacher "47 seconds left"
 * on an offer that died two minutes ago, and the Accept they press answers 409.
 *
 * `expiresAt − Date.now()` has none of those failure modes: a late tick computes the
 * true remainder, and the worst a throttled tab suffers is a display that updates
 * slowly and is correct the instant it updates.
 *
 * **The clock is the client's, and it is the only part that can be wrong.** A machine
 * whose clock is two minutes fast closes the modal early. That is why the server sends
 * an absolute instant rather than "60 seconds" — a duration would make *every* client
 * disagree about when the offer died, and an absolute instant makes only the
 * mis-set ones disagree, by exactly their error.
 */

/**
 * Twice a second, not once.
 *
 * The remainder is not aligned to the second boundary — an offer created at 14:00:00.4
 * expires on a half second — so a one-second tick can sit for nearly a full second
 * displaying a number that has already changed. Sampling at 500ms bounds that at half a
 * second, which is the difference between a countdown that looks like a clock and one
 * that looks stuck. It is two timer callbacks per second on one open modal.
 */
const TICK_MS = 500;

/**
 * @param {object} props
 * @param {string} props.expiresAt  ISO 8601, from the server
 * @param {() => void} props.onExpire  called exactly once, when the remainder hits zero
 */
export default function OfferCountdown({ expiresAt, onExpire }) {
  const [remainingMs, setRemainingMs] = useState(() => msUntil(expiresAt));

  /**
   * `onExpire` through a ref, for the reason `useSocketEvent` keeps its handler in one:
   * the parent passes an inline arrow, so putting it in the dependency array would tear
   * down and rebuild the interval on every render of the modal.
   */
  const savedOnExpire = useRef(onExpire);

  useEffect(() => {
    savedOnExpire.current = onExpire;
  });

  /** Latched, so a modal that lingers for one extra frame cannot fire twice. */
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;

    const tick = () => {
      const remaining = msUntil(expiresAt);

      setRemainingMs(remaining);

      if (remaining > 0 || expiredRef.current) return;

      expiredRef.current = true;
      savedOnExpire.current?.();
    };

    // Once immediately: an offer that was already dead when the modal opened — a
    // socket frame delayed past its own expiry — must not display sixty seconds
    // until the first interval fires.
    tick();

    const timer = window.setInterval(tick, TICK_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [expiresAt]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <Text
      component="span"
      fw={700}
      fz={{ base: 32, sm: 28 }}
      lh={1}
      c={seconds <= 10 ? 'red.7' : 'dark'}
      // The number changes twice a second; without this, a screen reader announces
      // every one of them and the brief underneath is never heard.
      aria-live="off"
    >
      {formatRemaining(seconds)}
    </Text>
  );
}

/**
 * Milliseconds until an ISO instant. Negative once it has passed — the caller wants to
 * know it went past, and clamping here would hide that from the expiry check.
 *
 * An unparseable `expiresAt` yields `NaN`, which compares false against `> 0` and so
 * expires the modal immediately. That is the safe direction: a modal that closes on a
 * malformed payload costs one offer, and one that stays open forever costs the teacher
 * their availability until they reload.
 *
 * @param {string} expiresAt
 * @returns {number}
 */
function msUntil(expiresAt) {
  return new Date(expiresAt).getTime() - Date.now();
}

/**
 * `0:47`. Minutes appear because the TTL is a constant on the server (§5) and nothing
 * here should assume it stays under a minute.
 *
 * @param {number} seconds  whole seconds, never negative
 * @returns {string}
 */
function formatRemaining(seconds) {
  const minutes = Math.floor(seconds / 60);

  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
