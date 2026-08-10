// The one PrismaClient in the process.
//
// PrismaClient owns a connection pool, so constructing a second one doubles the
// pool against a database that has a fixed connection limit — Neon's free tier
// in particular. Everything that talks to the database imports this instance:
//
//   import { prisma } from '#config/db.js';
//
// Repositories only. A service that imports this file is a layering violation,
// and a controller that does is a failed review (CONVENTIONS.md, "Server
// layering").

import { PrismaClient } from '@prisma/client';

// `node --watch` re-executes this module on every save. Without the global
// cache that leaks a fresh pool per reload until Postgres refuses connections.
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error', 'query'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Called by the server's shutdown handler (PR 0.4). Prisma flushes pending
// queries and closes the pool; skipping it leaves connections open on Neon for
// as long as its idle timeout.
export async function disconnectDb() {
  await prisma.$disconnect();
}
