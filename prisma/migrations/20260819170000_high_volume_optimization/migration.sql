-- High-volume ticket/comment indexes.
CREATE INDEX IF NOT EXISTS "Ticket_createdAt_id_idx" ON "Ticket" ("createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Ticket_authorId_createdAt_id_idx" ON "Ticket" ("authorId", "createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Ticket_status_lastActivityAt_id_idx" ON "Ticket" ("status", "lastActivityAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Ticket_assigneeId_status_lastActivityAt_id_idx" ON "Ticket" ("assigneeId", "status", "lastActivityAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Ticket_status_priority_lastActivityAt_id_idx" ON "Ticket" ("status", "priority", "lastActivityAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Comment_ticketId_createdAt_id_idx" ON "Comment" ("ticketId", "createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Comment_ticketId_isInternal_createdAt_idx" ON "Comment" ("ticketId", "isInternal", "createdAt" ASC, "id" ASC);

-- Trigram search keeps text search from turning into a sequential scan as tickets grow.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Ticket_title_trgm_idx" ON "Ticket" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Ticket_description_trgm_idx" ON "Ticket" USING GIN ("description" gin_trgm_ops);
