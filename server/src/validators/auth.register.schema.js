import { z } from 'zod';

/**
 * Zod schema for `POST /auth/register`. **Placeholder — DEV-A writes the real one
 * in PR 1.2**, in this file, replacing what is below.
 *
 * It exists now, empty, for one reason: `auth.routes.js` is frozen after PR 1.1 and
 * already wires `validate(registerSchema)` onto the route. Without this file the
 * server would not boot, and adding the schema later would mean editing the frozen
 * router — which is the collision this whole PR was written to prevent.
 *
 * The export name is therefore part of the contract. Change the body of
 * `registerSchema`; do not rename it, and do not add a second export that the route
 * does not call.
 *
 * What 1.2 puts here (from its brief): email, password with `PASSWORD_MIN_LENGTH`
 * from `#config/constants/index.js`, full name, `role` restricted to
 * `student | teacher` — `admin` rejected — and the student-only `grade` / `mathLevel`.
 */

/**
 * Passes the request through untouched.
 *
 * `z.unknown()` rather than `z.object({}).passthrough()` on purpose: `validate()`
 * writes the parsed result back onto the request, and an object schema would strip
 * every key it does not declare. A stub that silently emptied `req.body` would make
 * 1.2's first controller look broken for a reason nobody would look for here.
 */
export const registerSchema = z.object({
  body: z.unknown(),
  params: z.unknown(),
  query: z.unknown(),
});
