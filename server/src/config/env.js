import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Environment, validated once at boot.
 *
 * The point is fail-fast: a missing JWT_SECRET should stop the process on startup
 * with a message naming the variable, not surface as a 500 halfway through a demo.
 *
 * Variables are optional until the epic that needs them lands — an absent Daily key
 * must not stop PR 0.4 from booting. `requiredInProduction` below is what tightens
 * that for the deployed environment, and `warnInProduction` is for the ones a
 * deployment can survive without but must not lose silently.
 */

/**
 * One `.env` for the whole monorepo, at the repo root, next to `docker-compose.yml`
 * and `prisma.config.js` — both of which already read from there.
 *
 * The path is resolved from this file rather than from `process.cwd()`, because cwd
 * is not the repo root when it matters: `npm run dev -w server` runs with cwd set to
 * `server/`, so a bare `import 'dotenv/config'` looks for `server/.env`, finds
 * nothing, and the server refuses to boot with every variable reported missing.
 *
 * Missing file is not an error. In production Render injects the variables directly
 * and no `.env` exists — the schema below is what decides whether that is survivable.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: resolve(REPO_ROOT, '.env') });

/**
 * An optional positive integer that tolerates being present and blank.
 *
 * `.env.example` ships `VIDEO_ROOM_TTL_SECONDS=` with nothing after the `=`, which
 * is how a reader is shown a knob without being made to set it. dotenv puts that in
 * `process.env` as `''`, and `''` is not absent: a plain `z.coerce.number()` turns
 * it into `0` — a zero-second room — while adding `.positive()` makes the same blank
 * line refuse to boot. Both are worse than the default the caller already has, so an
 * empty string is read as "not set" and `config/video.js` supplies the number.
 */
const optionalPositiveInt = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // ── database ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),

  // ── auth (PR 1.1) ─────────────────────────────────────────────────────────
  // Separate secrets on purpose: a leaked access secret must not mint refresh tokens.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Comma-separated list. PR 0.4 splits and whitelists it.
  //
  // Still needed after 6b.2's proxy, and for two callers rather than one: the socket
  // connects to this origin directly, because Vercel's rewrites do not carry a
  // WebSocket upgrade, and the API must stay callable directly if the proxy is ever
  // removed. A proxy that quietly became the only working path would be this list
  // rotting untested until the day something needs it.
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // ── the refresh cookie's site boundary (PR 6b.2) ──────────────────────────
  // `lax` when the browser reaches this API on the same site as the client — which
  // is what the Vercel `/api` proxy arranges, and the only arrangement in which a
  // browser reliably keeps the cookie. `none` for a client on a different
  // registrable domain calling this origin directly; it works in a plain window and
  // is dropped by Safari, by Firefox's Total Cookie Protection and by every private
  // window, which is the defect 6b.2 exists to fix rather than a supported mode.
  //
  // Unset falls back to `auth.token.service.js`'s original rule, so an existing
  // deployment behaves exactly as it did until somebody sets this on purpose.
  // Blank reads as unset, for the same reason `optionalPositiveInt` above does it:
  // `.env.example` ships the variable with nothing after the `=`, and a reader who
  // leaves it that way must get the default rather than a server that will not boot.
  REFRESH_COOKIE_SAMESITE: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['lax', 'none', 'strict']).optional(),
  ),

  // ── external services — optional until their epic ─────────────────────────
  CLOUDINARY_CLOUD_NAME: z.string().optional(), // E3
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(), // E3 — question classification (PR 3.3)

  // E6 — the video call itself (PR 6.1). Optional like Cloudinary and Gemini above,
  // and the degradation is deliberate: with no key a session still starts, the
  // `sessions.video_room_*` columns stay null, and the screen renders everything
  // except the call. Both TTLs have defaults in `config/video.js`; they are here so
  // the two numbers are settable per environment without a deploy.
  DAILY_API_KEY: z.string().optional(),
  VIDEO_ROOM_TTL_SECONDS: optionalPositiveInt,
  VIDEO_TOKEN_TTL_SECONDS: optionalPositiveInt,

  RESEND_API_KEY: z.string().optional(), // E5
  EMAIL_FROM: z.string().email().optional(),
});

/** Optional above, but mandatory once deployed. Checked only when NODE_ENV=production. */
const requiredInProduction = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'GEMINI_API_KEY',
];

/**
 * Deployed without these and the product still works, with one part of it switched
 * off. Said out loud at boot; never a reason to refuse to start. PR 6b.1.
 *
 * **This list exists because of what happened without it.** `DAILY_API_KEY` was never
 * declared in `render.yaml`, so the deployed API never had one, so every session ever
 * started in production ran without a camera — from PR 6.1 until 6b.1 found it in a
 * log. Every layer behaved exactly as designed: 6.3 accepts the offer anyway rather
 * than 500ing on a video outage, 6.4 tries to repair the room on first join, 6.7
 * renders "No video on this session" and keeps the clock running. Nothing was broken
 * and nothing said anything. The gap was never a missing check on the request path —
 * it was that no layer's job was to notice the key had never existed.
 *
 * **Warn rather than exit, and the difference from `requiredInProduction` is not
 * squeamishness.** Cloudinary and Gemini have no degraded mode: a question cannot be
 * submitted without an image host and cannot be filed without a classifier, so a
 * deploy missing those is a deploy that cannot serve its own main flow, and failing at
 * boot beats failing per-request. Video has a degraded mode, built deliberately across
 * three PRs and tested in 6.8. Exiting here would take down login, the wallet, the
 * meter and every session on the platform to prevent something the product is already
 * designed to survive.
 */
const warnInProduction = [['DAILY_API_KEY', 'sessions will run with no video call']];

/**
 * The warn-list entries whose variable is absent. Pure, exported, and separate from
 * `load()` so that the rule can be tested without a process that exits.
 *
 * @param {Record<string, unknown>} values  a parsed environment
 * @returns {Array<[string, string]>}  the missing entries, `[key, consequence]`
 */
export function missingOptionalInProduction(values) {
  return warnInProduction.filter(([key]) => !values[key]);
}

function load() {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    // Deliberately console + exit rather than throw: this runs before the logger
    // and before any error handler exists, and a stack trace here helps nobody.
    console.error('\nInvalid environment. Fix .env and restart.\n');
    console.error(lines.join('\n'));
    console.error('\nSee .env.example for the full list.\n');
    process.exit(1);
  }

  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    const missing = requiredInProduction.filter((key) => !env[key]);
    if (missing.length > 0) {
      console.error(`\nMissing in production: ${missing.join(', ')}\n`);
      process.exit(1);
    }

    // `console` rather than the logger, for the same reason the block above uses it:
    // this runs at import time, before `config/logger.js` has been constructed.
    for (const [key, consequence] of missingOptionalInProduction(env)) {
      console.error(`\nMissing in production: ${key} — ${consequence}. Starting anyway.\n`);
    }
  }

  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}

export const env = load();
