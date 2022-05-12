#!/usr/bin/env bash

set -x

PROJECT=""
export GRIST_EXT=stubs
if [[ -e ext/app ]]; then
  PROJECT="tsconfig-ext.json"
fi

if [ ! -e _build ]; then
  buildtools/build.sh
fi

tsc --build -w --preserveWatchOutput $PROJECT &
catw app/client/*.css app/client/*/*.css -o static/bundle.css -v & webpack --config buildtools/webpack.config.js --mode development --watch --hide-modules &
NODE_PATH=_build:_build/stubs:_build/ext nodemon --delay 1 -w _build/app/server -w _build/app/common _build/stubs/app/server/server.js &

wait
