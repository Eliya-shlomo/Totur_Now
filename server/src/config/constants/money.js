/**
 * Pricing, commission and credits. MVP.md §5, §6.4, appendix.
 *
 * All amounts are integers in credits, and 1 credit = ₪1. Money is never a float
 * anywhere in this system — see prisma/schema/wallet.prisma.
 */

/**
 * The three tiers. A teacher picks one, subject to verification (MVP.md §5.2).
 * `badge` is the badge a teacher on this tier carries by default (§6.4).
 */
export const PRICE_TIERS = {
  BASE: { pricePerBlock: 8, badge: 'NEW' },
  REGULAR: { pricePerBlock: 12, badge: 'STUDENT' },
  PRO: { pricePerBlock: 16, badge: 'CERTIFIED' },
};

/** Highest price in the system. Feeds `price_fit` in the matching score (§9.2). */
export const MAX_PRICE_PER_BLOCK = Math.max(
  ...Object.values(PRICE_TIERS).map((t) => t.pricePerBlock),
);

/** Platform commission. Deliberately below market — supply before profit (§5.3). */
export const PLATFORM_FEE_PCT = 0.15;

/** New teachers pay no commission for this long. */
export const NEW_TEACHER_FEE_DAYS = 30;

/**
 * Commission-free hours, as [startHour, endHour) in server local time.
 * Availability incentive without paying for standby (§5.3).
 */
export const LOW_DEMAND_HOURS = [6, 14];

/** Default spending ceiling a student sets per question (§5.1). */
export const DEFAULT_BUDGET_CAP = 40;

/** Top-up packages, in credits (§5.4). */
export const TOPUP_PACKAGES = [50, 100, 200];
