/**
 * The API contract, in one place, for client and server.
 *
 * This is a plain-JavaScript project — nothing type-checks these declarations, and
 * they compile to nothing. They exist so that "what does `POST /auth/login` return"
 * has one written answer that both workspaces are reviewed against, and so editors
 * autocomplete it. CONVENTIONS.md points here for prop shapes.
 *
 * APPEND-ONLY, one clearly-marked section per epic (docs/OWNERSHIP.md §2). Never
 * reorder and never tidy: both developers append to this file in the same week, and
 * git merges appended lines cleanly.
 *
 * Created in PR 1.1 with the E1 section. Earlier epics shipped no endpoints beyond
 * `/health`, which is why the file starts here.
 */

// ── envelope — every response, every epic (CONVENTIONS.md) ───────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: {
    /** A value from `shared/errorCodes.js`. The client switches on this, not on the message. */
    code: string;
    /** Safe to show a user as-is. */
    message: string;
    /** Field-level detail for `VALIDATION_ERROR`, otherwise null. */
    details: Record<string, string> | null;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

// ── E1 — auth & users ────────────────────────────────────────────────────────
// Frozen in docs/epics/E1-auth/README.md § "Contract freeze". Changing anything
// below is a chat message to the other developer before the code changes.

/** The `user_role` enum in `prisma/schema/users.prisma`. Lowercase, exact. */
export type UserRole = 'student' | 'teacher' | 'admin';

/**
 * The JWT payload, both token types. Exactly four fields — the token is not a
 * profile cache, so no email and no name.
 */
export interface TokenPayload {
  /** The user id. */
  sub: string;
  role: UserRole;
  /** Issued at, seconds since epoch. Added by `jsonwebtoken`. */
  iat: number;
  /** Expires at, seconds since epoch. Added by `jsonwebtoken`. */
  exp: number;
}

/** What `authenticate` attaches to the request. Nothing more is available without a query. */
export interface RequestUser {
  id: string;
  role: UserRole;
}

/** The user object as it appears in every auth response. Never includes `passwordHash`. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  avatarUrl: string | null;
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  /** `admin` is rejected by validation — an open endpoint that mints admins is a hole. */
  role: 'student' | 'teacher';
  /** Students only. */
  grade?: number;
  /** Students only. */
  mathLevel?: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * The response body of `POST /auth/register` (201) and `POST /auth/login` (200) —
 * deliberately the same shape, so the client has one handler for both. The refresh
 * token is not here: it is set as an httpOnly cookie and is never readable by JS.
 */
export interface AuthResponse {
  user: AuthUser;
  /** 15 minutes. Held in memory by `authStore` — never in `localStorage`. */
  accessToken: string;
}

/** `POST /auth/refresh`. The rotated refresh token comes back in the cookie. */
export interface RefreshResponse {
  accessToken: string;
}

export interface StudentProfileData {
  grade: number | null;
  mathLevel: number | null;
  school: string | null;
}

export interface TeacherProfileData {
  bio: string | null;
  pricePerBlock: number;
  levelMax: number;
  /** The `teacher_status` enum in `prisma/schema/teachers.prisma`. Uppercase, unlike `UserRole`. */
  status: 'OFFLINE' | 'ONLINE' | 'OFFER_LOCKED' | 'IN_SESSION';
}

/**
 * `GET /auth/me` — the client's single source of truth for the current user.
 *
 * One round trip, not three: whatever a header or a dashboard needs about the
 * logged-in user is in here, which is why the role-specific profile and the student
 * balance are embedded rather than fetched separately.
 */
export interface MeResponse extends AuthUser {
  studentProfile?: StudentProfileData;
  teacherProfile?: TeacherProfileData;
  /** Students only. Credits, always an integer. */
  walletBalance?: number;
}

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

// ── E1 — public surface (PR 1.6) ─────────────────────────────────────────────
// Unauthenticated, MVP.md §12 "Public". No type here may reference a user: these
// responses are cacheable by any proxy, so anything in them is served to
// strangers.

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

// ── E2 ──────────────────────────────────────────────────────────────────────
// Frozen in docs/epics/E2-teacher-onboarding/README.md § "Contract freeze", and
// copied here verbatim in PR 2.1. Two audiences read the same table — the teacher
// their own record, a stranger a card — so the difference between them is the
// contract, not an implementation detail of whichever controller answers.
// Changing anything below is a chat message before the code.

