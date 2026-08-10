import 'dotenv/config';
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

  ANTHROPIC_API_KEY: z.string().optional(), // E3

  ZOOM_ACCOUNT_ID: z.string().optional(), // E6
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),

  RESEND_API_KEY: z.string().optional(), // E5
  EMAIL_FROM: z.string().email().optional(),
});

/** Optional above, but mandatory once deployed. Checked only when NODE_ENV=production. */
const requiredInProduction = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'ANTHROPIC_API_KEY',
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
