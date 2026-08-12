/**
 * Endpoint payload shapes, shared by client and server.
 *
 * APPEND-ONLY, one clearly-marked section per epic (docs/OWNERSHIP.md §2). Never
 * reorder and never edit another epic's section: this file is written by both
 * developers in the same week, and appended blocks merge where moved ones do not.
 *
 * Types only — no runtime export. This is the written contract between the two
 * halves of a vertical slice, so that "what does this endpoint return" has an
 * answer that does not require reading the controller.
 *
 * Every response travels inside the standard envelope, so `data` below is what
 * the client's axios interceptor hands back after unwrapping:
 *
 *   success  { success: true,  data: T }              →  caller receives T
 *   failure  { success: false, error: ErrorEnvelope } →  caller receives ApiError
 */

export interface ErrorEnvelope {
  code: string;
  message: string;
  details: unknown | null;
}

// ─── E1 · Public surface (PR 1.6) ─────────────────────────────────────────────

/**
 * A node of the topic taxonomy (MVP.md §7). Two levels only: `children` is
 * present on parents and absent on subtopics.
 *
 * `slug` is the stable key, not `id` — ids are assigned by the database
 * (CONVENTIONS.md → Database) and only `id = 0`, the classifier's
 * "General / Unclassified" fallback, is part of any contract.
 */
export interface TopicNode {
  id: number;
  slug: string;
  nameHe: string;
  nameEn: string;
  children?: TopicNode[];
}

/** `GET /public/topics` — the taxonomy as a tree, roots in seed order. */
export interface PublicTopicsResponse {
  topics: TopicNode[];
}

/** A price band as the pricing page and the selection filter display it (§5.2). */
export interface PriceBand {
  /** `'A' | 'B' | 'C'` today; read it as an opaque key, not an enum. */
  key: string;
  /** Derived from the previous band's ceiling; never stored. */
  minPrice: number;
  /** The ceiling. A student choosing this band sees every band up to it. */
  maxPrice: number;
}

/**
 * `GET /public/pricing` — MVP.md §5, derived server-side from
 * `server/src/config/constants/`. All amounts are whole credits (1 credit = ₪1)
 * and all durations are as named.
 */
export interface PublicPricingResponse {
  block: {
    minutes: number;
    openingBlocks: number;
    openingMinutes: number;
    extensionBlocks: number;
    extensionMinutes: number;
    /** How long before a block ends the student is asked to extend. */
    warningSeconds: number;
  };

  /** Per block. The teacher picks the number; the platform only bounds it. */
  price: {
    min: number;
    max: number;
    default: number;
  };

  /** Cheapest first. */
  bands: PriceBand[];

  commission: {
    /** A fraction, not a percentage: `0.15` means 15%. */
    platformFeePct: number;
    newTeacherFeeDays: number;
    /** `[startHour, endHour)` wall-clock in `timezone`, never in the client's. */
    lowDemandHours: { startHour: number; endHour: number };
    /** IANA zone the hours above are expressed in, e.g. `"Asia/Jerusalem"`. */
    timezone: string;
  };

  budget: {
    /** What a student's per-question spending cap defaults to. */
    defaultCap: number;
  };

  /** Top-up amounts, in credits. */
  topupPackages: number[];
}
