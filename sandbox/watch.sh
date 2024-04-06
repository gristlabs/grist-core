#!/usr/bin/env bash

set -x

PROJECT=""
if [[ -e ext/app ]]; then
  PROJECT="tsconfig-ext.json"
fi
WEBPACK_CONFIG=buildtools/webpack.config.js
if [[ -e ext/buildtools/webpack.config.js ]]; then
  WEBPACK_CONFIG=ext/buildtools/webpack.config.js
fi

if [ ! -e _build ]; then
  buildtools/build.sh
fi

tsc --build -w --preserveWatchOutput $PROJECT &
css_files="app/client/**/*.css"
chokidar "${css_files}" -c "bash -O globstar -c 'cat ${css_files} > static/bundle.css'" &
webpack --config $WEBPACK_CONFIG --mode development --watch &
NODE_PATH=_build:_build/stubs:_build/ext nodemon ${NODE_INSPECT:+--inspect} --delay 1 -w _build/app/server -w _build/app/common _build/stubs/app/server/server.js &

wait
