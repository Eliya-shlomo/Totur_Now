/**
 * Wraps an async controller so a rejected promise reaches the error middleware.
 *
 * Express 4 does not catch async rejections — without this an awaited failure
 * becomes an unhandled rejection and the request hangs until it times out, which
 * looks like a network problem rather than the bug it is.
 *
 * Every controller is wrapped. No exceptions. MVP.md §15.3.
 *
 *   router.post('/', validate(schema), asyncHandler(controller.create));
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
