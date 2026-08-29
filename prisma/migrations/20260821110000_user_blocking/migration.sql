-- Separate account blocking from archival/deletion.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isBlocked" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "User_isActive_isBlocked_role_idx"
  ON "User" ("isActive", "isBlocked", "role");
