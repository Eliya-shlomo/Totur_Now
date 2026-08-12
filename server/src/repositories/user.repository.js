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
 * This file was created by 1.4 rather than 1.2 only because 1.4 was written first —
 * 1.2's brief names it as DEV-A's. The registration section below is left empty and
 * marked, so that when 1.2 lands its functions go into a block nothing else touches.
 *
 * Every query here uses an explicit `select`. Not a style preference: a column added
 * to `users` in a later epic must not silently start appearing in an auth response,
 * and `passwordHash` is precisely the column that would.
 */

// ── registration — PR 1.2, DEV-A ─────────────────────────────────────────────
// Intentionally empty. Add registration's functions here, not below.

// ── the session flow — PR 1.4, DEV-B ─────────────────────────────────────────

/**
 * The columns every auth response returns — `AuthUser` in `shared/api.d.ts`.
 *
 * Written once and spread into the queries that build a response, because the
 * epic README lists "1.2 and 1.4 return user objects that differ by one field" as
 * a risk of this epic. A shared constant makes login and `/auth/me` structurally
 * unable to disagree, and `passwordHash` is absent from it by construction.
 */
const AUTH_USER_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  avatarUrl: true,
};

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
