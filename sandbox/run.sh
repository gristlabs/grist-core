#!/usr/bin/env bash

set -e

if [[ "$GRIST_SANDBOX_FLAVOR" = "gvisor" ]]; then
  ./sandbox/gvisor/update_engine_checkpoint.sh
  source ./sandbox/gvisor/get_checkpoint_path.sh
fi

node _build/stubs/app/server/server.js
