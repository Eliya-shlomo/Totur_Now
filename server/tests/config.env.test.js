import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { missingOptionalInProduction } from '#config/env.js';

/**
 * The boot-time environment rules — PR 6b.1.
 *
 * **The defect this file exists to prevent is not a missing check, it is a missing
 * sentence.** `DAILY_API_KEY` was never declared in `render.yaml`, so the deployed API
 * never had one, so every session in production from PR 6.1 onwards ran without a
 * camera. Every layer downstream behaved exactly as designed — 6.3 accepted the offer,
 * 6.4 tried to repair the room, 6.7 rendered the room without the call — and the state
 * was therefore indistinguishable from a healthy deploy until somebody read a log. The
 * assertions here are about what the process *says* at boot, which is the only thing
 * that was missing.
 *
 * Two layers, and the split is the same one `video.service.test.js` makes. The pure
 * rule is called directly. The behaviour that only exists once per process — parsing,
 * warning, and above all *not exiting* — is a child process, because `config/env.js`
 * parses at import and this one has already parsed as `test`.
 */

/**
 * A production environment with every hard requirement satisfied and no video key.
 *
 * **`DAILY_API_KEY` is present and empty rather than absent, and that is load-bearing.**
 * `config/env.js` calls `dotenv.config()` on the repo-root `.env`, which on a developer's
 * machine holds a real key. dotenv does not overwrite a variable the environment already
 * defines, and an empty string counts as defined — so this is what stops the file on
 * disk from deciding the result of a test about a deploy that has no file.
 */
const PRODUCTION = {
  NODE_ENV: 'production',
  DAILY_API_KEY: '',
  DATABASE_URL: 'postgresql://unused:unused@localhost:5433/unused',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  CLOUDINARY_CLOUD_NAME: 'unused',
  CLOUDINARY_API_KEY: 'unused',
  CLOUDINARY_API_SECRET: 'unused',
  GEMINI_API_KEY: 'unused',
};

/**
 * Boots `config/env.js` in a child process and reports what it did.
 *
 * `PATH` is carried through and nothing else is: inheriting the parent's environment
 * would let a developer with a real `DAILY_API_KEY` in their shell pass the test that
 * asserts the warning fires. That is the exact shape of the bug — a key present in one
 * place and absent in the one that matters.
 *
 * `spawnSync` rather than `execFileSync`, because the interesting output is on stderr
 * on the path where the process *succeeds*, and `execFileSync` only hands back stderr
 * when it throws.
 *
 * @param {Record<string, string>} vars
 * @returns {{status: number, stderr: string, stdout: string}}
 */
function boot(vars) {
  const script = "import('./server/src/config/env.js').then(() => console.log('booted'));";

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { PATH: process.env.PATH, ...vars },
    encoding: 'utf8',
  });

  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

describe('missingOptionalInProduction', () => {
  it('names DAILY_API_KEY, and what is lost without it', () => {
    const missing = missingOptionalInProduction({});

    assert.deepEqual(
      missing.map(([key]) => key),
      ['DAILY_API_KEY'],
    );
    assert.match(missing[0][1], /video/i);
  });

  it('says nothing when the key is set', () => {
    assert.deepEqual(missingOptionalInProduction({ DAILY_API_KEY: 'a-key' }), []);
  });

  it('treats an empty string as absent, because dotenv turns a blank line into one', () => {
    // `.env.example` ships `DAILY_API_KEY=""`. A truthiness check is the whole of the
    // rule, and a reader who fills in nothing must get the warning, not silence.
    assert.equal(missingOptionalInProduction({ DAILY_API_KEY: '' }).length, 1);
  });
});

describe('booting in production without a video key', () => {
  it('says so on stderr, naming the variable', () => {
    const { stderr } = boot(PRODUCTION);

    assert.match(stderr, /DAILY_API_KEY/);
  });

  it('starts anyway', () => {
    // The difference between this list and `requiredInProduction`, and the reason
    // there are two lists. Video has a degraded mode built across three PRs; exiting
    // here would take down login, the wallet and the meter to prevent something the
    // product is already designed to survive.
    const { status, stdout } = boot(PRODUCTION);

    assert.equal(status, 0);
    assert.match(stdout, /booted/);
  });

  it('still exits when something with no degraded mode is missing', () => {
    const { status, stderr } = boot({ ...PRODUCTION, GEMINI_API_KEY: '' });

    assert.equal(status, 1);
    assert.match(stderr, /Missing in production: GEMINI_API_KEY/);
  });

  it('says nothing once the key is set', () => {
    const { status, stderr } = boot({ ...PRODUCTION, DAILY_API_KEY: 'a-key' });

    assert.equal(status, 0);
    assert.equal(stderr.trim(), '');
  });
});

describe('booting outside production', () => {
  it('warns about nothing — development without a video key is a supported setup', () => {
    // The property that keeps `npm test` hermetic and keeps a laptop with no vendor
    // accounts able to run the product. A warning here would be noise on every boot.
    const { status, stderr } = boot({ ...PRODUCTION, NODE_ENV: 'development' });

    assert.equal(status, 0);
    assert.equal(stderr.trim(), '');
  });
});
