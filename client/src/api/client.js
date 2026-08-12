import axios from 'axios';
import { ERROR_CODES } from '@tutor/shared';

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

/**
 * The one path the 401 seam below must never react to. A 401 from the refresh
 * endpoint is the unambiguous "log in again" signal; refreshing in response to it
 * is an infinite loop. It lives here rather than in `auth.api.js` so the guard and
 * the request compare the same string without the two modules importing each other.
 */
export const REFRESH_PATH = '/auth/refresh';

export const api = axios.create({
  baseURL,
  // The refresh token is an httpOnly cookie (PR 1.5), so cross-origin requests
  // have to carry credentials. The server's CORS config allows this origin.
  withCredentials: true,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * How this file reaches the auth state without importing it — PR 1.5.
 *
 * `authStore` imports `auth.api.js`, which imports this file. If this file
 * imported the store back, the three would form a cycle whose evaluation order
 * decides whether `api` exists yet. So the store pushes what the interceptors need
 * in, at import time, and this file keeps knowing nothing about Zustand.
 *
 * The no-op default is not a fallback for a missing store: it is what runs before
 * the store module has evaluated, and it means "nobody is logged in", which is the
 * correct answer at that moment.
 *
 * @type {{ getAccessToken: () => string|null,
 *          refresh: () => Promise<string>,
 *          onAuthLost: () => void }}
 */
let authBridge = {
  getAccessToken: () => null,
  refresh: () => Promise.reject(new Error('auth bridge not connected')),
  onAuthLost: () => {},
};

/** Called once by `stores/authStore.js`. Nothing else may call it. */
export function connectAuthBridge(bridge) {
  authBridge = bridge;
}

/**
 * The access token is held in memory by `authStore` and attached here, so no
 * caller ever handles it (MVP.md §15.5 — never `localStorage`).
 *
 * Assigned unconditionally rather than only when absent: a retried request already
 * carries the *expired* header from its first attempt, and keeping it would make
 * the retry fail exactly as the original did.
 */
api.interceptors.request.use((config) => {
  const accessToken = authBridge.getAccessToken();

  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;

  return config;
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

  async (error) => {
    const response = error.response;

    if (!response) return Promise.reject(ApiError.network());

    const envelope = response.data?.error;

    if (!envelope) return Promise.reject(ApiError.malformed(response.status));

    // ── 401 refresh seam — filled by PR 1.5 ──────────────────────────────────
    //
    // An expired access token is a recoverable condition, not an error the screen
    // should see: refresh once, replay the request, and let the caller receive the
    // answer it originally asked for.
    //
    // Three conditions have to hold, and each one is a bug if dropped:
    //
    //   TOKEN_EXPIRED only — `TOKEN_INVALID` (tampered) and `UNAUTHORIZED` (wrong
    //     credentials, no session) are final. Refreshing on those turns a clean
    //     "log in again" into a retry storm.
    //   not the refresh call itself — otherwise a dead refresh cookie refreshes
    //     forever.
    //   not already retried — one attempt per request. `_retry` rides on the
    //     config object, which axios hands back to us unchanged on the replay.
    //
    // Concurrency is handled one level up: `authBridge.refresh()` returns the same
    // in-flight promise to every caller, so five parallel 401s produce one call to
    // /auth/refresh and five replays. See `stores/authStore.js`.
    const config = error.config;
    const isRecoverable =
      response.status === 401 &&
      envelope.code === ERROR_CODES.TOKEN_EXPIRED &&
      config &&
      !config._retry &&
      config.url !== REFRESH_PATH;

    if (isRecoverable) {
      config._retry = true;

      try {
        await authBridge.refresh();
      } catch {
        // The refresh cookie is gone or rejected. Nothing below this line can
        // succeed, so drop the session and send the user to /login.
        authBridge.onAuthLost();

        return Promise.reject(ApiError.fromEnvelope(envelope, response.status));
      }

      // Back through both interceptors, so the replay picks up the new token and
      // its own success is unwrapped exactly like any other response.
      return api(config);
    }

    return Promise.reject(ApiError.fromEnvelope(envelope, response.status));
  },
);
