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
