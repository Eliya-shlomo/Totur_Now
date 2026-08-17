import { prisma, log } from './helpers.js';
import { UNCLASSIFIED } from './topics.js';

/**
 * Two demo questions, each with the `PENDING` session E5 sends an offer on.
 *
 * **This was E4's filler item F5, and it lands inside PR 5.1 rather than as filler.**
 * E4's retro concluded that work without a position in the order table does not get
 * done — F1 through F5 were carried for four epics — and E5 has one developer and no
 * filler slot to hide them in. It is here because a blocking PR that leaves the epic
 * untestable is not blocking enough: every PR in E5 starts from a question, and
 * without these two, testing 5.3 means typing a question and spending a Gemini call
 * first. The classifier is currently down, so it would mean the fallback path every
 * time.
 *
 * The two are chosen to be the two shapes E5 has to handle:
 *
 *   · Avi's is fully classified — a real subtopic, `estimated_level` 5 — and it is
 *     the one that produces a ranked pool on `integration-by-parts`, which is where
 *     the seeded teachers have their deliberate Bayesian history (§18's criterion)
 *   · Noya's is on the sentinel, `classification_ok false`, which is what E3 writes
 *     when the classifier fails. §9.1's topic filter passes everybody on it, so it is
 *     the case where the pool is wide and the brief is the student's own words
 *
 * **Both briefs are written by hand**, because 5.6's email and 5.7's modal both
 * render `teacher_brief` and an empty one makes both look broken while the classifier
 * is down.
 *
 * **Idempotent, like the rest of the seed, but not by `upsert`.** `questions` has no
 * unique column other than its id, and the seed never assigns ids (CONVENTIONS.md §
 * Database), so there is no business key to upsert on. The stable key is instead the
 * pair (owner, raw text) — a lookup, then an update or a create. The session is a
 * real `upsert`, because `sessions.question_id` *is* `@unique`. Run the seed twice
 * and there are still exactly two questions and two `PENDING` sessions.
 */

const DEMO_QUESTIONS = [
  {
    studentEmail: 'avi.student@demo.tutornow.il',
    topicSlug: 'calculus-integrals',
    subtopicSlug: 'integration-by-parts',
    rawText:
      'אני מנסה לפתור ∫x·ln(x)dx בשיטת אינטגרציה בחלקים ולא מצליח להחליט מה לקחת בתור u ומה בתור dv. ניסיתי u=x ויצא לי משהו יותר מסובך.',
    title: 'Integration by parts — choosing u and dv',
    declaredLevel: 5,
    difficulty: 3,
    estimatedLevel: 5,
    llmConfidence: 0.92,
    classificationOk: true,
    teacherBrief:
      'Student is working on ∫x·ln(x)dx and cannot decide which factor to take as u. They tried u=x, which pushes the problem the wrong way. They need the LIATE reasoning for why the logarithm is the one to differentiate, and then one worked line to see it come out.',
    studentConfirmation:
      'Looks like you are working on integration by parts at the 5-unit level. Correct?',
  },
  {
    studentEmail: 'noya.student@demo.tutornow.il',
    // The sentinel. `topic_id = 0`, no subtopic, no level — what E3 writes when the
    // classifier fails or comes back under MIN_CONFIDENCE.
    topicSlug: UNCLASSIFIED.slug,
    subtopicSlug: null,
    rawText:
      'יש לי מבחן מחר על כל החומר של הסמסטר ואני לא מבינה שאלה 4 בדף התרגול, זו שאלה עם גרף ומשיק. אפשר עזרה?',
    title: null,
    declaredLevel: 4,
    difficulty: null,
    estimatedLevel: null,
    llmConfidence: 0,
    classificationOk: false,
    // On the fallback path E3 writes the student's own words as the brief. Written
    // out here rather than copied from `rawText` in code, so the fixture shows a
    // teacher what they will actually be shown.
    teacherBrief:
      'יש לי מבחן מחר על כל החומר של הסמסטר ואני לא מבינה שאלה 4 בדף התרגול, זו שאלה עם גרף ומשיק. אפשר עזרה?',
    studentConfirmation: 'We could not classify this automatically — a teacher will read it as is.',
  },
];

/**
 * @param {Record<string, number>} topicIdBySlug from `seedTopics()`
 */
export async function seedQuestions(topicIdBySlug) {
  for (const demo of DEMO_QUESTIONS) {
    const student = await prisma.user.findUnique({ where: { email: demo.studentEmail } });

    if (!student) {
      // Ordering, not a data problem: `seedStudents()` runs before this. Loud rather
      // than a silent skip, because a seed that quietly produces one question instead
      // of two looks like a matching bug an hour later.
      throw new Error(`No seeded student with email ${demo.studentEmail} — seed students first.`);
    }

    const fields = {
      title: demo.title,
      topicId: topicIdBySlug[demo.topicSlug],
      subtopicId: demo.subtopicSlug === null ? null : topicIdBySlug[demo.subtopicSlug],
      declaredLevel: demo.declaredLevel,
      difficulty: demo.difficulty,
      estimatedLevel: demo.estimatedLevel,
      teacherBrief: demo.teacherBrief,
      studentConfirmation: demo.studentConfirmation,
      llmConfidence: demo.llmConfidence,
      classificationOk: demo.classificationOk,
      // Reset on every run. A demo where Dana was rejected yesterday and is missing
      // from today's list is a matching bug that takes an hour to not find.
      rejectedBy: [],
    };

    // The stable key, standing in for the `upsert` this table cannot have.
    const existing = await prisma.question.findFirst({
      where: { studentId: student.id, rawText: demo.rawText },
      select: { id: true },
    });

    const question = existing
      ? await prisma.question.update({ where: { id: existing.id }, data: fields })
      : await prisma.question.create({
          data: { studentId: student.id, rawText: demo.rawText, ...fields },
        });

    // `question_id` is `@unique` on `sessions`, so this one is a real upsert. Reset to
    // `PENDING` with the offer-time columns cleared: a re-run after a demo has to
    // undo whatever the demo did, or the second run of the seed leaves a session that
    // is still `ACTIVE` from the last one and E5 refuses to send an offer on it.
    await prisma.session.upsert({
      where: { questionId: question.id },
      update: {
        status: 'PENDING',
        teacherId: null,
        pricePerBlock: null,
        startedAt: null,
        endsAt: null,
        endedAt: null,
        endReason: null,
      },
      create: {
        questionId: question.id,
        studentId: student.id,
        status: 'PENDING',
      },
    });

    // Offers reference the session, so any left over from a demo would survive as
    // rows pointing at a session that has been reset. Deleted rather than expired:
    // these describe a demo history that never happened, the same argument
    // `setWallet` makes for rewriting the ledger.
    await prisma.offer.deleteMany({ where: { session: { questionId: question.id } } });
  }

  log(`${DEMO_QUESTIONS.length} demo questions, each with a PENDING session`);
}

export { DEMO_QUESTIONS };
