import axios from 'axios';

import { ApiError } from '@/api/ApiError';

/**
 * The one axios instance. SINGLE-OWNER FILE, DEV-A — docs/OWNERSHIP.md §2.
 *
 * Nothing else in the client imports `axios`. Every server call goes through this
 * instance so that auth, the envelope, and error normalization are decided once
 * rather than per screen.
 *
 * What the interceptor guarantees to callers:
 *   success  →  resolves to the payload itself, never `{ success, data }`
 *   failure  →  rejects with an `ApiError`, always, whatever went wrong
 */

/** No trailing slash, so `api.get('/health')` never produces a `//`. */
const baseURL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '');

export const api = axios.create({
  baseURL,
  // The refresh token is an httpOnly cookie (PR 1.5), so cross-origin requests
  // have to carry credentials. The server's CORS config allows this origin.
  withCredentials: true,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => {
    const body = response.data;

    // The agreed success shape is `{ success: true, data }`. Anything else came
    // from something that is not our Express app.
    if (!body || body.success !== true || !('data' in body)) {
      // Rejects straight to the caller: a throw in this handler does not reach the
      // rejection handler below — that is plain promise semantics, not axios.
      return Promise.reject(ApiError.malformed(response.status));
    }

    return body.data;
  },

  (error) => {
    const response = error.response;

    if (!response) return Promise.reject(ApiError.network());

    // ── 401 refresh seam — PR 1.5 fills this in ──────────────────────────────
    // A 401 (TOKEN_EXPIRED) should trigger one refresh call against
    // /auth/refresh, retry the original request once, and log out if the refresh
    // itself fails. It is deliberately NOT implemented here: refresh needs
    // authStore, which E1 creates, and a half-built version now means E1.5
    // rewrites this file. Until then a 401 falls through and rejects like any
    // other error, which is the correct behaviour for a logged-out user.
    // Guard against infinite retry loops when it lands: mark the retried request.

    const envelope = response.data?.error;

    if (!envelope) return Promise.reject(ApiError.malformed(response.status));

    return Promise.reject(ApiError.fromEnvelope(envelope, response.status));
  },
);
