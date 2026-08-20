import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

/**
 * The refresh cookie's flags — PR 6b.2.
 *
 * **What this file is really asserting is a browser rule, and it is worth writing down
 * because the code it replaced was locally correct.** `sameSite: env.isProduction ?
 * 'none' : 'lax'` reasons accurately about the deployment it was written for: Vercel
 * and Render are different registrable domains, the refresh request is cross-site, and
 * `'none'` is the only value that lets the browser attach the cookie. All true, and the
 * cookie was still thrown away — `SameSite=None` makes a cookie *eligible* to travel
 * cross-site, and says nothing about a browser that refuses to store third-party
 * cookies at all. Safari does. Firefox does. Every private window does. So the access
 * token expired at fifteen minutes, `/auth/refresh` arrived with no cookie, and a
 * student with a running meter was sent to the login screen mid-lesson.
 *
 * No assertion here can see a browser. What it can hold is the part that broke: that
 * the flag is a deployment's own decision rather than a consequence of `NODE_ENV`, so
 * that a build proxied behind one origin and a build called directly can differ in it —
 * and that leaving it unset changes nothing for a deployment that has not been moved
 * yet.
 *
 * A child process per case, because `config/env.js` parses once at import and this one
 * has already parsed as `test`. Same reason and same shape as `config.env.test.js`.
 */

const BASE = {
  DATABASE_URL: 'postgresql://unused:unused@localhost:5433/unused',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  CLOUDINARY_CLOUD_NAME: 'unused',
  CLOUDINARY_API_KEY: 'unused',
  CLOUDINARY_API_SECRET: 'unused',
  GEMINI_API_KEY: 'unused',
  DAILY_API_KEY: 'unused',
  // Present and empty, so the repo-root `.env` cannot decide the result — dotenv does
  // not overwrite a variable the environment already defines. `config.env.test.js`
  // explains the hazard at length.
  REFRESH_COOKIE_SAMESITE: '',
};

/**
 * Sets the cookie against a recording stub and reports the options it was given.
 *
 * The real `setRefreshCookie` rather than a reimplementation of it: what is being
 * tested is that one builder feeds `res.cookie`, and a test that rebuilt the object
 * would assert its own arithmetic.
 *
 * @param {Record<string, string>} vars
 * @returns {{sameSite: string, secure: boolean, httpOnly: boolean, path: string}}
 */
function cookieOptions(vars) {
  const script = `
    import('./server/src/services/auth.token.service.js').then((m) => {
      let captured = null;
      m.setRefreshCookie({ cookie: (name, value, options) => (captured = options) }, 'token');
      console.log(JSON.stringify(captured));
    });
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { PATH: process.env.PATH, ...BASE, ...vars },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);

  return JSON.parse(result.stdout);
}

describe('the refresh cookie, behind the proxy', () => {
  it('is same-site when the deployment says so', () => {
    const options = cookieOptions({ NODE_ENV: 'production', REFRESH_COOKIE_SAMESITE: 'lax' });

    assert.equal(options.sameSite, 'lax');
  });

  it('does not read the answer off NODE_ENV — that is the whole of the fix', () => {
    // Same build, same NODE_ENV, two deployments: one proxied behind the client's
    // origin, one called directly. Before 6b.2 these were the same value and only one
    // of them was right.
    const proxied = cookieOptions({ NODE_ENV: 'production', REFRESH_COOKIE_SAMESITE: 'lax' });
    const direct = cookieOptions({ NODE_ENV: 'production', REFRESH_COOKIE_SAMESITE: 'none' });

    assert.notEqual(proxied.sameSite, direct.sameSite);
  });
});

describe('the refresh cookie, unset', () => {
  it('keeps production on none, so no deployment changes underneath itself', () => {
    const options = cookieOptions({ NODE_ENV: 'production' });

    assert.equal(options.sameSite, 'none');
  });

  it('keeps development on lax, where both sides are localhost and same-site already', () => {
    const options = cookieOptions({ NODE_ENV: 'development' });

    assert.equal(options.sameSite, 'lax');
  });
});

describe('the flags 6b.2 must not have touched', () => {
  it('are httpOnly, Secure, and scoped to the auth router', () => {
    // §15.5's whole point, and `secure` in particular: SameSite=None without it is
    // rejected outright, so the direct-origin arrangement depends on this staying true.
    for (const sameSite of ['lax', 'none']) {
      const options = cookieOptions({ NODE_ENV: 'production', REFRESH_COOKIE_SAMESITE: sameSite });

      assert.equal(options.httpOnly, true);
      assert.equal(options.secure, true);
      assert.equal(options.path, '/api/v1/auth');
    }
  });

  it('carries a maxAge on the way in — the TTL is set in one place', () => {
    const options = cookieOptions({ NODE_ENV: 'production' });

    assert.equal(options.maxAge, 7 * 24 * 60 * 60 * 1000);
  });
});
