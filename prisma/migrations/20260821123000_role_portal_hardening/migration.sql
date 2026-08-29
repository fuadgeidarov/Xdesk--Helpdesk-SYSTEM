-- Xdesk role portal hardening: workflow statuses and explicit staff presence.
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'WAITING_RESPONSE';
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'RESOLVED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PresenceStatus') THEN
    CREATE TYPE "PresenceStatus" AS ENUM ('ONLINE', 'AWAY', 'OFFLINE');
  END IF;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "presenceStatus" "PresenceStatus" NOT NULL DEFAULT 'OFFLINE';

CREATE INDEX IF NOT EXISTS "User_role_isActive_isBlocked_presenceStatus_idx"
  ON "User" ("role", "isActive", "isBlocked", "presenceStatus");

CREATE INDEX IF NOT EXISTS "Ticket_status_assigneeId_priority_lastActivityAt_id_idx"
  ON "Ticket" ("status", "assigneeId", "priority", "lastActivityAt" DESC, "id" DESC);

-- Normalize historical ticket lifecycle timestamps.
UPDATE "Ticket" SET "closedAt" = COALESCE("closedAt", "updatedAt") WHERE "status" = 'CLOSED' AND "closedAt" IS NULL;
UPDATE "Ticket" SET "closedAt" = NULL WHERE "status" <> 'CLOSED' AND "closedAt" IS NOT NULL;

-- Knowledge base is readable by every authenticated Xdesk user; mutations remain admin-only.
UPDATE "KnowledgeArticle" SET "visibility" = 'ALL' WHERE "visibility" = 'STAFF';
