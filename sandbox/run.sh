#!/usr/bin/env bash

set -e

if [[ "$GRIST_SANDBOX_FLAVOR" = "gvisor" ]]; then
  source ./sandbox/gvisor/get_checkpoint_path.sh

  # Check GVISOR_FLAGS we ended up with.
  if runsc --network none $GVISOR_FLAGS "do" true 2> /dev/null; then
    echo "gvisor check ok (flags: ${GVISOR_FLAGS})"
  else
    echo "gvisor check failed (flags: ${GVISOR_FLAGS}); consider different GVISOR_FLAGS or GRIST_SANDBOX_FLAVOR"
    exit 1
  fi

  ./sandbox/gvisor/update_engine_checkpoint.sh
fi

NODE_PATH=_build:_build/stubs:_build/ext node _build/stubs/app/server/server.js
