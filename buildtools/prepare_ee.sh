#!/usr/bin/env bash

# Sets up the full edition of Grist: checks out the Grist Labs extensions
# (grist-ee) into the ext directory, and installs the extra node packages they
# need into ext/node_modules (inside the checkout).

set -e

if ! ./buildtools/checkout-ext-directory.sh grist-ee; then
  echo "ERROR: Could not download Grist extensions for the full edition." >&2
  echo "Check your network or run 'yarn run set-community-edition' to install the community edition." >&2
  exit 1
fi

# Ext's dependencies go to ext/node_modules, resolved after the main
# node_modules (see webpack.config.js); duplicate @types must be removed
# (see dedupe-ext-types.sh).
if [[ -e ext/package.json ]]; then
  yarn install --cwd ext --frozen-lockfile
  ./buildtools/dedupe-ext-types.sh
fi

echo "+ Full edition ready (ext/ and ext/node_modules)."
