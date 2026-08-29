-- Telegram two-way chat metadata for comments.
ALTER TABLE "Comment" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "source" "TicketSource" NOT NULL DEFAULT 'WEB';
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "externalAuthorName" TEXT;
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "externalMessageId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Comment_externalMessageId_key" ON "Comment"("externalMessageId");
CREATE INDEX IF NOT EXISTS "Comment_source_createdAt_id_idx" ON "Comment"("source", "createdAt", "id");
