import { prisma, upsertUser, setWallet, log } from './helpers.js';
import { PARENT_OF } from './topics.js';

/**
 * 15 demo teachers. The distribution is the deliverable, not the count.
 *
 * Every number here exists to make something in the algorithm visible:
 *
 *   · all four standing badges (MVP.md §6.2) — including the two cases that prove
 *     the rule: 110 sessions at 4.1 that stays EXPERIENCED, and 55 sessions at 4.8
 *     that also stays EXPERIENCED. Volume alone and rating alone both fall short
 *   · all three price bands (§5.2), across the full ₪5–20 range
 *   · every level cap, 3 through 5
 *   · the Bayesian pair (§9.3): one 5.0 from a single rating against 4.6 across 40.
 *     The E4 acceptance test asserts the second outranks the first, and without
 *     this pair in the data that test cannot fail even when the code is wrong
 *
 * Aggregates are **derived** from `stats` below rather than typed twice — see
 * `deriveProfile`. Hand-written totals drift from their parts, and a teacher whose
 * rating_sum disagrees with their per-topic history makes the matching algorithm
 * look broken in E4 when it is not.
 *
 * `ratingCount` defaults to `sessions`: rating is mandatory (§4.2), so a session
 * normally produces one. Where it is given explicitly, the gap is a session that
 * ended without a rating — the student closed the tab, which the product allows.
 */
