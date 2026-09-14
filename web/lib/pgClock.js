import { prisma, Prisma } from "@lifeweb/db";

// SERVER ONLY. One read of the database's own clock. Every "as of when" stamp a live surface
// reconciles against must come from Postgres, never Date.now() — web-container/DB clock drift can
// make a fresh row look older than the stale one it should replace.

const clockSql = Prisma.sql`SELECT (EXTRACT(EPOCH FROM now()) * 1000)::double precision AS "nowMs"`;

export async function pgNowMs() {
  const rows = await prisma.$queryRaw(clockSql);
  return Number(rows[0]?.nowMs ?? Date.now());
}
