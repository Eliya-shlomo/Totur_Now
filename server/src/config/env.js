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
 * Variables are optional until the epic that needs them lands — an absent Zoom key
 * must not stop PR 0.4 from booting. `requiredInProduction` below is what tightens
 * that for the deployed environment.
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
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // ── external services — optional until their epic ─────────────────────────
  CLOUDINARY_CLOUD_NAME: z.string().optional(), // E3
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(), // E3 — question classification (PR 3.3)

  ZOOM_ACCOUNT_ID: z.string().optional(), // E6
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),

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