const TEACHERS = [
  {
    email: 'dana.k@demo.tutornow.il',
    fullName: 'Dana K.',
    bio: 'Integrals and derivatives, six years of one-on-one tutoring. I start by asking what you already tried.',
    pricePerBlock: 16, // band C
    levelMax: 5,
    status: 'ONLINE',
    acceptanceRate: 0.82,
    noShowCount: 1,
    stats: [
      { slug: 'integration-by-parts', sessions: 40, resolved: 36, ratingSum: 184 }, // 4.60
      { slug: 'definite-integrals', sessions: 35, resolved: 31, ratingSum: 161 }, // 4.60
      { slug: 'differentiation-rules', sessions: 30, resolved: 26, ratingSum: 138 }, // 4.60
    ], // → 105 sessions @ 4.60 = TOP
  },
  {
    email: 'yossi.m@demo.tutornow.il',
    fullName: 'Yossi M.',
    bio: 'Algebra and trigonometry. Ex-army instructor — I explain the same idea three different ways until one lands.',
    pricePerBlock: 12, // band B
    levelMax: 5,
    status: 'ONLINE',
    acceptanceRate: 0.75,
    noShowCount: 2,
    stats: [
      { slug: 'quadratic-equations', sessions: 45, resolved: 40, ratingSum: 212 }, // 4.71
      { slug: 'trig-identities', sessions: 40, resolved: 35, ratingSum: 188 }, // 4.70
      { slug: 'integration-by-parts', sessions: 35, resolved: 31, ratingSum: 164 }, // 4.69
    ], // → 120 sessions @ 4.70 = TOP
  },
  {
    email: 'ronen.s@demo.tutornow.il',
    fullName: 'Ronen S.',
    bio: 'Word problems and algebra. Patient with students who freeze on the wording rather than the maths.',
    pricePerBlock: 9, // band A
    levelMax: 4,
    status: 'OFFLINE',
    acceptanceRate: 0.68,
    noShowCount: 4,
    stats: [
      { slug: 'motion-problems', sessions: 60, resolved: 48, ratingSum: 246 }, // 4.10
      { slug: 'quadratic-equations', sessions: 50, resolved: 40, ratingSum: 205 }, // 4.10
    ], // → 110 sessions @ 4.10 = EXPERIENCED. Volume without satisfaction is not TOP
  },
  {
    email: 'avi.k@demo.tutornow.il',
    fullName: 'Avi K.',
    bio: 'Integrals, areas, and the 5-unit exam. Fewer students, longer sessions.',
    pricePerBlock: 20, // band C — the ceiling
    levelMax: 5,
    status: 'ONLINE',
    acceptanceRate: 0.6,
    noShowCount: 0,
    stats: [
      { slug: 'integration-by-parts', sessions: 30, resolved: 28, ratingSum: 144 }, // 4.80
      { slug: 'areas-under-curves', sessions: 25, resolved: 23, ratingSum: 120 }, // 4.80
    ], // → 55 sessions @ 4.80 = EXPERIENCED. Satisfaction without volume is not TOP
  },
  {
    email: 'noa.b@demo.tutornow.il',
    fullName: 'Noa B.',
    bio: 'Euclidean geometry. Proofs, and how to write one that gets full marks.',
    pricePerBlock: 18, // band C
    levelMax: 4,
    status: 'OFFLINE',
    acceptanceRate: 0.71,
    noShowCount: 1,
    stats: [
      { slug: 'triangles', sessions: 26, resolved: 21, ratingSum: 109 }, // 4.19
      { slug: 'similarity', sessions: 14, resolved: 11, ratingSum: 58 }, // 4.14
    ], // → 40 sessions @ 4.18 = EXPERIENCED
  },
  {
    email: 'maya.l@demo.tutornow.il',
    fullName: 'Maya L.',
    bio: 'Probability and statistics. Normal distribution is my favourite thing to teach.',
    pricePerBlock: 14, // band B — top of it
    levelMax: 5,
    status: 'OFFLINE',
    acceptanceRate: 0.78,
    noShowCount: 0,
    stats: [
      { slug: 'normal-distribution', sessions: 18, resolved: 15, ratingSum: 83 }, // 4.61
      { slug: 'basic-probability', sessions: 12, resolved: 10, ratingSum: 55 }, // 4.58
    ], // → 30 sessions @ 4.60 = EXPERIENCED
  },
  {
    email: 'tal.r@demo.tutornow.il',
    fullName: 'Tal R.',
    bio: 'Algebra at 3 units. I work with students who have decided they are bad at maths, and they are not.',
    pricePerBlock: 8, // band A
    levelMax: 3,
    status: 'ONLINE',
    acceptanceRate: 0.9,
    noShowCount: 0,
    stats: [
      { slug: 'quadratic-equations', sessions: 12, resolved: 9, ratingSum: 52 }, // 4.33
      { slug: 'inequalities', sessions: 8, resolved: 6, ratingSum: 35 }, // 4.38
    ], // → 20 sessions = ACTIVE
  },
  {
    email: 'omer.d@demo.tutornow.il',
    fullName: 'Omer D.',
    bio: 'Trigonometry, plane and identities. Evenings and late nights.',
    pricePerBlock: 10, // band B
    levelMax: 4,
    status: 'OFFLINE',
    acceptanceRate: 0.65,
    noShowCount: 2,
    stats: [
      { slug: 'trig-identities', sessions: 10, resolved: 8, ratingSum: 44 }, // 4.40
      { slug: 'plane-trigonometry', sessions: 8, resolved: 6, ratingSum: 34 }, // 4.25
    ], // → 18 sessions = ACTIVE
  },
  {
    email: 'shira.g@demo.tutornow.il',
    fullName: 'Shira G.',
    bio: 'Integrals. Third-year maths student, still remember exactly which step is the confusing one.',
    pricePerBlock: 15, // band C — the floor of it
    levelMax: 5,
    status: 'OFFLINE',
    acceptanceRate: 0.85,
    noShowCount: 0,
    stats: [
      { slug: 'integration-by-parts', sessions: 9, resolved: 8, ratingSum: 43 }, // 4.78
      { slug: 'indefinite-integrals', sessions: 6, resolved: 5, ratingSum: 28 }, // 4.67
    ], // → 15 sessions = ACTIVE
  },
  {
    email: 'eitan.p@demo.tutornow.il',
    fullName: 'Eitan P.',
    bio: 'Sequences and series. Short, concrete explanations.',
    pricePerBlock: 7, // band A
    levelMax: 3,
    status: 'OFFLINE',
    acceptanceRate: 0.7,
    noShowCount: 1,
    stats: [
      { slug: 'arithmetic-sequences', sessions: 7, resolved: 5, ratingSum: 30 }, // 4.29
      { slug: 'geometric-sequences', sessions: 5, resolved: 4, ratingSum: 22 }, // 4.40
    ], // → 12 sessions = ACTIVE
  },
  {
    email: 'lior.a@demo.tutornow.il',
    fullName: 'Lior A.',
    bio: 'Analytic geometry. Lines, circles, and the algebra hiding underneath them.',
    pricePerBlock: 13, // band B
    levelMax: 4,
    status: 'ONLINE',
    acceptanceRate: 0.8,
    noShowCount: 0,
    stats: [
      { slug: 'analytic-line', sessions: 6, resolved: 5, ratingSum: 27 }, // 4.50
      { slug: 'analytic-circle', sessions: 4, resolved: 3, ratingSum: 18 }, // 4.50
    ], // → 10 sessions = ACTIVE
  },
  {
    email: 'hadar.n@demo.tutornow.il',
    fullName: 'Hadar N.',
    bio: 'Absolute value and parameters at 3 units. Cheapest slot on the platform, deliberately.',
    pricePerBlock: 5, // band A — the floor
    levelMax: 3,
    status: 'OFFLINE',
    acceptanceRate: 0.55,
    noShowCount: 1,
    stats: [
      { slug: 'absolute-value', sessions: 4, resolved: 3, ratingSum: 17 }, // 4.25
      { slug: 'parameters', sessions: 3, resolved: 2, ratingSum: 13 }, // 4.33
    ], // → 7 sessions = ACTIVE, just past the NEW threshold
  },
  {
    email: 'gil.v@demo.tutornow.il',
    fullName: 'Gil V.',
    bio: 'Integrals. New here.',
    pricePerBlock: 11, // band B
    levelMax: 5,
    status: 'OFFLINE',
    acceptanceRate: 0.5,
    noShowCount: 0,
    // The other half of the Bayesian pair (§9.3): a perfect 5.0 from exactly one
    // rating. Smoothing must rank this below Dana's 4.60 across 40, and the second
    // session — completed, never rated — keeps the resolve rate off a fake 100%.
    stats: [
      { slug: 'integration-by-parts', sessions: 2, resolved: 1, ratingSum: 5, ratingCount: 1 },
    ],
  },
  {
    email: 'roni.t@demo.tutornow.il',
    fullName: 'Roni T.',
    bio: 'Just joined. Algebra and word problems at 3 units.',
    pricePerBlock: 6, // band A
    levelMax: 3,
    status: 'ONLINE',
    acceptanceRate: 0,
    noShowCount: 0,
    // No history at all — the true cold start. Every rate is 0/0, which is exactly
    // what the Bayesian priors and the new-teacher boost exist to handle.
    stats: [],
    declares: ['quadratic-equations', 'motion-problems'],
  },
  {
    email: 'adi.f@demo.tutornow.il',
    fullName: 'Adi F.',
    bio: 'Curve sketching and optimization. Two years tutoring, first month here.',
    pricePerBlock: 17, // band C
    levelMax: 4,
    status: 'OFFLINE',
    acceptanceRate: 0.6,
    noShowCount: 0,
    stats: [{ slug: 'curve-sketching', sessions: 3, resolved: 2, ratingSum: 13 }], // 4.33
  },
];

