import { prisma } from '#config/db.js';

/**
 * The only database access the health check needs.
 *
 * This exists as a repository rather than as two lines inside the route because
 * of the layering rule in CONVENTIONS.md — `routes → controllers → services →
 * repositories → prisma`. A route that imports `prisma` is a failed review, and
 * "it is only a health check" is exactly the argument that erodes the rule.
 *
 * `SELECT 1` is deliberate: it proves the connection pool can hand out a working
 * connection without depending on any table existing, so the check still reports
 * honestly on a database that has not been migrated yet.
 */
export async function pingDb() {
  await prisma.$queryRaw`SELECT 1`;
}
