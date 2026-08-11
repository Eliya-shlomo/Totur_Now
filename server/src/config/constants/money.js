/**
 * Pricing, commission and credits. MVP.md §5, §6.4, appendix.
 *
 * All amounts are integers in credits, and 1 credit = ₪1. Money is never a float
 * anywhere in this system — see prisma/schema/wallet.prisma.
 */

/**
 * The teacher sets their own price, anywhere in this range (MVP.md §5.2).
 *
 * The floor stops undercutting from becoming the way to get matched; the ceiling
 * keeps the budget cap and the "can afford the opening block" filter meaningful.
 * The same range is a CHECK constraint on teacher_profiles.price_per_block —
 * change one and you must change the other, in a migration.
 */
export const MIN_PRICE_PER_BLOCK = 5;
export const MAX_PRICE_PER_BLOCK = 20;
export const DEFAULT_PRICE_PER_BLOCK = 10;

/**
 * The student-facing price filter (§5.2). A band is a **ceiling**: picking B means
 * bands A and B, so a cheaper teacher is never hidden from someone willing to pay
 * more.
 *
 * Derived from `price_per_block` at read time and never stored on the teacher —
 * a teacher does not pick a band, they pick a number, and the band follows.
 */
export const PRICE_BANDS = {
  A: { maxPrice: 9 },
  B: { maxPrice: 14 },
  C: { maxPrice: MAX_PRICE_PER_BLOCK },
};

/** Band keys, cheapest first. `#utils/pricing.js` reads them in this order. */
export const PRICE_BAND_KEYS = Object.keys(PRICE_BANDS);

/** Platform commission. Deliberately below market — supply before profit (§5.3). */
export const PLATFORM_FEE_PCT = 0.15;

/** New teachers pay no commission for this long. */
export const NEW_TEACHER_FEE_DAYS = 30;

/**
 * Commission-free hours, as [startHour, endHour) — start inclusive, end exclusive.
 * Availability incentive without paying for standby (§5.3).
 *
 * Israel time, always. Never compare these against `new Date().getHours()`, which
 * answers in the host's timezone and is UTC on Render — use `isLowDemandHour()`
 * from `#utils/time.js`, which resolves through `TIMEZONE`.
 */
export const LOW_DEMAND_HOURS = [6, 14];

/** Default spending ceiling a student sets per question (§5.1). */
export const DEFAULT_BUDGET_CAP = 40;

/** Top-up packages, in credits (§5.4). */
export const TOPUP_PACKAGES = [50, 100, 200];
