#!/bin/sh
set -eu

# Xdesk production startup.
# Important: only failures that make the application schema unusable are fatal.
# Diagnostics/optimisation checks must not put the web container into a restart loop.

node <<'NODE'
const auth = process.env.AUTH_SECRET || "";
const db = process.env.POSTGRES_PASSWORD || "";
if (!auth || auth.includes("REPLACE_WITH")) {
  console.error("[Xdesk] AUTH_SECRET is missing or still contains a placeholder.");
  process.exit(1);
}
if (!db || db.includes("REPLACE_WITH")) {
  console.error("[Xdesk] POSTGRES_PASSWORD is missing or still contains a placeholder.");
  process.exit(1);
}
if (auth.length < 32) console.warn("[Xdesk] WARNING: AUTH_SECRET shorter than 32 characters.");
if (db.length < 12) console.warn("[Xdesk] WARNING: PostgreSQL password shorter than 12 characters.");
if (process.env.COOKIE_SECURE === "true" && process.env.APP_URL && !process.env.APP_URL.startsWith("https://")) {
  console.warn("[Xdesk] WARNING: COOKIE_SECURE=true with a non-HTTPS APP_URL may prevent login cookies from working.");
}
NODE

# Always construct the internal Docker DATABASE_URL from the actual database
# credentials. This prevents a stale/placeholder DATABASE_URL from .env from
# breaking an otherwise valid Docker installation.
DB_USER_ENC="$(node -p "encodeURIComponent(process.env.POSTGRES_USER || 'xdesk')")"
DB_PASS_ENC="$(node -p "encodeURIComponent(process.env.POSTGRES_PASSWORD || '')")"
DB_NAME_ENC="$(node -p "encodeURIComponent(process.env.POSTGRES_DB || 'xdesk')")"
export DATABASE_URL="postgresql://${DB_USER_ENC}:${DB_PASS_ENC}@db:5432/${DB_NAME_ENC}?schema=public&connection_limit=${DB_CONNECTION_LIMIT:-20}&pool_timeout=${DB_POOL_TIMEOUT:-20}&connect_timeout=10"

# Prisma schema synchronization is the one database step that is required for
# the current application binary. The Telegram integration adds a UNIQUE index
# for Comment.externalMessageId so duplicate Telegram updates cannot be written
# twice. Prisma classifies adding any UNIQUE constraint to an existing table as
# a potential data-loss change and refuses non-interactively unless
# --accept-data-loss is supplied. This flag only acknowledges the schema change;
# PostgreSQL will still reject the operation if real duplicate non-NULL values
# exist. Retry only covers transient DB readiness errors.
echo "[Xdesk] Synchronizing Prisma schema..."
SYNC_OK=0
ATTEMPT=1
while [ "$ATTEMPT" -le 10 ]; do
  if npx prisma db push --skip-generate --accept-data-loss; then
    SYNC_OK=1
    break
  fi
  echo "[Xdesk] Prisma schema sync attempt $ATTEMPT/10 failed; retrying in 3 seconds..." >&2
  ATTEMPT=$((ATTEMPT + 1))
  sleep 3
done
if [ "$SYNC_OK" -ne 1 ]; then
  echo "[Xdesk] FATAL: Prisma schema could not be synchronized after 10 attempts." >&2
  exit 1
fi

# These SQL files contain indexes, constraints and compatibility hardening.
# Prisma db push above already guarantees the columns/enums required by the app.
# Run every file independently so one legacy-data/index issue cannot prevent the
# portal from starting. Any warning remains visible in docker compose logs.
echo "[Xdesk] Applying idempotent database hardening..."
for SQL in \
  ./prisma/migrations/20260819170000_high_volume_optimization/migration.sql \
  ./prisma/migrations/20260820183000_add_store_fields/migration.sql \
  ./prisma/migrations/20260820213000_database_hardening/migration.sql \
  ./prisma/migrations/20260821110000_user_blocking/migration.sql \
  ./prisma/migrations/20260821123000_role_portal_hardening/migration.sql \
  ./prisma/migrations/20260827233000_telegram_chat/migration.sql
do
  if [ -f "$SQL" ]; then
    echo "[Xdesk] Applying $(basename "$(dirname "$SQL")")..."
    if ! npx prisma db execute --schema=./prisma/schema.prisma --file="$SQL"; then
      echo "[Xdesk] WARNING: optional hardening SQL failed: $SQL" >&2
    fi
  fi
done

# The integrity checker is diagnostic. Historical data/index drift must be
# reported, but should not make the application permanently unhealthy.
if [ "${DB_STARTUP_CHECK:-true}" = "true" ]; then
  echo "[Xdesk] Running database integrity check..."
  if ! npx tsx ./scripts/db-check.ts; then
    echo "[Xdesk] WARNING: database integrity check reported issues; application will still start." >&2
  fi
fi

case "${SEED_DEFAULT_USERS:-false}" in
  true|auto)
    echo "[Xdesk] Ensuring standard initial users are present..."
    if ! npx tsx prisma/seed.ts; then
      echo "[Xdesk] WARNING: initial-user seed failed; existing users are left untouched." >&2
    fi
    ;;
  *)
    echo "[Xdesk] Automatic initial users are disabled."
    ;;
esac

echo "[Xdesk] Starting application..."
exec node server.js
