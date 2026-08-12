import {
  BLOCK_MINUTES,
  DEFAULT_BUDGET_CAP,
  DEFAULT_PRICE_PER_BLOCK,
  EXTENSION_BLOCKS,
  LOW_DEMAND_HOURS,
  MAX_PRICE_PER_BLOCK,
  MIN_PRICE_PER_BLOCK,
  NEW_TEACHER_FEE_DAYS,
  OPENING_BLOCKS,
  PLATFORM_FEE_PCT,
  TIMEZONE,
  TOPUP_PACKAGES,
  WARNING_SECONDS,
} from '#config/constants/index.js';
import { priceBandRanges } from '#utils/pricing.js';

/**
 * How pricing works, as data. MVP.md §5.
 *
 * The point of this service is that **the pricing page cannot lie**. Every number
 * a visitor reads comes from `config/constants/`, which is the same module the
 * wallet charges from — so a page promising a ₪5 floor and a system enforcing ₪7
 * is not a bug that can happen. That is why nothing here is a literal: a hardcoded
 * `5` would be a second copy of a number, free to drift from the first.
 *
 * Minutes are computed rather than listed for the same reason. The spec says an
 * opening block is 10 minutes, but 10 is `BLOCK_MINUTES * OPENING_BLOCKS` — write
 * the product, not the result, and changing the block length stays a one-line
 * change.
 *
 * There is no database read here, so this is a pure function of the constants and
 * the layering rule (CONVENTIONS.md) is satisfied by the file's existence: the
 * controller composes no payload of its own.
 */

const [lowDemandStartHour, lowDemandEndHour] = LOW_DEMAND_HOURS;

/**
 * @returns {object} the `/public/pricing` payload — see shared/api.d.ts
 */
export function getPricingModel() {
  return {
    block: {
      minutes: BLOCK_MINUTES,
      openingBlocks: OPENING_BLOCKS,
      openingMinutes: BLOCK_MINUTES * OPENING_BLOCKS,
      extensionBlocks: EXTENSION_BLOCKS,
      extensionMinutes: BLOCK_MINUTES * EXTENSION_BLOCKS,
      // The student is asked to extend this long before the block ends (§5.1).
      warningSeconds: WARNING_SECONDS,
    },

    price: {
      // Per block, in credits. The teacher picks the number (§5.2); the platform
      // only bounds it.
      min: MIN_PRICE_PER_BLOCK,
      max: MAX_PRICE_PER_BLOCK,
      default: DEFAULT_PRICE_PER_BLOCK,
    },

    // A student filter, not a teacher property. Ceilings, cheapest first.
    bands: priceBandRanges(),

    commission: {
      // A fraction, not a percentage: 0.15, and the client formats it. Sending 15
      // would make every consumer guess which of the two it received.
      platformFeePct: PLATFORM_FEE_PCT,
      newTeacherFeeDays: NEW_TEACHER_FEE_DAYS,
      // [start, end) in `timezone`, never in the server's clock — Render is UTC
      // and would shift these by three hours (see constants/app.js).
      lowDemandHours: { startHour: lowDemandStartHour, endHour: lowDemandEndHour },
      timezone: TIMEZONE,
    },

    budget: {
      // What a student's per-question cap defaults to before they touch it.
      defaultCap: DEFAULT_BUDGET_CAP,
    },

    topupPackages: TOPUP_PACKAGES,
  };
}
