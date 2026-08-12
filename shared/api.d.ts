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
