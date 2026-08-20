/**
 * How one ledger row is put into words — the client's half of a deliberate split.
 *
 * The server sends `type`, an enum both sides already share, and **not `note`**.
 * `note` is operator-facing text chosen for a log reader — `'Session earning'`,
 * `'No-show refund'` — and `wallet.repository.js` keeps it off the wire on purpose: put
 * it on a student's screen and every future note becomes a user-facing string that
 * nobody reviews as one. So the sentence is written here, where it can be read as copy.
 *
 * Pure and JSX-free, so the mapping can be checked without rendering anything.
 *
 * No amount, no price and no block length is written in this file. Amounts arrive
 * signed from the server and are formatted, never recomputed.
 */

/**
 * `WalletTxType` → the word a student reads.
 *
 * **All six values are mapped, including the two nothing writes yet.** `PAYOUT` and
 * `PROMO` are in the Prisma enum and in `shared/api.d.ts` today, so they are values this
 * client already knows the meaning of — leaving them to the fallback below would render
 * `PAYOUT` in a list of ordinary English words for no reason other than that the feature
 * is unbuilt. The fallback stays for the value the *server* adds next.
 *
 * `SESSION_CHARGE` is "Session" rather than "Charge" because the sign already says which
 * direction the money went, and the row is more useful named after what it bought.
 */
const TX_LABELS = {
  TOPUP: 'Top-up',
  SESSION_CHARGE: 'Session',
  REFUND: 'Refund',
  TEACHER_EARNING: 'Earning',
  PAYOUT: 'Payout',
  PROMO: 'Promotion',
};

/**
 * **An unknown type renders as itself, never as nothing.** `tx_type` is a server-side
 * enum and a client is always one deploy behind it; a row whose label resolved to an
 * empty string would be a movement of money that the screen shows a blank line for,
 * which is the one failure a ledger must not have. `PROMO_2026` is ugly and it is
 * visible, and visible wins.
 *
 * @param {string} type  a `WalletTxType`, or a value newer than this client
 * @returns {string}
 */
export function txLabel(type) {
  return TX_LABELS[type] ?? type;
}

/**
 * The signed amount, as text.
 *
 * **The sign is in the characters, not only in the colour.** §14.4's accessibility
 * posture is that colour is never the sole carrier of meaning, and "is this row money
 * arriving or leaving" is the only question the ledger exists to answer. U+2212 MINUS
 * rather than a hyphen so the two signs are the same width and a column of them lines up.
 *
 * `amount` is already signed by the server — negative is money leaving the wallet — so
 * this reads the sign rather than deciding it from the type. A client that derived the
 * direction from `SESSION_CHARGE` would be a second opinion about which way a row went.
 *
 * @param {number} amount  signed credits, from `WalletTransactionRecord.amount`
 * @returns {string}
 */
export function signedCredits(amount) {
  return `${amount < 0 ? '−' : '+'}${Math.abs(amount)}`;
}

/**
 * When the row happened, in the reader's own locale and zone.
 *
 * `createdAt` is ISO 8601 in UTC and this is the first screen in the app to render a
 * wall-clock date rather than a countdown, so the choice is made here: `undefined` as the
 * locale, matching `CommissionPanel`'s `Intl.NumberFormat`, which means the browser's
 * preference rather than one this app picked for it. A student disputing a charge is
 * comparing this against their own memory of the evening, so it has to be their clock.
 *
 * Minutes are included and seconds are not: two sessions in one evening need the time to
 * be told apart, and nothing here is decided at second resolution.
 *
 * @param {string} isoDate  `WalletTransactionRecord.createdAt`
 * @returns {string}
 */
export function formatTxDate(isoDate) {
  const date = new Date(isoDate);

  // A row is useless without a date but not worth blanking the list over, so an
  // unparseable one degrades to what the server sent rather than to "Invalid Date".
  if (Number.isNaN(date.getTime())) return isoDate;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
