import {
  MAX_PRICE_PER_BLOCK,
  MIN_PRICE_PER_BLOCK,
  PRICE_BANDS,
  PRICE_BAND_KEYS,
} from '#config/constants/index.js';

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

/**
 * The bands as visible ranges, cheapest first — `[{ key: 'A', minPrice: 5,
 * maxPrice: 9 }, …]`. For anything that has to *show* the filter rather than
 * apply it: the pricing page (PR 1.6) and the selection screen's filter control.
 *
 * A band stores only its ceiling, because that is the only part matching uses.
 * The floor a student reads is therefore derived — one credit above the previous
 * band's ceiling, and `MIN_PRICE_PER_BLOCK` for the first. Deriving it is what
 * keeps a displayed range from drifting: edit a ceiling in `money.js` and both
 * ends of both neighbouring ranges follow, with no second place to remember.
 */
export function priceBandRanges() {
  let floor = MIN_PRICE_PER_BLOCK;

  return PRICE_BAND_KEYS.map((key) => {
    const maxPrice = PRICE_BANDS[key].maxPrice;
    const range = { key, minPrice: floor, maxPrice };

    floor = maxPrice + 1;

    return range;
  });
}
