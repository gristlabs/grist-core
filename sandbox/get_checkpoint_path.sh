#!/usr/bin/env bash

# This defines a GRIST_CHECKPOINT environment variable, where we will store
# a sandbox checkpoint, unless it is set already (GRIST_CHECKPOINT=none
# turns checkpoints off). The path is in principle arbitrary. In practice,
# it is helpful if it lies outside of the Grist repo (to avoid permission
# problems with docker users), but is distinct for each possible location
# of the Grist repo (to avoid collisions in distinct Jenkins jobs).
#
# This script also determines the best flags to call gvisor with. It tries:
#   --unprivileged --ignore-cgroups   : for a newer rebased fork of gvisor
#   --unprivileged                    : for an older fork of gvisor
#   --rootless                        : unforked gvisor
# The fork adds --unprivileged, from
# https://github.com/google/gvisor/issues/4371#issuecomment-700917549
# Unforked gvisor has not been able to make checkpoints in rootless mode;
# if that is still so, making one fails with an error.
# It leaves the flags in a GVISOR_FLAGS environment variable. This
# variable is respected by the sandbox/gvisor/run.py wrapper for running
# python in gvisor.

function check_gvisor {
  # If we already have working gvisor flags, return.
  if [[ -n "$GVISOR_FLAGS" ]]; then
    return
  fi
  # Check if a trivial command works under gvisor with the proposed flags.
  if runsc --network none "$@" "do" true 2> /dev/null; then
    export GVISOR_FLAGS="$@"
    export GVISOR_AVAILABLE=1
  fi
}

check_gvisor --unprivileged --ignore-cgroups
check_gvisor --unprivileged
check_gvisor --rootless

# Pyodide keeps its checkpoint apart from gvisor's, since making a gvisor
# checkpoint clears the directory.
if [[ -z "$GRIST_CHECKPOINT" ]]; then
  if [[ "$GRIST_SANDBOX_FLAVOR" = "pyodide" ]]; then
    export GRIST_CHECKPOINT=/tmp/engine_pyodide_$(echo $PWD | sed "s/[^a-zA-Z0-9]/_/g")
  elif [[ -n "$GVISOR_FLAGS" ]]; then
    export GRIST_CHECKPOINT=/tmp/engine_$(echo $PWD | sed "s/[^a-zA-Z0-9]/_/g")
  fi
fi
