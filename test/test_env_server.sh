#!/usr/bin/env bash

# Run server tests with the same behavior-affecting options that apply in prod.
export NODE_OPTIONS="--disable-proto=delete${NODE_OPTIONS:+ $NODE_OPTIONS}"

. "$(dirname -- "$0")"/test_env.sh