/** A teacher as a stranger sees them. No email, no status, no counters. */
export interface TeacherCard {
  id: string;
  fullName: string;
  bio: string | null;
  pricePerBlock: number;
  levelMax: number;
  /** Computed by `utils/standing.js`, never stored. */
  badge: 'NEW' | 'ACTIVE' | 'EXPERIENCED' | 'TOP';
  /** null until the teacher has been rated at least once. Not 0. */
  rating: number | null;
  ratingCount: number;
  /** Leaf topics only, in the taxonomy's own order. */
  topics: Array<{ id: number; slug: string; nameHe: string; nameEn: string }>;
  isOnline: boolean;
}

/** `GET /teachers` — the public list. */
export interface TeacherListResponse {
  teachers: TeacherCard[];
  total: number;
}

/** `GET /teachers/me` — the teacher's own record. Superset of TeacherCard. */
export interface TeacherMeResponse extends TeacherCard {
  status: 'OFFLINE' | 'ONLINE' | 'OFFER_LOCKED' | 'IN_SESSION';
  sessionsCount: number;
  resolvedCount: number;
  /** True until topics, levelMax and pricePerBlock have all been set once. */
  onboardingComplete: boolean;
}

/** `PATCH /teachers/me`. Every field optional — the stepper sends one step at a time. */
export interface TeacherUpdateRequest {
  bio?: string | null;
  pricePerBlock?: number; // 5–20, §5.2
  levelMax?: number; // 3 | 4 | 5, §6.1
  topicIds?: number[]; // leaf topics only, replaces the whole set
  status?: 'OFFLINE' | 'ONLINE';
}

// ── E3 ──────────────────────────────────────────────────────────────────────
// Frozen in docs/epics/E3-question-intake/README.md § "Contract freeze", and copied
// here verbatim in PR 3.1. Two tracks meet at one endpoint — DEV-A captures the
// student's words and pixels, DEV-B decides what they are about — so the shapes
// below are agreed before either side is built rather than discovered at the merge.
// Changing anything here is a chat message before the code.

/** One uploaded image. `questionId` is null until `POST /questions` binds it. */
export interface Attachment {
  id: string;
  fileUrl: string;
  mimeType: string;
}

/**
 * What the LLM decided, or what the fallback decided for it (MVP.md §8.1).
 * Every field here is also a column on `questions` — this is the write shape.
 */
export interface Classification {
  /** Short human title. Null when the fallback ran. */
  title: string | null;
  /** Parent topic. `0` = General / Unclassified, the seeded sentinel. */
  topicId: number;
  /** Leaf topic. Null on the fallback path, and null is legal on the override too. */
  subtopicId: number | null;
  /** 1–5. Null on the fallback path. */
  difficulty: number | null;
  /** 3 | 4 | 5 — what the LLM thinks the exercise is, not what the student declared. */
  estimatedLevel: number | null;
  /** What the teacher reads before accepting. On the fallback path this is the student's raw text. */
  teacherBrief: string;
  /** One sentence shown to the student on the confirmation screen. */
  studentConfirmation: string;
  /** 0–1. `0` when the fallback ran. */
  confidence: number;
  /** False = the LLM failed, timed out, or came back under MIN_CONFIDENCE. The flow continued anyway. */
  classificationOk: boolean;
}

/** `POST /questions` request. */
export interface CreateQuestionRequest {
  rawText: string;
  /** 3 | 4 | 5, what the student says they study. Optional — the form asks, it does not insist. */
  declaredLevel?: number;
  /** Ids from `POST /questions/attachments`, uploaded before the question existed. */
  attachmentIds?: string[];
}

/** `POST /questions` and `GET /questions/:id` both return this. */
export interface QuestionResponse {
  id: string;
  rawText: string;
  declaredLevel: number | null;
  classification: Classification;
  attachments: Attachment[];
  /** The `PENDING` session created alongside the question. E4 matches against it. */
  sessionId: string;
  createdAt: string;
}

