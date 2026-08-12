import { DEFAULT_LEVEL_MAX, DEFAULT_PRICE_PER_BLOCK } from '#config/constants/index.js';
import { prisma } from '#config/db.js';

/**
 * User reads and writes. `users`, `student_profiles`, `teacher_profiles` and the
 * wallet as it hangs off a user — MVP.md §11.2.
 *
 * **The one genuinely shared file in E1.** PR 1.2 (DEV-A, registration) and PR 1.4
 * (DEV-B, the session flow) both live here. The rule from both briefs: append your
 * functions in your own section, never reorganize the other's. Appended blocks merge
 * cleanly; moved ones do not.
 *
 * Every query here uses an explicit `select`. Not a style preference: a column added
 * to `users` in a later epic must not silently start appearing in an auth response,
 * and `passwordHash` is precisely the column that would.
 */

/**
 * The columns every auth response returns — `AuthUser` in `shared/api.d.ts`.
 *
 * Written once and spread into the queries that build a response, because the
 * epic README lists "1.2 and 1.4 return user objects that differ by one field" as
 * a risk of this epic. A shared constant makes registration, login and `/auth/me`
 * structurally unable to disagree, and `passwordHash` is absent from it by
 * construction.
 *
 * An explicit `select`, never `omit` and never a spread-and-delete in a service.
 * The difference is what happens when somebody adds a column: with `select`, a new
 * `password_reset_token` is invisible until a human adds it here, and with the
 * alternatives it ships to the client the moment the migration lands.
 *
 * Exported because it is shared across both sections below.
 */
export const AUTH_USER_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  avatarUrl: true,
};

// ── registration — PR 1.2, DEV-A ─────────────────────────────────────────────

/**
 * Creates a user, their role profile and their wallet — all three or none.
 *
 * **The transaction is the point of this function.** A user without a wallet
 * passes registration and then fails the "can afford the opening block" filter in
 * E4 (MVP.md §9.1) with a null balance, several screens and several days away from
 * the code that caused it. Three sequential awaits would produce exactly that row
 * every time the process died between the first and the third.
 *
 * It lives in the repository rather than the service because `prisma.$transaction`
 * is Prisma, and CONVENTIONS.md puts every line of Prisma behind this layer. The
 * service still decides that registration is atomic; this decides how.
 *
 * No teacher default is written as a literal (a review item in the brief):
 * `pricePerBlock` and `levelMax` come from the constants folder, and `status` and
 * `balance` are left to the schema defaults — `OFFLINE` and `0` are declared in
 * `prisma/schema/`, and repeating them here would be a second copy free to drift
 * from the migration.
 *
 * @param {{ email: string, passwordHash: string, fullName: string,
 *          role: 'student' | 'teacher', grade?: number, mathLevel?: number }} input
 * @returns {Promise<object>} the created user, `AUTH_USER_FIELDS` only
 * @throws {import('@prisma/client').Prisma.PrismaClientKnownRequestError} P2002 on a duplicate email
 */
export async function createUserWithProfileAndWallet({
  email,
  passwordHash,
  fullName,
  role,
  grade,
  mathLevel,
}) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      // `id` is deliberately absent: `gen_random_uuid()` is the column default and
      // the database assigns it (CONVENTIONS.md → Database).
      data: { email, passwordHash, fullName, role },
      select: AUTH_USER_FIELDS,
    });

    if (role === 'student') {
      await tx.studentProfile.create({
        // `?? null` rather than leaving them undefined: both columns are nullable,
        // and writing the null is what makes "the student did not say" a stored
        // fact instead of an absent one.
        data: { userId: user.id, grade: grade ?? null, mathLevel: mathLevel ?? null },
      });
    } else {
      await tx.teacherProfile.create({
        data: {
          userId: user.id,
          pricePerBlock: DEFAULT_PRICE_PER_BLOCK,
          levelMax: DEFAULT_LEVEL_MAX,
        },
      });
    }

    await tx.wallet.create({ data: { userId: user.id } });

    return user;
  });
}

// ── the session flow — PR 1.4, DEV-B ─────────────────────────────────────────

/**
 * The login lookup: the public fields, plus the two the login path needs and no
 * response may ever contain — `passwordHash` and `isActive`.
 *
 * **This is the only query in the codebase that selects `passwordHash`.** That is
 * worth keeping true: `grep passwordHash server/src` should return this file, the
 * hashing utility, and the registration insert. The service that calls this drops
 * both extra fields before returning, so the hash never leaves the service layer.
 *
 * `findUnique` on the unique `email` column. The caller has already normalised the
 * address (`auth.session.schema.js`) — no `mode: 'insensitive'` here, because that
 * would make the query miss the unique index and scan.
 *
 * @param {string} email  normalised: trimmed and lowercased
 * @returns {Promise<{id: string, email: string, fullName: string, role: string,
 *   avatarUrl: string|null, passwordHash: string, isActive: boolean}|null>}
 */
export async function findUserForLogin(email) {
  return prisma.user.findUnique({
    where: { email },
    select: { ...AUTH_USER_FIELDS, passwordHash: true, isActive: true },
  });
}

/**
 * The three fields `POST /auth/refresh` needs to decide whether to keep the session
 * alive: who the user is, what role to sign into the new token, and whether they are
 * still allowed in.
 *
 * `role` is read from the database rather than carried over from the old token's
 * claim, so a role corrected in the database reaches the client within one refresh
 * instead of within seven days.
 *
 * `authenticate.js` explains why this query lives on the refresh path and not in the
 * middleware: on every authenticated request it would be a query per request, whereas
 * here it runs once per access-token lifetime and is what makes E9's "block a user"
 * actually take effect (§15.5).
 *
 * @param {string} id
 * @returns {Promise<{id: string, role: string, isActive: boolean}|null>}
 */
export async function findUserSessionById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, isActive: true },
  });
}

/**
 * Everything `GET /auth/me` returns, in one round trip — the user, whichever profile
 * their role has, and the wallet balance.
 *
 * One query rather than three, because this is the client's single source of truth
 * for the current user (epic README) and it is called on every page load. Both
 * profiles are selected unconditionally: they are one-to-one relations, the absent
 * one comes back `null`, and branching the query on role would put a rule about
 * response shape into the repository — the service decides which of them to emit.
 *
 * `wallet` is selected down to `balance` alone. The row also carries `updatedAt`,
 * which is bookkeeping the client has no use for.
 *
 * @param {string} id
 */
export async function findUserWithProfile(id) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      ...AUTH_USER_FIELDS,
      studentProfile: {
        select: { grade: true, mathLevel: true, school: true },
      },
      teacherProfile: {
        select: { bio: true, pricePerBlock: true, levelMax: true, status: true },
      },
      wallet: { select: { balance: true } },
    },
  });
}
