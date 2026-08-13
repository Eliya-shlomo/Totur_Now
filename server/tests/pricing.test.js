import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_PRICE_PER_BLOCK,
  MIN_PRICE_PER_BLOCK,
  PRICE_BANDS,
  PRICE_BAND_KEYS,
} from '#config/constants/index.js';
import { bandCeiling, bandOf, priceBandRanges } from '#utils/pricing.js';

/**
 * Price bands — MVP.md §5.2.
 *
 * These tests exist because of a specific mistake. PR 2.3's brief said the public
 * list should resolve `?band=A` through `priceBandRanges()` into the range 5–9. A
 * band is a **ceiling**, not a bracket: picking B means bands A and B, so a cheaper
 * teacher is never hidden from someone willing to pay more (§5.2, and the matching
 * hard filter in §9.1 reads it the same way).
 *
 * The two readings happen to agree on band A, which is exactly how a wrong rule
 * survives a test — and it survived review too, because band A was the example
 * everybody checked. So the ceiling rule is pinned here, on every band, along with
 * the containment property that makes it a ceiling at all.
 *
 * Everything below is a pure function of `money.js`. Nothing is hardcoded: a test
 * that typed 9 and 14 would pass for the wrong reason the day someone edits the
 * band table, which is the failure it is supposed to catch.
 */

const [CHEAPEST, ...REST] = PRICE_BAND_KEYS;
const DEAREST = PRICE_BAND_KEYS[PRICE_BAND_KEYS.length - 1];

/** Every legal price, so a property can be checked over the whole domain. */
const ALL_PRICES = Array.from(
  { length: MAX_PRICE_PER_BLOCK - MIN_PRICE_PER_BLOCK + 1 },
  (_, index) => MIN_PRICE_PER_BLOCK + index,
);

describe('bandOf', () => {
  it('puts every legal price in some band', () => {
    for (const price of ALL_PRICES) {
      assert.ok(PRICE_BAND_KEYS.includes(bandOf(price)), `${price} landed outside the bands`);
    }
  });

  it('puts a band ceiling in that band, not the next one up', () => {
    for (const key of PRICE_BAND_KEYS) {
      assert.equal(bandOf(PRICE_BANDS[key].maxPrice), key);
    }
  });

  it('never moves down as the price rises', () => {
    // Monotonic by construction, and the property worth pinning: a band table
    // edited out of ascending order would break this and nothing else.
    let previous = 0;

    for (const price of ALL_PRICES) {
      const index = PRICE_BAND_KEYS.indexOf(bandOf(price));

      assert.ok(index >= previous, `price ${price} moved to a cheaper band`);
      previous = index;
    }
  });

  it('puts a price above the ceiling in the dearest band rather than nowhere', () => {
    assert.equal(bandOf(MAX_PRICE_PER_BLOCK + 100), DEAREST);
  });
});

describe('bandCeiling — a band is a ceiling, not a bracket', () => {
  it('returns the band’s own ceiling', () => {
    for (const key of PRICE_BAND_KEYS) {
      assert.equal(bandCeiling(key), PRICE_BANDS[key].maxPrice);
    }
  });

  it('lets each band see everything the bands below it can see', () => {
    // The whole rule, as a property. `?band=B` must include every teacher `?band=A`
    // would return — this is the assertion the 2.3 brief's bracket reading fails.
    const visible = (key) => ALL_PRICES.filter((price) => price <= bandCeiling(key));

    for (const [index, key] of PRICE_BAND_KEYS.entries()) {
      for (const cheaper of PRICE_BAND_KEYS.slice(0, index)) {
        for (const price of visible(cheaper)) {
          assert.ok(visible(key).includes(price), `band ${key} hid a ₪${price} teacher`);
        }
      }
    }
  });

  it('shows every teacher at the dearest band', () => {
    assert.equal(bandCeiling(DEAREST), MAX_PRICE_PER_BLOCK);
  });

  it('treats an unknown or missing band as no ceiling rather than no results', () => {
    // A typo in a query string must not silently empty the list. Same reasoning as
    // the `?nonsense=` rejection in `teacher.public.schema.js`, opposite mechanism:
    // there the request is refused, here a filter we cannot read is not applied.
    assert.equal(bandCeiling('Z'), MAX_PRICE_PER_BLOCK);
    assert.equal(bandCeiling(undefined), MAX_PRICE_PER_BLOCK);
  });
});

describe('priceBandRanges — for showing the filter, not applying it', () => {
  const ranges = priceBandRanges();

  it('returns one range per band, cheapest first', () => {
    assert.deepEqual(
      ranges.map((range) => range.key),
      PRICE_BAND_KEYS,
    );
  });

  it('starts at the global minimum', () => {
    assert.equal(ranges[0].minPrice, MIN_PRICE_PER_BLOCK);
  });

  it('derives each floor from the previous ceiling, leaving no gap and no overlap', () => {
    // The floors are not stored — a band knows only its ceiling, because that is the
    // only part matching uses. Deriving them is what keeps a displayed range from
    // drifting when a ceiling moves in `money.js`.
    for (const [index, range] of ranges.entries()) {
      if (index === 0) continue;

      assert.equal(range.minPrice, ranges[index - 1].maxPrice + 1);
    }
  });

  it('covers every legal price exactly once', () => {
    for (const price of ALL_PRICES) {
      const matches = ranges.filter((range) => price >= range.minPrice && price <= range.maxPrice);

      assert.equal(matches.length, 1, `₪${price} matched ${matches.length} ranges`);
    }
  });

  it('is a bracket, which is why the list filter does not use it', () => {
    // Documented as an assertion rather than a comment: the cheapest band's range
    // excludes prices the *filter* for that band must also exclude, but the second
    // band's range excludes prices its filter must include. That difference is the
    // bug 2.3 shipped in its brief.
    const second = ranges.find((range) => range.key === REST[0]);

    assert.ok(second.minPrice > bandCeiling(CHEAPEST));
    assert.ok(bandCeiling(REST[0]) >= bandCeiling(CHEAPEST));
  });
});