/** `PATCH /questions/:id/classification` — the student's correction (§8.1). */
export interface ClassificationOverrideRequest {
  /** Leaf topic id, or `0` to say "none of these". */
  subtopicId: number | null;
  topicId: number;
  estimatedLevel?: number;
}

// ── E4 ──────────────────────────────────────────────────────────────────────
// Frozen in docs/epics/E4-matching/README.md § "Contract freeze", and copied here
// verbatim in PR 4.1. Two tracks meet at one endpoint — DEV-A decides who is
// eligible and what the student can afford, DEV-B decides what order they come back
// in — so the shapes below are agreed before either side is built rather than
// discovered at the merge. Changing anything here is a chat message before the code.

/**
 * Why a match list came back empty. `null` when it did not.
 *
 * Both are string values, not thrown errors — see "Two empty pools" below.
 */
export type MatchEmptyReason = 'NO_AVAILABLE_TEACHERS' | 'INSUFFICIENT_CREDIT';

/**
 * One ranked teacher: E2's card, plus the three things §14.2 shows that a card
 * does not carry.
 *
 * **No score, and no rank number.** §14.2 is explicit — the student sees an order,
 * not grades. Nothing in this shape lets a client reconstruct one.
 */
export interface TeacherMatch {
  /** Field-for-field the same shape `GET /teachers` returns. */
  teacher: TeacherCard;
  /**
   * Sessions this teacher has completed in the question's *subtopic* — §14.2's
   * "solved 12 questions in Integrals". A whole number; `teacher_topic_stats`
   * stores it as NUMERIC(8,2) because of the 0.3 parent propagation, and this is
   * that value rounded for display. `0` when they have never taught it.
   */
  subtopicSessions: number;
  /**
   * Their resolve rate in that subtopic, 0–1 — §14.2's "91% resolved".
   * `null`, never `0`, when they have no history there: the same distinction
   * `TeacherCard.rating` already makes.
   */
  subtopicResolveRate: number | null;
  /**
   * §14.2's 💙 "studied with" badge: this student rated this teacher at least
   * `HISTORY_MIN_STARS` before. The same fact §9.2 scores as `history_bonus`.
   */
  studiedWith: boolean;
}

/**
 * `GET /questions/:id/matches?priceBand=A|B|C`.
 *
 * Always 200 when the caller owns a `PENDING` question, even with no teachers.
 */
export interface MatchesResponse {
  /** At most `MATCH_COUNT` (5), best first. Empty iff `reason` is set. */
  teachers: TeacherMatch[];
  reason: MatchEmptyReason | null;
  /**
   * The ceiling actually applied, in credits per block — the lower of the band's
   * ceiling and what the balance affords. The screen shows it so that "why is
   * Dana missing" has an answer on the page.
   */
  priceCeiling: number;
  /**
   * The student's balance at match time. Returned because the server has already
   * read it to compute `priceCeiling`, and because `GET /wallet` is E7.
   */
  walletBalance: number;
}

// ── E5 ──────────────────────────────────────────────────────────────────────
// Frozen in docs/epics/E5-offers-realtime/README.md § "Contract freeze", and copied
// here verbatim in PR 5.1. E5 has one developer, so this block is not settling an
// argument between two tracks — it is settling one between two *consumers*, the
// client and the server, which stay two even when one person writes both. E2 shipped
// three defects of the class "two subsystems disagree" and E4 shipped a fourth, and
// none of the four was caught by the person who wrote the code. Changing anything
// below is a note in the PR before the code.
//
// The socket contract is not here. Event names live in `shared/socketEvents.js`,
// which is JavaScript because both sides import the values rather than the types.

/** `PENDING` until the teacher answers or the clock runs out. */
export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

/**
 * What the student's awaiting screen renders, and what `POST /sessions/:id/offer`
 * answers with.
 *
 * **`expiresAt` is absolute and server-issued.** The countdown is computed from it
 * on every tick rather than from a client-side `setTimeout` seeded once: a phone
 * that sleeps for thirty seconds must wake up showing the right number, and a
 * client clock that is two minutes fast must not expire the offer early.
 */
export interface OfferResponse {
  offerId: string;
  sessionId: string;
  status: OfferStatus;
  /** ISO 8601, UTC. `createdAt + OFFER_TTL_SECONDS`. */
  expiresAt: string;
  teacher: TeacherCard;
  /** The price snapshotted onto the session, in credits per block. */
  pricePerBlock: number;
}

