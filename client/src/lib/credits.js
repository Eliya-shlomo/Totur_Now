/**
 * Credits, translated into the only unit a student is ever shown — MVP.md §5.4.
 *
 * A balance is a number of credits and a price is credits per block, but "you have
 * 96 credits" answers nothing a student asked. "Your credit buys 30 minutes with
 * this teacher" does, and §5.4 says minutes is what the screen displays. This is
 * that translation, written once so that the card, the selection screen and the
 * wallet cannot each round it differently.
 *
 * Pure and React-free on purpose: it is the half of DEV-A's slice that has to agree
 * with `floor(balance / OPENING_BLOCKS)` on the server, and a function with no
 * imports is a function two people can read side by side.
 */

/**
 * How many minutes a balance buys at a given price.
 *
 * **Whole blocks only.** A student cannot buy four fifths of a block, so the
 * division floors before it multiplies. Rounding up would tell someone with ₪23 at
 * ₪12 a block that they have 10 minutes when they have 5 and cannot extend — the
 * screen would be promising time the wallet will refuse to sell. Flooring is the
 * product decision; the caller says the honest thing about what is left.
 *
 * `blockMinutes` is a parameter rather than an import because there is no client
 * constants module and there should not be one. The number comes from
 * `GET /public/pricing`, which derives it from the same `constants/session.js` the
 * wallet charges from, so the label cannot drift from the billing. A client-side
 * `5` here would reintroduce exactly the drift that endpoint exists to prevent, in
 * the one place where being wrong costs the student money.
 *
 * Both of §14.2's own numbers fall out of it: a balance of 96 at ₪16 is 6 blocks
 * and 30 minutes, and the same 96 at ₪12 is 8 blocks and 40 minutes.
 *
 * A price that is missing, zero or negative yields 0 rather than `Infinity` or
 * `NaN`. Callers guarantee a real price today, but the return value of this
 * function is rendered directly onto a screen, and "NaN minutes" is a worse
 * failure than "no credit".
 *
 * @param {number} balance        credits the student holds (1 credit = ₪1)
 * @param {number} pricePerBlock  the teacher's price, credits per block
 * @param {number} blockMinutes   `block.minutes` from `GET /public/pricing`
 * @returns {number} whole minutes, always a multiple of `blockMinutes`
 */
export function minutesFor(balance, pricePerBlock, blockMinutes) {
  if (!Number.isFinite(balance) || balance <= 0) return 0;
  if (!Number.isFinite(pricePerBlock) || pricePerBlock <= 0) return 0;
  if (!Number.isFinite(blockMinutes) || blockMinutes <= 0) return 0;

  return Math.floor(balance / pricePerBlock) * blockMinutes;
}
