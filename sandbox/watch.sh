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
# DEBUG=1 keeps dev output verbose. Historically `yarn start` was
# noisy by accident (stubs/server.ts sets GRIST_LOG_LEVEL=error after
# log.ts has already been imported, so the level never took effect).
# Under RestartShell the env propagates correctly to the child and
# the intended "error" level kicks in, so we'd otherwise see almost
# nothing during dev. Set DEBUG explicitly to keep the old spew.
: "${DEBUG:=1}"
export DEBUG
! $NO_NODEMON && NODE_PATH=_build:_build/ext:_build/stubs nodemon ${NODE_INSPECT} --delay 1 -w _build/app/server -w _build/app/common _build/stubs/app/server/server.js &

wait
