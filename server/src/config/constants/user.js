import { TEACHING_LEVELS } from './teacher.js';

/**
 * Users and their profiles. MVP.md §11.2 "USERS", §6.1.
 *
 * The column widths below are not cosmetic — they are the `@db.VarChar` sizes in
 * `prisma/schema/users.prisma`. Validation that allows a longer string than the
 * column accepts turns a 400 the user can fix into a 500 they cannot.
 */

/** `users.email` is `VarChar(255)`. */
export const EMAIL_MAX_LENGTH = 255;

/** `users.full_name` is `VarChar(100)`. */
export const FULL_NAME_MAX_LENGTH = 100;

/**
 * Short enough for a mononym, long enough to reject an empty-looking name made of
 * one character. Trimming happens before this is checked.
 */
export const FULL_NAME_MIN_LENGTH = 2;

/** Israeli high school. MVP.md §2 — the product exists for the Bagrut years. */
export const STUDENT_GRADES = [10, 11, 12];

/**
 * Bagrut units, the scale a student's `math_level` is expressed in.
 *
 * Deliberately an alias rather than a second array: this is the same scale a
 * teacher declares as their ceiling (`TEACHING_LEVELS`, §6.1), and the matching
 * hard filter in E4 compares one against the other. Two literals that must always
 * hold the same values are two literals that will eventually not.
 */
export const MATH_LEVELS = TEACHING_LEVELS;
