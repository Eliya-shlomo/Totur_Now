import { getTeacherCard, getTeacherList } from '#services/teacher.public.service.js';

/**
 * What a student sees about a teacher — `GET /teachers` and `GET /teachers/:id`.
 *
 * No authentication on either route, deliberately: a stranger reads a teacher's
 * profile before deciding whether to register. That is also why the payload is
 * `toTeacherCard` and not `toTeacherMe` — no email, no `status`, no counter beyond
 * the rating pair.
 *
 * Controllers read the request and write the response (CONVENTIONS.md → Server
 * layering), so both handlers below are a call and a send. The filter translation,
 * the band ceiling and the `NOT_FOUND` all live in `teacher.public.service.js`.
 *
 * **No `Cache-Control` here**, unlike `public.controller.js`. That surface is
 * taxonomy and money — data that changes on a deploy — and is cached at the edge for
 * `PUBLIC_CACHE_SECONDS`. A teacher list changes every time somebody goes online,
 * and caching it would serve a stale roster for the rest of the day.
 */

/**
 * `GET /teachers` — the filtered, paged public list.
 *
 * `req.query` is already coerced, defaulted and capped by `teacherListSchema`, so it
 * is handed to the service whole rather than picked apart here.
 */
export async function listTeachers(req, res) {
  res.json({ success: true, data: await getTeacherList(req.query) });
}

/**
 * `GET /teachers/:id` — one card.
 *
 * The card is `data` itself, not `{ teacher }`, matching `GET /teachers/me` and
 * `GET /auth/me`: a single-resource read returns the resource.
 */
export async function getTeacherById(req, res) {
  res.json({ success: true, data: await getTeacherCard(req.params.id) });
}
