#!/usr/bin/env bash

# Usage: ./clean_if_new_version.sh N
# Cleans packages if _build/VERSION.txt exists and does not match N.

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <version-number>"
  exit 1
fi

VERSION_FILE="_build/VERSION.txt"
TARGET_VERSION="$1"

mkdir -p "$(dirname "$VERSION_FILE")"
if [ -f "$VERSION_FILE" ]; then
  CURRENT_VERSION="$(cat "$VERSION_FILE")"
  if [ "$CURRENT_VERSION" != "$TARGET_VERSION" ]; then
    echo "Version mismatch: $CURRENT_VERSION != $TARGET_VERSION"
    echo "Cleaning packages and resetting worker..."
    make clean_packages
    rm -rf _build/worker
    rm -rf _build/pyodide
    ./setup.sh
    echo "$TARGET_VERSION" > "$VERSION_FILE"
  else
    echo "Version matches ($CURRENT_VERSION). No clean needed."
  fi
else
  echo "Version file not found. Setting it..."
  echo "$TARGET_VERSION" > "$VERSION_FILE"
fi
