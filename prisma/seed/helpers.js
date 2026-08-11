import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../../server/src/utils/password.js';

/**
 * Shared plumbing for the seed.
 *
 * The password hash comes from the server's own `password.js` rather than a local
 * bcrypt call, so seeded users are hashed at exactly the cost factor login expects.
 * A seed that hashes differently produces users who cannot log in, and the failure
 * looks like an auth bug rather than a seed bug.
 *
 * That import reaches across workspaces by relative path, which the rest of the
 * repo never does (CONVENTIONS.md § Module resolution). It works because Node
 * resolves `#config/...` inside password.js against *its own* package.json, not the
 * importer's — and the alternative, a second bcrypt call site, is the thing the
 * server's own comment says not to create.
 */

export const prisma = new PrismaClient();

/**
 * One password for every demo account. Documented here and in the PR brief so a
 * demo never stalls on a forgotten login.
 */
export const SEED_PASSWORD = 'TutorNow!2026';

let cachedHash = null;

/** Hashes once. bcrypt at cost 12 is ~250ms — twenty of those is a visibly slow seed. */
export async function seedPasswordHash() {
  cachedHash ??= await hashPassword(SEED_PASSWORD);
  return cachedHash;
}

/**
 * Creates or updates a user by email — the stable business key, since the seed
 * never assigns an id.
 *
 * `profile` and `wallet` are applied by the caller afterwards rather than nested
 * here, so this stays the one function that knows how a user is identified.
 */
export async function upsertUser({ email, fullName, role }) {
  const passwordHash = await seedPasswordHash();

  return prisma.user.upsert({
    where: { email },
    update: { fullName, role, passwordHash, isActive: true },
    create: { email, fullName, role, passwordHash },
  });
}

/**
 * Sets a wallet to `balance` and makes the ledger say the same thing.
 *
 * The invariant from MVP.md §11.3 is that a wallet's balance equals the sum of its
 * transactions, and it is checked by a reconciliation query the seed must not fail.
 * So the ledger is rewritten rather than appended to on a re-run: seeded rows are
 * fixtures, and two runs must not produce twice the money.
 *
 * This is the **only** place in the codebase that deletes from `wallet_transactions`
 * (CONVENTIONS.md: the ledger is append-only). It is legitimate here and nowhere
 * else, because these rows describe a demo history that never happened.
 */
export async function setWallet(userId, balance, note) {
  await prisma.walletTransaction.deleteMany({ where: { userId } });
  await prisma.wallet.upsert({
    where: { userId },
    update: { balance },
    create: { userId, balance },
  });

  if (balance > 0) {
    await prisma.walletTransaction.create({
      data: { userId, type: 'TOPUP', amount: balance, balanceAfter: balance, note },
    });
  }
}

/**
 * Flips a seeded teacher online, for demoing matching without waiting for one.
 *
 *   node --input-type=module -e "import('./prisma/seed/helpers.js').then(m =>
 *     m.setTeacherOnline('dana.k@demo.tutornow.il').then(() => m.prisma.$disconnect()))"
 *
 * @param {string} email
 * @param {'ONLINE'|'OFFLINE'} [status]
 */
export async function setTeacherOnline(email, status = 'ONLINE') {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No seeded user with email ${email}`);

  await prisma.teacherProfile.update({
    where: { userId: user.id },
    data: { status, lastSeenAt: new Date() },
  });

  return `${email} is now ${status}`;
}

/** Seed output. Kept deliberately plain — this runs in CI logs as often as a terminal. */
export function log(message) {
  console.log(`  ${message}`);
}
