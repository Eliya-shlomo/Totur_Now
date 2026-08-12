import { DEFAULT_LEVEL_MAX, DEFAULT_PRICE_PER_BLOCK } from '#config/constants/index.js';
import { prisma } from '#config/db.js';

/**
 * User reads and writes. Created in PR 1.2 for registration.
 *
 * `AUTH_USER_FIELDS` is exported rather than inlined because 1.4's login and `me`
 * must return the same user object this endpoint does — the epic's stated risk is
 * two endpoints whose user shapes differ by one field, and one shared selection is
 * the cheapest way for that to be impossible rather than merely checked.
 */

/**
 * The columns that may leave the server as a user object — `AuthUser` in
 * `shared/api.d.ts`.
 *
 * An explicit `select`, never `omit` and never a spread-and-delete in a service.
 * The difference is what happens when somebody adds a column: with `select`, a new
 * `password_reset_token` is invisible until a human adds it here, and with the
 * alternatives it ships to the client the moment the migration lands. The one
 * field this exists to keep in the database is `passwordHash`.
 */
export const AUTH_USER_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  avatarUrl: true,
};

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
