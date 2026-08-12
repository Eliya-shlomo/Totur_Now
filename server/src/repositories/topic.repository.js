import { prisma } from '#config/db.js';

/**
 * Topic reads. The taxonomy is MVP.md §7 — two levels, parent topic → subtopic.
 *
 * One function, one query, every row. That is deliberate: the table is 60-odd
 * rows of production data that changes only when the seed changes, so fetching
 * parents and then their children per parent would be an N+1 against a table
 * small enough to hold in a single round trip. The shape — flat list in, tree out
 * — is built in the service, because assembling it here would make the repository
 * know what a consumer wants rather than what the database holds.
 */

/**
 * Every topic, both levels, ordered by id.
 *
 * Id order is seed order (`prisma/seed/topics.js` walks TAXONOMY top to bottom),
 * which is the pedagogical order a student expects to read — algebra before
 * trigonometry, not alphabetical. Sorting by name would throw that away, and
 * sorting is not the caller's job to redo.
 *
 * `select` rather than the whole row so a column added to `topics` later does not
 * silently start appearing in a public, unauthenticated response.
 */
export async function findAllTopics() {
  return prisma.topic.findMany({
    select: { id: true, parentId: true, slug: true, nameHe: true, nameEn: true },
    orderBy: { id: 'asc' },
  });
}
