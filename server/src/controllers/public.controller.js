import { PUBLIC_CACHE_SECONDS } from '#config/constants/index.js';
import { getPricingModel } from '#services/pricing.service.js';
import { getTopicTree } from '#services/topic.service.js';

/**
 * The unauthenticated surface — MVP.md §12 "Public".
 *
 * Two rules shape everything here. **No user data, ever:** these responses are
 * cacheable by any proxy between us and the visitor, so a single leaked field
 * would be a leaked field served to strangers. And **no logic:** controllers read
 * the request and write the response (CONVENTIONS.md → Server layering), so both
 * handlers are a call and a send.
 */

/** Marks a response as public and reusable for `PUBLIC_CACHE_SECONDS`. */
function setPublicCache(res) {
  res.set('Cache-Control', `public, max-age=${PUBLIC_CACHE_SECONDS}`);
}

/**
 * `GET /public/topics` — the taxonomy as a two-level tree.
 *
 * Cached at the edge because it changes on a seed run and at no other time.
 */
export async function getTopics(req, res) {
  const topics = await getTopicTree();

  setPublicCache(res);
  res.json({ success: true, data: { topics } });
}

/**
 * `GET /public/pricing` — blocks, price bounds, bands and commission (§5).
 *
 * Synchronous underneath: the payload is derived from constants, not read from
 * the database. The handler stays `async` anyway so that both public routes wrap
 * identically in `asyncHandler` and so adding a read later is not a signature
 * change.
 */
export async function getPricing(req, res) {
  setPublicCache(res);
  res.json({ success: true, data: getPricingModel() });
}
