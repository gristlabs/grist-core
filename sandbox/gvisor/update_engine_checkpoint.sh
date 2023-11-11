#!/usr/bin/env bash

# Create a checkpoint of a gvisor sandbox. It is best to make the
# checkpoint in as close to the same circumstances as it will be used,
# because of some nuances around file descriptor ordering and
# mapping. So we create the checkpoint in a roundabout way, by opening
# node and creating an NSandbox, with appropriate flags set.
#
# Watch out if you feel tempted to simplify this, I initially had a
# much simpler solution that worked fine in docker, but on aws
# would result in a runsc panic related to file descriptor
# ordering/mapping.
#
# Note for mac users: the checkpoint will be made in the docker
# container running runsc.

set -e

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

export NODE_PATH=_build:_build/core:_build/stubs:_build/ext
source $SCRIPT_DIR/get_checkpoint_path.sh

if [[ -z "$GRIST_CHECKPOINT" ]]; then
  echo "Skipping checkpoint generation"
  exit 0
fi

export GRIST_CHECKPOINT_MAKE=1
export GRIST_SANDBOX_FLAVOR=gvisor
export PYTHON_VERSION=3

BUILD=$(test -e _build/core && echo "_build/core" || echo "_build")
node $BUILD/app/server/generateCheckpoint.js
