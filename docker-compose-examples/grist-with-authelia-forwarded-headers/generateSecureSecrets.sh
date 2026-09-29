#!/usr/bin/env bash
# Generates the random secrets Authelia needs, into the ./secrets directory.
set -eu

SCRIPT_DIR=$(dirname "$0")
mkdir -p "$SCRIPT_DIR/secrets"

function generateSecureString {
  # Parses an Authelia-generated secret ("Random Value: ...") for the value.
  docker run --rm authelia/authelia:4 authelia crypto rand --charset=rfc3986 --length="$1" \
    | cut -d ":" -f 2 | tr -d '[:blank:]'
}

generateSecureString 128 > "$SCRIPT_DIR/secrets/JWT_SECRET"
generateSecureString 128 > "$SCRIPT_DIR/secrets/SESSION_SECRET"
generateSecureString 128 > "$SCRIPT_DIR/secrets/STORAGE_ENCRYPTION_KEY"
