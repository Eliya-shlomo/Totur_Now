import { api } from '@/api/client';

/**
 * The unauthenticated endpoints — MVP.md §12 "Public".
 *
 * One module per server domain, and components call these rather than `api`
 * directly (CONVENTIONS.md → Client). The interceptor in `client.js` already
 * unwraps `{ success, data }`, so every function here resolves to the payload
 * itself and rejects with an `ApiError`. No `try` blocks in this file: the screen
 * decides what a failure looks like, and swallowing it here would take that
 * decision away.
 */

/**
 * The topic taxonomy as a two-level tree.
 *
 * @returns {Promise<{ topics: Array<{ id: number, slug: string, nameHe: string,
 *   nameEn: string, children: Array<object> }> }>}
 */
export function getTopics() {
  return api.get('/public/topics');
}

/**
 * Blocks, price bounds, bands and commission — everything the pricing page
 * displays, derived server-side from `config/constants/money.js`.
 *
 * @returns {Promise<object>} see shared/api.d.ts
 */
export function getPricing() {
  return api.get('/public/pricing');
}
