#!/usr/bin/env bash

set -e

if [[ "$GRIST_SANDBOX_FLAVOR" = "gvisor" ]]; then
  ./sandbox/gvisor/update_engine_checkpoint.sh
  source ./sandbox/gvisor/get_checkpoint_path.sh
fi

if [[ -n "$GRIST_PROMCLIENT_PORT" ]]; then
  require_promclient="--require ./_build/stubs/app/server/prometheus-exporter.js"
fi

NODE_PATH=_build:_build/stubs:_build/ext node ${require_promclient} _build/stubs/app/server/server.js
