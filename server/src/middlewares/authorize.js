import { AppError } from '#utils/AppError.js';

/**
 * Role gate. `authorize('teacher')`, `authorize('student', 'admin')`. MVP.md §15.5.
 *
 * **Human-written, no agent** (MVP.md §17.5). Always after `authenticate` — it reads
 * `req.user` and never verifies anything itself:
 *
 *   router.get('/earnings', authenticate, authorize('teacher'), asyncHandler(earnings));
 *
 * Roles are the lowercase values of the `UserRole` enum in `prisma/schema/users.prisma`
 * — `student`, `teacher`, `admin` — compared exactly. No case folding and no aliases:
 * a typo like `authorize('Teacher')` must fail closed and be caught the first time the
 * route is called, rather than quietly matching.
 *
 * There is no implicit admin bypass. A route an admin may call lists `'admin'`
 * itself. An invisible "admin passes everything" rule means the set of endpoints an
 * admin can reach is not readable from the routers, which is the one place a
 * reviewer looks.
 */
export function authorize(...roles) {
  return function requireRole(req, res, next) {
    // Missing `req.user` means `authenticate` did not run before this — a wiring
    // mistake, not a permission problem. `UNAUTHORIZED` rather than `FORBIDDEN`
    // because "we do not know who you are" is the honest answer, and a 403 here
    // would send a logged-in-looking client (1.5) chasing a role it does not have
    // instead of a session it never established.
    if (!req.user) {
      throw AppError.unauthorized();
    }

    if (!roles.includes(req.user.role)) {
      throw AppError.forbidden();
    }

    next();
  };
}
