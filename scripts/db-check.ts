import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ log: ["error"] });

const requiredIndexes = [
  "Ticket_createdAt_id_idx",
  "Ticket_status_lastActivityAt_id_idx",
  "Ticket_assigneeId_status_lastActivityAt_id_idx",
  "Comment_ticketId_createdAt_id_idx",
  "Comment_ticketId_isInternal_createdAt_idx",
  "Ticket_title_trgm_idx",
  "Ticket_description_trgm_idx",
  "Ticket_active_lastActivityAt_id_idx",
  "Ticket_unassigned_active_idx",
  "Rating_agentId_score_createdAt_idx",
  "Ticket_status_assigneeId_priority_lastActivityAt_id_idx",
  "User_role_isActive_isBlocked_presenceStatus_idx",
];

type CountRow = { count: bigint };
type SettingRow = { value: string };
type IndexRow = { indexname: string };
type ConstraintRow = { conname: string; convalidated: boolean };

async function scalarCount(sql: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>(sql);
  return rows[0] ? Number(rows[0].count) : 0;
}

async function main() {
  console.log("Xdesk DB check: starting...");

  const versionRows = await prisma.$queryRaw<Array<{ version: string }>>(Prisma.sql`SELECT version()`);
  console.log(`PostgreSQL: ${versionRows[0]?.version ?? "unknown"}`);

  const maxConnections = await prisma.$queryRaw<SettingRow[]>(Prisma.sql`SELECT current_setting('max_connections') AS value`);
  const sharedBuffers = await prisma.$queryRaw<SettingRow[]>(Prisma.sql`SELECT current_setting('shared_buffers') AS value`);
  console.log(`max_connections=${maxConnections[0]?.value}, shared_buffers=${sharedBuffers[0]?.value}`);

  const [users, tickets, comments, ratings, authEvents] = await Promise.all([
    prisma.user.count(),
    prisma.ticket.count(),
    prisma.comment.count(),
    prisma.rating.count(),
    prisma.authEvent.count(),
  ]);
  console.log(`Rows: users=${users}, tickets=${tickets}, comments=${comments}, ratings=${ratings}, authEvents=${authEvents}`);

  const [badAttachments, badRatings, orphanComments, duplicateEmails, badLifecycle, invalidActiveAssignees, orphanKnowledgeFiles] = await Promise.all([
    scalarCount(Prisma.sql`SELECT count(*)::bigint AS count FROM "Attachment" WHERE (("ticketId" IS NOT NULL)::int + ("commentId" IS NOT NULL)::int) <> 1`),
    scalarCount(Prisma.sql`SELECT count(*)::bigint AS count FROM "Rating" WHERE "score" < 1 OR "score" > 5`),
    scalarCount(Prisma.sql`SELECT count(*)::bigint AS count FROM "Comment" c LEFT JOIN "Ticket" t ON t.id = c."ticketId" LEFT JOIN "User" u ON u.id = c."authorId" WHERE t.id IS NULL OR (c."authorId" IS NOT NULL AND u.id IS NULL)`),
    scalarCount(Prisma.sql`SELECT count(*)::bigint AS count FROM (SELECT lower("email") FROM "User" GROUP BY lower("email") HAVING count(*) > 1) d`),
    scalarCount(Prisma.sql`SELECT count(*)::bigint AS count FROM "Ticket" WHERE ("status" = 'CLOSED' AND "closedAt" IS NULL) OR ("status" <> 'CLOSED' AND "closedAt" IS NOT NULL)`),
    scalarCount(Prisma.sql`SELECT count(*)::bigint AS count FROM "Ticket" t LEFT JOIN "User" u ON u.id = t."assigneeId" WHERE t."status" <> 'CLOSED' AND t."assigneeId" IS NOT NULL AND (u.id IS NULL OR u."isActive" = false OR u."isBlocked" = true OR u."role" NOT IN ('AGENT','ADMIN'))`),
    scalarCount(Prisma.sql`SELECT count(*)::bigint AS count FROM "KnowledgeAttachment" ka LEFT JOIN "KnowledgeArticle" a ON a.id = ka."articleId" WHERE a.id IS NULL`),
  ]);

  let critical = false;
  if (badAttachments > 0) { console.error(`CRITICAL: invalid attachments=${badAttachments}`); critical = true; }
  if (badRatings > 0) { console.error(`CRITICAL: ratings outside 1..5=${badRatings}`); critical = true; }
  if (orphanComments > 0) { console.error(`CRITICAL: orphan comments=${orphanComments}`); critical = true; }
  if (badLifecycle > 0) { console.error(`CRITICAL: inconsistent ticket lifecycle timestamps=${badLifecycle}`); critical = true; }
  if (invalidActiveAssignees > 0) { console.error(`CRITICAL: active tickets assigned to unavailable/non-IT users=${invalidActiveAssignees}`); critical = true; }
  if (orphanKnowledgeFiles > 0) { console.error(`CRITICAL: orphan knowledge attachments=${orphanKnowledgeFiles}`); critical = true; }
  if (duplicateEmails > 0) console.warn(`WARNING: case-insensitive duplicate emails=${duplicateEmails}; normalize them before enabling the lower(email) unique index.`);

  const indexes = await prisma.$queryRaw<IndexRow[]>(
    Prisma.sql`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`,
  );
  const indexNames = new Set(indexes.map((row) => row.indexname));
  const missing = requiredIndexes.filter((name) => !indexNames.has(name));
  if (missing.length) {
    console.error(`CRITICAL: missing performance indexes: ${missing.join(", ")}`);
    critical = true;
  }

  const constraints = await prisma.$queryRaw<ConstraintRow[]>(
    Prisma.sql`SELECT conname, convalidated FROM pg_constraint WHERE conname IN ('Rating_score_check','Attachment_exactly_one_parent_check') ORDER BY conname`,
  );
  for (const expected of ["Rating_score_check", "Attachment_exactly_one_parent_check"]) {
    const row = constraints.find((item) => item.conname === expected);
    if (!row) {
      console.error(`CRITICAL: missing constraint ${expected}`);
      critical = true;
    } else if (!row.convalidated) {
      console.warn(`WARNING: ${expected} protects new rows but historical data has not been validated yet.`);
    }
  }

  if (critical) throw new Error("Database integrity/performance check failed");
  console.log("Xdesk DB check: OK");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
