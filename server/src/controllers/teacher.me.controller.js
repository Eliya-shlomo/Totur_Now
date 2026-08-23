import { publishTeacherStatus } from '#services/presence.service.js';
import { getMyTopicStats, getTeacherMe, updateTeacherMe } from '#services/teacher.me.service.js';

/**
 * The teacher's own record — `GET` and `PATCH /teachers/me`, and since 8.5 their own
 * per-topic reputation at `GET /teachers/me/stats`.
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
 *
 * **PR 5.2 added the last two lines and changed nothing above them.** The status code,
 * the payload and the validation are what they were; `publishTeacherStatus` is a side
 * effect of a response that has already gone out. It is here rather than inside
 * `teacher.me.service.js` because that file is E2's and this PR opens no E2 service —
 * and the layering holds either way, since a controller calling a service is the
 * arrangement CONVENTIONS.md asks for.
 *
 * It runs **after** `res.json` and is not awaited, which is deliberate on both counts:
 * a teacher whose socket server is unwell still gets their 200, and
 * `publishTeacherStatus` returns void and reports its own failures, so there is no
 * promise here to leave unhandled.
 *
 * The status is read off the response body — the row as it now is, after the write —
 * rather than off `req.body`, which is a partial and says nothing about `status` on a
 * request that only changed a bio. That is also what makes the guard right: a `PATCH`
 * that did not touch availability broadcasts nothing.
 */
export async function patchMe(req, res) {
  const teacher = await updateTeacherMe(req.user.id, req.body);

  res.status(200).json({ success: true, data: teacher });

  if (req.body.status !== undefined) {
    publishTeacherStatus(req.user.id, teacher.status);
  }
}

/**
 * `GET /teachers/me/stats` — 200 `TeacherStatsResponse`. PR 8.5.
 *
 * A third handler on the `/me` mount, and it takes its teacher from `req.user.id` like
 * the two above: there is no id in the path, so there is nothing here to tamper with.
 *
 * The array can be empty and that is a 200, not a 404. A teacher with no
 * `teacher_topic_stats` rows has not been rated in any topic yet, which is every teacher
 * on their first day; the screen renders an empty state and the service's note says why
 * that is the honest answer.
 */
export async function getMyStats(req, res) {
  const stats = await getMyTopicStats(req.user.id);

  res.status(200).json({ success: true, data: stats });
}
