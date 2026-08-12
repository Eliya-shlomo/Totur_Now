import { create } from 'zustand';

import * as authApi from '@/api/auth.api';
import { connectAuthBridge } from '@/api/client';

/**
 * Who is logged in — MVP.md §16, and the client half of the token strategy frozen
 * in docs/epics/E1-auth/README.md.
 *
 * **The access token lives in this module's memory and nowhere else.** Not
 * `localStorage`, not `sessionStorage`, not a cookie this code can read (§15.5). A
 * closed tab therefore forgets it, and what survives a reload is the `httpOnly`
 * refresh cookie the server set — which is the entire reason for the design, and
 * why `bootstrap` exists.
 *
 * `status` is the only thing screens should branch on:
 *
 *   'loading'        bootstrap has not answered yet. Nothing auth-dependent may
 *                    render — rendering the anonymous branch here is what makes
 *                    every page refresh flash the login screen for one frame.
 *   'authenticated'  `user` and `accessToken` are both set.
 *   'anonymous'      both are null. The user may simply never have logged in.
 *
 * Per CONVENTIONS.md → Client, this store imports no other store.
 */

/** Cleared state. One object so "logged out" cannot be spelled two ways. */
const ANONYMOUS = { user: null, accessToken: null, status: 'anonymous' };

/**
 * Where a signed-in user belongs, by role — MVP.md §14.1. Also where
 * `ProtectedRoute` sends someone who reached the wrong area's URL.
 */
export const HOME_BY_ROLE = {
  student: '/app',
  teacher: '/teach',
  admin: '/admin',
};

/**
 * How the attempted path travels to the login screen: `/login?from=/app/wallet`.
 *
 * A query parameter rather than React Router's location state, because half the
 * redirects here are full page loads (`onAuthLost` below) and router state does not
 * survive those. One mechanism for both paths means PR 1.3's login screen reads one
 * thing.
 */
export const FROM_PARAM = 'from';

/**
 * The `/login` URL that remembers where the user was headed.
 *
 * @param {{ pathname: string, search?: string }} location
 * @returns {string}
 */
export function loginPathFor(location) {
  const attempted = `${location.pathname}${location.search ?? ''}`;

  return `/login?${FROM_PARAM}=${encodeURIComponent(attempted)}`;
}

/**
 * Where to land after a successful login — PR 1.3 calls this.
 *
 * Only same-site absolute paths are honoured. `?from=https://elsewhere.example` is
 * an open-redirect handed to us by whoever wrote the link, so anything that is not
 * a single leading slash falls back to the role's home.
 *
 * @param {string} search   `location.search`, e.g. `'?from=%2Fapp%2Fwallet'`
 * @param {string} role     the logged-in user's role
 * @returns {string}
 */
export function postLoginPath(search, role) {
  const attempted = new URLSearchParams(search).get(FROM_PARAM);
  const home = HOME_BY_ROLE[role] ?? '/';

  if (!attempted || !attempted.startsWith('/') || attempted.startsWith('//')) return home;

  return attempted;
}

/**
 * The in-flight refresh, shared by every caller — the single-refresh guarantee.
 *
 * Five requests failing 401 at once all reach `refresh()` before any of them
 * finishes, so it must hand the same promise to all five rather than start five
 * rotations. It matters more than it looks: the server rotates the refresh cookie
 * on every call, so a second concurrent refresh presents a token the first one just
 * invalidated, and logs the user out mid-session.
 *
 * Module scope, not store state: it is machinery, and nothing should re-render when
 * it changes.
 */
let refreshInFlight = null;

/** Same idea for bootstrap, whose double-invoke comes from React StrictMode. */
let bootstrapInFlight = null;

