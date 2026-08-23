import { FIRST_PAGE } from '#config/constants/index.js';
import {
  countUnratedStudentSessions,
  findStudentSessionPage,
} from '#repositories/session.repository.js';
import { toSessionHistoryRecord } from '#utils/sessionView.js';

/**
 * The student's own history — `GET /sessions/mine`, PR 8.4, MVP.md §14.1.
 *
 * **The student has run sessions since E6 and has had no way to look at one afterwards.**
 * The sidebar has linked to `/app/history` since 1.5 and it has been a placeholder since.
 * This service is the read behind that screen.
 *
 * **It reads and it writes nothing.** No `tx` anywhere on this path, no transaction
 * opened, and the two repository functions it calls are the only two reads in
 * `session.repository.js` that take no transaction. A history is one snapshot of rows
 * that have already reached a terminal state; there is nothing here to be consistent
 * with.
 *
 * **The endpoint is `GET /sessions/mine` and §12 says `GET /students/me/sessions`.** That
 * deviation is E8's README's, made twice: there is no `/students` router in
 * `routes/index.js` and there never has been, and creating one for a single endpoint
 * means creating a `student.repository.js` whose only job is reading the `sessions` table.
 * That is precisely the move E7 refused when it put `GET /wallet/earnings` on the wallet
 * router rather than on `/teachers/me`, for the reason that applies unchanged here: the
 * read belongs to the router that owns the table.
 *
 * **This is the student's list and the teacher's already exists.** A teacher's finished
 * sessions are `GET /wallet/earnings` (7.6), which carries the money that side needs —
 * gross, fee and net. One endpoint answering both roles would be one serializer with a
 * role branch inside it, and the two rows overlap in everything except the money, which
 * is the half either reader came for.
 */

/** 8.4's two reads. See the note on the function below. */
const historyDeps = {
  loadSessions: findStudentSessionPage,
  countUnrated: countUnratedStudentSessions,
};

/**
 * One page of this student's finished sessions, plus the badge's number.
 *
 * **`unratedCount` is a second query rather than a count over the page**, and that is the
 * one arithmetic decision in this file. The client holds one page; the badge on the
 * sidebar is about the whole set. Derived from the page it would read 1 until the student
 * paged and then read 2, which is worse than no badge — a number that changes as you
 * navigate teaches the reader to ignore it.
 *
 * The two reads are issued together rather than in sequence. They are independent and
 * neither is a condition of the other: there is no id to check, no ownership question to
 * settle first, and nothing to refuse. That is the difference from `listTeacherReviews`,
 * which reads the teacher *before* the reviews on purpose, because an id that is not a
 * teacher's must never reach the review query at all. Here both queries are already
 * filtered by the caller's own id.
 *
 * **There is no id in the path and therefore nothing to tamper with.** `studentId` comes
 * from the verified token and is a `where` on both queries, so another student's sessions
 * are not refused — they are never selected. `authorize('student')` on the route is what
 * keeps a teacher's token off this list; a teacher who reached it would get their own
 * `student_id` rows, of which there are none, and an empty history is a worse answer than
 * a `403` because it looks like a working screen.
 *
 * `total` is the unpaged count of the history set, so a client that hit the `pageSize`
 * cap can tell it did not receive everything. It is deliberately **not** the same number
 * as `unratedCount`'s set: `total` counts every finished session and `unratedCount` counts
 * the `ENDED` ones with no review, which is a subset of it.
 *
 * **The two reads arrive through the second argument** — 3.3's idiom, which is what lets
 * the test assert the offset handed to the repository is `(page - 1) × pageSize` rather
 * than `page × pageSize`. That arithmetic is invisible on a seeded database, where every
 * student's whole history fits on one page.
 *
 * @param {object} query
 * @param {string} query.studentId from the verified token
 * @param {number} query.page      1-based
 * @param {number} query.pageSize  already capped at `MAX_PAGE_SIZE`
 * @param {typeof historyDeps} [deps]
 * @returns {Promise<import('@tutor/shared').SessionHistoryResponse>}
 */
export async function getStudentSessionHistory({ studentId, page, pageSize }, deps = historyDeps) {
  const { loadSessions, countUnrated } = { ...historyDeps, ...deps };

  const [{ sessions, total }, unratedCount] = await Promise.all([
    loadSessions({
      studentId,
      skip: (page - FIRST_PAGE) * pageSize,
      take: pageSize,
    }),
    countUnrated(studentId),
  ]);

  return { sessions: sessions.map(toSessionHistoryRecord), total, unratedCount };
}
