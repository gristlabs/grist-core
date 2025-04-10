#!/usr/bin/env bash

NODE_PATH=_build:_build/stubs:_build/ext node _build/app/server/companion.js "$@"
