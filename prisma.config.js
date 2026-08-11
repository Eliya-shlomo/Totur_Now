// Prisma CLI configuration.
//
// Two things make this file necessary rather than optional:
//
// 1. The schema folder at prisma/schema/ (OWNERSHIP.md §3.1) is not
//    auto-detected — the CLI looks only at ./prisma/schema.prisma and
//    ./schema.prisma — so its location has to be declared somewhere.
// 2. Migrations default to a `migrations/` folder *next to the schema*, which
//    for a schema folder means prisma/schema/migrations/. PR 0.2 and
//    OWNERSHIP.md §3.1 both put them at prisma/migrations/, and only a config
//    file can move them. The package.json#prisma key cannot express a migrations
//    path, and it is deprecated in Prisma 7 regardless.
//
// Prisma stops loading .env by itself as soon as a config file exists, so the
// import below restores it. Without that line every command fails with
// "Environment variable not found: DATABASE_URL".

import 'dotenv/config';

import path from 'node:path';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),

    // PR 0.7's seed. It lives here rather than under `package.json#prisma` — that
    // key is deprecated in Prisma 7 and conflicts with this file — so that
    // `prisma migrate reset` reseeds automatically. `npm run db:seed` runs the
    // same script directly.
    seed: 'node prisma/seed/index.js',
  },
});
