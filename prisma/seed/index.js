// Same reason prisma.config.js does it: this runs as a plain node script, not
// through the Prisma CLI, so nothing else puts DATABASE_URL in the environment.
// The repo keeps one .env at the root — server/ and client/ have none of their own.
import 'dotenv/config';

import { prisma, SEED_PASSWORD, log } from './helpers.js';
import { seedTopics } from './topics.js';
import { seedTeachers } from './teachers.js';
import { seedStudents } from './students.js';
import { seedQuestions } from './questions.js';

/**
 * `npm run db:seed`, and automatically after `prisma migrate reset`.
 *
 * Idempotent by construction: every write upserts on a stable business key —
 * `topics.slug`, `users.email` — never on an id, because the seed does not assign
 * ids (CONVENTIONS.md § Database). Run it twice and the second run updates rows in
 * place. The only exception is the id-0 "General / Unclassified" topic, whose value
 * is part of the classifier contract.
 *
 * Order matters twice now: topics before teachers, because a teacher's declared
 * topics and per-topic stats reference topic ids the first step generates — and
 * students before questions, because a demo question is owned by a seeded student and
 * is looked up by that student's id.
 */
async function main() {
  console.log('\nSeeding TutorNow…\n');

  const topicIdBySlug = await seedTopics();
  log(`${Object.keys(topicIdBySlug).length} topics (parents, subtopics, and id 0)`);

  await seedTeachers(topicIdBySlug);
  await seedStudents();
  await seedQuestions(topicIdBySlug);

  console.log(`\nDone. Every demo account uses the password: ${SEED_PASSWORD}\n`);
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error);
    // Non-zero, so `migrate reset` and CI both fail loudly rather than continuing
    // against a half-seeded database — which looks like a code bug for an hour.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