/**
 * Rating propagates from a subtopic to its parent at this weight. MVP.md §7, §9.3.
 *
 * **This is the second copy of `PARENT_TOPIC_WEIGHT` and it must equal the first**, which
 * is `server/src/config/constants/matching.js` and is what `server/src/utils/topicStats.js`
 * imports to perform the same propagation after every review (8.1). The copy exists
 * because `prisma/seed/*` cannot reach `server`'s `#config` subpath imports, and moving a
 * ranking parameter into `@tutor/shared` would put it in the package the *client* imports.
 * Unifying them is an open item for E8's retro. A third copy is what §5.3's commission
 * turned into before 7.9 unpicked it — three call sites, three answers, two of them wrong.
 */
const PARENT_WEIGHT = 0.3;

/** Prisma Decimal(8,2) — two places, as a string, so no float ever reaches the column. */
const dec = (n) => n.toFixed(2);

/**
 * Turns a teacher's per-topic history into the denormalized columns on
 * `teacher_profiles`. One source, two representations — which is the point.
 */
function deriveProfile(teacher) {
  const totals = teacher.stats.reduce(
    (acc, stat) => ({
      sessionsCount: acc.sessionsCount + stat.sessions,
      resolvedCount: acc.resolvedCount + stat.resolved,
      ratingSum: acc.ratingSum + stat.ratingSum,
      ratingCount: acc.ratingCount + (stat.ratingCount ?? stat.sessions),
    }),
    { sessionsCount: 0, resolvedCount: 0, ratingSum: 0, ratingCount: 0 },
  );

  // An accepted offer is a session, so acceptance rate fixes how many arrived.
  const offersAccepted = totals.sessionsCount;
  const offersReceived =
    teacher.acceptanceRate > 0 ? Math.round(offersAccepted / teacher.acceptanceRate) : 0;

  return { ...totals, offersAccepted, offersReceived, noShowCount: teacher.noShowCount };
}

