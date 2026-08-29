#!/usr/bin/env bash
# Generates random passwords for this example into a .env file, which
# docker compose reads automatically. Run it before the first
# `docker compose up`: the passwords get baked into the services'
# databases at first startup.
set -eu

SCRIPT_DIR=$(dirname "$0")

if [ -e "$SCRIPT_DIR/.env" ]; then
  echo ".env already exists; not overwriting it." >&2
  exit 1
fi
if [ -d "$SCRIPT_DIR/persist" ]; then
  echo "Warning: ./persist exists; services that already started keep their current passwords." >&2
fi

function generateSecureString {
  openssl rand -hex "$1"
}

cat > "$SCRIPT_DIR/.env" <<EOF
DATABASE_PASSWORD=$(generateSecureString 24)
MINIO_PASSWORD=$(generateSecureString 24)
OIDC_CLIENT_SECRET=$(generateSecureString 24)
KEYCLOAK_DATABASE_PASSWORD=$(generateSecureString 24)
KEYCLOAK_ADMIN_PASSWORD=$(generateSecureString 12)
EOF
echo "Wrote $SCRIPT_DIR/.env"
