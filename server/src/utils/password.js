import bcrypt from 'bcrypt';
import { BCRYPT_ROUNDS } from '#config/constants/auth.js';

/**
 * Password hashing. The only place bcrypt is imported.
 *
 * Lives in PR 0.3 rather than in E1 on purpose: the register slice (1.2) and the
 * login slice (1.4) are owned by different developers, and both need this. Creating
 * it here means neither has to, so neither collides with the other.
 */

export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * A bcrypt hash of a throwaway value, used to burn the same CPU time on the
 * user-not-found path as on a real comparison.
 *
 * Without it, login answers noticeably faster for an unknown email than for a
 * wrong password, and that timing difference is an account-enumeration oracle —
 * which is what makes PR 1.4's "identical response" requirement actually true
 * rather than only true of the response body.
 */
const DUMMY_HASH = bcrypt.hashSync('tutornow-timing-equalizer', BCRYPT_ROUNDS);

export function burnPasswordComparison() {
  return bcrypt.compare('tutornow-timing-equalizer', DUMMY_HASH);
}
