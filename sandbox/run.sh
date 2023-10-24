#!/usr/bin/env bash

set -e

if [[ "$GRIST_SANDBOX_FLAVOR" = "gvisor" ]]; then
  ./sandbox/gvisor/update_engine_checkpoint.sh
  source ./sandbox/gvisor/get_checkpoint_path.sh
fi

NODE_PATH=_build:_build/stubs:_build/ext node _build/stubs/app/server/server.js
