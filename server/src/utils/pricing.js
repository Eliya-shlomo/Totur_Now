import { PRICE_BANDS, PRICE_BAND_KEYS, MAX_PRICE_PER_BLOCK } from '#config/constants/index.js';

/**
 * Price bands — the student's price filter. MVP.md §5.2.
 *
 * A band is a **ceiling**, not a bracket: a student on band B sees bands A and B.
 * Everything here is a pure function of `price_per_block`, because the band is not
 * stored anywhere. A teacher picks a number; the band follows from it.
 */

/** The band a price falls in. `bandOf(12) === 'B'`. */
export function bandOf(pricePerBlock) {
  return PRICE_BAND_KEYS.find((key) => pricePerBlock <= PRICE_BANDS[key].maxPrice) ?? 'C';
}

/**
 * The price ceiling a student chose, for the matching hard filter (§9.1).
 *
 * An unknown or missing band means no ceiling rather than no results: a student
 * who never touched the filter should see every teacher they can afford, and a
 * typo in a query string should not silently empty the selection screen.
 */
export function bandCeiling(band) {
  return PRICE_BANDS[band]?.maxPrice ?? MAX_PRICE_PER_BLOCK;
}
