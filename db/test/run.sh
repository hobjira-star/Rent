#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres cluster and runs db/test/checks.sql.
# Uses DATABASE_URL if set (CI); otherwise starts a temporary local cluster.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${DATABASE_URL:-}" ]]; then
  URL="$DATABASE_URL"
else
  PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  TMP="$(mktemp -d)"
  RUNAS=()
  if [[ "$(id -u)" == "0" ]]; then
    id -u rentpg >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin rentpg
    chown rentpg "$TMP"
    RUNAS=(runuser -u rentpg --)
  fi
  "${RUNAS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
  "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p 55432 -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
  trap '"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null; rm -rf "$TMP"' EXIT
  URL="postgresql://postgres@/postgres?host=$TMP&port=55432"
fi

for f in migrations/*.sql; do
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$URL" -v ON_ERROR_STOP=1 -q -f test/checks.sql
echo "db checks passed"
