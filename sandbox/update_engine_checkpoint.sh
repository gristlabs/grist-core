#!/usr/bin/env bash

# Create a checkpoint of a gvisor sandbox, or of a pyodide sandbox if
# GRIST_SANDBOX_FLAVOR is pyodide. For gvisor, it is best to make the
# checkpoint in as close to the same circumstances as it will be used,
# because of some nuances around file descriptor ordering and
# mapping. So we create the checkpoint in a roundabout way, from node,
# starting the sandbox the same way the server does.
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

export NODE_PATH=_build:_build/core:_build/ext:_build/stubs:ext/node_modules
source $SCRIPT_DIR/get_checkpoint_path.sh

if [[ -z "$GRIST_CHECKPOINT" || "$GRIST_CHECKPOINT" = "none" ]]; then
  echo "Skipping checkpoint generation"
  exit 0
fi

if [[ "$GRIST_SANDBOX_FLAVOR" != "pyodide" ]]; then
  export GRIST_SANDBOX_FLAVOR=gvisor
fi
export PYTHON_VERSION=3

BUILD=$(test -e _build/core && echo "_build/core" || echo "_build")
node $BUILD/app/server/generateCheckpoint.js