/**
 * Subtopic rows as written, plus one parent row per branch carrying 30% of its
 * children — the same propagation the review service performs after every session
 * (§9.3). Without it, matching on a parent topic finds no history and the seeded
 * teachers all look equally unknown.
 */
function deriveTopicStats(teacher) {
  const rows = new Map();

  for (const stat of teacher.stats) {
    const ratingCount = stat.ratingCount ?? stat.sessions;
    rows.set(stat.slug, {
      slug: stat.slug,
      sessionsCount: stat.sessions,
      resolvedCount: stat.resolved,
      ratingSum: stat.ratingSum,
      ratingCount,
    });

    const parentSlug = PARENT_OF[stat.slug];
    const parent = rows.get(parentSlug) ?? {
      slug: parentSlug,
      sessionsCount: 0,
      resolvedCount: 0,
      ratingSum: 0,
      ratingCount: 0,
    };

    parent.sessionsCount += stat.sessions * PARENT_WEIGHT;
    parent.resolvedCount += stat.resolved * PARENT_WEIGHT;
    parent.ratingSum += stat.ratingSum * PARENT_WEIGHT;
    parent.ratingCount += ratingCount * PARENT_WEIGHT;
    rows.set(parentSlug, parent);
  }

  return [...rows.values()];
}

/**
 * Everything the teacher says they teach — the hard filter in §9.1 reads this, and
 * it is a declaration, not history (see `teacher_topics` vs `teacher_topic_stats`).
 * Subtopics they have taught, their parents, and anything listed in `declares` for
 * a teacher with no history yet.
 */
function declaredTopics(teacher) {
  const slugs = new Set(teacher.declares ?? []);
  for (const stat of teacher.stats) slugs.add(stat.slug);
  for (const slug of [...slugs]) if (PARENT_OF[slug]) slugs.add(PARENT_OF[slug]);
  return [...slugs];
}

export async function seedTeachers(topicIdBySlug) {
  for (const teacher of TEACHERS) {
    const user = await upsertUser({
      email: teacher.email,
      fullName: teacher.fullName,
      role: 'teacher',
    });

    const profile = deriveProfile(teacher);
    const data = {
      bio: teacher.bio,
      pricePerBlock: teacher.pricePerBlock,
      levelMax: teacher.levelMax,
      status: teacher.status,
      lastSeenAt: teacher.status === 'ONLINE' ? new Date() : null,
      ...profile,
    };

    await prisma.teacherProfile.upsert({
      where: { userId: user.id },
      update: data,
      create: { userId: user.id, ...data },
    });

    // Declarations and stats are fixtures, not history: replace them wholesale so
    // editing this file and re-running produces the file's data and nothing else.
    await prisma.teacherTopic.deleteMany({ where: { teacherId: user.id } });
    await prisma.teacherTopicStat.deleteMany({ where: { teacherId: user.id } });

    await prisma.teacherTopic.createMany({
      data: declaredTopics(teacher).map((slug) => ({
        teacherId: user.id,
        topicId: topicIdBySlug[slug],
      })),
    });

    await prisma.teacherTopicStat.createMany({
      data: deriveTopicStats(teacher).map((row) => ({
        teacherId: user.id,
        topicId: topicIdBySlug[row.slug],
        sessionsCount: dec(row.sessionsCount),
        resolvedCount: dec(row.resolvedCount),
        ratingSum: dec(row.ratingSum),
        ratingCount: dec(row.ratingCount),
      })),
    });

    // Teachers get a wallet at zero. Earnings are a consequence of sessions, and
    // seeding money with no session behind it would break the one invariant the
    // ledger exists to hold (MVP.md §11.3).
    await setWallet(user.id, 0);
  }

  log(`${TEACHERS.length} teachers`);
}

export { TEACHERS };
