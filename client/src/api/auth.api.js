import { api, REFRESH_PATH } from '@/api/client';

/**
 * The five auth endpoints — MVP.md §12, frozen in docs/epics/E1-auth/README.md.
 *
 * One module per server domain, and components call these through `authStore`
 * rather than directly (CONVENTIONS.md → Client). The interceptor in `client.js`
 * already unwraps `{ success, data }`, so every function here resolves to the
 * payload itself and rejects with an `ApiError`. No `try` blocks: the store
 * decides what a failure means.
 *
 * @see shared/api.d.ts for every shape below.
 */

/**
 * `201` with the refresh cookie set — registration logs the user straight in, so
 * this returns the same shape as {@link login}.
 *
 * @param {{ email: string, password: string, fullName: string,
 *   role: 'student'|'teacher', grade?: number, mathLevel?: number }} payload
 * @returns {Promise<import('@tutor/shared').AuthResponse>} `{ user, accessToken }`
 */
export function register(payload) {
  return api.post('/auth/register', payload);
}

/**
 * @param {{ email: string, password: string }} credentials
 * @returns {Promise<import('@tutor/shared').AuthResponse>} `{ user, accessToken }`
 */
export function login(credentials) {
  return api.post('/auth/login', credentials);
}

/**
 * Trades the httpOnly refresh cookie for a new access token, rotating the cookie.
 * There is no request body and no `Authorization` header worth sending: the cookie
 * is the entire credential, and the reason we are here is that the access token
 * has expired.
 *
 * @returns {Promise<{ accessToken: string }>}
 */
export function refresh() {
  return api.post(REFRESH_PATH);
}

/**
 * Clears the refresh cookie server-side. Answers `200` even when the access token
 * expired in an idle tab, so a rejection here means the network failed, not that
 * the user is still logged in.
 *
 * @returns {Promise<unknown>}
 */
export function logout() {
  return api.post('/auth/logout');
}

/**
 * The client's single source of truth for the current user: the base user plus the
 * role-specific profile and, for students, the wallet balance.
 *
 * @returns {Promise<import('@tutor/shared').MeResponse>}
 */
export function me() {
  return api.get('/auth/me');
}
