ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "store" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "store" TEXT;

CREATE INDEX IF NOT EXISTS "User_store_idx" ON "User"("store");
CREATE INDEX IF NOT EXISTS "Ticket_store_status_lastActivityAt_id_idx"
  ON "Ticket"("store", "status", "lastActivityAt", "id");
