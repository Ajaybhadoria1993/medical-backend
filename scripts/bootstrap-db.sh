#!/usr/bin/env sh
# Creates the database plus the extensions and helper function drizzle cannot generate.
# Usage: scripts/bootstrap-db.sh [dev|staging|prod]  — reads .env, nothing hardcoded here.

set -eu

cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env not found in $(pwd)"; exit 1; }

env_name="${1:-prod}"
case "$env_name" in
  prod)    prefix=PROD ;;
  staging) prefix=STAGING ;;
  dev)     prefix=DEV ;;
  *) echo "Usage: $0 [dev|staging|prod]"; exit 1 ;;
esac

# Read one key without sourcing .env, so odd values cannot execute as shell.
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//'; }

host=$(env_get "${prefix}_DB_HOST")
port=$(env_get "${prefix}_DB_PORT")
user=$(env_get "${prefix}_DB_USER")
name=$(env_get "${prefix}_DB_NAME")
PGPASSWORD=$(env_get "${prefix}_DB_PASS")
export PGPASSWORD

[ -n "$host" ] && [ -n "$user" ] && [ -n "$name" ] || {
  echo "Missing ${prefix}_DB_HOST / _DB_USER / _DB_NAME in .env"; exit 1; }

# Mirrors dbConfig.ts: local hosts go without TLS, everything else requires it.
case "$host" in
  localhost|host.docker.internal) sslmode=disable ;;
  *) sslmode=require ;;
esac

conn="host=$host port=${port:-5432} user=$user sslmode=$sslmode"
echo "Bootstrapping '$name' ($env_name)..."

if psql "$conn dbname=postgres" -tAc "SELECT 1 FROM pg_database WHERE datname='$name'" | grep -q 1; then
  echo "  database already exists"
else
  psql "$conn dbname=postgres" -c "CREATE DATABASE \"$name\";"
  echo "  database created"
fi

psql "$conn dbname=$name" -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is STABLE, so it cannot be indexed; pinning the dictionary
-- makes this wrapper IMMUTABLE and usable in indexes.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent', $1) $$
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;
SQL

psql "$conn dbname=$name" -c '\dx'
echo "Done. Next: npm run db:migrate:$env_name && npm run db:seed:$env_name"
