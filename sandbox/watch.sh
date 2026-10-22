#!/usr/bin/env bash

set -x

NO_NODEMON=false
for arg in $@; do
  if [[ $arg == "--no-nodemon" ]]; then
    NO_NODEMON=true
  fi
done

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
# Show debug-level logs while developing.
: "${GRIST_LOG_LEVEL:=debug}"
export GRIST_LOG_LEVEL
if ! $NO_NODEMON; then
  NODE_PATH="_build:_build/ext:_build/stubs:ext/node_modules" \
  nodemon \
    ${NODE_INSPECT} \
    --delay 1 \
    -w _build/app/server \
    -w _build/app/common \
    -w assets/locales \
    -w ext/assets/locales \
    -i assets/locales/en.client.json \
    -i assets/locales/en.server.json \
    -i ext/assets/locales/en.client.json \
    -i ext/assets/locales/en.server.json \
    _build/stubs/app/server/server.js &
fi


wait
