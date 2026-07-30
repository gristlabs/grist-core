#!/usr/bin/env bash

# Remove from ext/node_modules any @types package the main install already
# provides. tsc resolves an import's @types by proximity — walking
# node_modules/@types up from the importing file, uncontrollable via typeRoots,
# paths, or NODE_PATH, so a duplicate copy in ext/node_modules shadows the main
# one for ext sources, and tsc treats the two copies as incompatible types
# (e.g. "Request is not assignable to Request"). Runtime packages are left alone.

set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

if [[ -d ext/node_modules/@types && -d node_modules/@types ]]; then
  shopt -s nullglob
  for entry in ext/node_modules/@types/*; do
    name="${entry#ext/node_modules/@types/}"
    [[ -e "node_modules/@types/$name" ]] && rm -rf "$entry"
  done
  rmdir ext/node_modules/@types 2>/dev/null || true
  shopt -u nullglob
fi
