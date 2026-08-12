import { findAllTopics } from '#repositories/topic.repository.js';

/**
 * The topic taxonomy as a tree. MVP.md §7.
 *
 * This service is built for three consumers, not one: the pricing/landing surface
 * that ships in PR 1.6, teacher topic selection in E2, and the LLM classifier's
 * prompt in E3. All three want the same nested shape, so it is assembled once
 * here rather than three times at three call sites.
 *
 * There is no caching layer. The taxonomy is one small query and Postgres has it
 * in memory; a cache here would add an invalidation problem to buy nothing. The
 * `Cache-Control` header on the route is where the saving actually happens,
 * because it stops the request from reaching Node at all.
 */

/**
 * @typedef {object} TopicNode
 * @property {number} id
 * @property {string} slug     the stable key — see CONVENTIONS.md, ids are assigned by the database
 * @property {string} nameHe
 * @property {string} nameEn
 * @property {TopicNode[]} [children]  parents only; subtopics have no third level
 */

/**
 * Two levels: every parent with its subtopics nested under it.
 *
 * One query plus one in-memory group, O(n). The alternative — a query per parent
 * — is the N+1 that PR 1.6's brief calls out by name, and it matters more here
 * than the row count suggests, because E3 calls this on the classification path
 * where latency is the product.
 *
 * "General / Unclassified" (the seeded `id = 0` sentinel, MVP.md §8.1) has no
 * parent and no children, so it comes back as a childless root. It is not
 * special-cased: a consumer that wants to hide it filters by slug, and this
 * service does not decide that for them.
 */
export async function getTopicTree() {
  const rows = await findAllTopics();

  /** Subtopics grouped by their parent id, in the order the query returned them. */
  const childrenByParent = new Map();

  for (const row of rows) {
    if (row.parentId === null) continue;

    const siblings = childrenByParent.get(row.parentId);

    if (siblings) siblings.push(toNode(row));
    else childrenByParent.set(row.parentId, [toNode(row)]);
  }

  return rows
    .filter((row) => row.parentId === null)
    .map((row) => ({ ...toNode(row), children: childrenByParent.get(row.id) ?? [] }));
}

/** Row → public node. `parentId` is dropped: the nesting already carries it. */
function toNode({ id, slug, nameHe, nameEn }) {
  return { id, slug, nameHe, nameEn };
}
