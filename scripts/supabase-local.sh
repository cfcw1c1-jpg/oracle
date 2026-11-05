#!/usr/bin/env bash
# Runs the Supabase CLI with this project's own credentials from
# .env.supabase.local, without touching the global `supabase login`.
#
#   ./scripts/supabase-local.sh projects list
#   ./scripts/supabase-local.sh functions deploy send-message-notification
#   npm run sb -- db dump --schema public
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${SUPABASE_ENV_FILE:-$ROOT/.env.supabase.local}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# Refuse to run with an empty token: the CLI would otherwise silently fall
# back to the global login, which is exactly what this wrapper avoids.
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is empty in $ENV_FILE. Add a token from https://supabase.com/dashboard/account/tokens" >&2
  exit 1
fi

# Never let this wrapper change the global session.
case "${1:-}" in
  login|logout)
    echo "'supabase $1' is disabled here; it would change the global login. Edit $ENV_FILE instead." >&2
    exit 1
    ;;
esac

cd "$ROOT"
exec supabase "$@"
