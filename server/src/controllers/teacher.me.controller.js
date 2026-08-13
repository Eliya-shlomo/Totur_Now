import { getTeacherMe, updateTeacherMe } from '#services/teacher.me.service.js';

/**
 * The teacher's own record — `GET` and `PATCH /teachers/me`.
 *
 * The two export names are the contract with the frozen `teacher.routes.js` (PR 2.1);
 * 2.2 replaced the stub bodies and left the names alone, which is the whole trick that
 * PR was buying — the route, the middleware chain and the validator were already wired,
 * so this landed without opening a shared file.
 *
 * No database access and no decisions (CONVENTIONS.md → Server layering): each handler
 * calls one service function and writes the envelope.
 *
 * **There is no ownership parameter and there will not be one.** The teacher being read
 * or written is always `req.user.id` — never an id from the path, the body or the query.
 * `authenticate` + `authorize('teacher')` in the router is what makes that safe, and
 * `PATCH /teachers/:id` does not exist.
 */

/**
 * `GET /teachers/me` — 200 `TeacherMeResponse`.
 *
 * The stepper's source of truth for which steps are already done, so it has to be right
 * on a brand-new teacher whose row is registration defaults and nothing else.
 * `onboardingComplete` is computed in 2.1's serializer, here and in no second place.
 */
export async function getMe(req, res) {
  const teacher = await getTeacherMe(req.user.id);

  res.status(200).json({ success: true, data: teacher });
}

/**
 * `PATCH /teachers/me` — 200, the updated record in the shape `GET` returns.
 *
 * The full record rather than 204, so 2.4's stepper can re-render from the response
 * instead of following every step with a `GET` — including `onboardingComplete`, which
 * is the value the last step is waiting on.
 *
 * `req.body` is what `validate(teacherUpdateSchema)` wrote back: coerced, stripped, and
 * guaranteed non-empty. An empty body never reaches here.
 */
export async function patchMe(req, res) {
  const teacher = await updateTeacherMe(req.user.id, req.body);

  res.status(200).json({ success: true, data: teacher });
}