/**
 * One row in the teacher's incoming-offer modal — §13's `offer:new` payload,
 * and the shape `GET /sessions/:id` answers with for the teacher's side.
 *
 * `brief` is E3's `teacher_brief`, which is the student's own words when the
 * classifier fell back. It is shown, never re-summarised here.
 */
export interface IncomingOffer {
  offerId: string;
  sessionId: string;
  brief: string;
  topicLabel: string | null;
  level: number | null;
  /** What this offer is worth to the teacher after §5.3's commission. */
  expectedEarning: number;
  expiresAt: string;
}

// ── E6 ──────────────────────────────────────────────────────────────────────
// Frozen in docs/epics/E6-session-lifecycle/README.md § "Contract freeze", and copied
// here verbatim in PR 6.2 — the same arrangement 5.1 made, and for the same reason:
// one developer writes both consumers and they stay two consumers regardless. Changing
// anything below is a note in the PR **before** the code.
//
// Everything here ships before anything answers it. 6.3 fills `SessionState`, 6.4
// `SessionVideoResponse`, 6.5 `ExtendResponse`, 6.6 `ReviewRequest`; the five routes
// exist from this PR and answer 501 until each does. A payload decided once is what
// makes those four PRs consumers rather than four separate inventions of what a
// session looks like on the wire.
//
// The socket contract is not here. Event names live in `shared/socketEvents.js`,
// which is JavaScript because both sides import the values rather than the types.

/** `sessions.status`. Mirrors the Prisma enum; §10's diagram is the source. */
export type SessionStatus =
  'PENDING' | 'OFFER_SENT' | 'ACTIVE' | 'ENDED' | 'RATED' | 'CANCELLED' | 'NO_SHOW';

/** `sessions.end_reason`. Set on every transition into `ENDED` or `NO_SHOW`. */
export type SessionEndReason =
  'student_ended' | 'no_extension' | 'no_credit' | 'budget_cap' | 'teacher_no_show' | 'error';

/**
 * What `GET /sessions/:id` answers with once the session is `ACTIVE` or past it,
 * and what the session screen renders for **both** roles.
 *
 * One shape, two fillings. `role` tells the client which it got, and the fields the
 * other side may not see are `null` rather than absent — a missing key and a null
 * are indistinguishable to a renderer, and E5 already made the opposite call for
 * `offer:accepted`'s room URL, where the key is omitted entirely. The difference is
 * that there the absence was permanent and here it is per-caller.
 *
 * **`endsAt` is the only clock.** Absolute, server-issued, ISO 8601 UTC, recomputed
 * from on every tick. E5's countdown proved the pattern under a backgrounded tab and
 * a reload at second 30; this one is the same pattern with money behind it.
 */
export interface SessionState {
  sessionId: string;
  status: SessionStatus;
  role: 'student' | 'teacher';

  /** The other person. Never yourself. */
  counterpart: { userId: string; fullName: string; avatarUrl: string | null };

  brief: string;
  topicLabel: string | null;
  level: number | null;

  pricePerBlock: number;
  blocksUsed: number;
  totalCharged: number;
  budgetCap: number;

  /** Student only; `null` for the teacher. */
  balance: number | null;
  /** Teacher only; `null` for the student. Net of §5.3's commission. */
  teacherEarning: number | null;

  startedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  endReason: SessionEndReason | null;

  /** Whether a room exists. The URL and the token come from the video endpoint. */
  hasVideo: boolean;
  /** `true` once a review exists. The screen may not be left while this is false. */
  isRated: boolean;
}

/**
 * `GET /sessions/:id/video` — the seam, and the only way a client learns either value.
 *
 * **Minted per call and never cached server-side.** A token names one user and one
 * room and expires in an hour; two people in the same session get two different
 * tokens, and a page reload gets a third. Anything that stored one and handed it out
 * again would be the deleted `/video/access` endpoint wearing a different name.
 */
export interface SessionVideoResponse {
  roomUrl: string;
  token: string;
  /** ISO 8601, UTC. The token's expiry, not the session's. */
  expiresAt: string;
}

