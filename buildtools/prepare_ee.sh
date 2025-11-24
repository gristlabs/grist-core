#!/usr/bin/env bash

# This checks out the Grist Labs extensions (grist-ee) into
# the ext directory, and installs any extra node packages
# they need in ../node_modules. If this directory doesn't
# exist, the user is given a chance to abort (add -y to
# force the action).

set -e

if [[ "$1" != "-y" && ! -e "../node_modules" ]]; then
  echo "+ This will place material in ../node_modules"
  echo "+ Hit ^C to abort, or Enter to continue"
  read
fi

set -x  # Show commands
./buildtools/checkout-ext-directory.sh grist-ee
yarn install --cwd ext --modules-folder ../../node_modules/
{ set +x; } 2>/dev/null  # Hide commands again
echo "+ Updated ext and ../node_modules"
