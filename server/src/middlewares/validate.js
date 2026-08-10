import { AppError } from '#utils/AppError.js';
import { fieldErrors } from '#utils/fieldErrors.js';

/**
 * Runs a Zod schema against the request. MVP.md §16 — every endpoint gets one,
 * including the ones that "obviously can't fail".
 *
 * The schema describes the parts it cares about:
 *
 *   const registerSchema = z.object({
 *     body: z.object({ email: z.string().email(), password: z.string().min(8) }),
 *   });
 *
 * Parsed output is written back onto the request, so controllers receive coerced,
 * defaulted, stripped values rather than raw strings — `req.query.page` arrives as
 * a number if the schema says so.
 */
export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      return next(AppError.validation('Some fields need fixing.', fieldErrors(result.error)));
    }

    if (result.data.body !== undefined) req.body = result.data.body;
    if (result.data.params !== undefined) req.params = result.data.params;
    // req.query is a getter-only property on Express 5; defined rather than assigned
    // so this keeps working if the project upgrades. `configurable` and `enumerable`
    // are explicit: both default to false, which would make a second validate() on
    // the same route throw "Cannot redefine property" and would hide query from any
    // dump of the request.
    if (result.data.query !== undefined) {
      Object.defineProperty(req, 'query', {
        value: result.data.query,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    return next();
  };
}
