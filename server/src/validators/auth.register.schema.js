import { z } from 'zod';

import {
  EMAIL_MAX_LENGTH,
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  MATH_LEVELS,
  PASSWORD_MIN_LENGTH,
  STUDENT_GRADES,
} from '#config/constants/index.js';

/**
 * `POST /auth/register` — the request contract. PR 1.2, replacing 1.1's stub.
 *
 * The export name is fixed by the frozen `auth.routes.js`, which already wires
 * `validate(registerSchema)`. Body only: this POST has no params, and a query
 * string on a registration is noise.
 *
 * Two decisions here matter more than the field list.
 *
 * **`admin` is not a value this endpoint can produce.** The union below has two
 * members and neither of them is `admin`, so the rejection is structural rather
 * than a check somebody could delete during a refactor without noticing. `UserRole`
 * has three values; this endpoint mints two, and the third is made by a human with
 * database access.
 *
 * **Email is normalised here, not in the service.** Postgres unique indexes are
 * case-sensitive, so `A@b.com` and `a@b.com` are two rows and one of them can never
 * log in. Lowercasing at the edge makes storage and lookup agree by construction —
 * which holds only as long as 1.4's login schema does the same thing, and that is
 * the one line in this file that is a cross-PR contract.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(EMAIL_MAX_LENGTH);

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`);

const fullName = z
  .string()
  .trim()
  .min(FULL_NAME_MIN_LENGTH, 'Enter your full name.')
  .max(FULL_NAME_MAX_LENGTH);

/** Shared by both members of the union below. */
const credentials = { email, password, fullName };

/**
 * A student may declare grade and level; both are optional, because a student who
 * has not decided yet should not be stopped at the door. They sharpen matching
 * (§9.1) rather than gate it.
 */
const student = z
  .object({
    ...credentials,
    role: z.literal('student'),
    grade: z
      .number()
      .int()
      .refine((value) => STUDENT_GRADES.includes(value), {
        message: `Grade must be one of ${STUDENT_GRADES.join(', ')}.`,
      })
      .optional(),
    mathLevel: z
      .number()
      .int()
      .refine((value) => MATH_LEVELS.includes(value), {
        message: `Level must be one of ${MATH_LEVELS.join(', ')}.`,
      })
      .optional(),
  })
  .strict();

/**
 * A teacher sends credentials and nothing else. Price, level and topics are set
 * afterwards from the teacher's own screens (E2) — signup is deliberately the
 * shortest form in the product (§6.1), and `.strict()` is what stops a client from
 * slipping `pricePerBlock` in here, where nothing would bound it.
 */
const teacher = z
  .object({
    ...credentials,
    role: z.literal('teacher'),
  })
  .strict();

export const registerSchema = z.object({
  // Discriminated on `role`, so a wrong role is reported as one clear error on the
  // `role` field rather than as every branch's failures at once. `admin` produces
  // "Invalid discriminator value" against `role`, which `fieldErrors()` hands to the
  // client as an error on the role input.
  body: z.discriminatedUnion('role', [student, teacher]),
});
