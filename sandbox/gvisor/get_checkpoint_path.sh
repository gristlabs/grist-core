#!/usr/bin/env bash

# This defines a GRIST_CHECKPOINT environment variable, where we will store
# a sandbox checkpoint. The path is in principle arbitrary. In practice,
# it is helpful if it lies outside of the Grist repo (to avoid permission
# problems with docker users), but is distinct for each possible location
# of the Grist repo (to avoid collisions in distinct Jenkins jobs).
#
# Checkpointing is currently not supported by gvisor when running in
# rootless mode. Rootless mode is nevertheless the best way to run
# "mainstream" unpatched gvisor for Grist. If gvisor is unpatched
# (does not have the --unprivileged flag from
# https://github.com/google/gvisor/issues/4371#issuecomment-700917549)
# then we do not define GRIST_CHECKPOINT and checkpoints will not be
# used. If the host is linux, performance seems just fine; in other
# configurations we've seen about a second delay in initial load of
# python due to a relatively sluggish file system.
#
# So as part of figuring whether to allow checkpoints, this script
# determines the best flags to call gvisor with. It tries:
#   --unprivileged --ignore-cgroups   : for a newer rebased fork of gvisor
#   --unprivileged                    : for an older fork of gvisor
#   --rootless                        : unforked gvisor
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

# If we can't use --unprivileged, stick with --rootless. We will not make a checkpoint.
check_gvisor --rootless

if [[ "$GVISOR_FLAGS" =~ "-unprivileged" ]]; then
  export GRIST_CHECKPOINT=/tmp/engine_$(echo $PWD | sed "s/[^a-zA-Z0-9]/_/g")
fi