/** `POST /sessions/:id/extend` — one block. No body. */
export interface ExtendResponse {
  blocksUsed: number;
  endsAt: string;
  totalCharged: number;
  balance: number;
}

/** `POST /sessions/:id/review`. `stars` and `comment` are optional; `isResolved` is the KPI. */
export interface ReviewRequest {
  isResolved: boolean;
  stars?: number;
  comment?: string;
}

// ── E7 — money ──────────────────────────────────────────────────────────────
// Frozen in docs/epics/E7-wallet-billing/README.md § "Contract freeze". Changing
// anything below is a chat message to the other developer before the code changes.
//
// Opened whole by PR 7.2, including the shapes 7.3 and 7.6 implement. These
// declarations compile to nothing, so writing them before their endpoints exist
// costs nothing — and it means this file has one appended region for the whole
// epic rather than one per PR. E6a is appending to it in the same week, and every
// append at the end of the file is a place two branches conflict.

/** `wallet_transactions.type`. Mirrors the Prisma enum in prisma/schema/wallet.prisma. */
export type WalletTxType =
  'TOPUP' | 'SESSION_CHARGE' | 'REFUND' | 'TEACHER_EARNING' | 'PAYOUT' | 'PROMO';

/**
 * `GET /wallet` — credits and nothing else.
 *
 * **No minutes, and §12's "Balance + ≈ X minutes" cannot be honoured here.** Minutes
 * are a function of a teacher's price and this endpoint has no teacher — §5.4's own
 * example says "₪96 ≈ 40 minutes *with Dana*". `minutesFor` in
 * `client/src/lib/credits.js` owns that translation, floors it to whole blocks, and
 * takes `blockMinutes` from `GET /public/pricing` so the label cannot drift from the
 * billing. A second rounding computed server-side would sit beside the first on the
 * same screen.
 */
export interface WalletResponse {
  balance: number;
  /** ISO 8601, UTC. `wallets.updated_at`. */
  updatedAt: string;
}

/**
 * One ledger row.
 *
 * **`note` is not here and is not coming.** It is operator-facing text — see
 * `appendWalletTransaction` — and the client owns the sentence it renders from `type`.
 */
export interface WalletTransactionRecord {
  id: string;
  type: WalletTxType;
  /** Signed. Negative is money leaving the wallet. */
  amount: number;
  balanceAfter: number;
  /** Null for a top-up, which belongs to no session. */
  sessionId: string | null;
  createdAt: string;
}

/** `GET /wallet/transactions?page&pageSize`. Newest first. `total` is the whole ledger. */
export interface WalletTransactionsResponse {
  transactions: WalletTransactionRecord[];
  total: number;
}

/**
 * `POST /wallet/topup` — PR 7.3.
 *
 * **The client names a package, never an amount.** The value is looked up in
 * `TOPUP_PACKAGES` server-side, and a body that carries credits is a body that grants
 * them. The packages are already on the wire as `PublicPricingResponse.topupPackages`,
 * so there is no second representation to map through.
 */
export interface TopUpRequest {
  /** A member of `PublicPricingResponse.topupPackages`. Credits, and an allowlist. */
  packageId: number;
}

export interface TopUpResponse {
  balance: number;
  /** What was added. Echoed so the confirmation cannot disagree with the request. */
  credited: number;
  transactionId: string;
}

/** One row of `/teach/earnings` — PR 7.6. A finished session, from the teacher's side. */
export interface EarningRecord {
  sessionId: string;
  /** ISO 8601, UTC. `sessions.ended_at` — when the earning was credited. */
  endedAt: string;
  /** What the student paid. `sessions.total_charged`. */
  totalCharged: number;
  /** `sessions.platform_fee`. Zero in both of §5.3's free cases. */
  platformFee: number;
  /** `sessions.teacher_earning`. Positive. What the ledger row credited. */
  teacherEarning: number;
  /** The session's topic, for the row's label. Null if the question had none. */
  topicName: string | null;
}

/** `GET /wallet/earnings?page&pageSize`. Teacher-only. Newest first. */
export interface EarningsResponse {
  /** The teacher's own wallet balance — the same number `GET /wallet` answers. */
  balance: number;
  earnings: EarningRecord[];
  total: number;
  /** All-time, across every finished session — not just the page returned. */
  totals: { gross: number; fee: number; net: number };
}
