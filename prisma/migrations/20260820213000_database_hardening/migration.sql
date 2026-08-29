-- Xdesk database hardening for production/high-volume workloads.
-- This migration is written to be safe for an already populated database.

-- Ratings must always be in the supported 1..5 range.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Rating_score_check'
  ) THEN
    ALTER TABLE "Rating"
      ADD CONSTRAINT "Rating_score_check" CHECK ("score" BETWEEN 1 AND 5) NOT VALID;
  END IF;
END $$;

-- Every attachment belongs to exactly one entity: either a ticket or a comment.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Attachment_exactly_one_parent_check'
  ) THEN
    ALTER TABLE "Attachment"
      ADD CONSTRAINT "Attachment_exactly_one_parent_check"
      CHECK (("ticketId" IS NOT NULL)::int + ("commentId" IS NOT NULL)::int = 1) NOT VALID;
  END IF;
END $$;

-- Validate constraints only when historical data is clean. NOT VALID constraints
-- still protect every new/updated row even if old bad rows need manual repair.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Rating" WHERE "score" < 1 OR "score" > 5) THEN
    ALTER TABLE "Rating" VALIDATE CONSTRAINT "Rating_score_check";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Attachment"
    WHERE (("ticketId" IS NOT NULL)::int + ("commentId" IS NOT NULL)::int) <> 1
  ) THEN
    ALTER TABLE "Attachment" VALIDATE CONSTRAINT "Attachment_exactly_one_parent_check";
  END IF;
END $$;

-- Extra indexes for the most common operational and analytics paths.
CREATE INDEX IF NOT EXISTS "Ticket_active_lastActivityAt_id_idx"
  ON "Ticket" ("lastActivityAt" DESC, "id" DESC)
  WHERE "status" <> 'CLOSED'::"TicketStatus";

CREATE INDEX IF NOT EXISTS "Ticket_unassigned_active_idx"
  ON "Ticket" ("status", "lastActivityAt" DESC, "id" DESC)
  WHERE "assigneeId" IS NULL AND "status" <> 'CLOSED'::"TicketStatus";

CREATE INDEX IF NOT EXISTS "Comment_authorId_createdAt_id_idx"
  ON "Comment" ("authorId", "createdAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "Rating_agentId_score_createdAt_idx"
  ON "Rating" ("agentId", "score", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Rating_createdAt_idx"
  ON "Rating" ("createdAt" DESC);

-- The app normalizes new emails to lowercase. Add DB-level protection where
-- historical data permits it; otherwise the startup checker will report duplicates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'User_email_lower_unique_idx'
  ) AND NOT EXISTS (
    SELECT 1 FROM "User" GROUP BY lower("email") HAVING count(*) > 1
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX "User_email_lower_unique_idx" ON "User" (lower("email"))';
  END IF;
END $$;

ALTER TABLE "Ticket" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_threshold = 50
);

ALTER TABLE "Comment" SET (
  autovacuum_vacuum_scale_factor = 0.03,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_threshold = 100
);

ALTER TABLE "AuthEvent" SET (
  autovacuum_vacuum_scale_factor = 0.10,
  autovacuum_analyze_scale_factor = 0.05
);

ANALYZE "Ticket";
ANALYZE "Comment";
ANALYZE "Rating";
ANALYZE "AuthEvent";