export const useAuthStore = create((set, get) => ({
  /** @type {import('@tutor/shared').MeResponse|null} */
  user: null,
  /** @type {string|null} 15 minutes. In memory only. */
  accessToken: null,
  /** @type {'loading'|'authenticated'|'anonymous'} */
  status: 'loading',

  /**
   * Rotate the refresh cookie for a fresh access token.
   *
   * Only the access token is touched: `user` and `status` are still valid — the
   * session did not end, a token aged out. Rejects if the cookie is gone or
   * refused; the caller decides what that means.
   *
   * @returns {Promise<string>} the new access token
   */
  refresh() {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      try {
        const { accessToken } = await authApi.refresh();

        set({ accessToken });

        return accessToken;
      } finally {
        // Clears once this rotation settles, so the *next* 401 starts a new one.
        // Callers already awaiting this promise are unaffected.
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  },

  /**
   * Restore the session on app mount — the reason a page refresh keeps the user
   * logged in with no token in storage.
   *
   * Refresh first (the cookie is the only credential that survived the reload),
   * then `/auth/me` for the user. A failure at either step is the ordinary
   * logged-out case, not an error worth surfacing: most visitors have no cookie.
   *
   * @returns {Promise<void>}
   */
  bootstrap() {
    if (bootstrapInFlight) return bootstrapInFlight;

    bootstrapInFlight = (async () => {
      try {
        await get().refresh();

        set({ user: await authApi.me(), status: 'authenticated' });
      } catch {
        set(ANONYMOUS);
      } finally {
        bootstrapInFlight = null;
      }
    })();

    return bootstrapInFlight;
  },

  /**
   * @param {{ email: string, password: string }} credentials
   * @returns {Promise<import('@tutor/shared').MeResponse>} the logged-in user
   */
  async login(credentials) {
    return adopt(await authApi.login(credentials));
  },

  /**
   * Registration logs the user in — 1.2 returns the same `{ user, accessToken }`
   * and sets the same cookie, so there is one handler for both.
   *
   * @param {object} payload  see `auth.api.js`
   * @returns {Promise<import('@tutor/shared').MeResponse>} the registered user
   */
  async register(payload) {
    return adopt(await authApi.register(payload));
  },

  /**
   * End the session: clear the cookie server-side, drop everything held here, and
   * leave for `/login`.
   *
   * The endpoint failing does not keep the user logged in — the credential this
   * client holds is being discarded either way, so a network error is not a reason
   * to refuse. Worst case the cookie outlives its usefulness on the server.
   *
   * @returns {Promise<void>}
   */
  async logout() {
    try {
      await authApi.logout();
    } catch {
      // Deliberately ignored — see above.
    }

    set(ANONYMOUS);

    // A full load rather than a router navigation, so every other store, cache and
    // socket built in later epics is dropped with the session instead of being left
    // holding the previous user's data.
    window.location.assign('/login');
  },
}));

/**
 * Adopt an `{ user, accessToken }` response from login or register.
 *
 * The token goes in first, then `/auth/me` replaces the user it came with. That is
 * one extra round trip, on purpose: login returns `AuthUser`, `/auth/me` returns
 * `MeResponse` — the same fields plus the role profile and the wallet balance. Two
 * user shapes reaching components depending on how the session started is the
 * "divergent user shapes" risk named in the epic README, and it surfaces later as
 * something that looks like a caching bug.
 *
 * Written as a module function rather than a store action because nothing outside
 * this file may call it.
 *
 * @param {import('@tutor/shared').AuthResponse} response
 * @returns {Promise<import('@tutor/shared').MeResponse>}
 */
async function adopt(response) {
  useAuthStore.setState({ accessToken: response.accessToken });

  const user = await authApi.me();

  useAuthStore.setState({ user, status: 'authenticated' });

  return user;
}

/**
 * Hand the axios interceptors what they need, without `client.js` importing this
 * module back. Runs once, when this module is first evaluated.
 *
 * `onAuthLost` is the dead end of the refresh flow: the token expired, the refresh
 * cookie could not renew it, and the request that started it all cannot be replayed.
 * It carries the current path so the user returns to it after logging in.
 */
connectAuthBridge({
  getAccessToken: () => useAuthStore.getState().accessToken,

  refresh: () => useAuthStore.getState().refresh(),

  onAuthLost: () => {
    useAuthStore.setState(ANONYMOUS);

    const target = loginPathFor(window.location);

    if (window.location.pathname !== '/login') window.location.assign(target);
  },
});
