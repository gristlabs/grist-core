#!/usr/bin/env bash
#
# Prunes files from an installed node_modules tree (or any directory) that aren't
# needed at runtime (e.g. source maps, Typescript/Flow declarations).
#
# Usage: buildtools/prune-runtime-modules.sh <dir>

set -euo pipefail

dir="${1:?usage: prune-runtime-modules.sh <dir>}"
if [[ ! -d "$dir" ]]; then
  echo "prune-runtime-modules: not a directory: $dir" >&2
  exit 1
fi

# Remove source maps and TypeScript/Flow declarations.
find "$dir" -type f \( \
  -name '*.map' \
  -o -name '*.d.ts' \
  -o -name '*.d.cts' \
  -o -name '*.d.mts' \
  -o -name '*.flow' \
\) -delete

# Remove any directories left empty by the above (e.g. @types/*, dist-types/).
find "$dir" -type d -empty -delete
